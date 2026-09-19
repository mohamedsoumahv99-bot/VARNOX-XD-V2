'use strict';

const fs = require('fs');
const path = require('path');

const PREFIX_FILE = path.join(__dirname, '../data/prefixes.json');
const FALLBACK_PREFIX = '.';

function normalizePrefix(value) {
    const prefix = String(value || '').trim();
    if (!prefix || /\s/.test(prefix)) return null;
    const codePoints = Array.from(prefix);
    if (codePoints.length > 3) return null;
    if (/^[a-z0-9]+$/i.test(prefix)) return null;
    return prefix;
}

const DEFAULT_PREFIX = normalizePrefix(process.env.PREFIX) || FALLBACK_PREFIX;

function ensureFile() {
    const dir = path.dirname(PREFIX_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(PREFIX_FILE)) {
        fs.writeFileSync(PREFIX_FILE, JSON.stringify({ default: DEFAULT_PREFIX, scopes: {} }, null, 2));
    }
}

function readStore() {
    ensureFile();
    try {
        const value = JSON.parse(fs.readFileSync(PREFIX_FILE, 'utf8'));
        return {
            default: normalizePrefix(value.default) || DEFAULT_PREFIX,
            scopes: Object.fromEntries(Object.entries(value.scopes && typeof value.scopes === 'object' ? value.scopes : {}).filter(([scope, prefix]) => scope && normalizePrefix(prefix)).map(([scope, prefix]) => [scope, normalizePrefix(prefix)]))
        };
    } catch {
        return { default: DEFAULT_PREFIX, scopes: {} };
    }
}

function writeStore(value) {
    ensureFile();
    const temp = `${PREFIX_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2));
    fs.renameSync(temp, PREFIX_FILE);
}

function getPrefix(scopeId = '') {
    const store = readStore();
    return store.scopes[scopeId] || store.default || '.';
}

function setPrefix(scopeId, value) {
    const prefix = normalizePrefix(value);
    if (!prefix) {
        throw new Error('Le préfixe doit contenir 1 à 3 caractères sans espace et ne peut pas être un mot.');
    }
    const store = readStore();
    if (scopeId) store.scopes[scopeId] = prefix;
    else store.default = prefix;
    writeStore(store);
    return prefix;
}

/**
 * Convertit uniquement une commande qui commence par le préfixe actif
 * vers le format interne historique ".".
 *
 * Important : "." n'est pas un préfixe de secours. Dès qu'un autre
 * préfixe est configuré, les commandes commençant par "." sont ignorées.
 */
function normalizeCommandText(text, prefix = FALLBACK_PREFIX) {
    const value = String(text || '').trim();
    const activePrefix = normalizePrefix(prefix) || FALLBACK_PREFIX;
    if (!value) return '';
    if (!value.startsWith(activePrefix)) return value.toLowerCase();
    return `.${value.slice(activePrefix.length)}`.toLowerCase();
}

module.exports = {
    DEFAULT_PREFIX,
    getPrefix,
    setPrefix,
    normalizePrefix,
    normalizeCommandText
};