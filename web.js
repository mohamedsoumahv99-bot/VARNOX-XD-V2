/**
 * VARNOX XD V2 — web.js  v13  (NO SESSION-ID)
 *
 * Flow:
 *  1. User opens the panel, enters their phone number
 *  2. Pairing code is generated and shown
 *  3. User enters the code in WhatsApp → Linked Devices
 *  4. Session is saved to ./session/ (persisted disk on Render)
 *  5. Bot (index.js) starts automatically — no SESSION_ID env var needed
 *
 * Persistent disk (render.yaml) keeps ./session/ alive across restarts.
 */

'use strict';

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const https      = require('https');
const http       = require('http');
const { spawn }  = require('child_process');

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
const SESSION_DIR  = path.join(__dirname, 'session');    // bot session (persisted disk)
const SESSIONS_DIR = path.join(__dirname, 'sessions');   // temp pairing sessions
const DATA_DIR     = path.join(__dirname, 'data');
const OWNER_JSON   = path.join(DATA_DIR, 'owner.json');

[SESSION_DIR, SESSIONS_DIR, DATA_DIR].forEach(d => {
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
});

/* ─── owner.json ─────────────────────────────────────── */
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

/* ─── Bot process management ──────────────────────────── */
let botProcess   = null;
let botConnected = false;
let _currentQR   = null;
const botLogs    = [];
const MAX_LOGS   = 300;
let crashCount   = 0;
let lastCrash    = null;

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

/* ─── Auto-start if session present ─────────────────── */
setTimeout(() => {
  if (fs.existsSync(path.join(SESSION_DIR, 'creds.json'))) {
    console.log('[VARNOX] Session found → auto-starting bot');
    startBot();
  } else {
    console.log('[VARNOX] No session → pairing panel ready');
  }
}, 2000);

/* ─── Keep-alive (Render free tier) ──────────────────── */
const SELF_URL = process.env.RENDER_EXTERNAL_URL
  || (process.env.RENDER_EXTERNAL_HOSTNAME
      ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
      : null);

if (SELF_URL) {
  console.log(`[VARNOX] Keep-alive → ${SELF_URL}/ping every 14 min`);
  setInterval(() => {
    const mod = SELF_URL.startsWith('https') ? https : http;
    const req = mod.get(`${SELF_URL}/ping`, r => {
      appendLog(`[keepalive] ping → ${r.statusCode}`);
    });
    req.on('error', e => appendLog(`[keepalive] error: ${e.message}`));
    req.end();
  }, 14 * 60 * 1000);
}

/* ─── Pairing session store (memory, 30 min TTL) ─────── */
// Map<number, { ts: number, ready: boolean }>
const pairStore = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [num, entry] of pairStore) {
    if (now - entry.ts > 30 * 60 * 1000) {
      pairStore.delete(num);
      try { fs.rmSync(path.join(SESSIONS_DIR, `tmp_${num}`), { recursive: true, force: true }); } catch {}
      appendLog(`[web] pairing session expired for ${num}`);
    }
  }
}, 5 * 60 * 1000);

// Map<number, { sock, timer }>
const activeSockets = new Map();

/* ════════════════════════════════════════════════════════
 *   ROUTES
 * ════════════════════════════════════════════════════════ */

app.get('/ping',    (_req, res) => res.json({ pong: true, ts: Date.now() }));

app.get('/health',  (_req, res) => res.json({
  status      : 'online',
  bot         : 'VARNOX XD V2',
  version     : '13.0.0',
  uptime      : Math.floor(process.uptime()),
  botRunning  : !!botProcess,
  botConnected,
  hasSession  : fs.existsSync(path.join(SESSION_DIR, 'creds.json')),
}));

app.get('/botStatus', (_req, res) => res.json({
  running   : !!botProcess,
  connected : botConnected,
  session   : fs.existsSync(path.join(SESSION_DIR, 'creds.json')),
  crashCount,
  lastCrash,
}));

app.get('/debug', (_req, res) => {
  const sessionFiles  = (() => { try { return fs.readdirSync(SESSION_DIR);  } catch { return []; } })();
  const dataFiles     = (() => { try { return fs.readdirSync(DATA_DIR);     } catch { return []; } })();
  const userSessions  = (() => { try { return fs.readdirSync(SESSIONS_DIR); } catch { return []; } })();
  res.json({
    SESSION_DIR, SESSIONS_DIR, sessionFiles, dataFiles, userSessions,
    botProcess: !!botProcess, botConnected, crashCount, lastCrash,
    activeSockets: [...activeSockets.keys()],
    pairStore: [...pairStore.keys()],
  });
});

app.get('/bot-logs', (_req, res) => res.json({ count: botLogs.length, logs: botLogs }));

