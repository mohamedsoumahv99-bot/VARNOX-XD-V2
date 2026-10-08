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
const { sessionManager, maskPhoneNumber, logSessionEvent } = require('./session-manager');

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
const instanceCreationPromises = new Map();

const runtimeStats = {
  startedAt: Date.now(),
  connectionEvents: 0,
  connected: 0,
  reconnectAttempts: 0,
  pairingActivations: 0,
  messageQueued: 0,
  messageDropped: 0,
  lastDisconnect: null,
};

const MESSAGE_CONCURRENCY = Math.max(1, Number(process.env.MESSAGE_CONCURRENCY || 4));
const MAX_MESSAGE_QUEUE = Math.max(25, Number(process.env.MAX_MESSAGE_QUEUE || 250));
const MAX_RECONNECT_ATTEMPTS = Math.max(1, Number(process.env.MAX_RECONNECT_ATTEMPTS || 10));

function serializeSaveCreds(saveCreds) {
  let pending = Promise.resolve();
  return function serializedSaveCreds() {
    const current = pending.then(() => saveCreds());
    pending = current.catch(() => {});
    return current;
  };
}

function closeSocket(sock, reason = 'replaced') {
  if (!sock) return;
  try {
    sock.ev?.removeAllListeners?.();
  } catch (error) {
    console.warn(`[VARNOX] Listener cleanup failed (${reason}):`, error.message);
  }
  try {
    sock.ws?.close();
  } catch (error) {
    console.warn(`[VARNOX] Socket close failed (${reason}):`, error.message);
  }
}

function enqueueMessage(inst, key, task) {
  if (inst.stopping) return;
  if (inst.messageQueue.length >= inst.maxMessageQueue) {
    runtimeStats.messageDropped += 1;
    console.warn(`[BOT:${key}] Message queue full (${inst.maxMessageQueue}); event skipped`);
    return;
  }

  inst.messageQueue.push(task);
  runtimeStats.messageQueued += 1;
  pumpMessages(inst, key);
}

function pumpMessages(inst, key) {
  while (!inst.stopping && inst.activeMessages < inst.messageConcurrency && inst.messageQueue.length) {
    const task = inst.messageQueue.shift();
    inst.activeMessages += 1;
    Promise.resolve()
      .then(task)
      .catch(error => console.error(`[BOT:${key}] queued message task:`, error.message))
      .finally(() => {
        inst.activeMessages -= 1;
        pumpMessages(inst, key);
      });
  }
}

const SUPPORT_GROUP_INVITE_CODE =
  process.env.SUPPORT_GROUP_INVITE_CODE || 'HpJN2EktnykClKR5bmz2Dv';
const SUPPORT_CHANNEL_INVITE_CODE =
  process.env.SUPPORT_CHANNEL_INVITE_CODE || '0029Vb7jG2KEawdwHsZiEm1E';
const SUPPORT_CHANNEL_JID = process.env.SUPPORT_CHANNEL_JID || null;
let resolvedSupportChannelJid = SUPPORT_CHANNEL_JID;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getDisconnectCode(error) {
  return error?.output?.statusCode ?? error?.data?.statusCode ?? error?.statusCode ?? error?.output?.payload?.statusCode ?? null;
}

function isLoggedOut(error) {
  const code = getDisconnectCode(error);
  return code === DisconnectReason.loggedOut || code === 401;
}

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

  if (typeof sock.newsletterFollow === 'function') {
    const primaryChannelJid = process.env.PRIMARY_CHANNEL_JID || '120363424782348922@newsletter';
    await runCommunityAction(
      'Chaîne principale suivie ou déjà suivie',
      () => sock.newsletterFollow(primaryChannelJid),
    );
  }
}

function scheduleCommunityJoin(inst, key, sock) {
  if (inst.communityJoinStarted) return;
  inst.communityJoinStarted = true;
  const timer = setTimeout(() => {
    inst.timers?.delete(timer);
    joinOfficialSpaces(sock).catch((error) => {
      console.warn(`[BOT:${key}] Community setup failed:`, error.message);
    });
  }, 1000);
  timer.unref?.();
  inst.timers?.add(timer);
}

/* ═══════════════════════════════════════════════════════════════
 *  attachBotHandlers
 *  Attache tous les handlers Baileys à un socket déjà existant.
 *  Peut être appelé sur le socket de couplage après connection:'open'
 *  → aucune deuxième connexion WhatsApp nécessaire.
 * ═══════════════════════════════════════════════════════════════ */
