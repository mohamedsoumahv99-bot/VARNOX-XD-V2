/**
 * VARNOX XD V2 — web.js  v16  (SINGLE-PROCESS MULTI-USER — SANS DÉLAI)
 *
 * Correction principale :
 * Après que l'utilisateur entre le code de couplage et que connection:'open'
 * se déclenche, on N'OUVRE PAS une deuxième connexion WhatsApp.
 * On attache directement les handlers bot sur le socket de couplage existant
 * via attachBotHandlers() → le socket de couplage DEVIENT le socket bot.
 *
 * Résultat : connexion instantanée, pas de délai, même comportement qu'avant
 * mais avec support multi-utilisateurs.
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
  createBotInstance,
  stopBotInstance,
  getBotInstance,
  getAllInstances,
  markConnected,
  getVersion,
} = require('./lib/botInstance');

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
// Map<string, { sock, saveCreds, tmpDir, timer }>
const pairingSockets = new Map();

/* ─── Sessions marquées prêtes ───────────────────────────── */
// Map<string, { ts }>
const pairedNumbers = new Map();

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
  r.json({ status: 'online', bot: 'VARNOX XD V2', v: '16.0.0', uptime: Math.floor(process.uptime()), instances: insts, total: insts.length });
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
  if (i?.connected) return res.json({ ready: true });
  if (fs.existsSync(path.join(SESSIONS_DIR, `user_${number}`, 'creds.json'))) return res.json({ ready: true });
  res.json({ ready: false });
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
        try { fs.rmSync(p.tmpDir, { recursive: true, force: true }); } catch {}
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
      try { fs.rmSync(p.tmpDir, { recursive: true, force: true }); } catch {}
    });
    pairingSockets.clear();
    pairedNumbers.clear();
    try { fs.rmSync(SESSIONS_DIR, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    res.json({ ok: true, message: 'All sessions cleared.' });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/debug', (_q, r) => r.json({
  SESSIONS_DIR,
  instances    : getAllInstances(),
  pairing      : [...pairingSockets.keys()],
  paired       : [...pairedNumbers.keys()],
  memMB        : Math.round(process.memoryUsage().rss / 1024 / 1024),
}));

