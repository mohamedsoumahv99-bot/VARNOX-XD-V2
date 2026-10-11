'use strict';

class PairingRequestRegistry {
  constructor() {
    this.requests = new Map();
  }

  get size() {
    return this.requests.size;
  }

  get inFlight() {
    return this.requests.size;
  }

  begin(key) {
    const normalizedKey = String(key);
    const current = this.requests.get(normalizedKey);
    if (current) {
      return { owner: false, promise: current.promise };
    }

    let resolve;
    const entry = {
      promise: new Promise(done => { resolve = done; }),
      settled: false,
    };
    this.requests.set(normalizedKey, entry);

    return {
      owner: true,
      promise: entry.promise,
      complete: result => {
        if (entry.settled) return false;
        entry.settled = true;
        if (this.requests.get(normalizedKey) === entry) {
          this.requests.delete(normalizedKey);
        }
        resolve(result);
        return true;
      },
    };
  }
}

module.exports = PairingRequestRegistry;
