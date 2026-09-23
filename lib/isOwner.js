const settings = require('../settings');
const { isSudo } = require('./index');

function normalizeNumber(value) {
    return String(value || '')
        .split(':')[0]
        .split('@')[0]
        .replace(/[^\d]/g, '');
}

function candidatesFrom(senderId) {
    return (Array.isArray(senderId) ? senderId : [senderId])
        .filter(Boolean)
        .flatMap(value => [value, value?.id, value?.jid, value?.phoneNumber, value?.phone])
        .filter(Boolean)
        .map(String);
}

function matchesOwner(candidate, ownerNumberClean) {
    const value = String(candidate || '');
    const clean = normalizeNumber(value);
    return value === `${ownerNumberClean}@s.whatsapp.net` ||
        clean === ownerNumberClean;
}

async function isPrimaryOwner(senderId, sock = null, chatId = null) {
    const ownerNumberClean = '224669288332';
    const candidates = candidatesFrom(senderId);

    // WhatsApp peut fournir le numéro, le JID ou un LID selon le type
    // de discussion. Les JID alternatifs sont passés par main.js.
    if (candidates.some(candidate => matchesOwner(candidate, ownerNumberClean))) {
        return true;
    }

    // Dans les groupes, faire correspondre un LID au participant dont le
    // numéro est le propriétaire configuré.
    if (sock && chatId && chatId.endsWith('@g.us')) {
        try {
            const metadata = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];

            for (const p of participants) {
                const participantIds = [
                    p.id,
                    p.lid,
                    p.jid,
                    p.phoneNumber,
                    p.phone,
                    p.userJid
                ].map(normalizeNumber).filter(Boolean);

                if (participantIds.includes(ownerNumberClean)) {
                    if (candidates.some(candidate => participantIds.includes(normalizeNumber(candidate)))) {
                        return true;
                    }
                }
            }
        } catch (e) {
            console.error('❌ [isOwner] Erreur groupMetadata:', e.message);
        }
    }
    return false;
}

async function isOwnerOrSudo(senderId, sock = null, chatId = null) {
    if (await isPrimaryOwner(senderId, sock, chatId)) return true;
    try {
        for (const candidate of candidatesFrom(senderId)) {
            if (await isSudo(candidate)) return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

module.exports = isOwnerOrSudo;
module.exports.isPrimaryOwner = isPrimaryOwner;
