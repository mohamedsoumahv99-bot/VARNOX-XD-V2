/**
 * VARNOX XD V2 — lib/botInstance.js  v4
 *
 * v4 :
 *  - Garde _botHandlersAttached déplacée en HAUT de attachBotHandlers.
 *    En v3 elle était après tous les ev.on(), donc seul connection.update
 *    était protégé contre le double-enregistrement. Maintenant TOUS les
 *    handlers sont protégés si attachBotHandlers est appelé deux fois sur
 *    le même objet socket.
 *
 *  Note : avec le fix two-socket de web.js v18, attachBotHandlers n'est
 *  plus jamais appelé sur le socket de couplage. Il est uniquement appelé
 *  depuis createBotInstance qui crée toujours un nouveau socket. Cette garde
 *  est donc une sécurité défensive.
 *
 * Usage unique depuis v18 :
 *   createBotInstance(sessionDir, ownerNumber)
 *     → Crée un nouveau socket Baileys et attache les handlers.
 *     → Utilisé au boot (sessions existantes) ET après couplage réussi.
 */
'use strict';

const fs        = require('fs');
const path      = require('path');
const pino      = require('pino');
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
} = require('@whiskeysockets/baileys');

const PhoneNumber = require('awesome-phonenumber');
const { smsg }    = require('./myfunc');
const createStore = require('./lightweight_store');

function getHandlers() { return require('../main'); }

/* ─── Version Baileys — préchargée au démarrage ─────────────── */
let _version = [2, 3000, 1023097280]; // fallback immédiat

// Précharge en arrière-plan dès le require
fetchLatestBaileysVersion()
  .then(r => { if (r?.version) _version = r.version; })
  .catch(() => {});

function getVersion() { return _version; }

/* ─── Registry des instances ─────────────────────────────────── */
// Map<string, { sock, store, sessionDir, ownerNumber, connected, restartTimer, saveCreds }>
const instances = new Map();

/* ═══════════════════════════════════════════════════════════════
 *  attachBotHandlers
 *  Attache tous les handlers Baileys à un socket déjà existant.
 *  Peut être appelé sur le socket de couplage après connection:'open'
 *  → aucune deuxième connexion WhatsApp nécessaire.
 * ═══════════════════════════════════════════════════════════════ */
