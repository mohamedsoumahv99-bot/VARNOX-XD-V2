'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeYouTubeUrl } = require('../lib/downloadUtils');

test('normalizes supported YouTube URLs to a canonical video URL', () => {
    const id = 'abcDEF_1234';
    for (const url of [
        `https://www.youtube.com/watch?v=${id}&feature=share`,
        `https://youtu.be/${id}?si=share`,
        `https://m.youtube.com/shorts/${id}`,
        `https://youtube.com/embed/${id}`
    ]) {
        assert.equal(normalizeYouTubeUrl(url), `https://www.youtube.com/watch?v=${id}`);
    }
});

test('rejects lookalike hosts, non-YouTube URLs, and malformed video ids', () => {
    for (const url of [
        'https://youtube.com.attacker.example/watch?v=abcDEF_1234',
        'https://example.com/youtube.com/watch?v=abcDEF_1234',
        'https://youtube.com/watch?v=too-short',
        'not a URL'
    ]) {
        assert.equal(normalizeYouTubeUrl(url), null);
    }
});
