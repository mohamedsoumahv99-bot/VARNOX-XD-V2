/**
 * VARNOX XD V2 — web.js  v14  (MULTI-SESSIONS)
 *
 * Plusieurs utilisateurs peuvent désormais connecter leur propre compte
 * WhatsApp en même temps. Chaque compte a sa propre session isolée et
 * son propre processus bot.
 *
 * Flow par utilisateur :
 *  1. L'utilisateur ouvre le panel et saisit son numéro
 *  2. Un code de couplage est généré
 *  3. L'utilisateur entre le code dans WhatsApp → Appareils liés
 *  4. La session est sauvegardée dans ./sessions/user_<numéro>/
 *  5. Un processus bot (index.js) est lancé pour ce compte
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

/* ─── Répertoires ─────────────────────────────────────────── */
const SESSIONS_DIR  = path.join(__dirname, 'sessions');   // sessions multi-user
const LEGACY_SESSION = path.join(__dirname, 'session');   // rétrocompat session unique
const TMP_PAIR_DIR  = path.join(__dirname, 'tmp_pair');   // sessions temporaires couplage
const DATA_DIR      = path.join(__dirname, 'data');
const OWNER_JSON    = path.join(DATA_DIR, 'owner.json');

[SESSIONS_DIR, LEGACY_SESSION, TMP_PAIR_DIR, DATA_DIR].forEach(d => {
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
});

/* ─── owner.json (premier utilisateur connecté) ─────────── */
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
    } catch (e) { console.error('[VARNOX] owner.json error:', e.message); }
  }
}
initOwnerJson();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* ═══════════════════════════════════════════════════════════
 *  GESTIONNAIRE MULTI-BOTS
 * ═══════════════════════════════════════════════════════════ */

/**
 * Map : phoneNumber (string) → { process, sessionDir, connected, logs[] }
 */
const botInstances = new Map();
const MAX_LOGS = 200;

function appendBotLog(number, line) {
  const inst = botInstances.get(String(number));
  if (!inst) return;
  inst.logs.push(`${new Date().toISOString()} ${line}`);
  if (inst.logs.length > MAX_LOGS) inst.logs.shift();
}

/**
 * Lance un processus bot pour le numéro donné avec le répertoire de session.
 * Idempotent : ne fait rien si un processus tourne déjà pour ce numéro.
 */
function startBotForUser(number, sessionDir) {
  const key = String(number);
  if (botInstances.has(key)) {
    const inst = botInstances.get(key);
    if (inst.process && inst.process.exitCode === null) {
      console.log(`[VARNOX] Bot already running for ${key}`);
      return;
    }
  }

  console.log(`[VARNOX] Starting bot for ${key} → ${sessionDir}`);

  const proc = spawn('node', ['index.js', '--session-dir', sessionDir], {
    stdio  : ['ignore', 'pipe', 'pipe'],
    env    : {
      ...process.env,
      SKIP_PAIRING : '1',
      FORCE_COLOR  : '0',
      OWNER_NUMBER : key,
      SESSION_DIR  : sessionDir,
    },
    cwd    : __dirname,
  });

  const inst = { process: proc, sessionDir, connected: false, logs: [] };
  botInstances.set(key, inst);

  proc.stdout?.on('data', d => {
    String(d).split('\n').filter(Boolean).forEach(l => {
      process.stdout.write(`[BOT:${key}] ${l}\n`);
      appendBotLog(key, '[out] ' + l);
      if (l.includes('✅') || l.includes('connected') || l.includes('connecté')) {
        inst.connected = true;
      }
    });
  });

  proc.stderr?.on('data', d => {
    String(d).split('\n').filter(Boolean).forEach(l => {
      process.stderr.write(`[BOT:${key} ERR] ${l}\n`);
      appendBotLog(key, '[err] ' + l);
    });
  });

  proc.on('error', err => {
    console.error(`[VARNOX] spawn error (${key}):`, err.message);
    appendBotLog(key, '[web] spawn error: ' + err.message);
    inst.process   = null;
    inst.connected = false;
  });

  proc.on('exit', (code, signal) => {
    const msg = `exit code=${code} signal=${signal}`;
    console.log(`[VARNOX] Bot stopped (${key}): ${msg}. Restarting in 10s…`);
    appendBotLog(key, '[web] stopped: ' + msg);
    inst.process   = null;
    inst.connected = false;

    setTimeout(() => {
      const credFile = path.join(sessionDir, 'creds.json');
      if (fs.existsSync(credFile)) {
        appendBotLog(key, '[web] Auto-restarting…');
        startBotForUser(key, sessionDir);
      } else {
        appendBotLog(key, '[web] No session — restart cancelled');
        botInstances.delete(key);
      }
    }, 10_000);
  });
}

