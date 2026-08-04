/**
 * VARNOX XD V2 — lib/botInstance.js
 *
 * Crée un bot Baileys en mémoire pour un utilisateur donné.
 * Appelé par web.js au lieu de spawner un processus enfant.
 * Chaque instance a son propre socket, sa propre session,
 * et partage les handlers de main.js.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const pino = require('pino');
const NodeCache = require('node-cache');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidDecode,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  Browsers,
  delay,
} = require('@whiskeysockets/baileys');

const PhoneNumber = require('awesome-phonenumber');
const { smsg } = require('./myfunc');
const store   = require('./lightweight_store');

// Lazy-require main.js handlers to avoid circular deps at module load
function getHandlers() {
  return require('../main');
}

// ─── Cache version globale ─────────────────────────────────────────────────────
let _cachedVersion = null;
async function getVersion() {
  if (_cachedVersion) return _cachedVersion;
  try {
    const r = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000)),
    ]);
    if (r?.version) { _cachedVersion = r.version; return r.version; }
  } catch {}
  return [2, 3000, 1023097280];
}

// ─── Registry des instances actives ──────────────────────────────────────────
// Map<string, { sock, sessionDir, ownerNumber, connected, restartTimer }>
const instances = new Map();

/**
 * Crée (ou redémarre) une instance bot pour un utilisateur.
 *
 * @param {string} sessionDir   - Chemin vers le dossier de session
 * @param {string} ownerNumber  - Numéro de téléphone sans + (ex: '224610835573')
 * @returns {Promise<object>}   - Socket Baileys
 */