/* ════════════════════════════════════════════════════════════
 *  /code  — Génération du code de couplage
 *
 *  NOUVEAU FLUX (sans délai, sans 2ème connexion) :
 *
 *  1. Créer socket Baileys dans un dossier tmp
 *  2. Dès connection:'connecting' → requestPairingCode (300ms de délai min)
 *  3. Retourner le code au frontend
 *  4. Quand connection:'open' (code entré dans WhatsApp) :
 *       a. saveCreds() → flush session sur disque
 *       b. Copier les fichiers de session dans ./sessions/user_<num>/
 *       c. attachBotHandlers(sock, ...) → ce socket DEVIENT le bot
 *          (aucune nouvelle connexion WhatsApp)
 *       d. Nettoyage du dossier tmp
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

  const userSessionDir = path.join(SESSIONS_DIR, `user_${number}`);
  const tmpDir         = path.join(TMP_PAIR_DIR, `tmp_${number}`);

  // Fermer le couplage précédent pour ce numéro s'il existe
  if (pairingSockets.has(number)) {
    const old = pairingSockets.get(number);
    clearTimeout(old.timer);
    try { old.sock?.ws?.close(); } catch {}
    try { fs.rmSync(old.tmpDir, { recursive: true, force: true }); } catch {}
    pairingSockets.delete(number);
    await new Promise(r => setTimeout(r, 300));
  }

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log(`[VARNOX] /code for ${number}`);

  try {
    // ── Créer le socket de couplage ────────────────────────────────────────
    const logger = pino({ level: 'silent' });
    const { state, saveCreds } = await useMultiFileAuthState(tmpDir);

    const sock = makeWASocket({
      version              : getVersion(),    // version préchargée — pas d'attente réseau
      logger,
      printQRInTerminal    : false,
      browser              : Browsers.ubuntu('Chrome'),
      auth: {
        creds : state.creds,
        keys  : makeCacheableSignalKeyStore(state.keys, logger),
      },
      msgRetryCounterCache  : new NodeCache({ stdTTL: 120 }),
      connectTimeoutMs      : 60000,
      keepAliveIntervalMs   : 10000,
    });

    sock.ev.on('creds.update', saveCreds);

    // ── Promesse du code de couplage ──────────────────────────────────────
    let codeResolve, codeReject;
    let codeDone    = false;
    let pairStarted = false;
    let attempts    = 0;

    const codePromise = new Promise((res, rej) => { codeResolve = res; codeReject = rej; });

    const hardTimer = setTimeout(() => {
      if (!codeDone) { codeDone = true; codeReject(new Error('Timeout 40s — WhatsApp ne répond pas.')); }
    }, 40000);

    async function tryGetCode() {
      if (codeDone) return;
      attempts++;
      try {
        if (sock.authState?.creds?.registered) {
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
        if (attempts < 5) setTimeout(tryGetCode, 2000);
        else { codeDone = true; clearTimeout(hardTimer); codeReject(new Error(e.message)); }
      }
    }

    // ── Gestion de la session après couplage réussi ───────────────────────
    async function promotePairToBot() {
      // 1. Sauvegarder les creds sur disque
      try { await saveCreds(); } catch {}

      // 2. Copier la session tmp → session permanente
      try {
        fs.mkdirSync(userSessionDir, { recursive: true });
        fs.readdirSync(tmpDir).forEach(f => {
          try { fs.copyFileSync(path.join(tmpDir, f), path.join(userSessionDir, f)); } catch {}
        });
        console.log(`[VARNOX] ✅ Session copied to ${userSessionDir}`);
      } catch (e) {
        console.error(`[VARNOX] Session copy error:`, e.message);
        return;
      }

      // 3. Mettre à jour owner.json (premier utilisateur)
      if (getAllInstances().length === 0) initOwnerJson(number);
      pairedNumbers.set(number, { ts: Date.now() });

      // 4. Fermer la référence dans pairingSockets
      const p = pairingSockets.get(number);
      if (p) { clearTimeout(p.timer); pairingSockets.delete(number); }

      // 5. ★ CLEF : attacher les handlers bot sur CE socket ★
      //    Aucune nouvelle connexion WA — le socket de couplage devient le bot
      attachBotHandlers(sock, userSessionDir, number, saveCreds);
      markConnected(number);

      // 6. Nettoyer le dossier tmp
      setTimeout(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }, 3000);

      console.log(`[VARNOX] ✅ Bot live for ${number} (socket reused)`);
    }

    // ── Listener de connexion ─────────────────────────────────────────────
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'connecting' && !pairStarted) {
        pairStarted = true;
        // Délai minimal (300ms) pour laisser le WS s'établir avant de demander le code
        setTimeout(tryGetCode, 300);
      }

      if (connection === 'open') {
        console.log(`[VARNOX] ✅ WA authenticated for ${number}`);
        await promotePairToBot();
      }

      if (connection === 'close') {
        const sc       = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = sc === DisconnectReason.loggedOut || sc === 401;

        if (!codeDone) {
          // Le code n'a pas encore été émis — signaler l'erreur
          if (loggedOut) { codeDone = true; clearTimeout(hardTimer); codeReject(new Error('Connexion rejetée. Réessaie.')); }
          // Sinon Baileys reconnecte automatiquement → on laisse faire
          return;
        }

        // Code déjà envoyé → si loggedOut AVANT activation du bot, nettoyer
        if (loggedOut && !pairedNumbers.has(number)) {
          const p = pairingSockets.get(number);
          if (p) { clearTimeout(p.timer); pairingSockets.delete(number); }
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        }
        // Sinon (reconnexion normale) → Baileys gère
      }
    });

    // Fallback : si 'connecting' tarde ou ne se déclenche pas
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
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    }, 15 * 60 * 1000);

    pairingSockets.set(number, { sock, saveCreds, tmpDir, timer });

    return res.json({ error: false, code: formatted });

  } catch (err) {
    console.error(`[VARNOX] /code error ${number}:`, err.message);
    if (!pairedNumbers.has(number))
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return res.json({ error: true, message: err.message || 'Erreur génération du code' });
  }
}

app.get('/code',  handleCode);
app.post('/code', handleCode);

/* ─── SPA fallback ─────────────────────────────────────────── */
app.get('*', (_q, r) => {
  const p = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(p)) return r.sendFile(p);
  r.json({ status: 'VARNOX XD V2 — Multi-User', v: '16.0.0' });
});

/* ─── Démarrage ────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════════════╗`);
  console.log(`║  VARNOX XD V2 v16 — Multi-User sans délai      ║`);
  console.log(`║  Port : ${PORT}                                    ║`);
  console.log(`║  Socket couplage = socket bot (0 délai)         ║`);
  console.log(`╚════════════════════════════════════════════════╝\n`);
});

module.exports = app;
