'use strict';

/**
 * Normalize a bind address supplied through HOST.
 *
 * Brackets are URL notation for IPv6 literals (for example, [::]); Node's
 * server.listen() expects the address without those brackets. Use IPv4
 * wildcard binding for an unspecified IPv6 host so Railway's IPv4 health
 * checks can reach the server.
 */
function normalizeListenHost(value) {
  let host = String(value || '').trim();

  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1).trim();
  }

  if (!host || host === '::' || host === '0:0:0:0:0:0:0:0') {
    return '0.0.0.0';
  }

  return host;
}

module.exports = { normalizeListenHost };
