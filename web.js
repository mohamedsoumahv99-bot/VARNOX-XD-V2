/**
 * VARNOX XD V2 — web.js  v12  (MULTI-USER)
 *
 * v12 CHANGES:
 *  - MULTI-USER architecture: each user gets their own isolated session folder
 *    sessions/tmp_<number>/ — no shared session, no "already connected" block
 *  - After pairing: session base64 string generated and exposed via GET /session
 *  - Thousands of users can pair simultaneously across 60 servers
 *  - Owner bot (startBot) still works via the main session/ folder
 *  - Pairing sockets cleaned up after 15 min or after session retrieval
 */

'use strict';

require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const path        = require('path');
const fs          = require('fs');
const https       = require('https');
const http        = require('http');
const { spawn }   = require('child_process');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino      = require('pino');
const NodeCache = require('node-cache');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ─── Paths ───────────────────────────────────────────── */
const SESSION_DIR  = path.join(__dirname, 'session');    // owner bot session
const SESSIONS_DIR = path.join(__dirname, 'sessions');   // per-user pairing sessions
const DATA_DIR     = path.join(__dirname, 'data');
const OWNER_JSON   = path.join(DATA_DIR, 'owner.json');

/* ─── Create directories ─────────────────────────────── */
[SESSION_DIR, SESSIONS_DIR, DATA_DIR].forEach(d => {
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
});

/* ─── owner.json initializer ─────────────────────────── */
function initOwnerJson(overrideNumber) {
  let current = {};
  try {
    if (fs.existsSync(OWNER_JSON))
      current = JSON.parse(fs.readFileSync(OWNER_JSON, 'utf8'));
  } catch {}

  const placeholder = !current.ownerNumber
    || current.ownerNumber === 'TON_NUMERO_ICI'
    || current.ownerNumber === '';

  const realNumber = overrideNumber
    || (!placeholder ? current.ownerNumber : null)
    || process.env.OWNER_NUMBER
    || '';

  if (overrideNumber || placeholder) {
    try {
      fs.writeFileSync(OWNER_JSON, JSON.stringify({
        ownerNumber : realNumber,
        ownerName   : current.ownerName  || 'Owner',
        botName     : current.botName    || 'VARNOX XD V2',
        prefix      : current.prefix     || process.env.PREFIX || '.',
        version     : '2.0.0',
        mess        : current.mess       || 'Owner',
      }, null, 2));
      console.log(`[VARNOX] owner.json → ownerNumber=${realNumber || '(empty)'}`);
    } catch (e) { console.error('[VARNOX] owner.json write error:', e.message); }
  }
}
initOwnerJson();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* ─── Owner bot process management ───────────────────── */
let botProcess    = null;
let botConnected  = false;
let _currentQR    = null;
const botLogs     = [];
const MAX_LOGS    = 300;
let   crashCount  = 0;
let   lastCrash   = null;

function appendLog(line) {
  botLogs.push(`${new Date().toISOString()} ${line}`);
  if (botLogs.length > MAX_LOGS) botLogs.shift();
}

function startBot() {
  if (botProcess) return;
  console.log('[VARNOX] Starting index.js…');
  appendLog('[web] Starting index.js');
  botConnected = false;

  botProcess = spawn('node', ['index.js'], {
    stdio : ['ignore', 'pipe', 'pipe'],
    env   : { ...process.env, SKIP_PAIRING: '1', FORCE_COLOR: '0' },
    cwd   : __dirname,
  });

  botProcess.stdout?.on('data', d => {
    String(d).split('\n').filter(Boolean).forEach(l => {
      process.stdout.write('[BOT] ' + l + '\n');
      appendLog('[out] ' + l);
      if (l.includes('✅') || l.includes('connected') || l.includes('connecté')) {
        botConnected = true;
      }
    });
  });
  botProcess.stderr?.on('data', d => {
    String(d).split('\n').filter(Boolean).forEach(l => {
      process.stderr.write('[BOT ERR] ' + l + '\n');
      appendLog('[err] ' + l);
    });
  });
  botProcess.on('error', err => {
    console.error('[VARNOX] spawn error:', err.message);
    appendLog('[web] spawn error: ' + err.message);
    botProcess = null; lastCrash = err.message; crashCount++;
  });
  botProcess.on('exit', (code, signal) => {
    const msg = `exit code=${code} signal=${signal}`;
    console.log(`[VARNOX] Bot stopped (${msg}). Restarting in 10s…`);
    appendLog('[web] Bot stopped: ' + msg);
    botProcess = null; botConnected = false; lastCrash = msg; crashCount++;

    setTimeout(() => {
      if (fs.existsSync(path.join(SESSION_DIR, 'creds.json'))) {
        appendLog('[web] Auto-restarting…');
        startBot();
      } else {
        appendLog('[web] No session — restart cancelled');
      }
    }, 10000);
  });
}

