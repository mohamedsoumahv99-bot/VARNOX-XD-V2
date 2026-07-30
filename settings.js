const settings = {
  // ════════════════════════════════════════════════════
  //    🥷 CONFIGURATION DE TON BOT — REMPLIS ICI
  // ════════════════════════════════════════════════════

  packname: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',          // Nom du pack sticker
  author: 'ʋαɾɳσx ❍ғғɪᴄɪᴀʟ',               // Ton nom
  botName: "𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2",           // Nom du bot affiché
  botOwner: 'ʋαɾɳσx ❍ғғɪᴄɪᴀʟ',             // Ton vrai nom

  // ⚠️ Ton numéro WhatsApp SANS le + (ex: 224621000000)
  ownerNumber: process.env.OWNER_NUMBER || '224610835573',

  giphyApiKey: 'qnl7ssQChTdPjsKta2Ax2LMaGXz303tq',
  commandMode: "public",               // "public" ou "private"
  maxStoreMessages: 20,
  storeWriteInterval: 10000,
  description: "Bot WhatsApp multifonctions.",
  version: "2.0.0",

  // Ton lien GitHub (optionnel)
  updateZipUrl: "https://github.com/Med12-q/VARNOX-XD-V2",

  // URL du panneau — auto-détection Render / Railway / Vercel / fallback
  pairApiUrl: process.env.RENDER_EXTERNAL_URL
    ? process.env.RENDER_EXTERNAL_URL
    : process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.PANEL_URL
    || "https://varnox-xd-v2.onrender.com",
};

module.exports = settings;
