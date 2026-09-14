'use strict';
const {groupAntiCommand} = require('./groupanti');
module.exports = async function antimediaCommand(sock, chatId, message, args, isSenderAdmin) { return groupAntiCommand(sock, chatId, message, args, 'antimedia', isSenderAdmin); };
