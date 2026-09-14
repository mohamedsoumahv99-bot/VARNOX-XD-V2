'use strict';
const {groupAntiCommand} = require('./groupanti');
module.exports = async function antispamCommand(sock, chatId, message, args, isSenderAdmin) { return groupAntiCommand(sock, chatId, message, args, 'antispam', isSenderAdmin); };
