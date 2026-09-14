'use strict';

function messageText(message) {
    return (
        message?.message?.conversation ||
        message?.message?.extendedTextMessage?.text ||
        message?.message?.imageMessage?.caption ||
        message?.message?.videoMessage?.caption ||
        ''
    ).trim();
}

function commandInput(message) {
    const text = messageText(message);
    return text.replace(/^\S+\s*/, '').trim();
}

function safeFileName(value, fallback = 'download') {
    const name = String(value || fallback)
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/[^\p{L}\p{N}._ -]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 96);
    return name || fallback;
}

function isHttpUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

module.exports = {
    commandInput,
    isHttpUrl,
    messageText,
    safeFileName
};