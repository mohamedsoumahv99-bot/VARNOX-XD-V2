/**
 * VARNOX XD V2 — web.js  v19  (SINGLE-SOCKET PERSISTENT PAIRING)
 *
 * Corrections v18 (fix root cause de l'échec de reconnexion) :
 *
 *  PROBLÈME v17/v18 :
 *    - Le socket de couplage était séparé du socket du bot.
 *    - La copie et la fermeture pendant le handshake pouvaient perdre des
 *      clés de signal et faire refuser le code par WhatsApp.
 *
 *  FIX v19 :
 *    - Le socket de pairing utilise directement userSessionDir.
 *    - Il devient le socket du bot après connection:'open'.
 *    - Aucun tmpDir, aucune copie de clés, aucune fermeture/reconnexion
 *      pendant le handshake WhatsApp.
 */
'use strict';

const settings = require('./settings');

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const https    = require('https');
const http     = require('http');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  Browsers,
} = require('@whiskeysockets/baileys');

const pino      = require('pino');
const NodeCache = require('node-cache');
const PhoneNumber = require('awesome-phonenumber');

const {
  attachBotHandlers,
  createBotInstance,
  stopBotInstance,
  getBotInstance,
  getAllInstances,
  markConnected,
  getLatestVersion,
  serializeSaveCreds,
  shutdownBotInstances,
  getRuntimeStats,
} = require('./lib/botInstance');
const {
  sessionManager,
  SessionCapacityError,
  normalizePhoneNumber,
  maskPhoneNumber,
} = require('./lib/session-manager');

const app  = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

/* ─── Répertoires ─────────────────────────────────────────── */
const SESSIONS_DIR   = process.env.SESSION_DIR
  ? path.resolve(process.env.SESSION_DIR)
  : path.join(__dirname, 'sessions');
const LEGACY_SESSION = path.join(__dirname, 'session');
const DATA_DIR       = path.join(__dirname, 'data');
const OWNER_JSON     = path.join(DATA_DIR, 'owner.json');
const CONFIGURED_OWNER_NUMBER = String(settings.ownerNumber || '').replace(/\D/g, '');
const DEFAULT_BOT_NUMBER = String(process.env.BOT_NUMBER || '').replace(/\D/g, '');

try {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.accessSync(SESSIONS_DIR, fs.constants.R_OK | fs.constants.W_OK);
  fs.mkdirSync(LEGACY_SESSION, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (error) {
  throw new Error(`[VARNOX] Session/data directory is not writable (${SESSIONS_DIR}): ${error.message}`);
}

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_DIR) {
  console.warn('[VARNOX] SESSION_DIR is unset: sessions use the app filesystem, which may be ephemeral on Railway. Attach a persistent volume and set SESSION_DIR to its mount path.');
}

/* ─── owner.json ──────────────────────────────────────────── */
function initOwnerJson() {
  let cur = {};
  try { if (fs.existsSync(OWNER_JSON)) cur = JSON.parse(fs.readFileSync(OWNER_JSON, 'utf8')); } catch {}
  const ownerNumber = CONFIGURED_OWNER_NUMBER || cur.ownerNumber || '';
  if (!ownerNumber && !cur.ownerNumber) return;
  try {
    fs.writeFileSync(OWNER_JSON, JSON.stringify({
      ownerNumber,
      ownerName   : cur.ownerName || 'Owner',
      botName     : cur.botName   || 'VARNOX XD V2',
      prefix      : cur.prefix    || process.env.PREFIX || '.',
      version     : '2.0.0',
      mess        : cur.mess      || 'Owner',
    }, null, 2));
  } catch {}
}
initOwnerJson();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* ─── Keep-alive Render free tier ────────────────────────── */
const SELF_URL = process.env.RENDER_EXTERNAL_URL
  || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : null);

if (SELF_URL) {
  setInterval(() => {
    const mod = SELF_URL.startsWith('https') ? https : http;
    mod.get(`${SELF_URL}/ping`, () => {}).on('error', () => {}).end();
  }, 14 * 60 * 1000);
}

/* ─── Sockets de couplage en cours ───────────────────────── */
// Map<string, { sock, saveCreds, sessionDir, timer }>
const pairingSockets = new Map();
// Une seule génération de code active par numéro. Cela évite qu'un double clic
// ou deux onglets détruisent la session de couplage de l'autre.
const pairingRequests = new Map();
const pairingRecoveryPromises = new Map();
const pairingRecoveryInProgress = new Set();
const pairingRate = new Map();
const HTTP_METRICS = { total: 0, active: 0, errors: 0 };
const PAIRING_METRICS = { requests: 0, rejected: 0, reused: 0, inFlight: 0 };
const STARTED_AT = Date.now();
const PAIRING_RATE_WINDOW_MS = Math.max(60_000, Number(process.env.PAIRING_RATE_WINDOW_MS || 10 * 60 * 1000));
const PAIRING_RATE_MAX = Math.max(1, Number(process.env.PAIRING_RATE_MAX || 5));
const MAX_PAIRING_RECOVERY_ATTEMPTS = Math.max(1, Number(process.env.MAX_PAIRING_RECOVERY_ATTEMPTS || 10));
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '');
const RESTORE_STATE = { started: false, complete: false, restored: 0, failed: 0 };

app.set('trust proxy', true);
app.use((req, res, next) => {
  HTTP_METRICS.total += 1;
  HTTP_METRICS.active += 1;
  res.once('finish', () => {
    HTTP_METRICS.active = Math.max(0, HTTP_METRICS.active - 1);
    if (res.statusCode >= 500) HTTP_METRICS.errors += 1;
  });
  next();
});

const pairingRateCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - PAIRING_RATE_WINDOW_MS;
  for (const [key, value] of pairingRate) {
    if (value.startedAt < cutoff) pairingRate.delete(key);
  }
}, PAIRING_RATE_WINDOW_MS);
pairingRateCleanupTimer.unref?.();

function adminAuthorized(req) {
  if (!ADMIN_TOKEN) return process.env.NODE_ENV !== 'production' && (
    req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1'
  );
  const supplied = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '')
    || String(req.get('x-admin-token') || '');
  return supplied === ADMIN_TOKEN;
}

function requireAdmin(req, res, next) {
  if (adminAuthorized(req)) return next();
  return res.status(401).json({
    error: true,
    message: 'Route administrative protégée. Configure ADMIN_TOKEN.',
  });
}

/* ─── Sessions marquées prêtes ───────────────────────────── */
// Map<string, { ts }>
const pairedNumbers = new Map();
// Map<string, { code, message, ts }>
const pairingFailures = new Map();

function disconnectInfo(error) {
  const code = error?.output?.statusCode
    ?? error?.data?.statusCode
    ?? error?.statusCode
    ?? error?.output?.payload?.statusCode
    ?? null;
  const message = error?.message || error?.output?.payload?.message || String(error || 'unknown');
  return { code, message };
}

function isPairingRestart(code) {
  return code === 515
    || code === DisconnectReason.restartRequired
    || code === DisconnectReason.connectionLost
    || code === DisconnectReason.timedOut
    || code === DisconnectReason.connectionClosed
    || code === DisconnectReason.connectionReplaced;
}

function isTransientPairingDisconnect(code) {
  return isPairingRestart(code) || [408, 409, 411, 428, 500, 502, 503, 504, 520, 521, 522].includes(code);
}

function closeSocket(sock, reason = 'replaced') {
  if (!sock) return;
  try { sock.ev?.removeAllListeners?.(); } catch (error) {
    console.warn(`[VARNOX] Pairing listener cleanup failed (${reason}):`, error.message);
  }
  try { sock.ws?.close(); } catch (error) {
    console.warn(`[VARNOX] Pairing socket close failed (${reason}):`, error.message);
  }
}

function allowPairingRequest(req, number) {
  const ip = String(req.ip || req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const key = `${ip}:${number}`;
  const now = Date.now();
  const current = pairingRate.get(key);
  if (!current || now - current.startedAt >= PAIRING_RATE_WINDOW_MS) {
    pairingRate.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= PAIRING_RATE_MAX) return false;
  current.count += 1;
  return true;
}

function markPairingPending(sessionDir) {
  try {
    fs.writeFileSync(path.join(sessionDir, '.pairing_pending'), JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
    }));
  } catch (error) {
    console.error('[VARNOX] Unable to mark pairing session:', error.message);
  }
}

function clearPairingPending(sessionDir) {
  try { fs.rmSync(path.join(sessionDir, '.pairing_pending'), { force: true }); } catch {}
}

function pairingSocketOptions(version, logger, state) {
  return {
    version,
    logger,
    printQRInTerminal: false,
    // This is the profile used by the last known-good pairing flow.
    // Keep it aligned with the Baileys 7 pairing implementation.
    browser: Browsers.ubuntu('Chrome'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    msgRetryCounterCache: new NodeCache({ stdTTL: 120 }),
    connectTimeoutMs: 30000,
    keepAliveIntervalMs: 15000,
    markOnlineOnConnect: false,
  };
}

function schedulePairingRecovery(number, sessionDir, delayMs = 750) {
  const pending = pairingSockets.get(number);
  if (!pending || pending.recoveryTimer || pending.recovering || pairedNumbers.has(number)) return;
  pending.recoveryTimer = setTimeout(() => {
    pending.recoveryTimer = null;
    recoverPairingSocket(number, sessionDir).catch(error => {
      console.error(`[VARNOX] Pairing recovery task failed for ${number}:`, error.message);
    });
  }, delayMs);
  pending.recoveryTimer.unref?.();
}

async function recoverPairingSocket(number, sessionDir) {
  const pending = pairingSockets.get(number);
  if (!pending || pending.recovering || pairedNumbers.has(number) || pairingRecoveryInProgress.has(number)) return;

  pairingRecoveryInProgress.add(number);
  pending.recovering = true;
  pending.recoveryAttempts = (pending.recoveryAttempts || 0) + 1;
  sessionManager.updateSession(pending.sessionId || number, {
    status: 'RECONNECTING',
    reconnectAttempts: pending.recoveryAttempts,
  });
  if (pending.recoveryAttempts > MAX_PAIRING_RECOVERY_ATTEMPTS) {
    const message = 'WhatsApp a fermé la connexion de jumelage. La session est conservée ; génère un nouveau code si nécessaire.';
    pairingFailures.set(number, { code: 515, message, ts: Date.now() });
    clearTimeout(pending.timer);
    clearTimeout(pending.recoveryTimer);
    closeSocket(pending.sock, 'pairing recovery limit');
    pairingSockets.delete(number);
    sessionManager.releaseSession(pending.sessionId || number);
    pairingRecoveryInProgress.delete(number);
    return;
  }

  try {
    // Important: reuse the same auth directory. Recreating an empty session
    // produces a new identity and invalidates the code that is on the phone.
    const logger = pino({ level: 'silent' });
    closeSocket(pending.sock, 'pairing recovery');
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const serializedSaveCreds = serializeSaveCreds(saveCreds);
    const version = await getLatestVersion();
    const sock = makeWASocket(pairingSocketOptions(version, logger, state));
    sock.ev.on('creds.update', serializedSaveCreds);
    sock._credsHandlerAttached = true;

    const next = {
      ...pending,
      sock,
      saveCreds: serializedSaveCreds,
      recovering: false,
      recoveryTimer: null,
    };
    pairingSockets.set(number, next);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (pairingSockets.get(number) !== next) return;

      if (connection === 'open') {
        try {
          await next.activate(sock, serializedSaveCreds);
        } catch (e) {
          console.error(`[VARNOX] Pairing recovery activation failed for ${number}:`, e.message);
          pairingFailures.set(number, { code: 500, message: e.message, ts: Date.now() });
          clearTimeout(next.timer);
          pairingSockets.delete(number);
          
        }
        return;
      }

      if (connection === 'close' && !pairedNumbers.has(number)) {
        const info = disconnectInfo(lastDisconnect?.error);
        if (info.code === 401 || info.code === DisconnectReason.loggedOut) {
          const message = 'WhatsApp a refusé le code. Supprime les anciens appareils liés et génère un nouveau code.';
          pairingFailures.set(number, { code: 401, message: `${message} La session est conservée.`, detail: info.message, ts: Date.now() });
          clearTimeout(next.timer);
          pairingSockets.delete(number);
        } else if (isPairingRestart(info.code)) {
          schedulePairingRecovery(number, sessionDir, Math.min(60000, 750 * (2 ** Math.min(next.recoveryAttempts - 1, 6))));
        }
      }
    });
  } catch (e) {
    pending.recovering = false;
    console.error(`[VARNOX] Pairing recovery failed for ${number}:`, e.message);
    schedulePairingRecovery(number, sessionDir, 1500);
  } finally {
    pairingRecoveryInProgress.delete(number);
  }
}