/* ─── Auto-start if owner session present ───────────── */
setTimeout(() => {
  if (fs.existsSync(path.join(SESSION_DIR, 'creds.json'))) {
    console.log('[VARNOX] Session found → auto-starting bot');
    startBot();
  } else {
    console.log('[VARNOX] No session → pairing panel ready');
  }
}, 2000);

/* ════════════════════════════════════════════════════════
 *  KEEP-ALIVE — prevent Render free-tier from sleeping
 * ════════════════════════════════════════════════════════ */
const SELF_URL = process.env.RENDER_EXTERNAL_URL
  || (process.env.RENDER_EXTERNAL_HOSTNAME
      ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
      : null);

if (SELF_URL) {
  console.log(`[VARNOX] Keep-alive enabled → ${SELF_URL}/ping every 14 min`);
  setInterval(() => {
    const mod = SELF_URL.startsWith('https') ? https : http;
    const req = mod.get(`${SELF_URL}/ping`, (r) => {
      appendLog(`[keepalive] ping → ${r.statusCode}`);
    });
    req.on('error', (e) => appendLog(`[keepalive] ping error: ${e.message}`));
    req.end();
  }, 14 * 60 * 1000);
}

/* ════════════════════════════════════════════════════════
 *   MULTI-USER SESSION STORE
 *   After a user pairs, their session base64 is stored here.
 *   Expires after 30 minutes so memory doesn't grow forever.
 * ════════════════════════════════════════════════════════ */
// Map<number, { b64: string, ts: number }>
const sessionStore = new Map();

// Clean expired sessions every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [num, entry] of sessionStore) {
    if (now - entry.ts > 30 * 60 * 1000) {
      sessionStore.delete(num);
      // Clean up the disk folder too
      try { fs.rmSync(path.join(SESSIONS_DIR, `tmp_${num}`), { recursive: true, force: true }); } catch {}
      appendLog(`[web] session expired/cleaned for ${num}`);
    }
  }
}, 5 * 60 * 1000);

// Map<number, { sock, timer }> — active pairing sockets
const activeSockets = new Map();

/* ════════════════════════════════════════════════════════
 *   SERVER MANAGEMENT API
 *   60 virtual servers, 50 slots each.
 *   Counts persisted to data/servers.json.
 * ════════════════════════════════════════════════════════ */
const SERVERS_JSON = path.join(DATA_DIR, 'servers.json');

const SERVER_IDS = [
  'AF01','AF02','AF03','AF04','AF05','AF06','AF07','AF08','AF09','AF10',
  'AF11','AF12','AF13','AF14','AF15','AF16','AF17','AF18','AF19','AF20',
  'EU01','EU02','EU03','EU04','EU05','EU06','EU07','EU08','EU09','EU10',
  'EU11','EU12','EU13','EU14','EU15','EU16','EU17','EU18','EU19','EU20',
  'AM01','AM02','AM03','AM04','AM05','AM06','AM07','AM08','AM09','AM10',
  'AS01','AS02','AS03','AS04','AS05','AS06','AS07','AS08','AS09','AS10',
];

function loadServerCounts() {
  try {
    if (fs.existsSync(SERVERS_JSON))
      return JSON.parse(fs.readFileSync(SERVERS_JSON, 'utf8'));
  } catch {}
  const counts = {};
  SERVER_IDS.forEach(id => { counts[id] = Math.floor(Math.random() * 30) + 5; });
  saveServerCounts(counts);
  return counts;
}

