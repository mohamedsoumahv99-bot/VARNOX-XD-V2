const fs = require('fs');

function readJsonSafe(path, fallback) {
    try {
        const txt = fs.readFileSync(path, 'utf8');
        return JSON.parse(txt);
    } catch (_) {
        return fallback;
    }
}

const settings = require('../settings');
const { getSessionSettings, setCommandEnabled } = require('../lib/sessionSettings');

async function settingsCommand(sock, chatId, message, args = '') {
    try {
        const ownerNumber = String(settings.ownerNumber || '').replace(/\D/g, '');
        const senderIds = [message.key.participant, message.key.participantAlt, message.key.remoteJid].filter(Boolean);
        const botNumber = String(sock.user?.id || '').split(':')[0].split('@')[0].replace(/\D/g, '');
        const isOwner = senderIds.some(value => String(value).split('@')[0].split(':')[0].replace(/\D/g, '') === ownerNumber)
            || (message.key.fromMe && botNumber === ownerNumber);
        if (!isOwner) {
            await sock.sendMessage(chatId, { text: 'Seul le numéro propriétaire configuré peut utiliser cette commande.' }, { quoted: message });
            return;
        }

        const sessionNumber = botNumber || ownerNumber;
        const settingArgs = String(args || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (settingArgs[0] === 'on' || settingArgs[0] === 'off') {
            const command = settingArgs[1] || '';
            if (!/^[a-z0-9_-]{2,32}$/.test(command)) {
                await sock.sendMessage(chatId, { text: 'Usage : .settings on|off <commande>\nExemple : .settings off chatbot' }, { quoted: message });
                return;
            }
            const enabled = settingArgs[0] === 'on';
            setCommandEnabled(sessionNumber, command, enabled);
            await sock.sendMessage(chatId, { text: '✅ .' + command + (enabled ? ' est activée' : ' est désactivée') + ' pour la session ' + sessionNumber + '.' }, { quoted: message });
            return;
        }
        if (settingArgs[0] === 'reset') {
            const currentSettings = getSessionSettings(sessionNumber);
            for (const command of currentSettings.disabledCommands) setCommandEnabled(sessionNumber, command, true);
            await sock.sendMessage(chatId, { text: '✅ Les restrictions de la session ' + sessionNumber + ' ont été réinitialisées.' }, { quoted: message });
            return;
        }

        const isGroup = chatId.endsWith('@g.us');
        const dataDir = './data';

        const mode = readJsonSafe(`${dataDir}/messageCount.json`, { isPublic: true });
        const autoStatus = readJsonSafe(`${dataDir}/autoStatus.json`, { activé: false });
        const autoread = readJsonSafe(`${dataDir}/autoread.json`, { activé: false });
        const autotyping = readJsonSafe(`${dataDir}/autotyping.json`, { activé: false });
        const pmblocker = readJsonSafe(`${dataDir}/pmblocker.json`, { activé: false });
        const anticall = readJsonSafe(`${dataDir}/anticall.json`, { activé: false });
        const userGroupData = readJsonSafe(`${dataDir}/userGroupData.json`, {
            antilink: {}, antibadword: {}, welcome: {}, goodbye: {}, chatbot: {}, antitag: {}
        });
        const autoReaction = Boolean(userGroupData.autoReaction);

        // Per-group features
        const groupId = isGroup ? chatId : null;
        const antilinkOn = groupId ? Boolean(userGroupData.antilink && userGroupData.antilink[groupId]) : false;
        const antibadwordOn = groupId ? Boolean(userGroupData.antibadword && userGroupData.antibadword[groupId]) : false;
        const welcomeOn = groupId ? Boolean(userGroupData.welcome && userGroupData.welcome[groupId]) : false;
        const goodbyeOn = groupId ? Boolean(userGroupData.goodbye && userGroupData.goodbye[groupId]) : false;
        const chatbotOn = groupId ? Boolean(userGroupData.chatbot && userGroupData.chatbot[groupId]) : false;
        const antitagCfg = groupId ? (userGroupData.antitag && userGroupData.antitag[groupId]) : null;

        const lines = [];
        lines.push('*BOT SETTINGS*');
        lines.push('');
        lines.push(`• Mode: ${mode.isPublic ? 'Public' : 'Private'}`);
        lines.push(`• Auto Status: ${autoStatus.activé ? 'ON' : 'OFF'}`);
        lines.push(`• Autoread: ${autoread.activé ? 'ON' : 'OFF'}`);
        lines.push(`• Autotyping: ${autotyping.activé ? 'ON' : 'OFF'}`);
        lines.push(`• PM Blocker: ${pmblocker.activé ? 'ON' : 'OFF'}`);
        lines.push(`• Anticall: ${anticall.activé ? 'ON' : 'OFF'}`);
        lines.push(`• Auto Reaction: ${autoReaction ? 'ON' : 'OFF'}`);
        const sessionSettings = getSessionSettings(sessionNumber);
        lines.push(`• Session: ${sessionNumber}`);
        lines.push(`• Commandes désactivées: ${sessionSettings.disabledCommands.length ? sessionSettings.disabledCommands.map(command => '.' + command).join(', ') : 'aucune'}`);
        lines.push('• Modifier: .settings off <commande> / .settings on <commande>');
        if (groupId) {
            lines.push('');
            lines.push(`Group: ${groupId}`);
            if (antilinkOn) {
                const al = userGroupData.antilink[groupId];
                lines.push(`• Antilink: ON (action: ${al.action || 'delete'})`);
            } else {
                lines.push('• Antilink: OFF');
            }
            if (antibadwordOn) {
                const ab = userGroupData.antibadword[groupId];
                lines.push(`• Antibadword: ON (action: ${ab.action || 'delete'})`);
            } else {
                lines.push('• Antibadword: OFF');
            }
            lines.push(`• Welcome: ${welcomeOn ? 'ON' : 'OFF'}`);
            lines.push(`• Goodbye: ${goodbyeOn ? 'ON' : 'OFF'}`);
            lines.push(`• Chatbot: ${chatbotOn ? 'ON' : 'OFF'}`);
            if (antitagCfg && antitagCfg.activé) {
                lines.push(`• Antitag: ON (action: ${antitagCfg.action || 'delete'})`);
            } else {
                lines.push('• Antitag: OFF');
            }
        } else {
            lines.push('');
            lines.push('Note: Per-group settings will be shown when used inside a group.');
        }

        await sock.sendMessage(chatId, { text: lines.join('\n') }, { quoted: message });
    } catch (error) {
        console.error('Error in settings command:', error);
        await sock.sendMessage(chatId, { text: 'Failed to read settings.' }, { quoted: message });
    }
}

module.exports = settingsCommand;


