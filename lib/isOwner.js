const settings = require('../settings');
const { isSudo } = require('./index');

async function isOwnerOrSudo(senderId, sock = null, chatId = null) {
    const normalizeNumber = value => String(value || '')
        .split(':')[0]
        .split('@')[0]
        .replace(/[^\d]/g, '');
    const ownerNumberClean = normalizeNumber(settings.ownerNumber);
    const ownerJid = ownerNumberClean + "@s.whatsapp.net";

    // 1. Correspondance directe JID
    if (senderId === ownerJid) return true;

    // 2. Correspondance via numéro nettoyé
    const senderClean = normalizeNumber(senderId);
    if (senderClean === ownerNumberClean) return true;

    // 3. Le numéro du propriétaire est contenu dans le senderId
    if (senderId.includes(ownerNumberClean)) return true;

    // 4. Dans les groupes : gestion du LID WhatsApp
    if (sock && chatId && chatId.endsWith('@g.us')) {
        try {
            const metadata = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];

            for (const p of participants) {
                const pId = normalizeNumber(p.id);
                const pLid = normalizeNumber(p.lid);

                // Si ce participant est le propriétaire (par numéro)
                if (pId === ownerNumberClean) {
                    // Vérifier si le senderId correspond à ce participant
                    const senderLid = normalizeNumber(senderId);
                    if (
                        p.id === senderId ||
                        p.lid === senderId ||
                        pLid === senderLid ||
                        pId === senderClean
                    ) {
                        return true;
                    }
                }
            }
        } catch (e) {
            console.error('❌ [isOwner] Erreur groupMetadata:', e.message);
        }
    }

    // 5. Vérification sudo
    try {
        return await isSudo(senderId);
    } catch (e) {
        return false;
    }
}

module.exports = isOwnerOrSudo;