function saveServerCounts(counts) {
  try { fs.writeFileSync(SERVERS_JSON, JSON.stringify(counts, null, 2)); } catch {}
}

let serverCounts = loadServerCounts();

/* ─── GET /api/servers ─── raw counts ─────────────────── */
app.get('/api/servers', (_req, res) => {
  res.json({ ok: true, counts: serverCounts, max: 50 });
});

/* ─── GET /servers ─── frontend-facing: 60 servers ────── */
app.get('/servers', (_req, res) => {
  const servers = Array.from({ length: 60 }, (_, i) => {
    const n   = i + 1;
    const key = SERVER_IDS[i] || `SRV${String(n).padStart(2, '0')}`;
    return {
      id    : n,
      name  : `Server ${n}`,
      active: serverCounts[key] || Math.floor(Math.random() * 25) + 3,
      limit : 50,
      url   : '',
    };
  });
  res.json({ ok: true, servers });
});

/* ─── POST /api/servers/join ─── increment ─────────────── */
app.post('/api/servers/join', (req, res) => {
  const serverId = req.query.server || req.body?.server;
  if (!serverId || !SERVER_IDS.includes(serverId))
    return res.json({ ok: false, error: 'Unknown server' });
  const cur = serverCounts[serverId] || 0;
  if (cur >= 50) return res.json({ ok: false, error: 'Server full' });
  serverCounts[serverId] = cur + 1;
  saveServerCounts(serverCounts);
  res.json({ ok: true, server: serverId, current: serverCounts[serverId] });
});

/* ─── POST /api/servers/leave ─── decrement ────────────── */
app.post('/api/servers/leave', (req, res) => {
  const serverId = req.query.server || req.body?.server;
  if (!serverId || !SERVER_IDS.includes(serverId))
    return res.json({ ok: false, error: 'Unknown server' });
  serverCounts[serverId] = Math.max(0, (serverCounts[serverId] || 1) - 1);
  saveServerCounts(serverCounts);
  res.json({ ok: true, server: serverId, current: serverCounts[serverId] });
});

/* ════════════════════════════════════════════════════════
 *   ROUTES
 * ════════════════════════════════════════════════════════ */

/* ─── /ping ─────────────────────────────────────────────── */
app.get('/ping', (_req, res) => res.json({ pong: true, ts: Date.now() }));

/* ─── /health ────────────────────────────────────────────── */
app.get('/health', (_req, res) => {
  res.json({
    status      : 'online',
    bot         : 'VARNOX XD V2',
    version     : '12.0.0',
    platform    : process.env.RENDER_EXTERNAL_HOSTNAME ? 'render'
                : process.env.RAILWAY_ENVIRONMENT || 'local',
    uptime      : Math.floor(process.uptime()),
    botRunning  : !!botProcess,
    botConnected,
    activePairs : activeSockets.size,
    readySessions: sessionStore.size,
    ownerSession: fs.existsSync(path.join(SESSION_DIR, 'creds.json')),
  });
});

/* ─── /debug ─────────────────────────────────────────────── */
app.get('/debug', (_req, res) => {
  const sessionFiles = (() => { try { return fs.readdirSync(SESSION_DIR); } catch { return []; } })();
  const dataFiles    = (() => { try { return fs.readdirSync(DATA_DIR);    } catch { return []; } })();
  const userSessions = (() => { try { return fs.readdirSync(SESSIONS_DIR); } catch { return []; } })();
  res.json({
    SESSION_DIR,
    SESSIONS_DIR,
    sessionFiles,
    dataFiles,
    userSessions,
    botProcess    : !!botProcess,
    botConnected,
    activeSockets : [...activeSockets.keys()],
    sessionStore  : [...sessionStore.keys()],
    crashCount,
    lastCrash,
  });
});

/* ─── /bot-logs ──────────────────────────────────────────── */
app.get('/bot-logs', (_req, res) => res.json({ count: botLogs.length, logs: botLogs }));

/* ─── /botStatus ─────────────────────────────────────────── */
app.get('/botStatus', (_req, res) => {
  res.json({
    running   : !!botProcess,
    connected : botConnected,
    session   : fs.existsSync(path.join(SESSION_DIR, 'creds.json')),
    crashCount,
    lastCrash,
  });
});

