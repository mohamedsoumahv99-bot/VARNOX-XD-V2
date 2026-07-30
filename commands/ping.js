'use strict';
const os = require('os');

function uptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return [d && `${d}j`, h && `${h}h`, m && `${m}m`, `${s}s`]
    .filter(Boolean).join(' ');
}

async function pingCommand(sock, chatId, message) {
  try {
    const t0   = Date.now();
    await sock.sendMessage(chatId, { react: { text: '🏓', key: message.key } });
    const ping = Date.now() - t0;
    const ram  = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    const up   = uptime(Math.floor(process.uptime()));

    await sock.sendMessage(chatId, {
      text:
        `🏓 *Pong!* — ${ping}ms\n` +
        `⏱️ *Uptime :* ${up}\n` +
        `💾 *RAM :* ${ram} MB\n` +
        `⚙️ *Node :* ${process.version}`,
    }, { quoted: message });

  } catch (err) {
    console.error('[ping] error:', err.message);
    await sock.sendMessage(chatId, { text: '❌ Ping failed.' }, { quoted: message });
  }
}

module.exports = pingCommand;
