/**
 * VARNOX XD V2 — web.js  v15  (SINGLE-PROCESS MULTI-USERS)
 *
 * Architecture corrigée :
 * • Aucun processus enfant (spawn) — tout tourne dans ce même processus Node.js
 * • Chaque utilisateur qui se connecte obtient un bot Baileys en mémoire via
 *   lib/botInstance.js
 * • La session de chaque utilisateur est isolée dans ./sessions/user_<numéro>/
 * • Au démarrage, toutes les sessions existantes sont rechargées automatiquement
 *
 * Flow de connexion (couplage) :
 *  1. L'utilisateur saisit son numéro → GET/POST /code
 *  2. Web.js crée un socket Baileys temporaire et génère un code de couplage
 *  3. L'utilisateur entre le code dans WhatsApp → Appareils liés
 *  4. connection: 'open' → session sauvegardée dans ./sessions/user_<numéro>/
 *  5. createBotInstance() crée immédiatement le bot en mémoire
 */

'use strict';

require('./settings');

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const https      = require('https');
const http       = require('http');

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

const { createBotInstance, stopBotInstance, getBotInstance, getAllInstances } = require('./lib/botInstance');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ─── Répertoires ─────────────────────────────────────────── */
const SESSIONS_DIR   = path.join(__dirname, 'sessions');
const LEGACY_SESSION = path.join(__dirname, 'session');
const TMP_PAIR_DIR   = path.join(__dirname, 'tmp_pair');
const DATA_DIR       = path.join(__dirname, 'data');
const OWNER_JSON     = path.join(DATA_DIR, 'owner.json');

[SESSIONS_DIR, LEGACY_SESSION, TMP_PAIR_DIR, DATA_DIR].forEach(d => {
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
});

/* ─── owner.json ──────────────────────────────────────────── */
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

/* ─── Keep-alive (Render free tier) ──────────────────────── */
const SELF_URL = process.env.RENDER_EXTERNAL_URL
  || (process.env.RENDER_EXTERNAL_HOSTNAME
      ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
      : null);

if (SELF_URL) {
  setInterval(() => {
    const mod = SELF_URL.startsWith('https') ? https : http;
    mod.get(`${SELF_URL}/ping`, () => {}).on('error', () => {}).end();
  }, 14 * 60 * 1000);
}

/* ─── Cache version Baileys ───────────────────────────────── */
let _baileysVersion = null;
async function getBaileysVersion() {
  if (_baileysVersion) return _baileysVersion;
  try {
    const r = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    if (r?.version) { _baileysVersion = r.version; return r.version; }
  } catch {}
  return [2, 3000, 1023097280];
}

/* ─── Store de couplage (15 min TTL) ─────────────────────── */
// Map<string, { ts, ready, number }>
const pairStore     = new Map();
// Map<string, { sock, timer }>
const activeSockets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [num, entry] of pairStore) {
    if (now - entry.ts > 15 * 60 * 1000) {
      pairStore.delete(num);
      try { fs.rmSync(path.join(TMP_PAIR_DIR, `tmp_${num}`), { recursive: true, force: true }); } catch {}
    }
  }
}, 5 * 60 * 1000);

/* ═══════════════════════════════════════════════════════════
 *  DÉMARRAGE DES SESSIONS EXISTANTES
 * ═══════════════════════════════════════════════════════════ */
