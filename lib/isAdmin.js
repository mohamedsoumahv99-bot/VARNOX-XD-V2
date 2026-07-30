const settings = require('../settings');

async function isAdmin(sock, chatId, senderId) {
    try {
        if (!chatId.endsWith('@g.us')) {
            return { isSenderAdmin: false, isBotAdmin: false };
        }

        const groupMetadata = await sock.groupMetadata(chatId);
        if (!groupMetadata || !groupMetadata.participants) {
            return { isSenderAdmin: false, isBotAdmin: false };
        }

        const participants = groupMetadata.participants;

        // Nettoyer les IDs
        const botRawId = sock.user?.id || '';
        const botNumeric = botRawId.split(':')[0].split('@')[0];
        const botLidRaw = sock.user?.lid || '';
        const botLidNumeric = botLidRaw.split(':')[0].split('@')[0];
        const ownerNumeric = (settings.ownerNumber || '').split(':')[0].split('@')[0];

        const senderNumeric = senderId.split(':')[0].split('@')[0];

        // Fonction pour vérifier si un participant correspond au bot
        function isBotParticipant(p) {
            const pId = (p.id || '').split(':')[0].split('@')[0];
            const pLid = (p.lid || '').split(':')[0].split('@')[0];
            return (
                pId === botNumeric ||
                pId === ownerNumeric ||
                (botLidNumeric && pLid === botLidNumeric)
            );
        }

        // Fonction pour vérifier si un participant correspond à l'expéditeur
        function isSenderParticipant(p) {
            const pId = (p.id || '').split(':')[0].split('@')[0];
            const pLid = (p.lid || '').split(':')[0].split('@')[0];
            return (
                p.id === senderId ||
                p.lid === senderId ||
                pId === senderNumeric ||
                pLid === senderNumeric
            );
        }

        const senderParticipant = participants.find(isSenderParticipant);
        const botParticipant = participants.find(isBotParticipant);

        const isSenderAdmin = senderParticipant
            ? (senderParticipant.admin === 'admin' || senderParticipant.admin === 'superadmin')
            : false;

        // Si le bot = owner = même numéro, le bot est admin si le sender est admin
        const isBotAdmin = botParticipant
            ? (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin')
            : (senderNumeric === ownerNumeric && isSenderAdmin); // fallback si même compte

        return { isSenderAdmin, isBotAdmin };

    } catch (err) {
        console.error('❌ Error in isAdmin:', err);
        return { isSenderAdmin: false, isBotAdmin: false };
    }
}

module.exports = isAdmin;
