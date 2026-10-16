'use strict';

const fetch = require('node-fetch');

const CHANNEL_JID = '120363424782348922@newsletter';
const CHANNEL_NAME = '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2';

function channelInfo() {
    return {
        contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: CHANNEL_JID,
                newsletterName: CHANNEL_NAME,
                serverMessageId: -1
            }
        }
    };
}

function normalizeJid(value) {
    return String(value || '').split(':')[0].split('@')[0].replace(/\D/g, '');
}

function participantJid(participant) {
    const value = typeof participant === 'string'
        ? participant
        : (participant?.phoneNumber || participant?.pn || participant?.jid || participant?.id);
    if (!value) return '';
    const jid = String(value).split(':')[0];
    if (jid.includes('@')) return jid;
    const number = jid.replace(/\D/g, '');
    return number ? number + '@s.whatsapp.net' : '';
}

function participantNumber(participant) {
    const value = typeof participant === 'string'
        ? participant
        : (participant?.phoneNumber || participant?.pn || participant?.jid || participant?.id);
    return normalizeJid(value);
}

function participantKeys(participant) {
    const values = typeof participant === 'string'
        ? [participant]
        : [participant?.phoneNumber, participant?.pn, participant?.id, participant?.jid];
    return [...new Set(values.map(normalizeJid).filter(Boolean))];
}

function ordinal(number) {
    const value = Number(number) || 0;
    const lastTwo = value % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return String(value) + 'th';
    switch (value % 10) {
        case 1: return String(value) + 'st';
        case 2: return String(value) + 'nd';
        case 3: return String(value) + 'rd';
        default: return String(value) + 'th';
    }
}

function memberCountAfterChange(participants, changedParticipants, action) {
    const list = Array.isArray(participants) ? participants : [];
    const changed = Array.isArray(changedParticipants) ? changedParticipants : [changedParticipants];
    const currentKeys = new Set(list.flatMap(participantKeys));
    const seenKeys = new Set();
    let count = list.length;
    for (const participant of changed) {
        const keys = participantKeys(participant);
        if (!keys.length || keys.some(key => seenKeys.has(key))) continue;
        for (const key of keys) seenKeys.add(key);
        const alreadyIncluded = keys.some(key => currentKeys.has(key));
        if (action === 'add' && !alreadyIncluded) count += 1;
        if (action === 'remove' && alreadyIncluded) count -= 1;
    }
    return Math.max(0, count);
}

function memberCountAfterLeave(participants, leavingJid) {
    return memberCountAfterChange(participants, leavingJid, 'remove');
}

async function getMemberCount(sock, groupId, changedParticipants, action, metadata) {
    const groupMetadata = metadata || await sock.groupMetadata(groupId);
    if (!Array.isArray(groupMetadata?.participants)) return null;
    return memberCountAfterChange(groupMetadata.participants, changedParticipants, action);
}

function formatConakryDate(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'indisponible';
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Conakry',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return values.year + '-' + values.month + '-' + values.day + ' ' +
        values.hour + ':' + values.minute + ':' + values.second;
}

function buildWelcomeMessage({ senderNum, groupName, memberCount, date = new Date() }) {
    return '*VARNOX-XD*\n' +
        '   *〔 NEW MEMBER 〕*\n' +
        '*▢  WELCOME* 🎉🎊\n' +
        '*▢ USER :* @' + (senderNum || 'inconnu') + '\n' +
        '*▢ GROUP :* ' + (groupName || 'Groupe') + '\n' +
        '*▢ DATE :* ' + formatConakryDate(date) + '\n' +
        '*▢ Members :* ' + (memberCount ?? 'indisponible') + '\n' +
        '*╰───────────────────⊷*\n\n' +
        '> powerde by vArnox_Tech';
}

function buildGoodbyeMessage({ senderNum, groupName, memberCount, date = new Date() }) {
    return '*VARNOX-XD*\n' +
        '   *〔 OLD  MEMBER 〕*\n' +
        '*▢  👋GOODBYE 👋*\n' +
        '*▢ USER :* @' + (senderNum || 'inconnu') + '\n' +
        '*▢ GROUP :* ' + (groupName || 'Groupe') + '\n' +
        '*▢ DATE :* ' + formatConakryDate(date) + '\n' +
        '*▢ Members :* ' + (memberCount ?? 'indisponible') + '\n' +
        '*╰───────────────────⊷*\n\n' +
        '> powered by vArnox_tech';
}

async function profilePhotoBuffer(sock, jid) {
    try {
        const url = await sock.profilePictureUrl(jid, 'image');
        if (!url) return null;
        const response = await fetch(url, { timeout: 10000 });
        if (response.ok) return await response.buffer();
    } catch (error) {
        console.warn('[member-event] profile photo unavailable: ' + error.message);
    }
    return null;
}

async function sendMemberEvent(sock, groupId, jid, caption) {
    const media = await profilePhotoBuffer(sock, jid);
    const payload = { mentions: [jid], ...channelInfo() };
    if (media) {
        try {
            await sock.sendMessage(groupId, { image: media, caption, ...payload });
            return;
        } catch (error) {
            console.warn('[member-event] photo send failed; sending caption only: ' + error.message);
        }
    }
    await sock.sendMessage(groupId, { text: caption, ...payload });
}

module.exports = {
    buildGoodbyeMessage,
    buildWelcomeMessage,
    channelInfo,
    formatConakryDate,
    getMemberCount,
    memberCountAfterChange,
    memberCountAfterLeave,
    ordinal,
    participantJid,
    participantNumber,
    sendMemberEvent
};
