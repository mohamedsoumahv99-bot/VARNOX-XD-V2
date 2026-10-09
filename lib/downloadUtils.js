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

function normalizeYouTubeUrl(value) {
    if (!isHttpUrl(value)) return null;

    try {
        const url = new URL(String(value).trim());
        const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
        let videoId = '';

        if (host === 'youtu.be') {
            videoId = url.pathname.split('/').filter(Boolean)[0] || '';
        } else if (host === 'youtube.com' || host === 'music.youtube.com') {
            videoId = url.searchParams.get('v') || '';
            if (!videoId) {
                const [, route, routeId] = url.pathname.match(/^\/(shorts|embed|live|v)\/([^/]+)/i) || [];
                if (route && routeId) videoId = routeId;
            }
        }

        if (!/^[\w-]{11}$/.test(videoId)) return null;
        return `https://www.youtube.com/watch?v=${videoId}`;
    } catch {
        return null;
    }
}

module.exports = {
    commandInput,
    isHttpUrl,
    normalizeYouTubeUrl,
    messageText,
    safeFileName
};