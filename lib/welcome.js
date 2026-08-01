'use strict';

const { addWelcome, delWelcome, isWelcomeOn, addGoodbye, delGoodBye, isGoodByeOn } = require('../lib/index');

// ─── Gestion de la commande .welcome ─────────────────────────────────────────
async function handleWelcome(sock, chatId, message, match) {
    if (!match) {
        return sock.sendMessage(chatId, {
            text:
                `📥 *Configuration du Welcome*\n\n` +
                `✅ *.welcome on* — Activer les messages de bienvenue\n` +
                `🛠️ *.welcome set <message>* — Personnaliser le message\n` +
                `🚫 *.welcome off* — Désactiver les messages de bienvenue\n\n` +
                `*Variables disponibles :*\n` +
                `• {user} — Mentionne le nouveau membre\n` +
                `• {group} — Nom du groupe\n` +
                `• {description} — Description du groupe`
        }, { quoted: message });
    }

    const [command, ...args] = match.split(' ');
    const lowerCommand = command.toLowerCase();
    const customMessage = args.join(' ');

    if (lowerCommand === 'on') {
        if (await isWelcomeOn(chatId)) {
            return sock.sendMessage(chatId, {
                text: '⚠️ Les messages de bienvenue sont *déjà activés*.'
            }, { quoted: message });
        }
        await addWelcome(chatId, true, 'Bienvenue {user} dans *{group}* ! 🎉');
        return sock.sendMessage(chatId, {
            text: '✅ Messages de bienvenue *activés*. Utilisez *.welcome set [message]* pour personnaliser.'
        }, { quoted: message });
    }

    if (lowerCommand === 'off') {
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

    if (lowerCommand === 'set') {
        if (!customMessage) {
            return sock.sendMessage(chatId, {
                text: '⚠️ Veuillez fournir un message. Ex : *.welcome set Bienvenue dans le groupe !*'
            }, { quoted: message });
        }
        await addWelcome(chatId, true, customMessage);
        return sock.sendMessage(chatId, {
            text: `✅ Message de bienvenue *enregistré* :\n\n_${customMessage}_`
        }, { quoted: message });
    }

    return sock.sendMessage(chatId, {
        text: `❌ Commande invalide.\n*.welcome on* — Activer\n*.welcome set [message]* — Personnaliser\n*.welcome off* — Désactiver`
    }, { quoted: message });
}

// ─── Gestion de la commande .goodbye ─────────────────────────────────────────
async function handleGoodbye(sock, chatId, message, match) {
    if (!match) {
        return sock.sendMessage(chatId, {
            text:
                `📤 *Configuration du Goodbye*\n\n` +
                `✅ *.goodbye on* — Activer les messages de départ\n` +
                `🛠️ *.goodbye set <message>* — Personnaliser le message\n` +
                `🚫 *.goodbye off* — Désactiver les messages de départ\n\n` +
                `*Variables disponibles :*\n` +
                `• {user} — Mentionne le membre parti\n` +
                `• {group} — Nom du groupe`
        }, { quoted: message });
    }

    const [command, ...args] = match.split(' ');
    const lowerCommand = command.toLowerCase();
    const customMessage = args.join(' ');

    if (lowerCommand === 'on') {
        if (await isGoodByeOn(chatId)) {
            return sock.sendMessage(chatId, {
                text: '⚠️ Les messages de départ sont *déjà activés*.'
            }, { quoted: message });
        }
        await addGoodbye(chatId, true, 'Au revoir {user} 👋');
        return sock.sendMessage(chatId, {
            text: '✅ Messages de départ *activés*. Utilisez *.goodbye set [message]* pour personnaliser.'
        }, { quoted: message });
    }

    if (lowerCommand === 'off') {
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

    if (lowerCommand === 'set') {
        if (!customMessage) {
            return sock.sendMessage(chatId, {
                text: '⚠️ Veuillez fournir un message. Ex : *.goodbye set Au revoir !*'
            }, { quoted: message });
        }
        await addGoodbye(chatId, true, customMessage);
        return sock.sendMessage(chatId, {
            text: `✅ Message de départ *enregistré* :\n\n_${customMessage}_`
        }, { quoted: message });
    }

    return sock.sendMessage(chatId, {
        text: `❌ Commande invalide.\n*.goodbye on* — Activer\n*.goodbye set [message]* — Personnaliser\n*.goodbye off* — Désactiver`
    }, { quoted: message });
}

module.exports = { handleWelcome, handleGoodbye };
