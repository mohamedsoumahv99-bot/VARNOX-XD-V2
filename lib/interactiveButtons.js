'use strict';

const {
    generateWAMessageFromContent,
    prepareWAMessageMedia,
    proto
} = require('@whiskeysockets/baileys');

/*
 * WhatsApp native-flow buttons.
 * templateButtons is not rendered consistently by Baileys 7 / newer clients;
 * nativeFlowMessage is the format used by the current WhatsApp clients.
 */
async function sendInteractiveMessage(sock, chatId, options = {}) {
    const {
        body = '',
        footer = '',
        title = '',
        image = null,
        buttons = [],
        contextInfo = {},
        quoted
    } = options;

    const header = {
        title: String(title || ''),
        hasMediaAttachment: Boolean(image)
    };

    if (image) {
        if (typeof sock.waUploadToServer !== 'function') {
            throw new Error('Le téléchargement WhatsApp des médias est indisponible.');
        }
        const media = await prepareWAMessageMedia(
            { image },
            { upload: sock.waUploadToServer.bind(sock) }
        );
        header.imageMessage = media.imageMessage;
    }

    const nativeButtons = buttons
        .filter(button => button && button.name)
        .map(button => ({
            name: String(button.name),
            buttonParamsJson: JSON.stringify(button.params || {})
        }));

    const interactiveMessage = proto.Message.InteractiveMessage.create({
        body: proto.Message.InteractiveMessage.Body.create({
            text: String(body || '')
        }),
        footer: proto.Message.InteractiveMessage.Footer.create({
            text: String(footer || '')
        }),
        header: proto.Message.InteractiveMessage.Header.create(header),
        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
            buttons: nativeButtons,
            // WhatsApp clients reject the flow when this field is omitted or
            // sent as a string.
            messageVersion: 1
        }),
        contextInfo
    });

    const generated = generateWAMessageFromContent(
        chatId,
        {
            viewOnceMessage: {
                message: { interactiveMessage }
            }
        },
        {
            quoted,
            userJid: sock.user?.id
        }
    );

    await sock.relayMessage(chatId, generated.message, {
        messageId: generated.key.id
    });
    return generated;
}

module.exports = { sendInteractiveMessage };