/* ═══════════════════════════════════════════════════════════
 *  Démarrage des sessions existantes (au boot)
 * ═══════════════════════════════════════════════════════════ */
async function startExistingSessions() {
  RESTORE_STATE.started = true;
  // Restore every persisted session without deleting or replacing credentials.
  const restoreJobs = [];
  const restoredSessionIds = new Set();

  // The registry is authoritative for new sessionId-based directories. It
  // contains metadata only; Baileys credentials remain in each sessionDir.
  for (const record of sessionManager.listSessions()) {
    const sd = record.sessionDir || path.join(SESSIONS_DIR, record.sessionId);
    if (!fs.existsSync(path.join(sd, 'creds.json'))) continue;
    if (fs.existsSync(path.join(sd, '.logged_out'))) {
      sessionManager.releaseSession(record.sessionId);
      continue;
    }
    if (fs.existsSync(path.join(sd, '.pairing_pending'))) {
      let registered = false;
      try {
        registered = !!JSON.parse(fs.readFileSync(path.join(sd, 'creds.json'), 'utf8')).registered;
      } catch {}
      if (!registered) {
        // A pairing interrupted before WhatsApp accepted the code is not a
        // bot session. Leave its metadata for a clean retry via /code.
        sessionManager.updateSession(record.sessionId, { status: 'PAIRING', sessionDir: sd });
        console.warn(`[VARNOX] Skipping unfinished pairing session ${record.phoneMasked}`);
        continue;
      }
      // Authentication may succeed immediately before a process restart.
      // Registered credentials can be restored as a normal active session.
      clearPairingPending(sd);
    }
    restoredSessionIds.add(record.sessionId);
    sessionManager.updateSession(record.sessionId, { status: 'CONNECTING', sessionDir: sd });
    console.log(`[VARNOX] Restoring session ${record.phoneMasked} on ${record.workerId}`);
    restoreJobs.push(() => createBotInstance(sd, record.phoneNumber, {
      sessionId: record.sessionId,
      workerId: record.workerId,
    }).then(() => { RESTORE_STATE.restored += 1; })
      .catch(error => {
        RESTORE_STATE.failed += 1;
        sessionManager.updateSession(record.sessionId, {
          status: 'DISCONNECTED',
          lastDisconnect: { reason: error.message, at: new Date().toISOString() },
        });
        console.error(`[VARNOX] Restore ${record.phoneMasked} failed:`, error.message);
      }));
  }

  // Sessions multi-user ./sessions/user_<number>/
  try {
    const dirs = fs.readdirSync(SESSIONS_DIR);
    for (const dir of dirs) {
      const m = dir.match(/^user_(\d+)$/);
      if (!m) continue;
      const num = m[1];
      const sd  = path.join(SESSIONS_DIR, dir);
      if (fs.existsSync(path.join(sd, '.logged_out'))) {
        console.warn(`[VARNOX] Skipping logged-out session: ${num}`);
        continue;
      }
      if (!fs.existsSync(path.join(sd, 'creds.json'))) continue;
      const existingRecord = sessionManager.getByPhone(num);
      if (existingRecord && restoredSessionIds.has(existingRecord.sessionId)) continue;
      if (fs.existsSync(path.join(sd, '.pairing_pending'))) {
        let registered = false;
        try {
          registered = !!JSON.parse(fs.readFileSync(path.join(sd, 'creds.json'), 'utf8')).registered;
        } catch {}
        if (!registered) {
          console.warn(`[VARNOX] Skipping unfinished pairing session: ${num}`);
          continue;
        }
        // A crash can happen after WhatsApp authenticates but before the
        // marker is cleared. Registered credentials are safe to restore.
        clearPairingPending(sd);
      }
      const allocation = sessionManager.ensureSession(num, {
        status: 'CONNECTING',
        sessionDir: sd,
      });
      restoredSessionIds.add(allocation.session.sessionId);
      console.log(`[VARNOX] Restoring session: ${num}`);
      restoreJobs.push(() => createBotInstance(sd, num, {
        sessionId: allocation.session.sessionId,
        workerId: allocation.session.workerId,
      }).then(() => { RESTORE_STATE.restored += 1; })
        .catch(e => {
          RESTORE_STATE.failed += 1;
          sessionManager.updateSession(num, { status: 'DISCONNECTED', lastDisconnect: { reason: e.message, at: new Date().toISOString() } });
          console.error(`[VARNOX] Restore ${maskPhoneNumber(num)} failed:`, e.message);
        }));
    }
  } catch (e) { console.error('[VARNOX] startExistingSessions:', e.message); }

  // Rétrocompat session unique ./session/
  if (fs.existsSync(path.join(LEGACY_SESSION, 'creds.json'))) {
    let ownerNum = 'legacy';
    try { ownerNum = JSON.parse(fs.readFileSync(OWNER_JSON, 'utf8')).ownerNumber || 'legacy'; } catch {}
    if (!getBotInstance(ownerNum)) {
      console.log(`[VARNOX] Legacy session → ${ownerNum}`);
      const allocation = sessionManager.ensureSession(ownerNum, {
        status: 'CONNECTING',
        sessionDir: LEGACY_SESSION,
      });
      restoreJobs.push(() => createBotInstance(LEGACY_SESSION, ownerNum, {
        sessionId: allocation.session.sessionId,
        workerId: allocation.session.workerId,
      }).then(() => { RESTORE_STATE.restored += 1; })
        .catch(e => {
          RESTORE_STATE.failed += 1;
          console.error('[VARNOX] Legacy restore:', e.message);
        }));
    }
  }
  const restoreConcurrency = Math.max(1, Number(process.env.RESTORE_CONCURRENCY || 2));
  for (let index = 0; index < restoreJobs.length; index += restoreConcurrency) {
    await Promise.allSettled(restoreJobs.slice(index, index + restoreConcurrency).map(start => start()));
  }
  RESTORE_STATE.complete = true;
  console.log(`[VARNOX] Persistent session restore scheduled: ${restoreJobs.length}`);
}