/**
 * Arrête le processus bot d'un utilisateur.
 */
function stopBotForUser(number) {
  const key  = String(number);
  const inst = botInstances.get(key);
  if (!inst?.process) return;
  try { inst.process.kill('SIGTERM'); } catch {}
  inst.process   = null;
  inst.connected = false;
}

/**
 * Au démarrage : charge les sessions existantes et lance un bot pour chacune.
 */
function startExistingSessions() {
  // Sessions multi-user  ./sessions/user_<number>/
  try {
    const dirs = fs.readdirSync(SESSIONS_DIR);
    for (const dir of dirs) {
      const match = dir.match(/^user_(\d+)$/);
      if (!match) continue;
      const number    = match[1];
      const sessionDir = path.join(SESSIONS_DIR, dir);
      if (fs.existsSync(path.join(sessionDir, 'creds.json'))) {
        console.log(`[VARNOX] Session found for ${number} → auto-starting`);
        startBotForUser(number, sessionDir);
      }
    }
  } catch (e) {
    console.error('[VARNOX] Error scanning sessions:', e.message);
  }

  // Rétrocompat : session unique ./session/
  if (
    fs.existsSync(path.join(LEGACY_SESSION, 'creds.json')) &&
    !botInstances.size
  ) {
    const ownerNum = (() => {
      try {
        return JSON.parse(fs.readFileSync(OWNER_JSON, 'utf8')).ownerNumber || 'legacy';
      } catch { return 'legacy'; }
    })();
    if (!botInstances.has(String(ownerNum))) {
      console.log(`[VARNOX] Legacy session found → starting for ${ownerNum}`);
      startBotForUser(ownerNum, LEGACY_SESSION);
    }
  }
}

setTimeout(startExistingSessions, 2000);

/* ─── Keep-alive (Render free tier) ──────────────────────── */
const SELF_URL = process.env.RENDER_EXTERNAL_URL
  || (process.env.RENDER_EXTERNAL_HOSTNAME
      ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
      : null);

if (SELF_URL) {
  setInterval(() => {
    const mod = SELF_URL.startsWith('https') ? https : http;
    const req = mod.get(`${SELF_URL}/ping`, () => {});
    req.on('error', () => {});
    req.end();
  }, 14 * 60 * 1000);
}

/* ─── Store de couplage temporaire (30 min TTL) ──────────── */
// Map<string, { ts, ready, number }>
const pairStore    = new Map();
const activeSockets = new Map(); // Map<string, { sock, timer }>

setInterval(() => {
  const now = Date.now();
  for (const [num, entry] of pairStore) {
    if (now - entry.ts > 30 * 60 * 1000) {
      pairStore.delete(num);
      try {
        fs.rmSync(path.join(TMP_PAIR_DIR, `tmp_${num}`), { recursive: true, force: true });
      } catch {}
    }
  }
}, 5 * 60 * 1000);

/* ═══════════════════════════════════════════════════════════
 *  ROUTES
 * ═══════════════════════════════════════════════════════════ */

app.get('/ping',   (_req, res) => res.json({ pong: true, ts: Date.now() }));

app.get('/health', (_req, res) => {
  const instances = [];
  for (const [num, inst] of botInstances) {
    instances.push({
      number    : num,
      running   : !!(inst.process && inst.process.exitCode === null),
      connected : inst.connected,
    });
  }
  res.json({
    status     : 'online',
    bot        : 'VARNOX XD V2',
    version    : '14.0.0',
    uptime     : Math.floor(process.uptime()),
    instances,
    totalBots  : botInstances.size,
  });
});

app.get('/botStatus', (req, res) => {
  const number = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  if (number) {
    const inst = botInstances.get(number);
    return res.json({
      number,
      running   : !!(inst?.process && inst.process.exitCode === null),
      connected : !!inst?.connected,
      session   : fs.existsSync(path.join(SESSIONS_DIR, `user_${number}`, 'creds.json'))
                  || fs.existsSync(path.join(LEGACY_SESSION, 'creds.json')),
    });
  }
  // Global summary
  const instances = [];
  for (const [num, inst] of botInstances) {
    instances.push({
      number    : num,
      running   : !!(inst.process && inst.process.exitCode === null),
      connected : inst.connected,
    });
  }
  res.json({ instances, totalBots: botInstances.size });
});

