'use strict';
const {groupAntiCommand} = require('./groupanti');
module.exports = async function antivoiceCommand(sock, chatId, message, args, isSenderAdmin) { return groupAntiCommand(sock, chatId, message, args, 'antivoice', isSenderAdmin); };
