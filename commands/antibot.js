const fs = require('fs');
const path = require('path');

const ANTIBOT_FILE = path.join(__dirname, '../data/antibot.json');

function readAntibotState() {
    try {
        if (!fs.existsSync(ANTIBOT_FILE)) return {};
        return JSON.parse(fs.readFileSync(ANTIBOT_FILE));
    } catch { return {}; }
}

function saveAntibotState(state) {
    fs.writeFileSync(ANTIBOT_FILE, JSON.stringify(state, null, 2));
}

function isAntibotEnabled(chatId) {
    const state = readAntibotState();
    return state[chatId] === true;
}

async function antibotCommand(sock, chatId, message, args, isSenderAdmin) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: '❌ Cette commande ne fonctionne que dans les groupes.' }, { quoted: message });
        return;
    }

    if (!isSenderAdmin) {
        await sock.sendMessage(chatId, { text: '❌ Seuls les admins peuvent utiliser cette commande.' }, { quoted: message });
        return;
    }

    const state = readAntibotState();
    const action = args[0]?.toLowerCase();

    if (!action || action === 'statut') {
        const status = state[chatId] ? '✅ Activé' : '❌ Désactivé';
        await sock.sendMessage(chatId, {
            text: `🤖 *ANTIBOT*\n\n📊 Statut : ${status}\n\n📌 Utilisation :\n• *.antibot on* → Activer\n• *.antibot off* → Désactiver\n\n💡 Quand activé, aucun autre bot ne pourra répondre dans ce groupe.`
        }, { quoted: message });
        return;
    }

    if (action === 'on') {
        if (state[chatId]) {
            await sock.sendMessage(chatId, { text: '⚠️ L\'antibot est déjà activé dans ce groupe.' }, { quoted: message });
            return;
        }
        state[chatId] = true;
        saveAntibotState(state);
        await sock.sendMessage(chatId, {
            text: '✅ *Antibot activé !*\n\n🛡️ Aucun autre bot ne pourra répondre dans ce groupe.'
        }, { quoted: message });
    } else if (action === 'off') {
        if (!state[chatId]) {
            await sock.sendMessage(chatId, { text: '⚠️ L\'antibot est déjà désactivé dans ce groupe.' }, { quoted: message });
            return;
        }
        state[chatId] = false;
        saveAntibotState(state);
        await sock.sendMessage(chatId, {
            text: '❌ *Antibot désactivé !*\n\n🔓 Les autres bots peuvent maintenant répondre dans ce groupe.'
        }, { quoted: message });
    } else {
        await sock.sendMessage(chatId, { text: '❌ Option invalide. Utilisez : .antibot on/off' }, { quoted: message });
    }
}

module.exports = { antibotCommand, isAntibotEnabled };