app.get('/bot-logs', (req, res) => {
  const number = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  if (number) {
    const inst = botInstances.get(number);
    return res.json({ number, logs: inst?.logs || [] });
  }
  // Aggregate all
  const all = [];
  for (const [num, inst] of botInstances) {
    for (const l of inst.logs) all.push(`[${num}] ${l}`);
  }
  res.json({ logs: all.slice(-MAX_LOGS) });
});

app.get('/status', (req, res) => {
  const clean = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  if (!clean) {
    const instances = [];
    for (const [num, inst] of botInstances) {
      instances.push({ number: num, running: !!(inst.process), connected: inst.connected });
    }
    return res.json({ instances });
  }
  const entry = pairStore.get(clean);
  const inst  = botInstances.get(clean);
  res.json({
    number    : clean,
    ready     : !!(entry?.ready),
    active    : activeSockets.has(clean),
    running   : !!(inst?.process),
    connected : !!inst?.connected,
  });
});

app.get('/session', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  let { number } = req.query;
  if (!number) return res.json({ ready: false, error: 'number required' });
  number = number.replace(/[^0-9]/g, '');

  const entry   = pairStore.get(number);
  if (entry?.ready) return res.json({ ready: true });

  const inst = botInstances.get(number);
  if (inst?.connected) return res.json({ ready: true });

  const userSessionDir = path.join(SESSIONS_DIR, `user_${number}`);
  if (fs.existsSync(path.join(userSessionDir, 'creds.json'))) {
    return res.json({ ready: true });
  }

  res.json({ ready: false });
});

