'use strict';
const {groupAntiCommand} = require('./groupanti');
module.exports = async function antifloodCommand(sock, chatId, message, args, isSenderAdmin) { return groupAntiCommand(sock, chatId, message, args, 'antiflood', isSenderAdmin); };
