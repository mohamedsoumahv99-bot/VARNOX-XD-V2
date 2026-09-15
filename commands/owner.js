const settings = require('../settings');

async function ownerCommand(sock, chatId, message) {
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${settings.botOwner}\nTEL;waid=${settings.ownerNumber}:${settings.ownerNumber}\nEND:VCARD`;

    try {
        // .owner sends only the WhatsApp contact card, matching the reference image.
        await sock.sendMessage(chatId, {
            contacts: { displayName: settings.botOwner, contacts: [{ vcard }] }
        });
    } catch (error) {
        console.error('Error in owner command:', error);
    }
}

module.exports = ownerCommand;
