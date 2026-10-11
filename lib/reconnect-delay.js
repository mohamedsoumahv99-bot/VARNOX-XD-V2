'use strict';

function calculateReconnectDelay(attempt, random = Math.random) {
  const normalizedAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
  const backoff = Math.min(60_000, 1_000 * (2 ** Math.min(normalizedAttempt - 1, 6)));
  const jitterRange = Math.min(2_000, Math.max(250, backoff * 0.2));
  return backoff + Math.floor(random() * jitterRange);
}

module.exports = calculateReconnectDelay;
