'use strict';

function calculateReconnectDelay(attempt, random = Math.random) {
   const normalizedAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
   const backoff = Math.min(60000, 1000 * (2 ** Math.min(normalizedAttempt - 1, 6)));
   const jitterWindow = Math.min(2000, Math.max(250, backoff * 0.2));
   const sample = Number(random());
   const safeSample = Number.isFinite(sample) ? Math.max(0, Math.min(0.999999, sample)) : 0;
   return backoff + Math.floor(safeSample * jitterWindow);
}

module.exports = calculateReconnectDelay;