async function createBotInstance(sessionDir, ownerNumber) {
  const key = String(ownerNumber);

  // Arrêter l'ancienne instance si elle existe
  if (instances.has(key)) {
    const old = instances.get(key);
    if (old.restartTimer) clearTimeout(old.restartTimer);
    try { old.sock?.ws?.close(); } catch {}
    instances.delete(key);
    await delay(1500);
  }

  console.log(`[BOT:${key}] Starting in-memory bot (session: ${sessionDir})`);

  const version = await getVersion();
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const logger  = pino({ level: 'silent' });

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal : false,
    browser           : Browsers.ubuntu('Chrome'),
    auth: {
      creds : state.creds,
      keys  : makeCacheableSignalKeyStore(state.keys, logger),
    },
    getMessage: async (key) => {
      const jid = jidNormalizedUser(key.remoteJid);
      const msg = await store.loadMessage(jid, key.id);
      return msg?.message || '';
    },
    msgRetryCounterCache : new NodeCache({ stdTTL: 120 }),
    defaultQueryTimeoutMs: 60000,
    connectTimeoutMs     : 60000,
    keepAliveIntervalMs  : 10000,
  });

  const inst = { sock, sessionDir, ownerNumber: key, connected: false, restartTimer: null };
  instances.set(key, inst);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  sock.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      const d = jidDecode(jid) || {};
      return d.user && d.server ? `${d.user}@${d.server}` : jid;
    }
    return jid;
  };

  sock.getName = (jid, withoutContact = false) => {
    const id = sock.decodeJid(jid);
    if (id.endsWith('@g.us')) {
      return new Promise(async (resolve) => {
        let v = store.contacts[id] || {};
        if (!(v.name || v.subject)) v = sock.groupMetadata?.(id) || {};
        resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'));
      });
    }
    const v = id === '0@s.whatsapp.net'
      ? { id, name: 'WhatsApp' }
      : id === sock.decodeJid(sock.user?.id) ? sock.user : (store.contacts[id] || {});
    return (withoutContact ? '' : v.name) || v.subject || v.verifiedName
      || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international');
  };

  sock.public      = true;
  sock.serializeM  = (m) => smsg(sock, m, store);

  // ── Enregistrement des credentials ───────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);
  store.bind(sock.ev);

  // ── Contacts ─────────────────────────────────────────────────────────────────
  sock.ev.on('contacts.update', update => {
    for (const contact of update) {
      const id = sock.decodeJid(contact.id);
      if (store?.contacts) store.contacts[id] = { id, name: contact.notify };
    }
  });

  // ── Messages ─────────────────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async (chatUpdate) => {
    try {
      const { handleMessages, handleStatus } = getHandlers();
      const mek = chatUpdate.messages[0];
      if (!mek?.message) return;
      mek.message = Object.keys(mek.message)[0] === 'ephemeralMessage'
        ? mek.message.ephemeralMessage.message
        : mek.message;

      if (mek.key?.remoteJid === 'status@broadcast') {
        await handleStatus(sock, chatUpdate);
        return;
      }
      if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;
      if (sock?.msgRetryCounterCache) sock.msgRetryCounterCache.clear();

      await handleMessages(sock, chatUpdate, true);
    } catch (err) {
      console.error(`[BOT:${key}] messages.upsert error:`, err.message);
    }
  });

  // ── Participants de groupe ────────────────────────────────────────────────────
  sock.ev.on('group-participants.update', async (update) => {
    try {
      const { handleGroupParticipantUpdate } = getHandlers();
      await handleGroupParticipantUpdate(sock, update);
    } catch (err) {
      console.error(`[BOT:${key}] group-participants error:`, err.message);
    }
  });

  // ── Statuts ───────────────────────────────────────────────────────────────────
  sock.ev.on('status.update', async (s) => {
    try { const { handleStatus } = getHandlers(); await handleStatus(sock, s); } catch {}
  });
  sock.ev.on('messages.reaction', async (s) => {
    try { const { handleStatus } = getHandlers(); await handleStatus(sock, s); } catch {}
  });

  // ── Anti-call ─────────────────────────────────────────────────────────────────
  const antiCallNotified = new Set();
  sock.ev.on('call', async (calls) => {
    try {
      const { readState } = require('../commands/anticall');
      const state = readState();
      if (!state.enabled) return;
      for (const call of calls) {
        const callerJid = call.from || call.peerJid || call.chatId;
        if (!callerJid) continue;
        try {
          if (typeof sock.rejectCall === 'function' && call.id) {
            await sock.rejectCall(call.id, callerJid);
          }
        } catch {}
        if (!antiCallNotified.has(callerJid)) {
          antiCallNotified.add(callerJid);
          setTimeout(() => antiCallNotified.delete(callerJid), 60000);
          await sock.sendMessage(callerJid, { text: '📵 Anticall activé. Votre appel a été rejeté.' }).catch(() => {});
        }
        setTimeout(async () => {
          try { await sock.updateBlockStatus(callerJid, 'block'); } catch {}
        }, 800);
      }
    } catch {}
  });

  // ── Connexion / reconnexion ───────────────────────────────────────────────────
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      inst.connected = true;
      console.log(`[BOT:${key}] ✅ Connected to WhatsApp`);
    }

    if (connection === 'close') {
      inst.connected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut  = statusCode === DisconnectReason.loggedOut || statusCode === 401;

      console.log(`[BOT:${key}] Connection closed (code ${statusCode}). LoggedOut: ${loggedOut}`);

      if (loggedOut) {
        console.log(`[BOT:${key}] Session logged out — clearing session files`);
        try {
          // Ne supprimer QUE la session de CET utilisateur, pas './session' hardcodé
          const files = fs.readdirSync(sessionDir);
          for (const f of files) {
            try { fs.rmSync(path.join(sessionDir, f), { force: true }); } catch {}
          }
        } catch {}
        instances.delete(key);
        return; // pas de reconnexion
      }

      // Reconnexion automatique après 5s
      if (inst.restartTimer) clearTimeout(inst.restartTimer);
      inst.restartTimer = setTimeout(async () => {
        if (!fs.existsSync(path.join(sessionDir, 'creds.json'))) {
          console.log(`[BOT:${key}] No session — skipping reconnect`);
          instances.delete(key);
          return;
        }
        console.log(`[BOT:${key}] Reconnecting…`);
        try { await createBotInstance(sessionDir, key); } catch (e) {
          console.error(`[BOT:${key}] Reconnect failed:`, e.message);
        }
      }, 5000);
    }
  });

  return sock;
}

/**
 * Arrête une instance bot.
 * @param {string} ownerNumber
 */
function stopBotInstance(ownerNumber) {
  const key  = String(ownerNumber);
  const inst = instances.get(key);
  if (!inst) return;
  if (inst.restartTimer) clearTimeout(inst.restartTimer);
  try { inst.sock?.ws?.close(); } catch {}
  instances.delete(key);
}

/**
 * Renvoie une instance active ou null.
 * @param {string} ownerNumber
 */
function getBotInstance(ownerNumber) {
  return instances.get(String(ownerNumber)) || null;
}

/**
 * Renvoie toutes les instances actives.
 */
function getAllInstances() {
  return [...instances.entries()].map(([num, inst]) => ({
    number    : num,
    sessionDir: inst.sessionDir,
    connected : inst.connected,
    running   : !!inst.sock,
  }));
}

module.exports = { createBotInstance, stopBotInstance, getBotInstance, getAllInstances };
