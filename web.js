/**
 * VARNOX XD V2 - web.js  v9
 *
 * CORRIGÉ v9 :
 *  - owner.json toujours initialisé avec OWNER_NUMBER (plus jamais "TON_NUMERO_ICI")
 *  - index.js : stdout+stderr capturés → /bot-logs pour voir les crashs
 *  - /reset endpoint : efface la session pour re-pairer proprement
 *  - /start-bot endpoint : force le démarrage du bot manuellement
 *  - Meilleure gestion des crashs répétés d'index.js
 */

'use strict';

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const { spawn } = require('child_process');

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

/* ─── Chemins ────────────────────────────────────────── */
const SESSION_DIR = path.join(__dirname, 'session');
const DATA_DIR    = path.join(__dirname, 'data');
const OWNER_JSON  = path.join(DATA_DIR, 'owner.json');

/* ─── Créer les dossiers nécessaires si absents ──────── */
[SESSION_DIR, DATA_DIR].forEach(d => {
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
});

/* ─── Initialiser owner.json (FIX : toujours corriger "TON_NUMERO_ICI") ── */
function initOwnerJson(overrideNumber) {
  let current = {};
  try { if (fs.existsSync(OWNER_JSON)) current = JSON.parse(fs.readFileSync(OWNER_JSON, 'utf8')); } catch {}

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
        ownerNumber: realNumber,
        ownerName  : current.ownerName  || 'Owner',
        botName    : current.botName    || 'VARNOX XD V2',
        prefix     : current.prefix     || process.env.PREFIX || '.',
        version    : '2.0.0',
        mess       : current.mess       || 'Owner',
      }, null, 2));
      console.log(`[VARNOX] owner.json initialisé → ownerNumber=${realNumber || '(vide)'}`);
    } catch (e) { console.error('[VARNOX] owner.json write error:', e.message); }
  }
}
initOwnerJson();  // Corrige "TON_NUMERO_ICI" dès le démarrage

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* ─── Bot process management ─────────────────────────── */
let botProcess    = null;
let botConnected  = false;
let _currentQR    = null;
const activeSockets = new Map();

// Capture des logs du bot (dernières 200 lignes)
const botLogs     = [];
const MAX_LOGS    = 200;
let   crashCount  = 0;
let   lastCrash   = null;

function appendLog(line) {
  botLogs.push(`${new Date().toISOString()} ${line}`);
  if (botLogs.length > MAX_LOGS) botLogs.shift();
}

