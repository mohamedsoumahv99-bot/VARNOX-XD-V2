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

require('./settings');

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

const {
  attachBotHandlers,
  stopBotInstance,
  getBotInstance,
  getAllInstances,
  markConnected,
  getLatestVersion,
} = require('./lib/botInstance');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ─── Répertoires ─────────────────────────────────────────── */
const SESSIONS_DIR   = path.join(__dirname, 'sessions');
const LEGACY_SESSION = path.join(__dirname, 'session');
const DATA_DIR       = path.join(__dirname, 'data');
const OWNER_JSON     = path.join(DATA_DIR, 'owner.json');

[SESSIONS_DIR, LEGACY_SESSION, DATA_DIR].forEach(d => {
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
});

/* ─── owner.json ──────────────────────────────────────────── */
function initOwnerJson(number) {
  let cur = {};
  try { if (fs.existsSync(OWNER_JSON)) cur = JSON.parse(fs.readFileSync(OWNER_JSON, 'utf8')); } catch {}
  const empty = !cur.ownerNumber || cur.ownerNumber === 'TON_NUMERO_ICI';
  if (number || empty) {
    try {
      fs.writeFileSync(OWNER_JSON, JSON.stringify({
        ownerNumber : number || cur.ownerNumber || process.env.OWNER_NUMBER || '',
        ownerName   : cur.ownerName || 'Owner',
        botName     : cur.botName   || 'VARNOX XD V2',
        prefix      : cur.prefix    || process.env.PREFIX || '.',
        version     : '2.0.0',
        mess        : cur.mess      || 'Owner',
      }, null, 2));
    } catch {}
  }
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

/* ═══════════════════════════════════════════════════════════
 *  Démarrage des sessions existantes (au boot)
 * ═══════════════════════════════════════════════════════════ */
async function startExistingSessions() {
  // Sessions multi-user ./sessions/user_<number>/
  try {
    const dirs = fs.readdirSync(SESSIONS_DIR);
    for (const dir of dirs) {
      const m = dir.match(/^user_(\d+)$/);
      if (!m) continue;
      const num = m[1];
      const sd  = path.join(SESSIONS_DIR, dir);
      if (!fs.existsSync(path.join(sd, 'creds.json'))) continue;
      console.log(`[VARNOX] Restoring session: ${num}`);
      createBotInstance(sd, num).catch(e => console.error(`[VARNOX] Restore ${num} failed:`, e.message));
    }
  } catch (e) { console.error('[VARNOX] startExistingSessions:', e.message); }

  // Rétrocompat session unique ./session/
  if (fs.existsSync(path.join(LEGACY_SESSION, 'creds.json'))) {
    let ownerNum = 'legacy';
    try { ownerNum = JSON.parse(fs.readFileSync(OWNER_JSON, 'utf8')).ownerNumber || 'legacy'; } catch {}
    if (!getBotInstance(ownerNum)) {
      console.log(`[VARNOX] Legacy session → ${ownerNum}`);
      createBotInstance(LEGACY_SESSION, ownerNum).catch(e => console.error('[VARNOX] Legacy restore:', e.message));
    }
  }
}

setTimeout(startExistingSessions, 1500);

/* ═══════════════════════════════════════════════════════════
 *  ROUTES
 * ═══════════════════════════════════════════════════════════ */
app.get('/ping', (_q, r) => r.json({ pong: true, ts: Date.now() }));

app.get('/health', (_q, r) => {
  const insts = getAllInstances();
  r.json({
    status: 'online',
    bot: 'VARNOX XD V2',
    v: '19.2.0',
    build: '3acf967',
    waFallback: '2.3000.1043857760',
    uptime: Math.floor(process.uptime()),
    instances: insts,
    total: insts.length,
  });
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
  if (!num) return res.json({ instances: getAllInstances() });
  const i = getBotInstance(num);
  res.json({ number: num, connected: !!i?.connected, running: !!i, pairing: pairingSockets.has(num) });
});

app.get('/session', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  let { number } = req.query;
  if (!number) return res.json({ ready: false });
  number = number.replace(/\D/g, '');
  const i = getBotInstance(number);
  // IMPORTANT: creds.json est créé dès le début du pairing. Sa présence
  // ne signifie pas que WhatsApp a accepté le code.
  if (i?.connected && pairedNumbers.has(number)) {
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

app.get('/reset', (req, res) => {
  const num = req.query.number ? String(req.query.number).replace(/\D/g, '') : null;
  try {
    if (num) {
      stopBotInstance(num);
      // Fermer le socket de couplage s'il est en cours
      if (pairingSockets.has(num)) {
        const p = pairingSockets.get(num);
        clearTimeout(p.timer);
        try { p.sock?.ws?.close(); } catch {}
        try { fs.rmSync(p.sessionDir, { recursive: true, force: true }); } catch {}
        pairingSockets.delete(num);
      }
      pairedNumbers.delete(num);
      const ud = path.join(SESSIONS_DIR, `user_${num}`);
      try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
      fs.mkdirSync(ud, { recursive: true });
      return res.json({ ok: true, message: `Session cleared for ${num}. Reconnect to re-pair.` });
    }
    for (const i of getAllInstances()) stopBotInstance(i.number);
    pairingSockets.forEach(p => {
      clearTimeout(p.timer);
      try { p.sock?.ws?.close(); } catch {}
    });
    pairingSockets.clear();
    pairedNumbers.clear();
    res.json({ ok: true, message: 'All sessions cleared.' });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/debug', (_q, r) => r.json({
  SESSIONS_DIR,
  instances    : getAllInstances(),
  pairing      : [...pairingSockets.keys()],
  paired       : [...pairedNumbers.keys()],
  failures     : [...pairingFailures.entries()],
  memMB        : Math.round(process.memoryUsage().rss / 1024 / 1024),
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

  let number = (req.query.number || req.body?.number || '').toString().replace(/\D/g, '');
  if (!number) return res.json({ error: true, message: 'Numéro requis' });
  if (number.length < 7 || number.length > 15)
    return res.json({ error: true, message: 'Numéro invalide (7–15 chiffres, sans +)' });

  // Déjà connecté ?
  const existing = getBotInstance(number);
  if (existing?.connected)
    return res.json({ error: false, already: true, message: 'Déjà connecté.' });
  if (existing && !existing.connected) stopBotInstance(number);

  const userSessionDir = path.join(SESSIONS_DIR, `user_${number}`);
  const sessionDir     = userSessionDir;

  // Fermer le couplage précédent pour ce numéro s'il existe
  if (pairingSockets.has(number)) {
    const old = pairingSockets.get(number);
    clearTimeout(old.timer);
    try { old.sock?.ws?.close(); } catch {}
    try { fs.rmSync(old.sessionDir, { recursive: true, force: true }); } catch {}
    pairingSockets.delete(number);
    await new Promise(r => setTimeout(r, 300));
  }

  // Une tentative précédente non connectée peut avoir laissé des clés
  // incomplètes. On repart d'une session propre pour chaque nouveau code.
  try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(sessionDir, { recursive: true });

  console.log(`[VARNOX] /code for ${number}`);
  pairingFailures.delete(number);

  try {
    // ── Créer le socket directement dans la session permanente ────────────
    const logger = pino({ level: 'silent' });
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    // Ne jamais générer un code avec la version fallback si le réseau est
    // disponible : WhatsApp peut l'afficher puis refuser sa validation.
    const version = await getLatestVersion();

    const sock = makeWASocket({
      version,
      logger,
      printQRInTerminal    : false,
      // Desktop client is the most compatible profile for phone-number
      // linking. Some WhatsApp builds reject the Ubuntu companion profile.
      browser              : Browsers.macOS('Desktop'),
      auth: {
        creds : state.creds,
        keys  : makeCacheableSignalKeyStore(state.keys, logger),
      },
      msgRetryCounterCache  : new NodeCache({ stdTTL: 120 }),
      connectTimeoutMs      : 60000,
      keepAliveIntervalMs   : 10000,
      defaultQueryTimeoutMs : 60000,
      syncFullHistory       : false,
      markOnlineOnConnect   : true,
    });

    // ★ CRITIQUE : enregistrer creds.update dès maintenant (vers sessionDir).
    // WhatsApp envoie des mises à jour de clés en continu pendant et après
    // le couplage. Sans ce handler, les clés de session (noise keys, signal
    // pre-keys, etc.) ne sont pas écrites sur disque au fur et à mesure.
    // Le saveCreds() manuel dans promotePairToBot ne suffit pas car certaines
    // mises à jour arrivent APRÈS connection:'open' — race condition.
    sock.ev.on('creds.update', saveCreds);

    // ── Promesse du code de couplage ──────────────────────────────────────
    let codeResolve, codeReject;
    let codeDone    = false;
    let pairStarted = false;
    let attempts    = 0;

    const codePromise = new Promise((res, rej) => { codeResolve = res; codeReject = rej; });

    const hardTimer = setTimeout(() => {
      if (!codeDone) {
        codeDone = true;
        codeReject(new Error('Timeout 60s — WhatsApp n’a pas préparé la connexion. Réessaie avec le numéro international sans +.'));
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
          else if (attempts < 5) setTimeout(tryGetCode, 2000);
          else { codeDone = true; clearTimeout(hardTimer); codeReject(new Error('Code null. Réessaie.')); }
        }
      } catch (e) {
        if (codeDone) return;
        if (attempts < 5) setTimeout(tryGetCode, 2500);
        else { codeDone = true; clearTimeout(hardTimer); codeReject(new Error(e.message)); }
      }
    }

    // ── Gestion de la session après couplage réussi ───────────────────────
    // Le socket reste ouvert et devient directement le socket du bot.
    let pairActivated = false;

    async function promotePairToBot() {
      // Éviter un double-déclenchement si connection:'open' fire deux fois
      if (pairActivated) return;
      pairActivated = true;

      // Laisser les dernières clés de signal être écrites avant activation.
      await new Promise(r => setTimeout(r, 4000));
      try { await saveCreds(); } catch (e) {
        console.error(`[VARNOX] saveCreds error:`, e.message);
      }

      if (!fs.existsSync(path.join(sessionDir, 'creds.json'))) {
        pairActivated = false;
        throw new Error('creds.json absent après authentification');
      }

      // Mettre à jour owner.json (premier utilisateur)
      if (getAllInstances().length === 0) initOwnerJson(number);
      pairedNumbers.set(number, { ts: Date.now() });

      // Le socket actuel devient le socket du bot : aucun deuxième handshake.
      const p = pairingSockets.get(number);
      if (p) { clearTimeout(p.timer); pairingSockets.delete(number); }

      attachBotHandlers(sock, sessionDir, number, saveCreds);
      markConnected(number);
      console.log(`[VARNOX] ✅ Bot activated on persistent socket for ${number}`);
    }

    // ── Listener de connexion ─────────────────────────────────────────────
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'connecting' && !pairStarted) {
        pairStarted = true;
        // WhatsApp/Baileys doit finir son handshake avant requestPairingCode.
        // Le flux officiel du même dépôt attend 3 secondes.
        setTimeout(tryGetCode, 3000);
      }

      if (connection === 'open') {
        console.log(`[VARNOX] ✅ WA authenticated for ${number}`);
        await promotePairToBot();
      }

      if (connection === 'close') {
        // Après activation, le handler de botInstance gère la reconnexion.
        if (pairActivated) return;

        const info      = disconnectInfo(lastDisconnect?.error);
        const sc        = info.code;
        const loggedOut = sc === DisconnectReason.loggedOut || sc === 401;
        console.error(`[VARNOX] Pairing socket closed for ${number}; code=${sc ?? 'unknown'}; reason=${info.message}`);

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

        // Any close before activation invalidates the displayed code. Do not
        // keep polling a dead socket or silently wait forever on the panel.
        if (!pairedNumbers.has(number)) {
          const message = sc === 401
            ? 'Code refusé par WhatsApp. Supprime les anciennes sessions liées, attends quelques secondes, puis génère un nouveau code.'
            : `Connexion WhatsApp fermée avant la validation (code ${sc ?? 'inconnu'}).`;
          pairingFailures.set(number, { code: sc || 0, message, detail: info.message, ts: Date.now() });
          const p = pairingSockets.get(number);
          if (p) { clearTimeout(p.timer); pairingSockets.delete(number); }
          try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
        }
        // Sinon → Baileys / botInstance gère la reconnexion
      }
    });

    // Fallback : si 'connecting' tarde ou ne se déclenche pas avant que l'on
    // enregistre le listener (race condition possible avec certaines versions)
    setTimeout(() => { if (!codeDone && !pairStarted) { pairStarted = true; tryGetCode(); } }, 7000);

    // ── Attendre le code ──────────────────────────────────────────────────
    const raw       = await codePromise;
    const formatted = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,4}/g)?.join('-') || raw;

    console.log(`[VARNOX] Code for ${number}: ${formatted}`);

    // Garder le socket vivant jusqu'à 15 min
    const timer = setTimeout(() => {
      if (pairingSockets.has(number)) {
        try { pairingSockets.get(number).sock?.ws?.close(); } catch {}
        pairingSockets.delete(number);
        if (!pairedNumbers.has(number))
          try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
      }
    }, 15 * 60 * 1000);

    pairingSockets.set(number, { sock, saveCreds, sessionDir, timer });

    return res.json({ error: false, code: formatted });

  } catch (err) {
    console.error(`[VARNOX] /code error ${number}:`, err.message);
    if (!pairedNumbers.has(number))
      try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    return res.json({ error: true, message: err.message || 'Erreur génération du code' });
  }
}

app.get('/code',  handleCode);
app.post('/code', handleCode);

/* ─── SPA fallback ─────────────────────────────────────────── */
app.get('*', (_q, r) => {
  const p = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(p)) return r.sendFile(p);
  r.json({ status: 'VARNOX XD V2 — Multi-User', v: '19.0.0' });
});

/* ─── Démarrage ────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════════════╗`);
  console.log(`║  VARNOX XD V2 v19 — Pairing stable              ║`);
  console.log(`║  Port : ${PORT}                                    ║`);
  console.log(`║  saveCreds → session permanente                  ║`);
  console.log(`╚════════════════════════════════════════════════╝\n`);
});

module.exports = app;
