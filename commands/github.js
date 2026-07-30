const moment = require('moment-timezone');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function githubCommand(sock, chatId, message) {
  try {
    const res = await axios.get('https://api.github.com/repos/Med12-q/VARNOX-XD-V2', {
      headers: { 'User-Agent': 'VARNOX-XD-V2-Bot' }
    });
    const json = res.data;

    let txt = `*☆ 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2 ☆*\n\n`;
    txt += `✩  *Name* : ${json.name}\n`;
    txt += `✩  *Watchers* : ${json.watchers_count}\n`;
    txt += `✩  *Size* : ${(json.size / 1024).toFixed(2)} MB\n`;
    txt += `✩  *Last Updated* : ${moment(json.updated_at).format('DD/MM/YY - HH:mm:ss')}\n`;
    txt += `✩  *URL* : ${json.html_url}\n`;
    txt += `✩  *Forks* : ${json.forks_count}\n`;
    txt += `✩  *Stars* : ${json.stargazers_count}\n\n`;
    txt += `💥 *Star le repo pour soutenir!*`;

    const imgPath = path.join(__dirname, '../assets/bot_image.jpg');
    const imgBuffer = fs.readFileSync(imgPath);

    await sock.sendMessage(chatId, { image: imgBuffer, caption: txt }, { quoted: message });
  } catch (error) {
    console.error('Error in github command:', error);
    await sock.sendMessage(chatId, { text: '❌ Erreur lors de la récupération des infos GitHub.' }, { quoted: message });
  }
}

module.exports = githubCommand;
