const settings = require('../settings');
const { isSudo } = require('./index');

async function isOwnerOrSudo(senderId, sock = null, chatId = null) {
    const ownerNumberClean = settings.ownerNumber.split(':')[0].split('@')[0].trim();
    const ownerJid = ownerNumberClean + "@s.whatsapp.net";

    // 1. Correspondance directe JID
    if (senderId === ownerJid) return true;

    // 2. Correspondance via numéro nettoyé
    const senderClean = senderId.split(':')[0].split('@')[0];
    if (senderClean === ownerNumberClean) return true;

    // 3. Le numéro du propriétaire est contenu dans le senderId
    if (senderId.includes(ownerNumberClean)) return true;

    // 4. Dans les groupes : gestion du LID WhatsApp
    if (sock && chatId && chatId.endsWith('@g.us')) {
        try {
            const metadata = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];

            for (const p of participants) {
                const pId = (p.id || '').split(':')[0].split('@')[0];
                const pLid = (p.lid || '').split(':')[0].split('@')[0];

                // Si ce participant est le propriétaire (par numéro)
                if (pId === ownerNumberClean) {
                    // Vérifier si le senderId correspond à ce participant
                    const senderLid = senderId.split(':')[0].split('@')[0];
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