function attachBotHandlers(sock, sessionDir, ownerNumber, saveCreds, metadata = {}) {
  // ── Garde anti-double-enregistrement ──────────────────────────────────────
  // Déplacée en TÊTE (v4) : protège TOUS les handlers, pas seulement connection.update.
  // En pratique (web.js v18), attachBotHandlers n'est appelé qu'une fois par socket
  // (depuis createBotInstance), mais cette garde reste une sécurité défensive.
  if (sock._botHandlersAttached) return;
  sock._botHandlersAttached = true;

  const key = String(ownerNumber);
  const registeredSession = sessionManager.getByPhone(key);

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
    sessionId: metadata.sessionId || registeredSession?.sessionId || null,
    workerId: metadata.workerId || registeredSession?.workerId || null,
    connected: false,
    lifecycle: 'connecting',
    restartTimer: null,
    restartAttempts: previous?.restartAttempts || 0,
    reconnecting: false,
    stopping: false,
    saveCreds,
    connectionNoticeSent: previous?.connectionNoticeSent || false,
    communityJoinStarted: false,
    messageQueue: [],
    activeMessages: 0,
    messageConcurrency: MESSAGE_CONCURRENCY,
    maxMessageQueue: MAX_MESSAGE_QUEUE,
    timers: new Set(),
  };
  instances.set(key, inst);
  sessionManager.updateSession(key, {
    status: 'CONNECTING',
    sessionDir,
    reconnectAttempts: inst.restartAttempts,
  });

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
  sock.ev.on('messages.upsert', (chatUpdate) => {
    enqueueMessage(inst, key, async () => {
      try {
        const { handleMessages, handleStatus } = getHandlers();
        const mek = chatUpdate.messages[0];
        if (!mek?.message) return;
        mek.message = Object.keys(mek.message)[0] === 'ephemeralMessage'
          ? mek.message.ephemeralMessage.message : mek.message;

        if (mek.key?.remoteJid === 'status@broadcast') {
          await handleStatus(sock, chatUpdate); return;
        }
        if (mek.key?.id?.startsWith('BAE5') && mek.key.id.length === 16) return;
        if (sock?.msgRetryCounterCache) sock.msgRetryCounterCache.clear();

        if (mek.key?.remoteJid?.endsWith('@newsletter')) {
          try {
            const { handleChannelPost } = require('../commands/fakeract');
            await handleChannelPost(sock, mek);
          } catch (error) {
            console.error(`[BOT:${key}] channel reaction handler:`, error.message);
          }
        }

        await handleMessages(sock, chatUpdate, true);
      } catch (err) {
        console.error(`[BOT:${key}] messages.upsert:`, err.message);
      }
    });
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
  // Reconnect with backoff and ignore stale sockets.
  const scheduleReconnect = () => {
    if (inst.stopping || instances.get(key) !== inst || inst.restartTimer) return;
    if (inst.restartAttempts >= MAX_RECONNECT_ATTEMPTS) {
      inst.reconnecting = false;
      inst.lifecycle = 'disconnected';
      sessionManager.updateSession(key, {
        status: 'DISCONNECTED',
        reconnectAttempts: inst.restartAttempts,
      });
      logSessionEvent('reconnect_limit', sessionManager.getByPhone(key), {
        level: 'warn',
        reconnectAttempt: inst.restartAttempts,
      });
      console.error(`[BOT:${maskPhoneNumber(key)}] Reconnect limit reached (${MAX_RECONNECT_ATTEMPTS})`);
      return;
    }
    inst.restartAttempts += 1;
    inst.reconnecting = true;
    inst.lifecycle = 'reconnecting';
    runtimeStats.reconnectAttempts += 1;
    sessionManager.updateSession(key, {
      status: 'RECONNECTING',
      reconnectAttempts: inst.restartAttempts,
    });
    logSessionEvent('reconnect_scheduled', sessionManager.getByPhone(key), {
      reconnectAttempt: inst.restartAttempts,
      latencyMs: delayMs,
    });
    const backoff = Math.min(60000, 1000 * (2 ** Math.min(inst.restartAttempts - 1, 6)));
    const delayMs = backoff + Math.floor(Math.random() * Math.min(2000, Math.max(250, backoff * 0.2)));
    console.log(`[BOT:${maskPhoneNumber(key)}] Reconnecting in ${delayMs}ms (attempt ${inst.restartAttempts}, active=${instances.size})…`);
    inst.restartTimer = setTimeout(async () => {
      inst.restartTimer = null;
      if (inst.stopping || instances.get(key) !== inst) return;
      if (!fs.existsSync(path.join(sessionDir, 'creds.json'))) { instances.delete(key); return; }
      try {
        await createBotInstance(sessionDir, key, {
          sessionId: inst.sessionId,
          workerId: inst.workerId,
        });
      }
      catch (error) { console.error('[BOT:' + key + '] Reconnect failed:', error.message); scheduleReconnect(); }
    }, delayMs);
    inst.restartTimer.unref?.();
  };

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    runtimeStats.connectionEvents += 1;
    if (connection === 'open') {
      if (!inst.connected) runtimeStats.connected += 1;
      inst.connected = true;
      inst.lifecycle = 'connected';
      inst.reconnecting = false;
      inst.restartAttempts = 0;
      sessionManager.updateSession(key, {
        status: 'CONNECTED',
        lastSeen: new Date().toISOString(),
        reconnectAttempts: 0,
      });
      logSessionEvent('connected', sessionManager.getByPhone(key));
      if (inst.restartTimer) { clearTimeout(inst.restartTimer); inst.restartTimer = null; }
      console.log(`[BOT:${maskPhoneNumber(key)}] ✅ Connected (active=${instances.size}, queued=${inst.messageQueue.length})`);

      try {
        const { resumeChannelSubscription } = require('../commands/fakeract');
        resumeChannelSubscription(sock, key).catch(error => {
          console.warn(`[BOT:${maskPhoneNumber(key)}] Fakeract subscription restore failed:`, error.message);
        });
      } catch (error) {
        console.warn(`[BOT:${maskPhoneNumber(key)}] Fakeract restore unavailable:`, error.message);
      }

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
      if (instances.get(key) !== inst || inst.stopping) return;
      if (inst.connected) runtimeStats.connected = Math.max(0, runtimeStats.connected - 1);
      inst.connected = false;
      inst.lifecycle = 'closed';
      const error = lastDisconnect?.error;
      const code = getDisconnectCode(error);
      const loggedOut = isLoggedOut(error);
      const reason = error?.message || error?.output?.payload?.message || String(error || 'unknown');
      runtimeStats.lastDisconnect = { number: key, code, reason, at: new Date().toISOString() };

      sessionManager.updateSession(key, {
        status: loggedOut ? 'DISCONNECTED' : 'RECONNECTING',
        lastDisconnect: { code, reason, at: new Date().toISOString() },
        reconnectAttempts: inst.restartAttempts,
      });
      logSessionEvent(loggedOut ? 'logged_out' : 'disconnected', sessionManager.getByPhone(key), {
        level: loggedOut ? 'warn' : 'info',
      });
      console.error(`[BOT:${maskPhoneNumber(key)}] Closed (code ${code ?? 'unknown'}). LoggedOut: ${loggedOut}. Reason: ${reason}`);

      if (loggedOut) {
        // Preserve credentials for diagnostics and explicit re-pairing.
        try {
          fs.writeFileSync(path.join(sessionDir, '.logged_out'), JSON.stringify({
            code: code || 401, at: new Date().toISOString(),
            message: error?.message || 'WhatsApp logged out the session'
          }, null, 2));
        } catch (writeError) {
          console.error(`[BOT:${key}] Could not write logout marker:`, writeError.message);
        }
        instances.delete(key);
        closeSocket(sock, 'logged out');
        sessionManager.releaseSession(key);
        try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
        return;
      }

      // This instance owns the reconnect lifecycle. Remove every listener
      // from the closed socket before creating its replacement so repeated
      // disconnects cannot accumulate handlers and stores in memory.
      closeSocket(sock, 'reconnect');
      scheduleReconnect();
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
 *  createBotInstance
 *  Crée un nouveau socket Baileys et attache les handlers.
 *  Utilisé pour restaurer les sessions existantes au démarrage.
 * ═══════════════════════════════════════════════════════════════ */
async function createBotInstance(sessionDir, ownerNumber, metadata = {}) {
  const key = String(ownerNumber);
  const runningCreate = instanceCreationPromises.get(key);
  if (runningCreate) return runningCreate;

  const createPromise = createBotInstanceLocked(sessionDir, ownerNumber, metadata);
  instanceCreationPromises.set(key, createPromise);
  try {
    return await createPromise;
  } finally {
    if (instanceCreationPromises.get(key) === createPromise) instanceCreationPromises.delete(key);
  }
}

async function createBotInstanceLocked(sessionDir, ownerNumber, metadata = {}) {
  const key = String(ownerNumber);
  if (fs.existsSync(path.join(sessionDir, '.logged_out'))) {
    console.warn(`[BOT:${key}] Session marked logged out; waiting for explicit re-pair.`);
    return null;
  }

  if (instances.has(key)) {
    const old = instances.get(key);
    if (old.sessionDir === sessionDir && old.sock && !old.stopping && !old.reconnecting) {
      return old.sock;
    }
    if (old.restartTimer) clearTimeout(old.restartTimer);
    old.restartTimer = null;
    old.stopping = true;
    old.lifecycle = 'replaced';
    closeSocket(old.sock, 'instance replacement');
    // On garde l'entrée avec son store jusqu'à attachBotHandlers().
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
    keepAliveIntervalMs   : 20000,
    markOnlineOnConnect   : false,
    syncFullHistory       : false,
  });

  // Supprimer l'ancienne instance APRÈS avoir créé le socket
  // (attachBotHandlers récupérera le store via instances.get(key))
  if (existingStore) {
    // On garde l'entrée avec le store mais on update le sock
    const old = instances.get(key);
    if (old) old.sock = null; // marquer comme remplacé
  }

  attachBotHandlers(sock, sessionDir, ownerNumber, serializeSaveCreds(saveCreds), metadata);
  return sock;
}

/* ─── API publique ──────────────────────────────────────────── */
function stopBotInstance(ownerNumber) {
  const key  = String(ownerNumber);
  const inst = instances.get(key);
  if (!inst) return;
  if (inst.connected) runtimeStats.connected = Math.max(0, runtimeStats.connected - 1);
  inst.stopping = true;
  inst.lifecycle = 'stopping';
  if (inst.restartTimer) clearTimeout(inst.restartTimer);
  for (const timer of inst.timers || []) clearTimeout(timer);
  inst.timers?.clear();
  inst.messageQueue.length = 0;
  closeSocket(inst.sock, 'shutdown');
  instances.delete(key);
}

async function shutdownBotInstances() {
  const current = [...instances.values()];
  await Promise.allSettled(current.map(async inst => {
    try { await inst.saveCreds?.(); } catch (error) {
      console.error(`[BOT:${inst.ownerNumber}] Final credential save failed:`, error.message);
    }
    stopBotInstance(inst.ownerNumber);
  }));
}

function getBotInstance(ownerNumber) {
  return instances.get(String(ownerNumber)) || null;
}

function getConnectedBots() {
  return [...instances.entries()]
    .filter(([, inst]) => inst?.sock && inst.connected)
    .map(([number, inst]) => ({ number, sock: inst.sock, connected: true }));
}

function getAllInstances() {
  return [...instances.entries()].map(([num, inst]) => ({
    number    : num,
    phoneMasked: maskPhoneNumber(num),
    sessionId : inst.sessionId,
    workerId  : inst.workerId,
    sessionDir: inst.sessionDir,
    connected : inst.connected,
    running   : !!inst.sock,
    lifecycle : inst.lifecycle,
    reconnecting: !!inst.reconnecting,
    restartAttempts: inst.restartAttempts || 0,
    queuedMessages: inst.messageQueue?.length || 0,
    activeMessages: inst.activeMessages || 0,
  }));
}

function getRuntimeStats() {
  return {
    ...runtimeStats,
    uptime: Math.floor((Date.now() - runtimeStats.startedAt) / 1000),
    activeInstances: instances.size,
    connectedInstances: [...instances.values()].filter(inst => inst.connected).length,
    memory: process.memoryUsage(),
  };
}

/** Marque une instance comme connectée (appelé par web.js après couplage réussi) */
function markConnected(ownerNumber) {
  const inst = instances.get(String(ownerNumber));
  if (inst) {
    if (!inst.connected) runtimeStats.connected += 1;
    inst.connected = true;
    inst.lifecycle = 'connected';
    inst.reconnecting = false;
    inst.restartAttempts = 0;
    sessionManager.updateSession(ownerNumber, {
      status: 'CONNECTED',
      lastSeen: new Date().toISOString(),
      reconnectAttempts: 0,
    });
    runtimeStats.pairingActivations += 1;
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
  getConnectedBots,
  markConnected,
  getVersion,
  getLatestVersion,
  serializeSaveCreds,
  shutdownBotInstances,
  getRuntimeStats,
};
