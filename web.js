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
const PairingRequestRegistry = require('./lib/pairing-request-registry');
const { normalizeListenHost } = require('./lib/server-config');

const app  = express();
const PORT = process.env.PORT || 3000;
const HOST = normalizeListenHost(process.env.HOST);

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
const pairingRequests = new PairingRequestRegistry();
const pairingRecoveryPromises = new Map();
const pairingRecoveryInProgress = new Set();
const pairingRate = new Map();
const HTTP_METRICS = { total: 0, active: 0, errors: 0 };
const PAIRING_METRICS = { requests: 0, rejected: 0, reused: 0, inFlight: 0 };
const STARTED_AT = Date.now();
const PAIRING_RATE_WINDOW_MS = Math.max(60_000, Number(process.env.PAIRING_RATE_WINDOW_MS || 10 * 60 * 1000));
const PAIRING_RATE_MAX = Math.max(1, Number(process.env.PAIRING_RATE_MAX || 5));
const PAIRING_FAILURE_TTL_MS = Math.max(60_000, Number(process.env.PAIRING_FAILURE_TTL_MS || 15 * 60 * 1000));
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
  const now = Date.now();
  const cutoff = now - PAIRING_RATE_WINDOW_MS;
  for (const [key, value] of pairingRate) {
    if (value.startedAt < cutoff) pairingRate.delete(key);
  }
  const failureCutoff = now - PAIRING_FAILURE_TTL_MS;
  for (const [number, failure] of pairingFailures) {
    if (failure.ts < failureCutoff) pairingFailures.delete(number);
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
    if (pairingSockets.get(number) !== pending) return;
    recoverPairingSocket(number, sessionDir, pending).catch(error => {
      console.error(`[VARNOX] Pairing recovery task failed for ${maskPhoneNumber(number)}:`, error.message);
    });
  }, delayMs);
  pending.recoveryTimer.unref?.();
}