setTimeout(() => startExistingSessions().catch(e => console.error('[VARNOX] Session restore:', e.message)), 1500);

/* ═══════════════════════════════════════════════════════════
 *  ROUTES
 * ═══════════════════════════════════════════════════════════ */
app.get('/ping', (_q, r) => r.json({ pong: true, ts: Date.now() }));

app.get('/health', (_q, r) => {
  const insts = getAllInstances();
  r.json({
    status: 'ok',
    ready: RESTORE_STATE.complete,
    bot: 'VARNOX XD V2',
    v: '19.4.0',
    build: 'pairing-baileys7-ubuntu',
    waFallback: '2.3000.1043857760',
    uptime: Math.floor(process.uptime()),
    instances: insts,
    total: insts.length,
    runtime: getRuntimeStats(),
    manager: sessionManager.getStatus(),
    http: HTTP_METRICS,
    pairing: {
      active: pairingSockets.size,
      inFlight: pairingRequests.size,
      rateKeys: pairingRate.size,
      metrics: PAIRING_METRICS,
    },
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

app.get('/ready', (_q, r) => {
  const ready = sessionManager.ready && RESTORE_STATE.complete;
  const payload = {
    ready,
    status: ready ? 'ready' : 'starting',
    restore: RESTORE_STATE,
    manager: sessionManager.getStatus(),
    uptime: Math.floor(process.uptime()),
  };
  return r.status(ready ? 200 : 503).json(payload);
});

app.get('/botStatus', (req, res) => {
  const num = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  if (num) {
    const i = getBotInstance(num);
    return res.json({ number: num, running: !!i, connected: !!i?.connected });
  }
  res.json({ instances: getAllInstances() });
});

app.get('/status', (req, res) => {
  const num = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  if (!num) return res.json({
    status: 'ok',
    totalSessions: sessionManager.summary().totalSessions,
    workersActive: sessionManager.summary().workersActive,
  });
  const i = getBotInstance(num);
  const session = sessionManager.getByPhone(num);
  res.json({
    number: maskPhoneNumber(num),
    sessionId: session?.sessionId || null,
    workerId: session?.workerId || null,
    status: session?.status || (i?.connected ? 'CONNECTED' : 'DISCONNECTED'),
    connected: !!i?.connected,
    running: !!i,
    pairing: pairingSockets.has(num),
    lastSeen: session?.lastSeen || null,
    lastDisconnect: session?.lastDisconnect || null,
    reconnectAttempts: session?.reconnectAttempts || 0,
  });
});

app.get('/workers', requireAdmin, (_req, res) => {
  res.json({
    workers: sessionManager.listWorkers(),
    summary: sessionManager.summary(),
  });
});

app.get('/sessions', requireAdmin, (_req, res) => {
  res.json({
    sessions: sessionManager.listSessions().map(session => ({
      ...session,
      active: Boolean(getBotInstance(session.phoneNumber)?.sock),
      pairing: pairingSockets.has(session.phoneNumber),
    })),
    summary: sessionManager.summary(),
  });
});

app.get('/session/:id', requireAdmin, (req, res) => {
  const session = sessionManager.getBySessionId(req.params.id);
  if (!session) return res.status(404).json({ error: true, message: 'Session introuvable.' });
  const instance = getBotInstance(session.phoneNumber);
  return res.json({
    ...session,
    active: Boolean(instance?.sock),
    connected: Boolean(instance?.connected),
    pairing: pairingSockets.has(session.phoneNumber),
  });
});

app.get('/session/:id/status', requireAdmin, (req, res) => {
  const session = sessionManager.getBySessionId(req.params.id);
  if (!session) return res.status(404).json({ error: true, message: 'Session introuvable.' });
  const instance = getBotInstance(session.phoneNumber);
  return res.json({
    sessionId: session.sessionId,
    workerId: session.workerId,
    phoneNumber: session.phoneMasked,
    status: session.status,
    connected: Boolean(instance?.connected),
    active: Boolean(instance?.sock),
    pairing: pairingSockets.has(session.phoneNumber),
    lastSeen: session.lastSeen,
    lastDisconnect: session.lastDisconnect,
    reconnectAttempts: session.reconnectAttempts,
  });
});

app.get('/session', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  let { number } = req.query;
  if (!number) return res.json({ ready: false });
  number = number.replace(/\D/g, '');
  const i = getBotInstance(number);
  // IMPORTANT: creds.json est créé dès le début du pairing. Sa présence
  // ne signifie pas que WhatsApp a accepté le code.
  if (i?.connected) {
    // pairedNumbers is in-memory and empty after a process restart.
    return res.json({ ready: true, connected: true });
  }
  const failure = pairingFailures.get(number);
  res.json({
    ready    : false,
    connected: false,
    pairing  : pairingSockets.has(number),
    error    : failure?.message || null,
    code     : failure?.code || null,
  });
});

app.get('/reset', requireAdmin, (req, res) => {
  const num = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  try {
    if (num) {
      pairingFailures.delete(num);
      const registeredSession = sessionManager.getByPhone(num);
      stopBotInstance(num);
      // Fermer le socket de couplage s'il est en cours
      if (pairingSockets.has(num)) {
        const p = pairingSockets.get(num);
        clearTimeout(p.timer);
        clearTimeout(p.recoveryTimer);
        closeSocket(p.sock, 'reset');
        try { fs.rmSync(p.sessionDir, { recursive: true, force: true }); } catch {}
        pairingSockets.delete(num);
      }
      pairedNumbers.delete(num);
      if (registeredSession?.sessionDir) {
        try { fs.rmSync(registeredSession.sessionDir, { recursive: true, force: true }); } catch {}
      }
      sessionManager.releaseSession(num);
      const ud = path.join(SESSIONS_DIR, `user_${num}`);
      try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
      fs.mkdirSync(ud, { recursive: true });
      return res.json({ ok: true, message: `Session cleared for ${num}. Reconnect to re-pair.` });
    }
    for (const i of getAllInstances()) stopBotInstance(i.number);
    pairingSockets.forEach(p => {
      clearTimeout(p.timer);
      clearTimeout(p.recoveryTimer);
      closeSocket(p.sock, 'reset-all');
    });
    pairingSockets.clear();
    pairedNumbers.clear();
    for (const session of sessionManager.listSessions()) sessionManager.releaseSession(session.sessionId);
    res.json({ ok: true, message: 'All sessions cleared.' });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/debug', requireAdmin, (_q, r) => r.json({
  SESSIONS_DIR,
  instances    : getAllInstances(),
  pairing      : [...pairingSockets.keys()],
  paired       : [...pairedNumbers.keys()],
  failures     : [...pairingFailures.entries()],
  memMB        : Math.round(process.memoryUsage().rss / 1024 / 1024),
  runtime      : getRuntimeStats(),
  manager      : sessionManager.getStatus(),
  http         : HTTP_METRICS,
}));

/* ════════════════════════════════════════════════════════════
 *  /code  — Génération du code de couplage
 *
 *  FLUX (un seul socket, session persistante) :
 *
 *  1. Créer socket Baileys dans ./sessions/user_<num>/
 *  2. Après connection:'connecting' → requestPairingCode (3s de délai)
 *  3. Retourner le code au frontend
 *  4. Quand connection:'open' (code entré dans WhatsApp) :
 *       a. flush saveCreds()
 *       b. attachBotHandlers() sur ce même socket
 *       c. garder la connexion ouverte — aucun handoff risqué
 * ════════════════════════════════════════════════════════════ */
async function handleCode(req, res) {
  res.setHeader('Content-Type', 'application/json');
  req.setTimeout?.(65000);
  PAIRING_METRICS.requests += 1;

  const rawNumber = (req.query.number || req.body?.number || DEFAULT_BOT_NUMBER).toString();
  const number = normalizePhoneNumber(rawNumber);
  if (!rawNumber.trim()) return res.status(400).json({ error: true, message: 'Numéro requis' });
  if (!number || !/^\+?[\d\s().-]+$/.test(rawNumber) || !PhoneNumber(`+${number}`).isValid())
    return res.status(400).json({ error: true, message: 'Numéro invalide (7–15 chiffres).' });
  if (!allowPairingRequest(req, number)) {
    PAIRING_METRICS.rejected += 1;
    return res.status(429).json({
      error: true,
      message: 'Trop de demandes de pairing pour ce numéro. Réessaie dans quelques minutes.',
      retryAfterSeconds: Math.ceil(PAIRING_RATE_WINDOW_MS / 1000),
    });
  }

  // Déjà connecté ?
  const existing = getBotInstance(number);
  if (existing?.connected)
    return res.json({
      error: false,
      already: true,
      sessionId: sessionManager.getByPhone(number)?.sessionId || existing.sessionId || null,
      message: 'Déjà connecté.',
    });
  if (existing && !existing.connected) {
    return res.status(409).json({
      error: true,
      preserving: true,
      message: 'Cette session est momentanément en reconnexion. Elle est préservée ; attends sa reprise ou utilise /reset uniquement pour un nouveau jumelage.'
    });
  }
  const registered = sessionManager.getByPhone(number);
  if (registered && registered.status !== 'PAIRING' && !pairingSockets.has(number)) {
    return res.status(409).json({
      error: true,
      preserving: true,
      sessionId: registered.sessionId,
      status: registered.status,
      message: 'Une session existe déjà pour ce numéro. Elle sera réutilisée ; supprime-la explicitement avant un nouveau jumelage.',
    });
  }

  // Si le code est déjà affiché, le renvoyer au lieu de recréer une session.
  // Recréer un socket ici invaliderait le code visible dans WhatsApp.
  const activePairing = pairingSockets.get(number);
  if (activePairing?.code && (!activePairing.expiresAt || activePairing.expiresAt > Date.now())) {
    PAIRING_METRICS.reused += 1;
    return res.json({ error: false, code: activePairing.code, reused: true });
  }

  // Les requêtes concurrentes pour un même numéro partagent le même résultat.
  // Les utilisateurs différents continuent, eux, à utiliser leurs propres
  // sessions en parallèle.
  const runningRequest = pairingRequests.get(number);
  if (runningRequest) {
    try {
      return res.json(await runningRequest);
    } catch (error) {
      return res.json({ error: true, message: error.message || 'Erreur génération du code' });
    }
  }

  let resolveRequest;
  let rejectRequest;
  const requestResult = new Promise((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  pairingRequests.set(number, requestResult);
  PAIRING_METRICS.inFlight += 1;

  let allocation;
  try {
    if (registered?.status === 'PAIRING' && !pairingSockets.has(number)) {
      sessionManager.releaseSession(registered.sessionId);
    }
    allocation = sessionManager.reserveSession(number, { status: 'PAIRING' });
  } catch (error) {
    if (error instanceof SessionCapacityError || error.code === 'WORKERS_FULL') {
      return res.status(503).json({
        error: true,
        code: 'WORKERS_FULL',
        message: 'Tous les workers sont pleins. Réessaie plus tard.',
        workers: sessionManager.listWorkers(),
      });
    }
    return res.status(error.statusCode || 400).json({ error: true, message: error.message });
  }
  const session = allocation.session;
  const userSessionDir = session.sessionDir || path.join(SESSIONS_DIR, session.sessionId);
  const sessionDir = userSessionDir;
  sessionManager.updateSession(session.sessionId, {
    status: 'PAIRING',
    sessionDir,
  });

  // Fermer le couplage précédent pour ce numéro s'il existe
  if (pairingSockets.has(number)) {
    const old = pairingSockets.get(number);
    // Retirer l'ancienne entrée avant de fermer le socket : son événement
    // "close" ne doit jamais toucher la nouvelle tentative du même numéro.
    pairingSockets.delete(number);
    clearTimeout(old.timer);
    closeSocket(old.sock, 'new pairing request');
    try { fs.rmSync(old.sessionDir, { recursive: true, force: true }); } catch {}
    await new Promise(r => setTimeout(r, 300));
  }

  // Une tentative précédente non connectée peut avoir laissé des clés
  // incomplètes. On repart d'une session propre pour chaque nouveau code.
           // Preserve the auth directory for diagnostics and to avoid
           // destroying valid credentials after a temporary close.
  fs.mkdirSync(sessionDir, { recursive: true });
  markPairingPending(sessionDir);

  console.log(`[VARNOX] /pair for ${maskPhoneNumber(number)} on ${session.workerId}`);
  pairingFailures.delete(number);

  let sock = null;
  try {
    // ── Créer le socket directement dans la session permanente ────────────
    const logger = pino({ level: 'silent' });
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const serializedSaveCreds = serializeSaveCreds(saveCreds);
    // Ne jamais générer un code avec la version fallback si le réseau est
    // disponible : WhatsApp peut l'afficher puis refuser sa validation.
    const version = await getLatestVersion();

    sock = makeWASocket(pairingSocketOptions(version, logger, state));

    // ★ CRITIQUE : enregistrer creds.update dès maintenant (vers sessionDir).
    // WhatsApp envoie des mises à jour de clés en continu pendant et après
    // le couplage. Sans ce handler, les clés de session (noise keys, signal
    // pre-keys, etc.) ne sont pas écrites sur disque au fur et à mesure.
    // Le saveCreds() manuel dans promotePairToBot ne suffit pas car certaines
    // mises à jour arrivent APRÈS connection:'open' — race condition.
    sock.ev.on('creds.update', serializedSaveCreds);
    sock._credsHandlerAttached = true;

    // ── Promesse du code de couplage ──────────────────────────────────────
    let codeResolve, codeReject;
    let codeDone    = false;
    let pairStarted = false;
    let attempts    = 0;

    const codePromise = new Promise((res, rej) => { codeResolve = res; codeReject = rej; });

    const hardTimer = setTimeout(() => {
      if (!codeDone) {
        codeDone = true;
        codeReject(new Error('Timeout 60s — WhatsApp n’a pas préparé la connexion. Réessaie dans quelques secondes.'));
      }
    }, 60000);

    async function tryGetCode() {
      if (codeDone) return;
      attempts++;
      try {
        if (state.creds.registered) {
          codeDone = true; clearTimeout(hardTimer);
          codeReject(new Error('Numéro déjà enregistré. Dans WhatsApp → Appareils liés → supprime le bot, puis réessaie.'));
          return;
        }
        const raw = await sock.requestPairingCode(number);
        if (!codeDone) {
          if (raw) { codeDone = true; clearTimeout(hardTimer); codeResolve(raw); }
          else if (attempts < 5) setTimeout(tryGetCode, Math.min(400 * attempts, 2000));
          else { codeDone = true; clearTimeout(hardTimer); codeReject(new Error('Code null. Réessaie.')); }
        }
      } catch (e) {
        if (codeDone) return;
        if (attempts < 5) setTimeout(tryGetCode, Math.min(500 * attempts, 2500));
        else { codeDone = true; clearTimeout(hardTimer); codeReject(new Error(e.message)); }
      }
    }

    // ── Gestion de la session après couplage réussi ───────────────────────
    // Le socket reste ouvert et devient directement le socket du bot.
    let pairActivated = false;

    async function promotePairToBot(activeSock = sock, activeSaveCreds = serializedSaveCreds) {
      // Éviter un double-déclenchement si connection:'open' fire deux fois
      if (pairActivated) return;
      pairActivated = true;

      // Laisser les dernières clés de signal être écrites avant activation.
      await new Promise(r => setTimeout(r, 1200));
      try { await activeSaveCreds(); } catch (e) {
        console.error(`[VARNOX] saveCreds error:`, e.message);
      }

      if (!fs.existsSync(path.join(sessionDir, 'creds.json'))) {
        pairActivated = false;
        throw new Error('creds.json absent après authentification');
      }

      // The paired WhatsApp account is the bot identity. Never write it
      // into owner.json: OWNER_NUMBER remains the permanent administrator.
      if (getAllInstances().length === 0) initOwnerJson();
      pairedNumbers.set(number, { ts: Date.now() });
      sessionManager.updateSession(session.sessionId, {
        status: 'CONNECTED',
        lastSeen: new Date().toISOString(),
        reconnectAttempts: 0,
      });
      clearPairingPending(sessionDir);

      // Le socket actuel devient le socket du bot : aucun deuxième handshake.
      const p = pairingSockets.get(number);
      if (p) { clearTimeout(p.timer); pairingSockets.delete(number); }

      attachBotHandlers(activeSock, sessionDir, number, activeSaveCreds, {
        sessionId: session.sessionId,
        workerId: session.workerId,
      });
      markConnected(number);
      console.log(`[VARNOX] ✅ Bot activated on persistent socket for ${number}`);
    }

    // Enregistrer le socket avant que le code soit retourné permet à une
    // seconde requête et aux événements 515 de retrouver la session exacte.
    const pendingPairing = {
      sock,
      saveCreds: serializedSaveCreds,
      sessionDir,
      timer: null,
      code: null,
      expiresAt: null,
      activate: promotePairToBot,
      recoveryAttempts: 0,
      recovering: false,
      recoveryTimer: null,
      sessionId: session.sessionId,
      workerId: session.workerId,
    };
    pairingSockets.set(number, pendingPairing);

    // ── Listener de connexion ─────────────────────────────────────────────
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (pairingSockets.get(number) !== pendingPairing) return;

      if (connection === 'connecting' && !pairStarted) {
        pairStarted = true;
        // Le socket est déjà en phase de handshake. Une courte attente évite
        // la race sans imposer le délai de plusieurs secondes de l'ancienne
        // implémentation.
        setTimeout(tryGetCode, 650);
      }

      if (connection === 'open') {
        console.log(`[VARNOX] ✅ WA authenticated for ${number}`);
        try {
          await promotePairToBot(sock, serializedSaveCreds);
        } catch (error) {
          console.error(`[VARNOX] Pairing activation failed for ${number}:`, error.message);
          pairingFailures.set(number, { code: 500, message: error.message, ts: Date.now() });
          clearTimeout(pendingPairing.timer);
          pairingSockets.delete(number);
        }
      }

      if (connection === 'close') {
        // Après activation, le handler de botInstance gère la reconnexion.
        if (pairActivated) return;

        const info      = disconnectInfo(lastDisconnect?.error);
        const sc        = info.code;
        const loggedOut = sc === DisconnectReason.loggedOut || sc === 401;
        sessionManager.updateSession(session.sessionId, {
          status: loggedOut ? 'DISCONNECTED' : 'RECONNECTING',
          lastDisconnect: { code: sc, reason: info.message, at: new Date().toISOString() },
        });
        console.error(`[VARNOX] Pairing socket closed for ${maskPhoneNumber(number)}; code=${sc ?? 'unknown'}; reason=${info.message}`);

        if (!codeDone) {
          // Le code n'a pas encore été émis — signaler l'erreur
          if (loggedOut) {
            const message = 'WhatsApp a rejeté la connexion avant la validation du code.';
            pairingFailures.set(number, { code: sc || 401, message, detail: info.message, ts: Date.now() });
            codeDone = true;
            clearTimeout(hardTimer);
            codeReject(new Error(message));
          }
          // Sinon Baileys reconnecte automatiquement → on laisse faire
          return;
        }

        // WhatsApp commonly closes the first socket with 515
        // (restartRequired) while finishing phone-number linking. This is
        // not a rejection: keep the same auth directory and reconnect it.
        if (codeDone && isTransientPairingDisconnect(sc)) {
          console.warn(`[VARNOX] Pairing socket restart required for ${number}; preserving session`);
          schedulePairingRecovery(number, sessionDir, 750);
          return;
        }

        // A real rejection invalidates the displayed code.
        if (!pairedNumbers.has(number)) {
          const message = sc === 401
            ? 'Code refusé par WhatsApp. Supprime les anciennes sessions liées, attends quelques secondes, puis génère un nouveau code.'
            : `Connexion WhatsApp fermée avant la validation (code ${sc ?? 'inconnu'}).`;
          pairingFailures.set(number, { code: sc || 0, message, detail: info.message, ts: Date.now() });
          const p = pairingSockets.get(number);
          if (p) { clearTimeout(p.timer); pairingSockets.delete(number); }
           // Keep the directory; /reset or a deliberate new /code attempt
           // can clear an incomplete pairing explicitly.
        }
        // Sinon → Baileys / botInstance gère la reconnexion
      }
    });

    // Fallback : si 'connecting' tarde ou ne se déclenche pas avant que l'on
    // enregistre le listener (race condition possible avec certaines versions)
    setTimeout(() => {
      if (!codeDone && !pairStarted) {
        pairStarted = true;
        tryGetCode();
      }
    }, 2500);

    // ── Attendre le code ──────────────────────────────────────────────────
    const raw       = await codePromise;
    const formatted = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,4}/g)?.join('-') || raw;

    console.log(`[VARNOX] Code generated for ${maskPhoneNumber(number)} on ${session.workerId}`);

    // Garder le socket vivant jusqu'à 15 min
    const timer = setTimeout(() => {
      if (pairingSockets.has(number)) {
        closeSocket(pairingSockets.get(number).sock, 'pairing expiry');
        pairingSockets.delete(number);
        sessionManager.releaseSession(session.sessionId);
         // Keep the directory so a temporary timeout cannot destroy auth data.
      }
    }, 15 * 60 * 1000);

    pendingPairing.timer = timer;
    pendingPairing.code = formatted;
    pendingPairing.expiresAt = Date.now() + 15 * 60 * 1000;

    const result = { error: false, code: formatted };
    resolveRequest(result);
    pairingRequests.delete(number);
    PAIRING_METRICS.inFlight = Math.max(0, PAIRING_METRICS.inFlight - 1);
    return res.json(result);

  } catch (err) {
    console.error(`[VARNOX] /pair error ${maskPhoneNumber(number)}:`, err.message);
    pairingRequests.delete(number);
    PAIRING_METRICS.inFlight = Math.max(0, PAIRING_METRICS.inFlight - 1);
    rejectRequest(err);
    const pending = pairingSockets.get(number);
    if (pending) {
      clearTimeout(pending.timer);
      pairingSockets.delete(number);
    }
    closeSocket(sock, 'pairing request failure');
    if (allocation?.session?.sessionId) sessionManager.releaseSession(allocation.session.sessionId);
    const result = { error: true, message: err.message || 'Erreur génération du code' };
    return res.json(result);
  }
}

app.get('/pair',  handleCode);
app.post('/pair', handleCode);
app.get('/code',  handleCode);
app.post('/code', handleCode);

app.use((error, _req, res, _next) => {
  const status = Number(error?.statusCode || error?.status || 500);
  console.error('[VARNOX] HTTP request error:', error?.message || error);
  if (res.headersSent) return;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: true,
    message: status >= 500 ? 'Erreur interne du serveur.' : (error?.message || 'Requête invalide.'),
  });
});

