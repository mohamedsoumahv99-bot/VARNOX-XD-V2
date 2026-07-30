const fs = require('fs');

const ANTICALL_PATH = './data/anticall.json';

function readState() {
    try {
        if (!fs.existsSync(ANTICALL_PATH)) return { activé: false };
        const raw = fs.readFileSync(ANTICALL_PATH, 'utf8');
        const data = JSON.parse(raw || '{}');
        return { activé: !!data.activé };
    } catch {
        return { activé: false };
    }
}

function writeState(activé) {
    try {
        if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
        fs.writeFileSync(ANTICALL_PATH, JSON.stringify({ activé: !!activé }, null, 2));
    } catch {}
}

async function anticallCommand(sock, chatId, message, args) {
    const state = readState();
    const sub = (args || '').trim().toLowerCase();

    if (!sub || (sub !== 'on' && sub !== 'off' && sub !== 'status')) {
        await sock.sendMessage(chatId, { text: '*ANTICALL*\n\n.anticall on  - Enable auto-block on incoming calls\n.anticall off - Disable anticall\n.anticall status - Show current status' }, { quoted: message });
        return;
    }

    if (sub === 'status') {
        await sock.sendMessage(chatId, { text: `Anticall is currently *${state.activé ? 'ON' : 'OFF'}*.` }, { quoted: message });
        return;
    }

    const enable = sub === 'on';
    writeState(enable);
    await sock.sendMessage(chatId, { text: `Anticall is now *${enable ? 'ENABLED' : 'DISABLED'}*.` }, { quoted: message });
}

module.exports = { anticallCommand, readState };