app.get('/reset', (req, res) => {
  const number = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  try {
    if (number) {
      // Réinitialiser un utilisateur spécifique
      stopBotForUser(number);
      botInstances.delete(number);
      const userDir = path.join(SESSIONS_DIR, `user_${number}`);
      try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
      fs.mkdirSync(userDir, { recursive: true });
      pairStore.delete(number);
      return res.json({ ok: true, message: `Session cleared for ${number}. Re-pair to reconnect.` });
    }
    // Réinitialiser TOUT (admin)
    for (const [num] of botInstances) stopBotForUser(num);
    botInstances.clear();
    try { fs.rmSync(SESSIONS_DIR, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(LEGACY_SESSION, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.mkdirSync(LEGACY_SESSION, { recursive: true });
    pairStore.clear();
    res.json({ ok: true, message: 'All sessions cleared.' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/debug', (_req, res) => {
  const instances = [];
  for (const [num, inst] of botInstances) {
    instances.push({
      number     : num,
      sessionDir : inst.sessionDir,
      running    : !!(inst.process),
      connected  : inst.connected,
      logCount   : inst.logs.length,
    });
  }
  res.json({
    SESSIONS_DIR,
    LEGACY_SESSION,
    instances,
    pairStore : [...pairStore.keys()],
    activeSockets: [...activeSockets.keys()],
  });
});

/* ════════════════════════════════════════════════════════════
 *  POST /code  (et GET /code)
 *  Génère un code de couplage pour le numéro donné.
 *  À la connexion réussie → session sauvegardée → bot lancé.
 * ════════════════════════════════════════════════════════════ */
async function handleCode(req, res) {
  res.setHeader('Content-Type', 'application/json');

  let number = (req.query.number || req.body?.number || '');
  if (!number) return res.json({ error: true, message: 'Phone number required' });
  number = number.replace(/[^0-9]/g, '');
  if (number.length < 7 || number.length > 15)
    return res.json({ error: true, message: 'Invalid number (7–15 digits with country code, no +)' });

  // Déjà couplé et bot actif → répondre immédiatement
  if (pairStore.get(number)?.ready) {
    return res.json({ error: false, already: true, message: 'Already connected.' });
  }

  const userSessionDir = path.join(SESSIONS_DIR, `user_${number}`);
  const tmpSessionDir  = path.join(TMP_PAIR_DIR,  `tmp_${number}`);

  // Fermer tout socket actif pour ce numéro
  if (activeSockets.has(number)) {
    const old = activeSockets.get(number);
    clearTimeout(old.timer);
    try { old.sock.ws?.close(); } catch {}
    activeSockets.delete(number);
  }

  // Nettoyer la session temporaire précédente
  try { fs.rmSync(tmpSessionDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(tmpSessionDir, { recursive: true });

  console.log(`[VARNOX] /code for ${number}`);

  try {
    let version = [2, 3000, 1023097280];
    try {
      const result = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000)),
      ]);
      if (result?.version) version = result.version;
    } catch {}

    const { state, saveCreds } = await useMultiFileAuthState(tmpSessionDir);
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
      console.log(`[VARNOX] requestPairingCode attempt ${attempts} for ${number}`);
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
          codeResolve(raw);
        } else if (!raw && !codeDone) {
          if (attempts < MAX_TRIES) setTimeout(tryRequestCode, 3000);
          else {
            codeDone = true; clearTimeout(hardTimeout);
            codeReject(new Error('Null code after retries. Try again.'));
          }
        }
      } catch (e) {
        if (codeDone) return;
        if (attempts < MAX_TRIES) setTimeout(tryRequestCode, 3000);
        else {
          codeDone = true; clearTimeout(hardTimeout);
          codeReject(new Error('Pairing error: ' + e.message));
        }
      }
    }

    async function saveAndClose(delayMs = 4000) {
      try { await saveCreds(); } catch {}
      await new Promise(r => setTimeout(r, delayMs));
      try { sock.ws?.close(); } catch {}
    }

    async function activateSession() {
      const src = path.join(tmpSessionDir, 'creds.json');
      if (!fs.existsSync(src)) return;

      try {
        fs.mkdirSync(userSessionDir, { recursive: true });
        // Copier tous les fichiers de session
        const files = fs.readdirSync(tmpSessionDir);
        for (const f of files) {
          fs.copyFileSync(path.join(tmpSessionDir, f), path.join(userSessionDir, f));
        }
        console.log(`[VARNOX] ✅ Session → ${userSessionDir} for ${number}`);
      } catch (e) {
        console.error(`[VARNOX] session copy error (${number}):`, e.message);
        return;
      }

      // Mettre à jour owner.json si c'est le premier utilisateur
      if (!botInstances.size) initOwnerJson(number);

      pairStore.set(number, { ts: Date.now(), ready: true, number });

      // Lancer ou redémarrer le bot pour ce numéro
      if (botInstances.has(number)) {
        stopBotForUser(number);
        botInstances.delete(number);
        await new Promise(r => setTimeout(r, 2000));
      }
      startBotForUser(number, userSessionDir);
    }

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'connecting' && !pairStarted) {
        pairStarted = true;
        setTimeout(tryRequestCode, 1500);
      }

      if (connection === 'open') {
        console.log(`[VARNOX] ✅ Paired: ${number}`);
        await saveAndClose(4000);
        await activateSession();
        const entry = activeSockets.get(number);
        if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }
        return;
      }

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        if (!codeDone) {
          if (reason === DisconnectReason.loggedOut) {
            codeDone = true; clearTimeout(hardTimeout);
            codeReject(new Error('Session expired. Try again.'));
          }
          return;
        }
        const registered = !!sock.authState?.creds?.registered;
        if (registered && !pairStore.get(number)?.ready) {
          await saveAndClose(3000);
          await activateSession();
          const entry = activeSockets.get(number);
          if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }
        } else if (!registered && reason === DisconnectReason.loggedOut) {
          const entry = activeSockets.get(number);
          if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }
          try { fs.rmSync(tmpSessionDir, { recursive: true, force: true }); } catch {}
        }
      }
    });

    // Cold-start fallback
    setTimeout(() => {
      if (!codeDone && !pairStarted) {
        pairStarted = true;
        tryRequestCode();
      }
    }, 8000);

    const raw       = await codePromise;
    const formatted = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,4}/g)?.join('-') ?? raw;

    const timer = setTimeout(() => {
      if (activeSockets.has(number)) {
        try { activeSockets.get(number).sock.ws?.close(); } catch {}
        activeSockets.delete(number);
        if (!pairStore.get(number)?.ready) {
          try { fs.rmSync(tmpSessionDir, { recursive: true, force: true }); } catch {}
        }
      }
    }, 15 * 60 * 1000);

    activeSockets.set(number, { sock, timer });
    return res.json({ error: false, code: formatted });

  } catch (err) {
    console.error('[VARNOX] Pairing error:', err.message);
    if (!pairStore.get(number)?.ready) {
      try { fs.rmSync(tmpSessionDir, { recursive: true, force: true }); } catch {}
    }
    return res.json({ error: true, message: err.message || 'Error generating code' });
  }
}

app.get('/code',  handleCode);
app.post('/code', handleCode);

/* ─── SPA fallback ─────────────────────────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ─── Démarrage du serveur ─────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  VARNOX XD V2 v14 (MULTI-USER)           ║`);
  console.log(`║  Port : ${PORT}                             ║`);
  console.log(`║  Plusieurs comptes simultanés supportés   ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
});

module.exports = app;