async function startExistingSessions() {
  // Sessions multi-user : ./sessions/user_<number>/
  try {
    const dirs = fs.readdirSync(SESSIONS_DIR);
    for (const dir of dirs) {
      const match = dir.match(/^user_(\d+)$/);
      if (!match) continue;
      const number     = match[1];
      const sessionDir = path.join(SESSIONS_DIR, dir);
      if (fs.existsSync(path.join(sessionDir, 'creds.json'))) {
        console.log(`[VARNOX] Restoring session for ${number}`);
        try { await createBotInstance(sessionDir, number); } catch (e) {
          console.error(`[VARNOX] Failed to restore ${number}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[VARNOX] Error scanning sessions:', e.message);
  }

  // Rétrocompat : session unique ./session/ (premier déploiement)
  if (fs.existsSync(path.join(LEGACY_SESSION, 'creds.json'))) {
    const ownerNum = (() => {
      try { return JSON.parse(fs.readFileSync(OWNER_JSON, 'utf8')).ownerNumber || 'legacy'; } catch { return 'legacy'; }
    })();
    const already = getAllInstances().some(i => i.number === String(ownerNum));
    if (!already) {
      console.log(`[VARNOX] Legacy session found → restoring for ${ownerNum}`);
      try { await createBotInstance(LEGACY_SESSION, ownerNum); } catch (e) {
        console.error('[VARNOX] Failed to restore legacy session:', e.message);
      }
    }
  }
}

// Démarrer après 2s pour laisser le serveur démarrer
setTimeout(startExistingSessions, 2000);

/* ═══════════════════════════════════════════════════════════
 *  ROUTES
 * ═══════════════════════════════════════════════════════════ */

app.get('/ping', (_req, res) => res.json({ pong: true, ts: Date.now() }));

app.get('/health', (_req, res) => {
  const instances = getAllInstances();
  res.json({
    status    : 'online',
    bot       : 'VARNOX XD V2',
    version   : '15.0.0',
    uptime    : Math.floor(process.uptime()),
    instances,
    totalBots : instances.length,
  });
});

app.get('/botStatus', (req, res) => {
  const number = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  if (number) {
    const inst = getBotInstance(number);
    return res.json({
      number,
      running   : !!inst,
      connected : !!inst?.connected,
      session   : fs.existsSync(path.join(SESSIONS_DIR, `user_${number}`, 'creds.json'))
                  || fs.existsSync(path.join(LEGACY_SESSION, 'creds.json')),
    });
  }
  res.json({ instances: getAllInstances(), totalBots: getAllInstances().length });
});

app.get('/status', (req, res) => {
  const number = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  if (!number) return res.json({ instances: getAllInstances() });

  const inst  = getBotInstance(number);
  const entry = pairStore.get(number);
  res.json({
    number,
    ready     : !!(entry?.ready || inst?.connected),
    connected : !!inst?.connected,
    running   : !!inst,
    active    : activeSockets.has(number),
  });
});

app.get('/session', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  let { number } = req.query;
  if (!number) return res.json({ ready: false, error: 'number required' });
  number = number.replace(/[^0-9]/g, '');

  // Vérifie si déjà connecté
  const inst = getBotInstance(number);
  if (inst?.connected) return res.json({ ready: true });

  // Vérifie la session sur disque
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
      stopBotInstance(number);
      const userDir = path.join(SESSIONS_DIR, `user_${number}`);
      try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
      fs.mkdirSync(userDir, { recursive: true });
      pairStore.delete(number);
      return res.json({ ok: true, message: `Session cleared for ${number}. Re-pair to reconnect.` });
    }
    // Reset ALL
    for (const inst of getAllInstances()) stopBotInstance(inst.number);
    try { fs.rmSync(SESSIONS_DIR, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    pairStore.clear();
    res.json({ ok: true, message: 'All sessions cleared.' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/debug', (_req, res) => {
  res.json({
    SESSIONS_DIR,
    LEGACY_SESSION,
    instances       : getAllInstances(),
    pairStore       : [...pairStore.keys()],
    activeSockets   : [...activeSockets.keys()],
    memoryMB        : Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

/* ════════════════════════════════════════════════════════════
 *  /code  — Génération du code de couplage
 *
 *  Flux corrigé :
 *  1. Crée un socket Baileys temporaire (session dans tmp_pair/)
 *  2. Demande le code → le retourne à l'utilisateur
 *  3. Maintient le socket en vie dans activeSockets[]
 *  4. Quand connection: 'open' (code entré dans WhatsApp) :
 *     a. Sauvegarde la session dans ./sessions/user_<number>/
 *     b. Ferme le socket temporaire
 *     c. Appelle createBotInstance() → bot en mémoire
 * ════════════════════════════════════════════════════════════ */
async function handleCode(req, res) {
  res.setHeader('Content-Type', 'application/json');

  let number = (req.query.number || req.body?.number || '');
  if (!number) return res.json({ error: true, message: 'Phone number required' });
  number = number.replace(/[^0-9]/g, '');
  if (number.length < 7 || number.length > 15)
    return res.json({ error: true, message: 'Invalid number (7–15 digits with country code, no +)' });

  // Déjà actif ?
  const existingInst = getBotInstance(number);
  if (existingInst?.connected) {
    return res.json({ error: false, already: true, message: 'Already connected.' });
  }

  const userSessionDir = path.join(SESSIONS_DIR, `user_${number}`);
  const tmpSessionDir  = path.join(TMP_PAIR_DIR,  `tmp_${number}`);

  // Fermer tout socket de couplage actif pour ce numéro
  if (activeSockets.has(number)) {
    const old = activeSockets.get(number);
    clearTimeout(old.timer);
    try { old.sock?.ws?.close(); } catch {}
    activeSockets.delete(number);
    await new Promise(r => setTimeout(r, 500));
  }

  // Nettoyer la session temporaire précédente
  try { fs.rmSync(tmpSessionDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(tmpSessionDir, { recursive: true });

  console.log(`[VARNOX] /code request for ${number}`);

  try {
    const version = await getBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(tmpSessionDir);
    const logger  = pino({ level: 'silent' });

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
      keepAliveIntervalMs  : 10000,
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
        codeReject(new Error('Timeout 45s — WhatsApp ne répond pas. Réessaie.'));
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
              'Numéro déjà enregistré. Dans WhatsApp → Appareils liés → supprime le bot, puis réessaie.'
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
            codeReject(new Error('Code nul après plusieurs tentatives. Réessaie.'));
          }
        }
      } catch (e) {
        if (codeDone) return;
        console.warn(`[VARNOX] requestPairingCode attempt ${attempts} failed:`, e.message);
        if (attempts < MAX_TRIES) setTimeout(tryRequestCode, 3000);
        else {
          codeDone = true; clearTimeout(hardTimeout);
          codeReject(new Error('Erreur couplage : ' + e.message));
        }
      }
    }

    // ── Copier la session tmp → permanente et lancer le bot ─────────────────
    async function activateSession() {
      const credFile = path.join(tmpSessionDir, 'creds.json');
      if (!fs.existsSync(credFile)) {
        console.error(`[VARNOX] activateSession: no creds.json in ${tmpSessionDir}`);
        return false;
      }
      try {
        fs.mkdirSync(userSessionDir, { recursive: true });
        const files = fs.readdirSync(tmpSessionDir);
        for (const f of files) {
          fs.copyFileSync(path.join(tmpSessionDir, f), path.join(userSessionDir, f));
        }
        console.log(`[VARNOX] ✅ Session saved for ${number} → ${userSessionDir}`);
      } catch (e) {
        console.error(`[VARNOX] Session copy error for ${number}:`, e.message);
        return false;
      }

      // Mettre à jour owner.json si c'est la première instance
      if (getAllInstances().length === 0) initOwnerJson(number);
      pairStore.set(number, { ts: Date.now(), ready: true, number });

      // Supprimer le socket de couplage du registre
      const entry = activeSockets.get(number);
      if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }

      // Démarrer le vrai bot en mémoire
      try {
        await createBotInstance(userSessionDir, number);
        console.log(`[VARNOX] ✅ Bot instance created for ${number}`);
      } catch (e) {
        console.error(`[VARNOX] createBotInstance failed for ${number}:`, e.message);
      }

      // Nettoyer le dossier tmp
      try { fs.rmSync(tmpSessionDir, { recursive: true, force: true }); } catch {}
      return true;
    }

    // ── Événements de connexion ──────────────────────────────────────────────
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      // Dès la connexion → demander le code
      if (connection === 'connecting' && !pairStarted) {
        pairStarted = true;
        setTimeout(tryRequestCode, 1500);
      }

      if (connection === 'open') {
        // Code entré avec succès — le socket est maintenant authentifié
        console.log(`[VARNOX] ✅ Pairing successful for ${number}`);
        try { await saveCreds(); } catch {}
        // Attendre un peu pour que les creds soient bien flush sur le disque
        await new Promise(r => setTimeout(r, 3000));
        try { await saveCreds(); } catch {}
        // Fermer le socket temporaire
        try { sock.ws?.close(); } catch {}
        // Activer la session et créer le bot
        await activateSession();
        return;
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut  = statusCode === DisconnectReason.loggedOut || statusCode === 401;

        // Si le code a déjà été envoyé et que la connexion se ferme (normal après auth)
        if (codeDone) {
          if (loggedOut && !pairStore.get(number)?.ready) {
            // Échec définitif — nettoyage
            const entry = activeSockets.get(number);
            if (entry) { clearTimeout(entry.timer); activeSockets.delete(number); }
            try { fs.rmSync(tmpSessionDir, { recursive: true, force: true }); } catch {}
          }
          // Si pas loggedOut, Baileys va auto-reconnecter → on laisse faire
          return;
        }

        // Code pas encore envoyé et connexion fermée
        if (loggedOut) {
          codeDone = true; clearTimeout(hardTimeout);
          codeReject(new Error('Session expirée. Réessaie.'));
        }
        // Sinon, Baileys auto-reconnecte
      }
    });

    // Fallback : si 'connecting' n'a pas été reçu après 8s
    setTimeout(() => {
      if (!codeDone && !pairStarted) {
        pairStarted = true;
        tryRequestCode();
      }
    }, 8000);

    // Attendre le code
    const raw       = await codePromise;
    const formatted = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,4}/g)?.join('-') ?? raw;

    console.log(`[VARNOX] Code generated for ${number}: ${formatted}`);

    // Timer d'expiration du socket de couplage (15 min)
    const timer = setTimeout(() => {
      if (activeSockets.has(number)) {
        try { activeSockets.get(number).sock?.ws?.close(); } catch {}
        activeSockets.delete(number);
        if (!pairStore.get(number)?.ready) {
          try { fs.rmSync(tmpSessionDir, { recursive: true, force: true }); } catch {}
        }
      }
    }, 15 * 60 * 1000);

    activeSockets.set(number, { sock, timer });

    return res.json({ error: false, code: formatted });

  } catch (err) {
    console.error(`[VARNOX] /code error for ${number}:`, err.message);
    if (!pairStore.get(number)?.ready) {
      try { fs.rmSync(tmpSessionDir, { recursive: true, force: true }); } catch {}
    }
    return res.json({ error: true, message: err.message || 'Erreur génération du code' });
  }
}

app.get('/code',  handleCode);
app.post('/code', handleCode);

/* ─── SPA fallback ─────────────────────────────────────────── */
app.get('*', (_req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.json({ status: 'VARNOX XD V2 API running', endpoints: ['/ping', '/health', '/code?number=', '/session?number=', '/reset?number=', '/debug'] });
});

/* ─── Démarrage ────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  VARNOX XD V2 v15 (SINGLE-PROCESS MULTI-USER) ║`);
  console.log(`║  Port : ${PORT}                                  ║`);
  console.log(`║  Chaque utilisateur = bot en mémoire           ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
});

module.exports = app;