/* ─── /reset ─── owner-only: clear owner session ─────────── */
app.get('/reset', (_req, res) => {
  try {
    if (botProcess) {
      try { botProcess.kill('SIGTERM'); } catch {}
      botProcess = null; botConnected = false;
    }
    try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    appendLog('[web] /reset — owner session cleared');
    crashCount = 0; lastCrash = null;
    res.json({ ok: true, message: 'Owner session cleared. Re-pair to reconnect.' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

/* ─── /start-bot ─────────────────────────────────────────── */
app.get('/start-bot', (_req, res) => {
  if (botProcess)
    return res.json({ ok: false, message: `Bot already running (pid=${botProcess.pid})` });
  if (!fs.existsSync(path.join(SESSION_DIR, 'creds.json')))
    return res.json({ ok: false, message: 'No owner session. Do the owner pairing first.' });
  startBot();
  res.json({ ok: true, message: 'Bot started.' });
});

/* ─── /qr ────────────────────────────────────────────────── */
app.get('/qr', (_req, res) => {
  res.json({ qr: _currentQR, waiting: !_currentQR });
});

/* ─── /status ────────────────────────────────────────────── */
app.get('/status', (req, res) => {
  const clean = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  if (!clean) return res.json({ sessions: activeSockets.size, botRunning: !!botProcess });
  const paired = sessionStore.has(clean);
  res.json({ number: clean, paired, active: activeSockets.has(clean) });
});

/* ════════════════════════════════════════════════════════
 *   GET /session?number=XXX
 *   Returns the base64 session string once pairing is done.
 *   Frontend polls this every 3s after showing the code.
 * ════════════════════════════════════════════════════════ */
app.get('/session', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  let { number } = req.query;
  if (!number) return res.json({ ready: false, error: 'number required' });
  number = number.replace(/[^0-9]/g, '');

  if (sessionStore.has(number)) {
    const { b64 } = sessionStore.get(number);
    return res.json({ ready: true, session: b64 });
  }

  // Check disk directly (for edge case where server restarted)
  const credsPath = path.join(SESSIONS_DIR, `tmp_${number}`, 'creds.json');
  if (fs.existsSync(credsPath)) {
    try {
      const raw = fs.readFileSync(credsPath, 'utf8');
      const b64 = Buffer.from(raw).toString('base64');
      sessionStore.set(number, { b64, ts: Date.now() });
      return res.json({ ready: true, session: b64 });
    } catch {}
  }

  res.json({ ready: false });
});

/* ════════════════════════════════════════════════════════
 *   POST /code  (also accepts GET for compat)
 *   MULTI-USER: each number gets its own session folder.
 *   No "already connected" block — anyone can pair anytime.
 * ════════════════════════════════════════════════════════ */
async function handleCode(req, res) {
  res.setHeader('Content-Type', 'application/json');

  let number = (req.query.number || req.body?.number || '');
  if (!number) return res.json({ error: true, message: 'Phone number required' });
  number = number.replace(/[^0-9]/g, '');
  if (number.length < 7 || number.length > 15)
    return res.json({ error: true, message: 'Invalid number (7–15 digits with country code, no +)' });

  // Already have a ready session? Return immediately.
  if (sessionStore.has(number)) {
    const { b64 } = sessionStore.get(number);
    return res.json({ error: false, already: true, session: b64, message: 'Already paired.' });
  }

  // Per-user session folder
  const userSessionDir = path.join(SESSIONS_DIR, `tmp_${number}`);

  /* Close any existing socket for this number */
  if (activeSockets.has(number)) {
    const old = activeSockets.get(number);
    clearTimeout(old.timer);
    try { old.sock.ws?.close(); } catch {}
    activeSockets.delete(number);
  }

  /* Clean previous incomplete session for this number */
  try { fs.rmSync(userSessionDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(userSessionDir, { recursive: true });

  appendLog(`[web] /code requested for ${number}`);

  try {
    /* ── Fetch latest Baileys version with fallback ── */
    let version = [2, 3000, 1023097280];
    try {
      const result = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000)),
      ]);
      if (result?.version) version = result.version;
      appendLog(`[web] Baileys version: ${version.join('.')}`);
    } catch (e) {
      appendLog('[web] fetchLatestBaileysVersion fallback: ' + e.message);
    }

    const { state, saveCreds } = await useMultiFileAuthState(userSessionDir);
    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
      version,
      logger,
      printQRInTerminal : false,
      browser           : Browsers.ubuntu('Chrome'),
      auth: {
        creds : state.creds,
        keys  : makeCacheableSignalKeyStore(state.keys, logger),
      },
      msgRetryCounterCache : new NodeCache({ stdTTL: 120 }),
      connectTimeoutMs     : 60000,
      keepAliveIntervalMs  : 10_000,
    });

    /* CRITICAL: save creds on every update */
    sock.ev.on('creds.update', saveCreds);

    /* ── Pairing code promise ── */
    let codeResolve, codeReject;
    let codeDone    = false;
    let pairStarted = false;
    let attempts    = 0;
    const MAX_TRIES = 5;

    const codePromise = new Promise((res, rej) => {
      codeResolve = res;
      codeReject  = rej;
    });

    /* Hard timeout 45s */
    const hardTimeout = setTimeout(() => {
      if (!codeDone) {
        codeDone = true;
        codeReject(new Error('Timeout 45s — WhatsApp not responding. Try again.'));
      }
    }, 45000);

    async function tryRequestCode() {
      if (codeDone) return;
      attempts++;
      appendLog(`[web] requestPairingCode attempt ${attempts} for ${number}`);
      try {
        if (sock.authState?.creds?.registered) {
          if (!codeDone) {
            codeDone = true; clearTimeout(hardTimeout);
            codeReject(new Error(
              'Number already registered. In WhatsApp → Linked Devices → remove the bot, then try again.'
            ));
          }
          return;
        }
        const raw = await sock.requestPairingCode(number);
        if (raw && !codeDone) {
          codeDone = true; clearTimeout(hardTimeout);
          appendLog(`[web] ✅ Code obtained for ${number}`);
          codeResolve(raw);
        } else if (!raw && !codeDone) {
          if (attempts < MAX_TRIES) setTimeout(tryRequestCode, 3000);
          else {
            codeDone = true; clearTimeout(hardTimeout);
            codeReject(new Error('Null code after retries. Try again.'));
          }
        }
      } catch (e) {
        appendLog(`[web] requestPairingCode error: ${e.message}`);
        if (codeDone) return;
        if (attempts < MAX_TRIES) setTimeout(tryRequestCode, 3000);
        else {
          codeDone = true; clearTimeout(hardTimeout);
          codeReject(new Error('Pairing error: ' + e.message));
        }
      }
    }

    /* Helper: save creds then close socket cleanly */
    async function saveAndClose(delayMs = 4000) {
      try {
        await saveCreds();
        appendLog(`[web] creds saved ✅ for ${number}`);
      } catch (e) {
        appendLog(`[web] saveCreds error: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, delayMs));
      try { sock.ws?.close(); } catch {}
    }

    /* Helper: generate base64 session string from saved creds */
    async function buildSessionString() {
      const credsPath = path.join(userSessionDir, 'creds.json');
      if (!fs.existsSync(credsPath)) return null;
      try {
        const raw = fs.readFileSync(credsPath, 'utf8');
        return Buffer.from(raw).toString('base64');
      } catch { return null; }
    }

    /* ── Connection update handler ── */
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) { _currentQR = qr; }

      if (connection === 'connecting' && !pairStarted) {
        pairStarted = true;
        appendLog(`[web] connecting → requestPairingCode in 1.5s for ${number}`);
        setTimeout(tryRequestCode, 1500);
      }

      if (connection === 'open') {
        _currentQR = null;
        appendLog(`[web] ✅ WhatsApp connected for ${number}`);
        console.log(`[VARNOX] ✅ Paired: ${number}`);

        await saveAndClose(4000);

        /* Generate and store session base64 */
        const b64 = await buildSessionString();
        if (b64) {
          sessionStore.set(number, { b64, ts: Date.now() });
          appendLog(`[web] ✅ Session ready for ${number} (${b64.length} chars)`);
        }

        const entry = activeSockets.get(number);
        if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }

        /* If this is the owner number and no owner bot running, start it */
        let ownerNum = '';
        try { ownerNum = JSON.parse(fs.readFileSync(OWNER_JSON, 'utf8')).ownerNumber || ''; } catch {}
        if (ownerNum && number === ownerNum.replace(/\D/g, '') && !botProcess) {
          // Copy session to owner dir
          try {
            const src = path.join(userSessionDir, 'creds.json');
            if (fs.existsSync(src)) {
              fs.mkdirSync(SESSION_DIR, { recursive: true });
              fs.copyFileSync(src, path.join(SESSION_DIR, 'creds.json'));
            }
          } catch {}
          initOwnerJson(number);
          startBot();
        }
        return;
      }

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        appendLog(`[web] connection close — reason=${reason} codeDone=${codeDone} for ${number}`);

        if (!codeDone) {
          if (reason === DisconnectReason.loggedOut) {
            codeDone = true; clearTimeout(hardTimeout);
            codeReject(new Error('Session expired. Try again.'));
          }
          return;
        }

        const registered = !!sock.authState?.creds?.registered;
        appendLog(`[web] post-code close — registered=${registered} for ${number}`);

        if (registered && !sessionStore.has(number)) {
          appendLog(`[web] ✅ Pairing confirmed at close for ${number}`);
          await saveAndClose(3000);
          const b64 = await buildSessionString();
          if (b64) {
            sessionStore.set(number, { b64, ts: Date.now() });
            appendLog(`[web] ✅ Session stored for ${number}`);
          }
          const entry = activeSockets.get(number);
          if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }
        } else if (!registered && reason === DisconnectReason.loggedOut) {
          appendLog(`[web] ❌ Pairing failed for ${number}`);
          const entry = activeSockets.get(number);
          if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }
          try { fs.rmSync(userSessionDir, { recursive: true, force: true }); } catch {}
        }
      }
    });

    /* ── Cold-start fallback: if 'connecting' doesn't fire in 8s ── */
    setTimeout(() => {
      if (!codeDone && !pairStarted) {
        appendLog(`[web] cold-start fallback → forcing requestPairingCode for ${number}`);
        pairStarted = true;
        tryRequestCode();
      }
    }, 8000);

    /* ── Wait for code ── */
    const raw       = await codePromise;
    const formatted = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,4}/g)?.join('-') ?? raw;

    /* ── 15-min cleanup timer ── */
    const timer = setTimeout(() => {
      if (activeSockets.has(number)) {
        appendLog(`[web] 15-min timeout — closing socket for ${number}`);
        try { activeSockets.get(number).sock.ws?.close(); } catch {}
        activeSockets.delete(number);
        if (!sessionStore.has(number)) {
          try { fs.rmSync(userSessionDir, { recursive: true, force: true }); } catch {}
        }
      }
    }, 15 * 60 * 1000);

    activeSockets.set(number, { sock, timer });
    return res.json({ error: false, code: formatted });

  } catch (err) {
    appendLog('[web] /code error: ' + err.message);
    console.error('[VARNOX] Pairing error:', err.message);
    // Clean up on error (only if no session was stored)
    if (!sessionStore.has(number)) {
      try { fs.rmSync(userSessionDir, { recursive: true, force: true }); } catch {}
    }
    return res.json({ error: true, message: err.message || 'Error generating code' });
  }
}

app.get('/code', handleCode);
app.post('/code', handleCode);

/* ─── SPA fallback ────────────────────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ─── Start server ────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  VARNOX XD V2 v12  —  Port ${PORT}     ║`);
  console.log(`╠══════════════════════════════════════╣`);
  console.log(`║  Multi-user pairing enabled          ║`);
  console.log(`║  Panel  : http://localhost:${PORT}       ║`);
  console.log(`║  Debug  : http://localhost:${PORT}/debug ║`);
  console.log(`║  Logs   : http://localhost:${PORT}/bot-logs ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
  if (SELF_URL) console.log(`[VARNOX] Keep-alive: ${SELF_URL}`);
});

module.exports = app;
