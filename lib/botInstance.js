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
// Current fallback used by the known-good Baileys 7 pairing flow. Keep this
// current even when the remote version manifest is temporarily unavailable;
// an old fallback can generate a code that WhatsApp displays but rejects.
let _version = [2, 3000, 1043857760];
let _versionPromise = fetchLatestBaileysVersion()
  .then(r => {
    if (r?.version) _version = r.version;
    return _version;
  })
  .catch(() => _version);

function getVersion() { return _version; }

// Le pairing doit attendre la version WA actuelle. Le fallback historique
// pouvait générer un code affiché mais refusé lors de sa validation.
async function getLatestVersion() {
  try {
    return await Promise.race([
      _versionPromise,
      new Promise(resolve => setTimeout(() => resolve(_version), 2500)),
    ]);
  } catch {
    return _version;
  }
}

/* ─── Registry des instances ─────────────────────────────────── */
// Map<string, { sock, store, sessionDir, ownerNumber, connected, restartTimer, saveCreds }>
const instances = new Map();

const SUPPORT_GROUP_INVITE_CODE =
  process.env.SUPPORT_GROUP_INVITE_CODE || 'HpJN2EktnykClKR5bmz2Dv';
const SUPPORT_CHANNEL_INVITE_CODE =
  process.env.SUPPORT_CHANNEL_INVITE_CODE || '0029Vb7jG2KEawdwHsZiEm1E';
const SUPPORT_CHANNEL_JID = process.env.SUPPORT_CHANNEL_JID || null;
let resolvedSupportChannelJid = SUPPORT_CHANNEL_JID;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function resolveSupportChannelJid(sock) {
  if (resolvedSupportChannelJid) return resolvedSupportChannelJid;
  if (typeof sock.newsletterMetadata !== 'function') {
    throw new Error('newsletterMetadata indisponible dans cette version de Baileys');
  }

  const metadata = await sock.newsletterMetadata('invite', SUPPORT_CHANNEL_INVITE_CODE);
  const jid = metadata?.id;
  if (!jid || !jid.endsWith('@newsletter')) {
    throw new Error('JID de chaîne introuvable depuis le lien d’invitation');
  }

  resolvedSupportChannelJid = jid;
  return jid;
}

async function runCommunityAction(label, action) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await action();
      console.log(`[COMMUNITY] ${label}`);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(attempt * 1500);
    }
  }

  // A failed community join must never interrupt the bot connection.
  console.warn(`[COMMUNITY] ${label} ignoré: ${lastError?.message || 'erreur inconnue'}`);
  return false;
}

/**
 * Add the newly connected account to the official VARNOX spaces.
 *
 * This is intentionally done on connection, not from the menu. The account
 * owner must still be allowed by WhatsApp to accept the group invitation;
 * failures are logged and never prevent the bot from starting.
 */
async function joinOfficialSpaces(sock) {
  if (typeof sock.groupAcceptInvite === 'function') {
    await runCommunityAction(
      'Groupe support rejoint ou déjà accessible',
      () => sock.groupAcceptInvite(SUPPORT_GROUP_INVITE_CODE),
    );
  }

  if (typeof sock.newsletterFollow === 'function') {
    await runCommunityAction(
      'Chaîne VARNOX suivie ou déjà suivie',
      async () => {
        const channelJid = await resolveSupportChannelJid(sock);
        await sock.newsletterFollow(channelJid);
      },
    );
  }
}

function scheduleCommunityJoin(inst, key, sock) {
  if (inst.communityJoinStarted) return;
  inst.communityJoinStarted = true;
  setTimeout(() => {
    joinOfficialSpaces(sock).catch((error) => {
      console.warn(`[BOT:${key}] Community setup failed:`, error.message);
    });
  }, 1000);
}

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

  const previous = instances.get(key);
  const inst = {
    sock,
    store,
    sessionDir,
    ownerNumber: key,
    connected: false,
    restartTimer: null,
    saveCreds,
    connectionNoticeSent: previous?.connectionNoticeSent || false,
    communityJoinStarted: false,
  };
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
  if (saveCreds && !sock._credsHandlerAttached) {
    sock.ev.on('creds.update', saveCreds);
    sock._credsHandlerAttached = true;
  }
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

      scheduleCommunityJoin(inst, key, sock);

      // Confirmer le couplage directement dans le chat du compte lié.
      // Une seule fois par instance logique, pas à chaque message/reconnexion.
      if (!inst.connectionNoticeSent && sock.user?.id) {
        inst.connectionNoticeSent = true;
        const selfJid = jidNormalizedUser(sock.user.id);
        setTimeout(() => {
          sock.sendMessage(selfJid, {
            text: '✅ VARNOX XD V2 est connecté avec succès.\n\nEnvoie .menu pour afficher les commandes.',
          }).catch((err) => {
            inst.connectionNoticeSent = false;
            console.error(`[BOT:${key}] Confirmation message failed:`, err.message);
          });
        }, 1500);
      }
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
  if (inst) {
    inst.connected = true;
    // The web pairing flow calls markConnected after connection:'open' has
    // already fired, so its community join must be scheduled here as well.
    scheduleCommunityJoin(inst, String(ownerNumber), inst.sock);
  }
}

module.exports = {
  attachBotHandlers,
  createBotInstance,
  stopBotInstance,
  getBotInstance,
  getAllInstances,
  markConnected,
  getVersion,
  getLatestVersion,
};