function startBot() {
  if (botProcess) return;
  console.log('[VARNOX] Démarrage index.js…');
  appendLog('[web] Démarrage index.js');
  botConnected = false;

  botProcess = spawn('node', ['index.js'], {
    stdio : ['ignore', 'pipe', 'pipe'],   // capture stdout + stderr
    env   : { ...process.env, SKIP_PAIRING: '1', FORCE_COLOR: '0' },
    cwd   : __dirname,
  });

  botProcess.stdout?.on('data', d => {
    String(d).split('\n').filter(Boolean).forEach(l => {
      process.stdout.write('[BOT] ' + l + '\n');
      appendLog('[out] ' + l);
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
    botProcess   = null;
    lastCrash    = err.message;
    crashCount++;
  });

  botProcess.on('exit', (code, signal) => {
    const msg = `exit code=${code} signal=${signal}`;
    console.log(`[VARNOX] Bot terminé (${msg}). Redémarrage dans 10s…`);
    appendLog('[web] Bot terminé: ' + msg);
    botProcess   = null;
    botConnected = false;
    lastCrash    = msg;
    crashCount++;

    // Redémarrage automatique — seulement si creds.json existe toujours
    setTimeout(() => {
      if (fs.existsSync(path.join(SESSION_DIR, 'creds.json'))) {
        appendLog('[web] Redémarrage automatique…');
        startBot();
      } else {
        appendLog('[web] Pas de session — redémarrage annulé');
      }
    }, 10000);
  });
}

/* ─── Auto-démarrage si session déjà présente ────────── */
setTimeout(() => {
  if (fs.existsSync(path.join(SESSION_DIR, 'creds.json'))) {
    console.log('[VARNOX] Session trouvée → démarrage auto du bot');
    startBot();
  } else {
    console.log('[VARNOX] Aucune session → panel de pairage prêt');
  }
}, 2000);

/* ══════════════════════════════════════════════════════
 *   ROUTES
 * ══════════════════════════════════════════════════════ */

/* ─── /health ─────────────────────────────────────────── */
app.get('/health', (_req, res) => {
  res.json({
    status      : 'online',
    bot         : 'VARNOX XD V2',
    version     : '9.0.0',
    build       : '2026-07-20-v9',
    platform    : process.env.RENDER_EXTERNAL_HOSTNAME ? 'render' : process.env.RAILWAY_ENVIRONMENT || 'local',
    uptime      : Math.floor(process.uptime()),
    botRunning  : !!botProcess,
    botConnected,
    session     : fs.existsSync(path.join(SESSION_DIR, 'creds.json')),
  });
});

/* ─── /debug — diagnostic complet ────────────────────── */
app.get('/debug', (_req, res) => {
  const sessionFiles = (() => { try { return fs.readdirSync(SESSION_DIR); } catch { return []; } })();
  const dataFiles    = (() => { try { return fs.readdirSync(DATA_DIR);    } catch { return []; } })();
  let ownerData = null;
  try { ownerData = JSON.parse(fs.readFileSync(OWNER_JSON, 'utf8')); } catch {}

  res.json({
    ok            : true,
    version       : '9.0.0',
    build         : '2026-07-20-v9',
    nodeVersion   : process.version,
    platform      : process.env.RENDER_EXTERNAL_HOSTNAME ? 'render' : process.env.RAILWAY_ENVIRONMENT || 'local',
    port          : PORT,
    uptime        : Math.floor(process.uptime()),
    botRunning    : !!botProcess,
    botConnected,
    crashCount,
    lastCrash,
    activeSockets : activeSockets.size,
    sessionDir    : SESSION_DIR,
    sessionFiles,
    hasCredentials: sessionFiles.includes('creds.json'),
    dataFiles,
    ownerNumber   : ownerData?.ownerNumber || 'non défini',
    envVars: {
      PORT                 : !!process.env.PORT,
      OWNER_NUMBER         : !!process.env.OWNER_NUMBER,
      SKIP_PAIRING         : !!process.env.SKIP_PAIRING,
      RAILWAY_ENVIRONMENT  : !!process.env.RAILWAY_ENVIRONMENT,
      RENDER               : !!process.env.RENDER,
      RENDER_EXTERNAL_URL  : !!process.env.RENDER_EXTERNAL_URL,
      RAILWAY_PUBLIC_DOMAIN: !!process.env.RAILWAY_PUBLIC_DOMAIN,
    },
    lastBotLogs: botLogs.slice(-20),  // 20 dernières lignes
  });
});

/* ─── /bot-logs — logs complets du bot ───────────────── */
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

/* ─── /reset — efface la session pour re-pairer ─────── */
app.get('/reset', (_req, res) => {
  try {
    // Tuer le bot s'il tourne
    if (botProcess) {
      try { botProcess.kill('SIGTERM'); } catch {}
      botProcess   = null;
      botConnected = false;
    }
    // Fermer tous les sockets de pairage
    activeSockets.forEach(({ sock, timer }) => {
      clearTimeout(timer);
      try { sock.end(); } catch {}
    });
    activeSockets.clear();

    // Effacer la session
    try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(SESSION_DIR, { recursive: true });

    appendLog('[web] /reset exécuté — session effacée');
    crashCount = 0;
    lastCrash  = null;

    res.json({ ok: true, message: 'Session effacée. Retourne sur le panel pour re-pairer.' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

/* ─── /start-bot — forcer démarrage manuel du bot ────── */
app.get('/start-bot', (_req, res) => {
  if (botProcess) return res.json({ ok: false, message: 'Bot déjà en train de tourner (pid=' + botProcess.pid + ')' });
  if (!fs.existsSync(path.join(SESSION_DIR, 'creds.json')))
    return res.json({ ok: false, message: 'Aucune session. Fais le pairage d\'abord.' });

  startBot();
  res.json({ ok: true, message: 'Bot démarré. Vérifie /bot-logs dans quelques secondes.' });
});

/* ─── /code — génère un code de pairage ─────────────── */
app.get('/code', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (botProcess && botConnected) {
    return res.json({ error: true, message: 'Bot déjà connecté. Va sur /reset pour changer de compte.' });
  }

  let { number } = req.query;
  if (!number) return res.json({ error: true, message: 'Numéro requis' });
  number = number.replace(/[^0-9]/g, '');
  if (number.length < 7 || number.length > 15)
    return res.json({ error: true, message: 'Numéro invalide (7–15 chiffres)' });

  /* Couper l'ancien socket pour ce numéro */
  if (activeSockets.has(number)) {
    const old = activeSockets.get(number);
    clearTimeout(old.timer);
    try { old.sock.end(); } catch {}
    activeSockets.delete(number);
  }

  /* Effacer l'ancienne session seulement si le bot ne tourne pas */
  if (!botProcess) {
    try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
  }
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  appendLog(`[web] /code demandé pour ${number}`);

  try {
    /* fetchLatestBaileysVersion avec timeout + fallback */
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

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      browser          : Browsers.ubuntu('Chrome'),
      auth: {
        creds: state.creds,
        keys : makeCacheableSignalKeyStore(state.keys, logger),
      },
      msgRetryCounterCache: new NodeCache({ stdTTL: 120 }),
      connectTimeoutMs    : 60000,
      keepAliveIntervalMs : 10_000,  // ← FIX PRINCIPAL : empêche Railway de tuer la WS idle
      syncFullHistory     : false,
      markOnlineOnConnect : true,
    });

    sock.ev.on('creds.update', saveCreds);

    /* ─── UN SEUL handler connection.update (pas de race condition) ─── */
    let codeResolve, codeReject;
    let codeDone        = false;
    let connectingFired = false;
    let attempts        = 0;
    const MAX_TRIES     = 4;

    const codePromise = new Promise((res, rej) => { codeResolve = res; codeReject = rej; });

    /* Timeout global 40s */
    const hardTimeout = setTimeout(() => {
      if (!codeDone) {
        codeDone = true;
        codeReject(new Error('Timeout 40s — WhatsApp ne répond pas. Réessaye.'));
      }
    }, 40000);

    const tryCode = async () => {
      if (codeDone) return;
      attempts++;
      appendLog(`[web] requestPairingCode tentative ${attempts}`);
      try {
        if (sock.authState?.creds?.registered) {
          codeDone = true; clearTimeout(hardTimeout);
          return codeReject(new Error(
            'Numéro déjà enregistré. Dans WhatsApp → Appareils liés → déconnecte le bot, puis réessaie.'
          ));
        }
        const raw = await sock.requestPairingCode(number);
        if (raw && !codeDone) {
          codeDone = true; clearTimeout(hardTimeout);
          appendLog(`[web] Code reçu pour ${number}`);
          codeResolve(raw);
        } else if (!codeDone) {
          if (attempts < MAX_TRIES) setTimeout(tryCode, 3000);
          else { codeDone = true; clearTimeout(hardTimeout); codeReject(new Error('Code null reçu. Réessaie.')); }
        }
      } catch (e) {
        appendLog(`[web] requestPairingCode erreur: ${e.message}`);
        if (codeDone) return;
        if (attempts < MAX_TRIES) setTimeout(tryCode, 3000);
        else { codeDone = true; clearTimeout(hardTimeout); codeReject(new Error('Erreur pairage: ' + e.message)); }
      }
    };

    /* Handler unique enregistré AVANT tout await */
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) _currentQR = qr;

      if (connection === 'connecting' && !connectingFired) {
        connectingFired = true;
        appendLog('[web] connecting → tryCode dans 1s');
        setTimeout(tryCode, 1000);
      }

      if (connection === 'open') {
        _currentQR   = null;
        botConnected = true;
        appendLog(`[web] ✅ connection open pour ${number} — bot démarré`);
        console.log(`[VARNOX] ✅ WhatsApp connecté pour ${number}`);

        /* Mettre à jour owner.json avec le vrai numéro */
        initOwnerJson(number);

        /* Nettoyer le socket de pairage */
        const entry = activeSockets.get(number);
        if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }
        try { sock.end(); } catch {}

        /* Démarrer index.js après 2s */
        setTimeout(() => startBot(), 2000);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        // Logger TOUJOURS (même après codeDone) pour voir ce qui se passe
        appendLog(`[web] connection close — status=${statusCode} codeDone=${codeDone}`);

        if (!codeDone) {
          // Avant le code → rejeter si loggedOut
          if (statusCode === DisconnectReason.loggedOut) {
            codeDone = true; clearTimeout(hardTimeout);
            codeReject(new Error('Session expirée. Réessaie.'));
          }
          // Autres fermetures avant code → laisser le fallback timeout gérer
          return;
        }

        // ── Après le code : Baileys NE reconnecte PAS ce socket tout seul.
        // WhatsApp ferme ce socket temporaire une fois le code utilisé — c'est normal.
        // Il faut vérifier si l'enregistrement a réussi (creds.registered) et,
        // si oui, démarrer nous-mêmes le vrai bot (index.js) avec la session sauvegardée.
        const registered = !!sock.authState?.creds?.registered;

        if (registered && !botConnected) {
          botConnected = true;
          _currentQR   = null;
          appendLog(`[web] ✅ Pairing réussi pour ${number} (détecté à la fermeture) — démarrage du bot`);
          console.log(`[VARNOX] ✅ WhatsApp connecté pour ${number}`);

          initOwnerJson(number);

          const entry = activeSockets.get(number);
          if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }
          try { sock.end(); } catch {}

          setTimeout(() => startBot(), 2000);
        } else if (!registered && statusCode === DisconnectReason.loggedOut) {
          // Fermeture après code mais jamais enregistré → vraiment échoué, on nettoie
          appendLog(`[web] ❌ Pairing échoué pour ${number} (non enregistré, loggedOut)`);
          const entry = activeSockets.get(number);
          if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }
          try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
        }
        // Sinon (fermeture transitoire, pas encore enregistré) → on attend,
        // le timer de 10 min nettoiera si rien ne se passe.
      }
    });

    /* Cold-start fallback : si 'connecting' ne fire pas dans 6s */
    setTimeout(() => {
      if (!codeDone && !connectingFired) {
        appendLog('[web] cold-start fallback → tryCode forcé');
        connectingFired = true;
        tryCode();
      }
    }, 6000);

    /* Attendre le code — le handler 'open' reste actif ensuite */
    const raw       = await codePromise;
    const formatted = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,4}/g)?.join('-') ?? raw;

    /* Timer 10min — ferme le socket si l'utilisateur n'entre jamais le code */
    const timer = setTimeout(() => {
      if (activeSockets.has(number)) {
        appendLog(`[web] Timeout 10min — socket ${number} fermé`);
        try { activeSockets.get(number).sock.end(); } catch {}
        activeSockets.delete(number);
        if (!botConnected) {
          try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
        }
      }
    }, 10 * 60 * 1000);

    activeSockets.set(number, { sock, timer });
    return res.json({ error: false, code: formatted });

  } catch (err) {
    appendLog('[web] /code erreur: ' + err.message);
    console.error('[VARNOX] Erreur pairage:', err.message);
    if (!botConnected) {
      try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
    }
    return res.json({ error: true, message: err.message || 'Erreur lors de la génération du code' });
  }
});

/* ─── /qr ────────────────────────────────────────────── */
app.get('/qr', (_req, res) => {
  res.json({ qr: _currentQR, waiting: !_currentQR });
});

/* ─── /status ────────────────────────────────────────── */
app.get('/status', (req, res) => {
  const clean = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  if (!clean) return res.json({ sessions: activeSockets.size, botRunning: !!botProcess });
  res.json({ number: clean, connected: activeSockets.has(clean) || botConnected });
});

/* ─── SPA fallback ───────────────────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ─── Démarrage ──────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n=== VARNOX XD V2 v9 — Port ${PORT} ===`);
  console.log(`Panel   : http://localhost:${PORT}`);
  console.log(`Debug   : http://localhost:${PORT}/debug`);
  console.log(`Logs    : http://localhost:${PORT}/bot-logs`);
  console.log(`Reset   : http://localhost:${PORT}/reset\n`);
});

module.exports = app;
