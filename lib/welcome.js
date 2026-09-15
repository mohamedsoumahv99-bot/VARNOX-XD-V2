'use strict';

const { addWelcome, delWelcome, isWelcomeOn, addGoodbye, delGoodBye, isGoodByeOn } = require('../lib/index');

const DEFAULT_WELCOME = 'Bienvenue {user} dans *{group}* ! 🎉';
const DEFAULT_GOODBYE = 'Au revoir {user} 👋';

function actionFrom(match) {
    return String(match || '').trim().split(/\s+/)[0].toLowerCase();
}

function welcomeHelp() {
    return '📥 *Configuration du Welcome*\n\n' +
        '✅ *.welcome on* — Activer les messages de bienvenue\n' +
        '🚫 *.welcome off* — Désactiver les messages de bienvenue';
}

function goodbyeHelp() {
    return '📤 *Configuration du Goodbye*\n\n' +
        '✅ *.goodbye on* — Activer les messages de départ\n' +
        '🚫 *.goodbye off* — Désactiver les messages de départ';
}

async function handleWelcome(sock, chatId, message, match) {
    const action = actionFrom(match);
    if (!action) {
        return sock.sendMessage(chatId, { text: welcomeHelp() }, { quoted: message });
    }

    if (action === 'on') {
        if (await isWelcomeOn(chatId)) {
            return sock.sendMessage(chatId, {
                text: '⚠️ Les messages de bienvenue sont *déjà activés*.'
            }, { quoted: message });
        }
        await addWelcome(chatId, true, DEFAULT_WELCOME);
        return sock.sendMessage(chatId, {
            text: '✅ Messages de bienvenue *activés* avec le format VARNOX.'
        }, { quoted: message });
    }

    if (action === 'off') {
        if (!(await isWelcomeOn(chatId))) {
            return sock.sendMessage(chatId, {
                text: '⚠️ Les messages de bienvenue sont *déjà désactivés*.'
            }, { quoted: message });
        }
        await delWelcome(chatId);
        return sock.sendMessage(chatId, {
            text: '✅ Messages de bienvenue *désactivés* pour ce groupe.'
        }, { quoted: message });
    }

    return sock.sendMessage(chatId, {
        text: '❌ Option invalide. Utilisez *.welcome on* ou *.welcome off*.'
    }, { quoted: message });
}

async function handleGoodbye(sock, chatId, message, match) {
    const action = actionFrom(match);
    if (!action) {
        return sock.sendMessage(chatId, { text: goodbyeHelp() }, { quoted: message });
    }

    if (action === 'on') {
        if (await isGoodByeOn(chatId)) {
            return sock.sendMessage(chatId, {
                text: '⚠️ Les messages de départ sont *déjà activés*.'
            }, { quoted: message });
        }
        await addGoodbye(chatId, true, DEFAULT_GOODBYE);
        return sock.sendMessage(chatId, {
            text: '✅ Messages de départ *activés* avec le format VARNOX.'
        }, { quoted: message });
    }

    if (action === 'off') {
        if (!(await isGoodByeOn(chatId))) {
            return sock.sendMessage(chatId, {
                text: '⚠️ Les messages de départ sont *déjà désactivés*.'
            }, { quoted: message });
        }
        await delGoodBye(chatId);
        return sock.sendMessage(chatId, {
            text: '✅ Messages de départ *désactivés* pour ce groupe.'
        }, { quoted: message });
    }

    return sock.sendMessage(chatId, {
        text: '❌ Option invalide. Utilisez *.goodbye on* ou *.goodbye off*.'
    }, { quoted: message });
}

module.exports = { handleWelcome, handleGoodbye };
