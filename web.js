/**
 * VARNOX XD V2 — web.js  v11
 *
 * FIXES v11 (Baileys v7 upgrade):
 *  - @whiskeysockets/baileys → 7.0.0-rc14 (latest, replaces 6.7.x)
 *  - Removed options dropped in v7: syncFullHistory, markOnlineOnConnect,
 *    generateHighQualityLinkPreview (causes TypeError if passed)
 *
 *  FIXES v10 (pairing reliability):
 *  - NEVER call sock.end() before saveCreds() finishes → was losing creds.json
 *  - await saveCreds() explicitly after connection open/close
 *  - Wait 4s after saveCreds() before closing the pairing socket
 *  - Keep-alive self-ping every 14 min to prevent Render free-tier sleep
 *  - Baileys version updated in package.json (^6.7.4 → ^6.7.18)
 *  - Cold-start fallback delay increased to 8s
 *  - Cleanup timer raised to 15 min (user may be slow entering code)
 *  - Added /ping endpoint for uptime monitors (UptimeRobot etc.)
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
const SESSION_DIR = path.join(__dirname, 'session');
const DATA_DIR    = path.join(__dirname, 'data');
const OWNER_JSON  = path.join(DATA_DIR, 'owner.json');

/* ─── Create directories ─────────────────────────────── */
[SESSION_DIR, DATA_DIR].forEach(d => {
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

/* ─── Bot process management ─────────────────────────── */
let botProcess    = null;
let botConnected  = false;
let _currentQR    = null;
const activeSockets = new Map();
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

/* ─── Auto-start if session present ─────────────────── */
setTimeout(() => {
  if (fs.existsSync(path.join(SESSION_DIR, 'creds.json'))) {
    console.log('[VARNOX] Session found → auto-starting bot');
    startBot();
  } else {
    console.log('[VARNOX] No session → pairing panel ready');
  }
}, 2000);

/* ════════════════════════════════════════════════════════
 *  KEEP-ALIVE  — prevent Render free-tier from sleeping
 *  Pings /ping every 14 minutes.
 *  Works automatically if RENDER_EXTERNAL_URL is set.
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
  }, 14 * 60 * 1000); // 14 minutes
}

/* ════════════════════════════════════════════════════════
 *   ROUTES
 * ════════════════════════════════════════════════════════ */

/* ─── /ping — for uptime monitors & keep-alive ───────── */
app.get('/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

/* ─── /health ─────────────────────────────────────────── */
app.get('/health', (_req, res) => {
  res.json({
    status      : 'online',
    bot         : 'VARNOX XD V2',
    version     : '11.0.0',
    platform    : process.env.RENDER_EXTERNAL_HOSTNAME ? 'render'
                : process.env.RAILWAY_ENVIRONMENT || 'local',
    uptime      : Math.floor(process.uptime()),
    botRunning  : !!botProcess,
    botConnected,
    session     : fs.existsSync(path.join(SESSION_DIR, 'creds.json')),
  });
});

/* ─── /debug ──────────────────────────────────────────── */
app.get('/debug', (_req, res) => {
  const sessionFiles = (() => { try { return fs.readdirSync(SESSION_DIR); } catch { return []; } })();
  const dataFiles    = (() => { try { return fs.readdirSync(DATA_DIR);    } catch { return []; } })();
  let ownerData = null;
  try { ownerData = JSON.parse(fs.readFileSync(OWNER_JSON, 'utf8')); } catch {}
  res.json({
    ok              : true,
    version         : '11.0.0',
    nodeVersion     : process.version,
    platform        : process.env.RENDER_EXTERNAL_HOSTNAME ? 'render'
                    : process.env.RAILWAY_ENVIRONMENT || 'local',
    port            : PORT,
    uptime          : Math.floor(process.uptime()),
    botRunning      : !!botProcess,
    botConnected,
    crashCount,
    lastCrash,
    activeSockets   : activeSockets.size,
    hasCredentials  : sessionFiles.includes('creds.json'),
    sessionFiles,
    dataFiles,
    ownerNumber     : ownerData?.ownerNumber || 'not set',
    keepAliveUrl    : SELF_URL || 'not configured',
    envVars: {
      PORT                : !!process.env.PORT,
      OWNER_NUMBER        : !!process.env.OWNER_NUMBER,
      RENDER              : !!process.env.RENDER,
      RENDER_EXTERNAL_URL : !!process.env.RENDER_EXTERNAL_URL,
    },
    lastBotLogs     : botLogs.slice(-30),
  });
});

/* ─── /bot-logs ───────────────────────────────────────── */
app.get('/bot-logs', (_req, res) => {
  res.json({ count: botLogs.length, logs: botLogs });
});

/* ─── /botStatus ─────────────────────────────────────── */
app.get('/botStatus', (_req, res) => {
  res.json({
    running   : !!botProcess,
    connected : botConnected,
    session   : fs.existsSync(path.join(SESSION_DIR, 'creds.json')),
    crashCount,
    lastCrash,
  });
});

/* ─── /reset ──────────────────────────────────────────── */
app.get('/reset', (_req, res) => {
  try {
    if (botProcess) {
      try { botProcess.kill('SIGTERM'); } catch {}
      botProcess = null; botConnected = false;
    }
    activeSockets.forEach(({ sock, timer }) => {
      clearTimeout(timer);
      try { sock.ws?.close(); } catch {}
    });
    activeSockets.clear();
    try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    appendLog('[web] /reset — session cleared');
    crashCount = 0; lastCrash = null;
    res.json({ ok: true, message: 'Session cleared. Go back to the panel to re-pair.' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

/* ─── /start-bot ──────────────────────────────────────── */
app.get('/start-bot', (_req, res) => {
  if (botProcess)
    return res.json({ ok: false, message: `Bot already running (pid=${botProcess.pid})` });
  if (!fs.existsSync(path.join(SESSION_DIR, 'creds.json')))
    return res.json({ ok: false, message: 'No session. Do the pairing first.' });
  startBot();
  res.json({ ok: true, message: 'Bot started. Check /bot-logs in a few seconds.' });
});

/* ════════════════════════════════════════════════════════
 *   /code  —  PAIRING CODE (v10 — fixed creds save race)
 * ════════════════════════════════════════════════════════ */
app.get('/code', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (botProcess && botConnected)
    return res.json({ error: true, message: 'Bot already connected. Go to /reset to change accounts.' });

  let { number } = req.query;
  if (!number) return res.json({ error: true, message: 'Phone number required' });
  number = number.replace(/[^0-9]/g, '');
  if (number.length < 7 || number.length > 15)
    return res.json({ error: true, message: 'Invalid number (must be 7–15 digits with country code, no +)' });

  /* Close any existing socket for this number */
  if (activeSockets.has(number)) {
    const old = activeSockets.get(number);
    clearTimeout(old.timer);
    try { old.sock.ws?.close(); } catch {}
    activeSockets.delete(number);
  }

  /* Clear old session — only if bot is not running */
  if (!botProcess) {
    try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
  }
  fs.mkdirSync(SESSION_DIR, { recursive: true });

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

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
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
      msgRetryCounterCache    : new NodeCache({ stdTTL: 120 }),
      connectTimeoutMs        : 60000,
      keepAliveIntervalMs     : 10_000,
    });

    /* ── CRITICAL: save creds on every update ── */
    sock.ev.on('creds.update', saveCreds);

    /* ── Pairing code promise ── */
    let codeResolve, codeReject;
    let codeDone      = false;
    let pairStarted   = false;
    let attempts      = 0;
    const MAX_TRIES   = 5;

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
      appendLog(`[web] requestPairingCode attempt ${attempts}`);
      try {
        if (sock.authState?.creds?.registered) {
          if (!codeDone) {
            codeDone = true; clearTimeout(hardTimeout);
            codeReject(new Error(
              'Number already registered. In WhatsApp → Linked Devices → disconnect the bot, then try again.'
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
          else { codeDone = true; clearTimeout(hardTimeout); codeReject(new Error('Null code after retries. Try again.')); }
        }
      } catch (e) {
        appendLog(`[web] requestPairingCode error: ${e.message}`);
        if (codeDone) return;
        if (attempts < MAX_TRIES) setTimeout(tryRequestCode, 3000);
        else { codeDone = true; clearTimeout(hardTimeout); codeReject(new Error('Pairing error: ' + e.message)); }
      }
    }

    /* ── Async helper: save creds then safely close socket ── */
    async function saveAndClose(delayMs = 4000) {
      try {
        await saveCreds();           // wait for all credential files to be written
        appendLog('[web] creds saved ✅');
      } catch (e) {
        appendLog('[web] saveCreds error: ' + e.message);
      }
      await new Promise(r => setTimeout(r, delayMs)); // extra buffer for disk writes
      try { sock.ws?.close(); } catch {}
    }

    /* ── Single connection.update handler ── */
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) _currentQR = qr;

      /* ── connecting: trigger pairing code request ── */
      if (connection === 'connecting' && !pairStarted) {
        pairStarted = true;
        appendLog('[web] connecting → requestPairingCode in 1.5s');
        setTimeout(tryRequestCode, 1500);
      }

      /* ── open: pairing succeeded ── */
      if (connection === 'open') {
        _currentQR   = null;
        botConnected = true;
        appendLog(`[web] ✅ WhatsApp connected for ${number}`);
        console.log(`[VARNOX] ✅ WhatsApp connected (${number})`);

        initOwnerJson(number);

        /* FIX: save creds FIRST, wait, then close socket, then start bot */
        await saveAndClose(4000);

        const entry = activeSockets.get(number);
        if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }

        startBot();
        return;
      }

      /* ── close: check if pairing was registered ── */
      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        appendLog(`[web] connection close — reason=${reason} codeDone=${codeDone} botConnected=${botConnected}`);

        /* Before code: only reject on loggedOut */
        if (!codeDone) {
          if (reason === DisconnectReason.loggedOut) {
            codeDone = true; clearTimeout(hardTimeout);
            codeReject(new Error('Session expired. Try again.'));
          }
          return;
        }

        /* After code: WhatsApp closes the pairing socket after registration — this is NORMAL.
           Check if creds.registered was set during the close. */
        const registered = !!sock.authState?.creds?.registered;
        appendLog(`[web] post-code close — registered=${registered} botConnected=${botConnected}`);

        if (registered && !botConnected) {
          botConnected = true; _currentQR = null;
          appendLog(`[web] ✅ Pairing confirmed at close for ${number} → starting bot`);
          console.log(`[VARNOX] ✅ Pairing confirmed (${number})`);

          initOwnerJson(number);

          /* FIX: save creds before starting bot */
          await saveAndClose(3000);

          const entry = activeSockets.get(number);
          if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }

          startBot();

        } else if (!registered && reason === DisconnectReason.loggedOut) {
          appendLog(`[web] ❌ Pairing failed — not registered`);
          const entry = activeSockets.get(number);
          if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }
          if (!botConnected) {
            try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
          }
        }
        /* Other close reasons while waiting → let the 15-min timer clean up */
      }
    });

    /* ── Cold-start fallback: if 'connecting' doesn't fire in 8s ── */
    setTimeout(() => {
      if (!codeDone && !pairStarted) {
        appendLog('[web] cold-start fallback → forcing requestPairingCode');
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
        if (!botConnected) {
          try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
        }
      }
    }, 15 * 60 * 1000);

    activeSockets.set(number, { sock, timer });
    return res.json({ error: false, code: formatted });

  } catch (err) {
    appendLog('[web] /code error: ' + err.message);
    console.error('[VARNOX] Pairing error:', err.message);
    if (!botConnected) {
      try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
    }
    return res.json({ error: true, message: err.message || 'Error generating code' });
  }
});

/* ─── /qr ─────────────────────────────────────────────── */
app.get('/qr', (_req, res) => {
  res.json({ qr: _currentQR, waiting: !_currentQR });
});

/* ─── /status ─────────────────────────────────────────── */
app.get('/status', (req, res) => {
  const clean = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  if (!clean) return res.json({ sessions: activeSockets.size, botRunning: !!botProcess });
  res.json({ number: clean, connected: activeSockets.has(clean) || botConnected });
});

/* ─── SPA fallback ────────────────────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ─── Start server ────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  VARNOX XD V2 v11  —  Port ${PORT}     ║`);
  console.log(`╠══════════════════════════════════════╣`);
  console.log(`║  Panel  : http://localhost:${PORT}       ║`);
  console.log(`║  Debug  : http://localhost:${PORT}/debug ║`);
  console.log(`║  Logs   : http://localhost:${PORT}/bot-logs ║`);
  console.log(`║  Reset  : http://localhost:${PORT}/reset  ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
  if (SELF_URL) console.log(`[VARNOX] Keep-alive: ${SELF_URL}`);
});

module.exports = app;
