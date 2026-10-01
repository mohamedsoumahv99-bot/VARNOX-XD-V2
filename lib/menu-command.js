'use strict';

const PLAIN_MENU_PATTERN = /^(?:menu|help)(?:\s+(.+))?$/;
const PREFIXED_MENU_PATTERN = /^\.(menu|help)(?:\s+(.+))?$/;

/**
 * Parse menu aliases after the active chat prefix has been normalized to ".".
 * Bare menu/help aliases are supported separately so an inactive prefix such
 * as "." cannot accidentally become a command when a chat uses another prefix.
 */
function parseMenuCommand(text, { prefixed = false } = {}) {
  const value = String(text || '').trim().toLowerCase();

  if (prefixed) {
    if (value === '.allmenu' || value === '.list') return { query: 'allmenu' };
    if (value === '.bot') return { query: '' };
    const match = value.match(PREFIXED_MENU_PATTERN);
    return match ? { query: match[2] || '' } : null;
  }

  if (value === 'allmenu') return { query: 'allmenu' };
  const match = value.match(PLAIN_MENU_PATTERN);
  return match ? { query: match[1] || '' } : null;
}

module.exports = { parseMenuCommand };