async function recoverPairingSocket(number, sessionDir, expectedPending) {
  const pending = pairingSockets.get(number);
  if (!pending || pending !== expectedPending || pending.recovering || pairedNumbers.has(number)
    || pairingRecoveryInProgress.has(number)
    || (pending.expiresAt && pending.expiresAt <= Date.now())) return;

  pairingRecoveryInProgress.add(number);
  pending.recovering = true;
  try {
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
      if (pairingSockets.get(number) === pending) pairingSockets.delete(number);
      sessionManager.updateSession(pending.sessionId || number, {
        status: 'ERROR',
        lastDisconnect: { code: 515, reason: message, at: new Date().toISOString() },
      });
      return;
    }

    // Important: reuse the same auth directory. Recreating an empty session
    // produces a new identity and invalidates the code that is on the phone.
    const logger = pino({ level: 'silent' });
    closeSocket(pending.sock, 'pairing recovery');
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const serializedSaveCreds = serializeSaveCreds(saveCreds);
    const version = await getLatestVersion();
    if (pairingSockets.get(number) !== pending
      || (pending.expiresAt && pending.expiresAt <= Date.now())) return;
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
          console.error(`[VARNOX] Pairing recovery activation failed for ${maskPhoneNumber(number)}:`, e.message);
          pairingFailures.set(number, { code: 500, message: e.message, ts: Date.now() });
          clearTimeout(next.timer);
          if (pairingSockets.get(number) === next) pairingSockets.delete(number);
          sessionManager.updateSession(next.sessionId, {
            status: 'ERROR',
            lastDisconnect: { code: 500, reason: 'Pairing activation failed.', at: new Date().toISOString() },
          });
        }
        return;
      }

      if (connection === 'close' && !pairedNumbers.has(number)) {
        const info = disconnectInfo(lastDisconnect?.error);
        if (info.code === 401 || info.code === DisconnectReason.loggedOut) {
          const message = 'WhatsApp a refusé le code. Supprime les anciens appareils liés et génère un nouveau code.';
          pairingFailures.set(number, { code: 401, message: `${message} La session est conservée.`, detail: info.message, ts: Date.now() });
          clearTimeout(next.timer);
          if (pairingSockets.get(number) === next) pairingSockets.delete(number);
          sessionManager.updateSession(next.sessionId || number, {
            status: 'ERROR',
            lastDisconnect: { code: 401, reason: message, at: new Date().toISOString() },
          });
        } else if (isPairingRestart(info.code)) {
          schedulePairingRecovery(number, sessionDir, Math.min(60000, 750 * (2 ** Math.min(next.recoveryAttempts - 1, 6))));
        }
      }
    });
  } catch (e) {
    pending.recovering = false;
    console.error(`[VARNOX] Pairing recovery failed for ${maskPhoneNumber(number)}:`, e.message);
    if (pairingSockets.get(number) === pending) schedulePairingRecovery(number, sessionDir, 1500);
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
    if (fs.existsSync(path.join(sd, '.logged_out'))) {
      sessionManager.updateSession(record.sessionId, {
        status: 'REVOKED',
        lastDisconnect: {
          code: 401,
          reason: 'WhatsApp revoked this session; credentials are preserved.',
          at: new Date().toISOString(),
        },
      });
      continue;
    }
    if (!fs.existsSync(path.join(sd, 'creds.json'))) {
      sessionManager.updateSession(record.sessionId, {
        status: 'ERROR',
        lastDisconnect: {
          code: null,
          reason: 'Saved auth credentials are missing; no session data was removed.',
          at: new Date().toISOString(),
        },
      });
      console.warn(`[VARNOX] Saved credentials missing for ${record.phoneMasked}; preserving its directory and registry record.`);
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
        console.warn(`[VARNOX] Skipping logged-out session: ${maskPhoneNumber(num)}`);
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
          console.warn(`[VARNOX] Skipping unfinished pairing session: ${maskPhoneNumber(num)}`);
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
      console.log(`[VARNOX] Restoring session: ${maskPhoneNumber(num)}`);
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
  const instances = getAllInstances().map(instance => ({
    phone: instance.phoneMasked,
    connected: instance.connected,
    running: instance.running,
    lifecycle: instance.lifecycle,
    reconnecting: instance.reconnecting,
    reconnectAttempts: instance.restartAttempts,
    queuedMessages: instance.queuedMessages,
  }));
  const runtime = getRuntimeStats();
  const manager = sessionManager.summary();
  r.json({
    status: 'ok',
    ready: sessionManager.ready && RESTORE_STATE.complete,
    bot: 'VARNOX XD V2',
    v: '19.4.0',
    build: 'pairing-baileys7-ubuntu',
    uptime: Math.floor(process.uptime()),
    instances,
    total: instances.length,
    runtime: {
      connectionEvents: runtime.connectionEvents,
      connected: runtime.connected,
      reconnectAttempts: runtime.reconnectAttempts,
      pairingActivations: runtime.pairingActivations,
      messageQueued: runtime.messageQueued,
      messageDropped: runtime.messageDropped,
      activeInstances: runtime.activeInstances,
      connectedInstances: runtime.connectedInstances,
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    manager: {
      ready: sessionManager.ready,
      totalSessions: manager.totalSessions,
      workersActive: manager.workersActive,
      workersConfigured: manager.workersConfigured,
    },
    http: { ...HTTP_METRICS },
    pairing: {
      active: pairingSockets.size,
      inFlight: pairingRequests.size,
      rateKeys: pairingRate.size,
      metrics: { ...PAIRING_METRICS, inFlight: pairingRequests.inFlight },
    },
  });
});

app.get('/ready', (_q, r) => {
  const ready = sessionManager.ready && RESTORE_STATE.complete;
  const manager = sessionManager.summary();
  const payload = {
    ready,
    status: ready ? 'ready' : 'starting',
    restore: RESTORE_STATE,
    manager: {
      ready: sessionManager.ready,
      totalSessions: manager.totalSessions,
      workersActive: manager.workersActive,
      workersConfigured: manager.workersConfigured,
    },
    uptime: Math.floor(process.uptime()),
  };
  return r.status(ready ? 200 : 503).json(payload);
});

app.get('/botStatus', (req, res) => {
  const num = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  if (num) {
    const i = getBotInstance(num);
    const session = sessionManager.getByPhone(num);
    return res.json({
      number: maskPhoneNumber(num),
      status: session?.status || (i?.connected ? 'CONNECTED' : 'DISCONNECTED'),
      running: !!i,
      connected: !!i?.connected,
      reconnecting: !!i?.reconnecting,
    });
  }
  res.json({
    instances: getAllInstances().map(i => ({
      number: i.phoneMasked,
      status: i.lifecycle,
      running: i.running,
      connected: i.connected,
      reconnecting: i.reconnecting,
      reconnectAttempts: i.restartAttempts,
    })),
  });
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
    status: session?.status || (i?.connected ? 'CONNECTED' : 'DISCONNECTED'),
    connected: !!i?.connected,
    running: !!i,
    pairing: pairingSockets.has(num),
    lastSeen: session?.lastSeen || null,
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
    return res.json({ ready: true, connected: true });
  }
  const failure = pairingFailures.get(number);
  const session = sessionManager.getByPhone(number);
  let error = failure?.message || null;
  let code = failure?.code || null;
  if (!error && session?.status === 'REVOKED') {
    error = 'WhatsApp a révoqué l’ancienne session. Une nouvelle demande peut générer un nouveau code ; les anciens fichiers sont conservés.';
    code = 401;
  } else if (!error && session?.status === 'ERROR') {
    error = 'La session enregistrée ne peut pas être restaurée. Tes données existantes sont conservées ; une nouvelle demande peut créer une session séparée.';
    code = session.lastDisconnect?.code || 0;
  } else if (!error && session?.status === 'DISCONNECTED') {
    error = 'La session est déconnectée. Relance Générer pour tenter de réutiliser ses identifiants conservés.';
    code = session.lastDisconnect?.code || 0;
  }
  res.json({
    ready    : false,
    connected: false,
    pairing  : pairingSockets.has(number),
    status   : session?.status || (i?.lifecycle?.toUpperCase() || 'DISCONNECTED'),
    error,
    code,
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
function sendPairingResponse(res, result = {}) {
  const { httpStatus = 200, ...payload } = result;
  return res.status(httpStatus).json(payload);
}

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
      message: 'Déjà connecté.',
    });
  if (existing && !existing.connected) {
    if (existing.reconnecting || existing.restartTimer || existing.lifecycle === 'connecting') {
      return res.status(202).json({
        error: false,
        resuming: true,
        status: existing.lifecycle?.toUpperCase() || 'RECONNECTING',
        message: 'La session enregistrée est en cours de reprise. Aucun nouveau jumelage ne sera lancé.',
      });
    }
    // A retry-limit instance is no longer a live socket. Drop only its
    // in-memory handlers; the saved auth directory remains untouched.
    stopBotInstance(number);
  }
  let registered = sessionManager.getByPhone(number);
  if (registered && !pairingSockets.has(number)) {
    const registeredDir = registered.sessionDir || path.join(SESSIONS_DIR, registered.sessionId);
    const credentialsFile = path.join(registeredDir, 'creds.json');
    const loggedOutMarker = path.join(registeredDir, '.logged_out');
    if (registered.status === 'REVOKED' || fs.existsSync(loggedOutMarker)) {
      // A revoked session is not resumed. Preserve its directory, release only
      // the metadata slot, then create a separate directory for explicit re-pairing.
      sessionManager.releaseSession(registered.sessionId);
      registered = null;
    } else if (fs.existsSync(credentialsFile)) {
      let credentialsRegistered = false;
      try {
        credentialsRegistered = Boolean(JSON.parse(fs.readFileSync(credentialsFile, 'utf8')).registered);
      } catch {
        // Keep unreadable auth files intact; a fresh attempt gets a new folder.
        sessionManager.releaseSession(registered.sessionId);
        registered = null;
      }

      if (registered && credentialsRegistered) {
        try {
          sessionManager.updateSession(registered.sessionId, {
            status: 'CONNECTING',
            reconnectAttempts: 0,
            lastDisconnect: null,
          });
          const resumedSocket = await createBotInstance(registeredDir, number, {
            sessionId: registered.sessionId,
            workerId: registered.workerId,
          });
          if (!resumedSocket && !getBotInstance(number)?.sock) {
            throw new Error('Saved session did not create an active socket.');
          }
          return res.status(202).json({
            error: false,
            resuming: true,
            status: 'CONNECTING',
            message: 'Les identifiants existants sont réutilisés ; la connexion WhatsApp est en cours de reprise.',
          });
        } catch (error) {
          sessionManager.updateSession(registered.sessionId, {
            status: 'ERROR',
            lastDisconnect: {
              code: null,
              reason: 'Unable to resume saved WhatsApp credentials.',
              at: new Date().toISOString(),
            },
          });
          console.error(`[VARNOX] Session resume failed for ${maskPhoneNumber(number)}:`, error.message);
          return res.status(503).json({
            error: true,
            preserving: true,
            status: 'ERROR',
            message: 'La session existante est conservée, mais WhatsApp ne répond pas pour le moment. Réessaie plus tard.',
          });
        }
      }

      if (registered) {
        // An unregistered auth state is an unfinished pairing. Reuse its
        // directory instead of silently discarding any keys it contains.
        sessionManager.updateSession(registered.sessionId, {
          status: 'PAIRING',
          sessionDir: registeredDir,
        });
      }
    } else {
      // The registry row has no auth file. It is stale metadata, not a
      // connected session; remove only that row and preserve the directory.
      sessionManager.releaseSession(registered.sessionId);
      registered = null;
    }
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
  const pairingRequest = pairingRequests.begin(number);
  PAIRING_METRICS.inFlight = pairingRequests.inFlight;
  if (!pairingRequest.owner) {
    return sendPairingResponse(res, await pairingRequest.promise);
  }
  const completePairingRequest = result => {
    pairingRequest.complete(result);
    PAIRING_METRICS.inFlight = pairingRequests.inFlight;
  };
  let allocation;
  let sock = null;
  try {
    allocation = sessionManager.reserveSession(number, { status: 'PAIRING' });
    const session = allocation.session;
    const userSessionDir = session.sessionDir || path.join(SESSIONS_DIR, session.sessionId);
    const sessionDir = userSessionDir;
    sessionManager.updateSession(session.sessionId, {
      status: 'PAIRING',
      sessionDir,
    });

    // Fermer le couplage précédent sans effacer ses fichiers d'authentification.
    if (pairingSockets.has(number)) {
      const old = pairingSockets.get(number);
      pairingSockets.delete(number);
      clearTimeout(old.timer);
      clearTimeout(old.recoveryTimer);
      closeSocket(old.sock, 'new pairing request');
      await new Promise(r => setTimeout(r, 300));
    }

    fs.mkdirSync(sessionDir, { recursive: true });
    markPairingPending(sessionDir);

    console.log(`[VARNOX] /pair for ${maskPhoneNumber(number)} on ${session.workerId}`);
    pairingFailures.delete(number);

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
      console.log(`[VARNOX] ✅ Bot activated on persistent socket for ${maskPhoneNumber(number)}`);
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
        console.log(`[VARNOX] ✅ WA authenticated for ${maskPhoneNumber(number)}`);
        try {
          await promotePairToBot(sock, serializedSaveCreds);
        } catch (error) {
          console.error(`[VARNOX] Pairing activation failed for ${maskPhoneNumber(number)}:`, error.message);
          pairingFailures.set(number, { code: 500, message: error.message, ts: Date.now() });
          clearTimeout(pendingPairing.timer);
          if (pairingSockets.get(number) === pendingPairing) pairingSockets.delete(number);
          sessionManager.updateSession(session.sessionId, {
            status: 'ERROR',
            lastDisconnect: { code: 500, reason: 'Pairing activation failed.', at: new Date().toISOString() },
          });
        }
      }

      if (connection === 'close') {
        // Après activation, le handler de botInstance gère la reconnexion.
        if (pairActivated) return;

        const info      = disconnectInfo(lastDisconnect?.error);
        const sc        = info.code;
        const loggedOut = sc === DisconnectReason.loggedOut || sc === 401;
        sessionManager.updateSession(session.sessionId, {
          status: loggedOut ? 'ERROR' : 'RECONNECTING',
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
          console.warn(`[VARNOX] Pairing socket restart required for ${maskPhoneNumber(number)}; preserving session`);
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
          if (p) {
            clearTimeout(p.timer);
            clearTimeout(p.recoveryTimer);
            if (pairingSockets.get(number) === p) pairingSockets.delete(number);
          }
          sessionManager.updateSession(session.sessionId, {
            status: 'ERROR',
            lastDisconnect: { code: sc, reason: info.message, at: new Date().toISOString() },
          });
          // Preserve the directory for an explicit retry.
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
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const timer = setTimeout(() => {
      const activePairing = pairingSockets.get(number);
      if (!activePairing || activePairing.sessionId !== session.sessionId
        || activePairing.expiresAt !== expiresAt) return;
      const message = 'Le code de jumelage a expiré. Génère un nouveau code ; les données de session sont conservées.';
      clearTimeout(activePairing.recoveryTimer);
      pairingFailures.set(number, { code: 408, message, ts: Date.now() });
      sessionManager.updateSession(session.sessionId, {
        status: 'ERROR',
        lastDisconnect: { code: 408, reason: message, at: new Date().toISOString() },
      });
      closeSocket(activePairing.sock, 'pairing expiry');
      pairingSockets.delete(number);
    }, 15 * 60 * 1000);
    timer.unref?.();

    pendingPairing.timer = timer;
    pendingPairing.code = formatted;
    pendingPairing.expiresAt = expiresAt;

    const result = { error: false, code: formatted };
    completePairingRequest(result);
    return sendPairingResponse(res, result);

  } catch (err) {
    console.error(`[VARNOX] /pair error ${maskPhoneNumber(number)}:`, err.message);
    const httpStatus = err instanceof SessionCapacityError || err.code === 'WORKERS_FULL'
      ? 503
      : Number(err.statusCode) || 502;
    const result = httpStatus === 503 && (err instanceof SessionCapacityError || err.code === 'WORKERS_FULL')
      ? {
          error: true,
          code: 'WORKERS_FULL',
          httpStatus,
          message: 'Tous les workers sont pleins. Réessaie plus tard.',
          workers: sessionManager.listWorkers(),
        }
      : {
          error: true,
          httpStatus,
          message: err.message || 'WhatsApp ne peut pas préparer le jumelage pour le moment.',
        };
    completePairingRequest(result);
    const pending = pairingSockets.get(number);
    if (pending && (!allocation?.session?.sessionId || pending.sessionId === allocation.session.sessionId)) {
      clearTimeout(pending.timer);
      clearTimeout(pending.recoveryTimer);
      pairingSockets.delete(number);
    }
    closeSocket(sock, 'pairing request failure');
    if (allocation?.session?.sessionId) {
      sessionManager.updateSession(allocation.session.sessionId, {
        status: 'ERROR',
        lastDisconnect: {
          code: err.statusCode || null,
          reason: 'Pairing failed; auth directory preserved for retry.',
          at: new Date().toISOString(),
        },
      });
      pairingFailures.set(number, {
        code: err.statusCode || 0,
        message: result.message,
        ts: Date.now(),
      });
    }
    return sendPairingResponse(res, result);
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
  await Promise.allSettled([...pairingSockets.entries()].map(async ([number, pending]) => {
    clearTimeout(pending.timer);
    clearTimeout(pending.recoveryTimer);
    try { await pending.saveCreds?.(); } catch (error) {
      console.error(`[VARNOX] Pairing credential flush failed for ${maskPhoneNumber(number)}:`, error.message);
    }
    closeSocket(pending.sock, `shutdown:${signal}`);
    if (pairingSockets.get(number) === pending) pairingSockets.delete(number);
  }));
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
  sessionManager.close();
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
  shutdown('unhandledRejection', 1).catch(shutdownError => {
    console.error('[VARNOX] unhandled rejection shutdown failure:', shutdownError);
    process.exit(1);
  });
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
