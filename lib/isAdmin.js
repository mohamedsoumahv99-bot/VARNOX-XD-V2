const settings = require('../settings');

function identityVariants(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return [];

    const variants = new Set([raw]);
    const withoutDevice = raw.split(':')[0];
    variants.add(withoutDevice);
    variants.add(withoutDevice.split('@')[0].replace(/[^\d]/g, ''));
    return [...variants].filter(Boolean);
}

function participantVariants(participant) {
    return [
        participant?.id,
        participant?.jid,
        participant?.lid,
        participant?.phoneNumber,
        participant?.phone,
        participant?.userJid
    ].flatMap(identityVariants);
}

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

        const ownerVariants = identityVariants(settings.ownerNumber);
        const botVariants = [
            sock.user?.id,
            sock.user?.jid,
            sock.user?.lid,
            sock.user?.phoneNumber,
            sock.user?.phone
        ].flatMap(identityVariants);
        const senderVariants = identityVariants(senderId);

        const matches = (left, right) => left.some(value => right.includes(value));

        // Baileys peut exposer le téléphone, le JID d'appareil ou le LID
        // dans des champs différents selon la version et le type de groupe.
        const senderParticipant = participants.find(p =>
            matches(participantVariants(p), senderVariants)
        );
        const botParticipant = participants.find(p => {
            const variants = participantVariants(p);
            return matches(variants, botVariants);
        });

        const isSenderAdmin = senderParticipant
            ? (senderParticipant.admin === 'admin' || senderParticipant.admin === 'superadmin')
            : false;

        // Si le compte du bot n'apparaît pas avec son JID principal, le
        // numéro propriétaire reste un fallback fiable (Baileys peut exposer
        // un LID ou un JID d'appareil selon le groupe).
        const isBotAdmin = botParticipant
            ? (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin')
            : (matches(botVariants, ownerVariants) && Boolean(
                participants.some(participant =>
                    matches(participantVariants(participant), ownerVariants) &&
                    (participant.admin === 'admin' || participant.admin === 'superadmin')
                )
            ));

        return { isSenderAdmin, isBotAdmin };

    } catch (err) {
        console.error('❌ Error in isAdmin:', err);
        return { isSenderAdmin: false, isBotAdmin: false };
    }
}

module.exports = isAdmin;
