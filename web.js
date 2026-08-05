/**
 * VARNOX XD V2 — web.js  v18  (SINGLE-PROCESS MULTI-USER — TWO-SOCKET FIX)
 *
 * Corrections v18 (fix root cause de l'échec de reconnexion) :
 *
 *  PROBLÈME v17 (aliasing de state.creds) :
 *    - Le socket de couplage utilise state.creds (objet A, depuis tmpDir).
 *    - Après copie, on faisait useMultiFileAuthState(userSessionDir) → fresh.state.creds
 *      (objet B, copie statique lue depuis disque).
 *    - saveCredsUser = fresh.saveCreds écrit l'objet B.
 *    - Mais Baileys met à jour l'objet A (vrai état du socket) et émet creds.update.
 *    - Résultat : saveCredsUser() sauvegarde des creds périmés (objet B figé)
 *      → à la prochaine reconnexion, creds stale → échec d'authentification.
 *    - Idem pour les signal keys (makeCacheableSignalKeyStore était initialisé
 *      depuis tmpDir → les nouvelles pre-keys allaient dans tmpDir, supprimé après).
 *
 *  FIX v18 (approche deux sockets) :
 *    1. session couplage (tmpDir) → flush + copie → userSessionDir  (inchangé)
 *    2. socket de couplage fermé proprement (flag intentionallyClosed)
 *    3. createBotInstance(userSessionDir, number) → NEW socket
 *       → Baileys lit auth.creds ET auth.keys depuis userSessionDir dès le départ
 *       → TOUTES les écritures futures (creds.update, pre-keys…) vont dans userSessionDir
 *       → zéro aliasing, zéro creds perdus
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
  r.json({ status: 'online', bot: 'VARNOX XD V2', v: '17.0.0', uptime: Math.floor(process.uptime()), instances: insts, total: insts.length });
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
  memMB        : Math.round(process.memoryUsage().rss / 1024 / 1024),
}));

/* ════════════════════════════════════════════════════════════
 *  /code  — Génération du code de couplage
 *
 *  FLUX (sans délai, sans 2ème connexion) :
 *
 *  1. Créer socket Baileys dans un dossier tmp
 *  2. Dès connection:'connecting' → requestPairingCode (300ms de délai min)
 *  3. Retourner le code au frontend
 *  4. Quand connection:'open' (code entré dans WhatsApp) :
 *       a. saveCreds() → flush session sur disque (tmpDir)
 *       b. Copier les fichiers de session dans ./sessions/user_<num>/
 *       c. Obtenir un nouveau saveCreds pointant sur userSessionDir  ← FIX v17
 *       d. Retirer l'ancien handler creds.update (tmpDir)            ← FIX v17
 *       e. attachBotHandlers(sock, userSessionDir, num, saveCredsUser) ← FIX v17
 *          → ce socket DEVIENT le bot, les creds sont persistés
 *            dans userSessionDir (pas dans tmpDir qui sera effacé)
 *       f. Nettoyage du dossier tmp après 15 s
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

    // ★ CRITIQUE : enregistrer creds.update dès maintenant (vers tmpDir).
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
    // Flag : indique que le socket de couplage a été fermé VOLONTAIREMENT
    // pour démarrer le nouveau socket bot depuis userSessionDir.
    let intentionallyClosed = false;

    async function promotePairToBot() {
      // Éviter un double-déclenchement si connection:'open' fire deux fois
      if (intentionallyClosed) return;

      // 1. ★ Attendre 4s après connection:'open' ★
      //    WhatsApp envoie des paquets supplémentaires (clés de session, noise,
      //    prékeys, infos de compte…) dans les secondes qui suivent l'ouverture.
      //    Le handler creds.update ci-dessus les capte et les écrit dans tmpDir.
      //    Sans cette attente, saveCreds() snapshote un état INCOMPLET.
      //    (L'original qui marchait avait saveAndClose(4000) — délai identique.)
      await new Promise(r => setTimeout(r, 4000));
      if (intentionallyClosed) return; // vérification après le délai

      // 2. Flush explicite (en plus du handler auto) pour être sûr
      try { await saveCreds(); } catch (e) {
        console.error(`[VARNOX] saveCreds(tmp) error:`, e.message);
      }

      // 3. Copier la session tmp → session permanente
      let copyOk = false;
      try {
        fs.mkdirSync(userSessionDir, { recursive: true });
        const files = fs.readdirSync(tmpDir);
        for (const f of files) {
          try { fs.copyFileSync(path.join(tmpDir, f), path.join(userSessionDir, f)); } catch {}
        }
        copyOk = true;
        console.log(`[VARNOX] ✅ Session copied to ${userSessionDir}`);
      } catch (e) {
        console.error(`[VARNOX] Session copy error:`, e.message);
      }

      if (!copyOk) {
        console.error(`[VARNOX] ❌ Copy failed — bot non activé pour ${number}`);
        return;
      }

      // 4. Mettre à jour owner.json (premier utilisateur)
      if (getAllInstances().length === 0) initOwnerJson(number);
      pairedNumbers.set(number, { ts: Date.now() });

      // 5. Fermer la référence dans pairingSockets
      const p = pairingSockets.get(number);
      if (p) { clearTimeout(p.timer); pairingSockets.delete(number); }

      // 6. ★ FIX v18 : fermer le socket de couplage et démarrer un NOUVEAU socket ★
      //
      //    POURQUOI l'approche "réutiliser le socket de couplage" était cassée (v17) :
      //      - Le socket utilise state.creds (objet A, initialisé depuis tmpDir).
      //      - useMultiFileAuthState(userSessionDir) crée fresh.state.creds (objet B).
      //      - fresh.saveCreds() écrit l'objet B — figé au moment de la lecture.
      //      - Baileys met à jour l'objet A et émet creds.update.
      //      - → On sauvegarde des creds périmés (B) → reconnexion échoue.
      //      - Idem pour makeCacheableSignalKeyStore : les pre-keys allaient dans tmpDir.
      //
      //    SOLUTION : nouveau socket depuis userSessionDir
      //      - auth.creds ET auth.keys lus depuis userSessionDir dès le départ.
      //      - Toutes les écritures futures vont dans userSessionDir.
      //      - Zéro aliasing, zéro creds perdus.
      //
      intentionallyClosed = true;
      try { sock.ws?.close(); } catch {}   // fermeture propre du socket de couplage

      // Attendre 2 s (le socket doit être fermé côté WS avant reconnexion)
      setTimeout(async () => {
        try {
          await createBotInstance(userSessionDir, number);
          markConnected(number);
          console.log(`[VARNOX] ✅ Bot live for ${number} (new socket ← userSessionDir)`);
        } catch (e) {
          console.error(`[VARNOX] createBotInstance failed for ${number}:`, e.message);
        }
        // Nettoyer tmpDir (copie déjà effectuée)
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }, 2000);
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
        // Socket fermé volontairement dans promotePairToBot → rien à faire
        if (intentionallyClosed) return;

        const sc        = lastDisconnect?.error?.output?.statusCode;
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
  r.json({ status: 'VARNOX XD V2 — Multi-User', v: '17.0.0' });
});

/* ─── Démarrage ────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════════════╗`);
  console.log(`║  VARNOX XD V2 v17 — Multi-User sans délai      ║`);
  console.log(`║  Port : ${PORT}                                    ║`);
  console.log(`║  saveCreds → userSessionDir après couplage      ║`);
  console.log(`╚════════════════════════════════════════════════╝\n`);
});

module.exports = app;