app.get('/reset', (_req, res) => {
  try {
    if (botProcess) {
      try { botProcess.kill('SIGTERM'); } catch {}
      botProcess = null; botConnected = false;
    }
    try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    appendLog('[web] /reset — session cleared');
    crashCount = 0; lastCrash = null;
    res.json({ ok: true, message: 'Session cleared. Re-pair to reconnect.' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/qr', (_req, res) => res.json({ qr: _currentQR, waiting: !_currentQR }));

/* ─── GET /status?number=XXX ─────────────────────────── */
app.get('/status', (req, res) => {
  const clean = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  if (!clean) return res.json({ botRunning: !!botProcess, botConnected });
  const entry = pairStore.get(clean);
  res.json({
    number    : clean,
    ready     : !!(entry?.ready),
    active    : activeSockets.has(clean),
    botRunning: !!botProcess,
    botConnected,
  });
});

/* ─── GET /session?number=XXX ────────────────────────── */
/* Frontend polls this to know when pairing is complete.  */
/* Returns { ready: true } — NO session string exposed.   */
app.get('/session', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  let { number } = req.query;
  if (!number) return res.json({ ready: false, error: 'number required' });
  number = number.replace(/[^0-9]/g, '');

  const entry = pairStore.get(number);
  if (entry?.ready) {
    return res.json({ ready: true });
  }

  // Also check if the main session file exists and bot is running
  if (fs.existsSync(path.join(SESSION_DIR, 'creds.json')) && botProcess) {
    return res.json({ ready: true });
  }

  res.json({ ready: false });
});

/* ════════════════════════════════════════════════════════
 *   POST /code  (also accepts GET)
 *   Generate a pairing code for the given phone number.
 *   On success → session saved → bot auto-started.
 * ════════════════════════════════════════════════════════ */
async function handleCode(req, res) {
  res.setHeader('Content-Type', 'application/json');

  let number = (req.query.number || req.body?.number || '');
  if (!number) return res.json({ error: true, message: 'Phone number required' });
  number = number.replace(/[^0-9]/g, '');
  if (number.length < 7 || number.length > 15)
    return res.json({ error: true, message: 'Invalid number (7–15 digits with country code, no +)' });

  // If already paired and bot running, reply immediately
  if (pairStore.get(number)?.ready && botProcess) {
    return res.json({ error: false, already: true, message: 'Already connected.' });
  }

  const userSessionDir = path.join(SESSIONS_DIR, `tmp_${number}`);

  // Close any existing socket for this number
  if (activeSockets.has(number)) {
    const old = activeSockets.get(number);
    clearTimeout(old.timer);
    try { old.sock.ws?.close(); } catch {}
    activeSockets.delete(number);
  }

  // Clean previous incomplete session
  try { fs.rmSync(userSessionDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(userSessionDir, { recursive: true });

  appendLog(`[web] /code for ${number}`);

  try {
    /* Fetch Baileys version */
    let version = [2, 3000, 1023097280];
    try {
      const result = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000)),
      ]);
      if (result?.version) version = result.version;
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

    sock.ev.on('creds.update', saveCreds);

    let codeResolve, codeReject;
    let codeDone    = false;
    let pairStarted = false;
    let attempts    = 0;
    const MAX_TRIES = 5;

    const codePromise = new Promise((res, rej) => {
      codeResolve = res;
      codeReject  = rej;
    });

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

    /* ── Copy session to main folder and (re)start bot ── */
    async function activateSession() {
      const src = path.join(userSessionDir, 'creds.json');
      if (!fs.existsSync(src)) {
        appendLog(`[web] ⚠ creds.json not found for ${number}`);
        return;
      }
      try {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
        fs.copyFileSync(src, path.join(SESSION_DIR, 'creds.json'));
        appendLog(`[web] ✅ Session → ./session/creds.json for ${number}`);
      } catch (e) {
        appendLog(`[web] session copy error: ${e.message}`);
        return;
      }

      // Update owner number in owner.json
      initOwnerJson(number);

      // Mark as ready in memory store
      pairStore.set(number, { ts: Date.now(), ready: true });

      // Start or restart the bot
      if (botProcess) {
        appendLog('[web] Restarting bot with new session…');
        try { botProcess.kill('SIGTERM'); } catch {}
        botProcess = null; botConnected = false;
        setTimeout(startBot, 3000);
      } else {
        startBot();
      }
    }

    /* ── Connection update ── */
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
        await activateSession();

        const entry = activeSockets.get(number);
        if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }
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

        if (registered && !pairStore.get(number)?.ready) {
          appendLog(`[web] ✅ Pairing confirmed at close for ${number}`);
          await saveAndClose(3000);
          await activateSession();
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

    // Cold-start fallback
    setTimeout(() => {
      if (!codeDone && !pairStarted) {
        appendLog(`[web] cold-start fallback → forcing requestPairingCode for ${number}`);
        pairStarted = true;
        tryRequestCode();
      }
    }, 8000);

    const raw       = await codePromise;
    const formatted = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,4}/g)?.join('-') ?? raw;

    // 15-min cleanup timer
    const timer = setTimeout(() => {
      if (activeSockets.has(number)) {
        appendLog(`[web] 15-min timeout — closing socket for ${number}`);
        try { activeSockets.get(number).sock.ws?.close(); } catch {}
        activeSockets.delete(number);
        if (!pairStore.get(number)?.ready) {
          try { fs.rmSync(userSessionDir, { recursive: true, force: true }); } catch {}
        }
      }
    }, 15 * 60 * 1000);

    activeSockets.set(number, { sock, timer });
    return res.json({ error: false, code: formatted });

  } catch (err) {
    appendLog('[web] /code error: ' + err.message);
    console.error('[VARNOX] Pairing error:', err.message);
    if (!pairStore.get(number)?.ready) {
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
  console.log(`║  VARNOX XD V2 v13  —  Port ${PORT}     ║`);
  console.log(`╠══════════════════════════════════════╣`);
  console.log(`║  Panel   : http://localhost:${PORT}       ║`);
  console.log(`║  No SESSION_ID needed — pair & go!   ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
  if (SELF_URL) console.log(`[VARNOX] Keep-alive: ${SELF_URL}`);
});

module.exports = app;