/* ─── SPA fallback ─────────────────────────────────────────── */
app.get('*', (_q, r) => {
  const p = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(p)) return r.sendFile(p);
  r.json({ status: 'VARNOX XD V2 — Multi-User', v: '19.4.0' });
});

/* ─── Démarrage et arrêt propre ───────────────────────────── */
let server;
let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.warn(`[VARNOX] ${signal}: graceful shutdown started`);
  clearInterval(pairingRateCleanupTimer);
  for (const [number, pending] of pairingSockets) {
    clearTimeout(pending.timer);
    clearTimeout(pending.recoveryTimer);
    closeSocket(pending.sock, `shutdown:${signal}`);
    pairingSockets.delete(number);
  }
  await shutdownBotInstances();
  if (server) {
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 5000);
      timeout.unref?.();
      server.close(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  console.warn(`[VARNOX] ${signal}: sessions preserved; exiting`);
  process.exit(exitCode);
}

process.on('SIGTERM', () => { shutdown('SIGTERM').catch(error => { console.error('[VARNOX] SIGTERM shutdown failed:', error); process.exit(1); }); });
process.on('SIGINT', () => { shutdown('SIGINT').catch(error => { console.error('[VARNOX] SIGINT shutdown failed:', error); process.exit(1); }); });
process.on('uncaughtException', error => {
  console.error('[VARNOX] uncaughtException:', error?.stack || error);
  shutdown('uncaughtException', 1).catch(shutdownError => {
    console.error('[VARNOX] fatal shutdown failure:', shutdownError);
    process.exit(1);
  });
});
process.on('unhandledRejection', reason => {
  console.error('[VARNOX] unhandledRejection:', reason?.stack || reason);
});

server = app.listen(PORT, HOST, () => {
  console.log(`\n╔════════════════════════════════════════════════╗`);
  console.log(`║  VARNOX XD V2 v19.4 — Pairing stable             ║`);
  console.log(`║  Port : ${PORT} / Host : ${HOST}                  ║`);
  console.log(`║  saveCreds → session permanente                  ║`);
  console.log(`╚════════════════════════════════════════════════╝\n`);
});
server.on('error', error => {
  console.error('[VARNOX] HTTP server error:', error);
});
server.requestTimeout = 70_000;
server.headersTimeout = 75_000;
server.keepAliveTimeout = 65_000;

module.exports = app;