function attachBotHandlers(sock, sessionDir, ownerNumber, saveCreds) {
  // ── Garde anti-double-enregistrement ──────────────────────────────────────
  // Déplacée en TÊTE (v4) : protège TOUS les handlers, pas seulement connection.update.
  // En pratique (web.js v18), attachBotHandlers n'est appelé qu'une fois par socket
  // (depuis createBotInstance), mais cette garde reste une sécurité défensive.
  if (sock._botHandlersAttached) return;
  sock._botHandlersAttached = true;

  const key = String(ownerNumber);

  // ── Store par instance ─────────────────────────────────────────────────────
  // Si une instance existait déjà (reconnexion), on réutilise son store pour
  // préserver le cache de messages; sinon on en crée un nouveau.
  const existingStore = instances.get(key)?.store;
  const store = existingStore || createStore();

  const inst = { sock, store, sessionDir, ownerNumber: key, connected: false, restartTimer: null, saveCreds };
  instances.set(key, inst);

  // ── Helpers ────────────────────────────────────────────────────────────────
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

  sock.public     = true;
  sock.store      = store;   // accès direct au store depuis les commandes (ex: delete.js)
  sock.serializeM = (m) => smsg(sock, m, store);

  // ── Credentials ────────────────────────────────────────────────────────────
  if (saveCreds) sock.ev.on('creds.update', saveCreds);
  store.bind(sock.ev);

  // ── Contacts ───────────────────────────────────────────────────────────────
  sock.ev.on('contacts.update', update => {
    for (const contact of update) {
      const id = sock.decodeJid(contact.id);
      if (store?.contacts) store.contacts[id] = { id, name: contact.notify };
    }
  });

  // ── Messages ───────────────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async (chatUpdate) => {
    try {
      const { handleMessages, handleStatus } = getHandlers();
      const mek = chatUpdate.messages[0];
      if (!mek?.message) return;
      mek.message = Object.keys(mek.message)[0] === 'ephemeralMessage'
        ? mek.message.ephemeralMessage.message : mek.message;

      if (mek.key?.remoteJid === 'status@broadcast') {
        await handleStatus(sock, chatUpdate); return;
      }
      if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;
      if (sock?.msgRetryCounterCache) sock.msgRetryCounterCache.clear();

      await handleMessages(sock, chatUpdate, true);
    } catch (err) {
      console.error(`[BOT:${key}] messages.upsert:`, err.message);
    }
  });

  // ── Participants groupe ─────────────────────────────────────────────────────
  sock.ev.on('group-participants.update', async (update) => {
    try {
      const { handleGroupParticipantUpdate } = getHandlers();
      await handleGroupParticipantUpdate(sock, update);
    } catch (err) {
      console.error(`[BOT:${key}] group-participants:`, err.message);
    }
  });

  // ── Statuts ────────────────────────────────────────────────────────────────
  sock.ev.on('status.update',     async (s) => { try { const { handleStatus } = getHandlers(); await handleStatus(sock, s); } catch {} });
  sock.ev.on('messages.reaction', async (s) => { try { const { handleStatus } = getHandlers(); await handleStatus(sock, s); } catch {} });

  // ── Anti-call ──────────────────────────────────────────────────────────────
  const antiCallNotified = new Set();
  sock.ev.on('call', async (calls) => {
    try {
      const { readState } = require('../commands/anticall');
      if (!readState().enabled) return;
      for (const call of calls) {
        const jid = call.from || call.peerJid || call.chatId;
        if (!jid) continue;
        try { if (typeof sock.rejectCall === 'function' && call.id) await sock.rejectCall(call.id, jid); } catch {}
        if (!antiCallNotified.has(jid)) {
          antiCallNotified.add(jid);
          setTimeout(() => antiCallNotified.delete(jid), 60000);
          sock.sendMessage(jid, { text: '📵 Anticall activé. Votre appel a été rejeté.' }).catch(() => {});
        }
        setTimeout(async () => { try { await sock.updateBlockStatus(jid, 'block'); } catch {} }, 800);
      }
    } catch {}
  });

  // ── Connexion / reconnexion ────────────────────────────────────────────────
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      inst.connected = true;
      console.log(`[BOT:${key}] ✅ Connected`);
    }
    if (connection === 'close') {
      inst.connected = false;
      const code      = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut || code === 401;

      console.log(`[BOT:${key}] Closed (code ${code}). LoggedOut: ${loggedOut}`);

      if (loggedOut) {
        // Supprimer uniquement les fichiers de CETTE session
        try {
          fs.readdirSync(sessionDir).forEach(f => {
            try { fs.rmSync(path.join(sessionDir, f), { force: true }); } catch {}
          });
        } catch {}
        instances.delete(key);
        return;
      }

      // Reconnexion automatique
      if (inst.restartTimer) clearTimeout(inst.restartTimer);
      inst.restartTimer = setTimeout(async () => {
        if (!fs.existsSync(path.join(sessionDir, 'creds.json'))) {
          instances.delete(key); return;
        }
        console.log(`[BOT:${key}] Reconnecting…`);
        try { await createBotInstance(sessionDir, key); } catch (e) {
          console.error(`[BOT:${key}] Reconnect failed:`, e.message);
        }
      }, 5000);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
 *  createBotInstance
 *  Crée un nouveau socket Baileys et attache les handlers.
 *  Utilisé pour restaurer les sessions existantes au démarrage.
 * ═══════════════════════════════════════════════════════════════ */
async function createBotInstance(sessionDir, ownerNumber) {
  const key = String(ownerNumber);

  if (instances.has(key)) {
    const old = instances.get(key);
    if (old.restartTimer) clearTimeout(old.restartTimer);
    try { old.sock?.ws?.close(); } catch {}
    // On ne delete pas ici : on garde l'entrée pour récupérer l'ancien store
    // dans attachBotHandlers (évite de perdre le cache de messages).
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`[BOT:${key}] Creating new socket (session: ${sessionDir})`);

  const logger  = pino({ level: 'silent' });
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  // Récupérer le store existant pour cette instance (si reconnexion)
  const existingStore = instances.get(key)?.store;

  const sock = makeWASocket({
    version              : getVersion(),
    logger,
    printQRInTerminal    : false,
    browser              : Browsers.ubuntu('Chrome'),
    auth: {
      creds : state.creds,
      keys  : makeCacheableSignalKeyStore(state.keys, logger),
    },
    getMessage: async (k) => {
      // Utiliser le store de cette instance spécifique
      const instNow = instances.get(key);
      if (!instNow?.store) return undefined;
      const jid = jidNormalizedUser(k.remoteJid);
      const msg = await instNow.store.loadMessage(jid, k.id);
      return msg?.message || undefined;
    },
    msgRetryCounterCache  : new NodeCache({ stdTTL: 120 }),
    defaultQueryTimeoutMs : 60000,
    connectTimeoutMs      : 60000,
    keepAliveIntervalMs   : 10000,
  });

  // Supprimer l'ancienne instance APRÈS avoir créé le socket
  // (attachBotHandlers récupérera le store via instances.get(key))
  if (existingStore) {
    // On garde l'entrée avec le store mais on update le sock
    const old = instances.get(key);
    if (old) old.sock = null; // marquer comme remplacé
  }

  attachBotHandlers(sock, sessionDir, ownerNumber, saveCreds);
  return sock;
}

/* ─── API publique ──────────────────────────────────────────── */
function stopBotInstance(ownerNumber) {
  const key  = String(ownerNumber);
  const inst = instances.get(key);
  if (!inst) return;
  if (inst.restartTimer) clearTimeout(inst.restartTimer);
  try { inst.sock?.ws?.close(); } catch {}
  instances.delete(key);
}

function getBotInstance(ownerNumber) {
  return instances.get(String(ownerNumber)) || null;
}

function getAllInstances() {
  return [...instances.entries()].map(([num, inst]) => ({
    number    : num,
    sessionDir: inst.sessionDir,
    connected : inst.connected,
    running   : !!inst.sock,
  }));
}

/** Marque une instance comme connectée (appelé par web.js après couplage réussi) */
function markConnected(ownerNumber) {
  const inst = instances.get(String(ownerNumber));
  if (inst) inst.connected = true;
}

module.exports = { attachBotHandlers, createBotInstance, stopBotInstance, getBotInstance, getAllInstances, markConnected, getVersion };
