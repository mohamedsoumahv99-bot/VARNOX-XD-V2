'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSION_STATUSES = new Set([
  'PAIRING',
  'CONNECTING',
  'CONNECTED',
  'RECONNECTING',
  'DISCONNECTED',
]);

class SessionCapacityError extends Error {
  constructor(message = 'Aucun worker ne peut accepter de session supplémentaire.') {
    super(message);
    this.name = 'SessionCapacityError';
    this.code = 'WORKERS_FULL';
    this.statusCode = 503;
  }
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizePhoneNumber(value) {
  const number = String(value == null ? '' : value).replace(/\D/g, '');
  return number.length >= 7 && number.length <= 15 ? number : null;
}

function maskPhoneNumber(value) {
  const number = String(value == null ? '' : value).replace(/\D/g, '');
  if (!number) return 'unknown';
  if (number.length <= 4) return `***${number}`;
  return `${number.slice(0, 2)}***${number.slice(-2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function logSessionEvent(event, session, extra = {}) {
  const record = session || {};
  const payload = {
    level: extra.level || 'info',
    component: 'session-manager',
    event,
    workerId: record.workerId || extra.workerId || null,
    sessionId: record.sessionId || extra.sessionId || null,
    phoneMasked: record.phoneMasked || maskPhoneNumber(record.phoneNumber || extra.phoneNumber),
    status: record.status || extra.status || null,
    reconnectAttempt: Number.isInteger(record.reconnectAttempts)
      ? record.reconnectAttempts
      : (extra.reconnectAttempt || 0),
    latencyMs: extra.latencyMs ?? null,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    at: nowIso(),
  };
  console.log(JSON.stringify(payload));
}

class SessionManager {
  constructor(options = {}) {
    this.registryFile = path.resolve(
      options.registryFile
        || process.env.SESSION_REGISTRY_FILE
        || path.join(process.env.SESSION_DIR || path.join(process.cwd(), 'sessions'), 'registry.json'),
    );
    this.workerMaxSessions = positiveInt(
      options.workerMaxSessions || process.env.WORKER_MAX_SESSIONS,
      100,
    );
    this.maxWorkers = positiveInt(options.maxWorkers || process.env.MAX_WORKERS, 1);
    this.workerId = String(options.workerId || process.env.WORKER_ID || 'worker-1');
    this.heartbeatTtlMs = positiveInt(
      options.heartbeatTtlMs || process.env.WORKER_HEARTBEAT_TTL_MS,
      30_000,
    );
    this.heartbeatIntervalMs = positiveInt(
      options.heartbeatIntervalMs || process.env.WORKER_HEARTBEAT_INTERVAL_MS,
      5_000,
    );
    this.persist = options.persist !== false;
    this.sessions = new Map();
    this.workers = new Map();
    this.ready = false;
    this.heartbeatTimer = null;
    this._initWorkers();
  }

  _initWorkers() {
    const configuredIds = String(process.env.WORKER_IDS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
    const ids = configuredIds.length
      ? configuredIds
      : Array.from({ length: this.maxWorkers }, (_, index) => `worker-${index + 1}`);
    if (!ids.includes(this.workerId)) ids[0] = this.workerId;
    for (const id of [...new Set(ids)]) this._ensureWorker(id);
  }

  _ensureWorker(workerId) {
    const id = String(workerId);
    if (!this.workers.has(id)) {
      this.workers.set(id, {
        workerId: id,
        status: 'ONLINE',
        heartbeatAt: Date.now(),
        sessionIds: new Set(),
      });
    }
    return this.workers.get(id);
  }

  _load() {
    if (!this.persist || !fs.existsSync(this.registryFile)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryFile, 'utf8'));
      const records = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
      for (const raw of records) {
        const phoneNumber = normalizePhoneNumber(raw.phoneNumber);
        const sessionId = String(raw.sessionId || '');
        if (!phoneNumber || !sessionId || this.sessions.has(sessionId)) continue;
        const record = this._normalizeRecord({
          ...raw,
          phoneNumber,
          sessionId,
          status: SESSION_STATUSES.has(raw.status) ? raw.status : 'DISCONNECTED',
          workerId: String(raw.workerId || this.workerId),
        });
        if ([...this.sessions.values()].some(item => item.phoneNumber === phoneNumber)) continue;
        this.sessions.set(sessionId, record);
        this._ensureWorker(record.workerId).sessionIds.add(sessionId);
      }
    } catch (error) {
      const backup = `${this.registryFile}.corrupt-${Date.now()}`;
      try { fs.renameSync(this.registryFile, backup); } catch {}
      console.warn(`[SESSION_MANAGER] Registry ignored (${error.message}); backup=${path.basename(backup)}`);
    }
  }

  _normalizeRecord(record) {
    return {
      sessionId: String(record.sessionId),
      phoneNumber: String(record.phoneNumber),
      phoneMasked: record.phoneMasked || maskPhoneNumber(record.phoneNumber),
      workerId: String(record.workerId),
      status: SESSION_STATUSES.has(record.status) ? record.status : 'DISCONNECTED',
      createdAt: record.createdAt || nowIso(),
      lastSeen: record.lastSeen || null,
      lastDisconnect: record.lastDisconnect || null,
      reconnectAttempts: Number.isInteger(record.reconnectAttempts) ? record.reconnectAttempts : 0,
      sessionDir: record.sessionDir ? path.resolve(record.sessionDir) : null,
    };
  }

  _serialize() {
    return {
      version: 1,
      updatedAt: nowIso(),
      sessions: this.listSessions(),
    };
  }

  _save() {
    if (!this.persist) return;
    fs.mkdirSync(path.dirname(this.registryFile), { recursive: true });
    const tempFile = `${this.registryFile}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(this._serialize(), null, 2), { mode: 0o600 });
    fs.renameSync(tempFile, this.registryFile);
  }

  init() {
    if (this.ready) return this;
    this._load();
    this.ready = true;
    this.heartbeat();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
    return this;
  }

  close() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.ready = false;
  }

  heartbeat() {
    const worker = this._ensureWorker(this.workerId);
    worker.status = 'ONLINE';
    worker.heartbeatAt = Date.now();
    return worker;
  }

  _refreshWorkerStatuses() {
    const cutoff = Date.now() - this.heartbeatTtlMs;
    for (const worker of this.workers.values()) {
      worker.status = worker.heartbeatAt >= cutoff ? 'ONLINE' : 'OFFLINE';
    }
  }

  _findWorker() {
    this._refreshWorkerStatuses();
    return [...this.workers.values()]
      .filter(worker => worker.status === 'ONLINE' && worker.sessionIds.size < this.workerMaxSessions)
      .sort((left, right) => (
        left.sessionIds.size - right.sessionIds.size
        || left.workerId.localeCompare(right.workerId)
      ))[0] || null;
  }

  _findByPhone(phoneNumber) {
    return [...this.sessions.values()].find(item => item.phoneNumber === phoneNumber) || null;
  }

  getByPhone(value) {
    const number = normalizePhoneNumber(value);
    return number ? this._findByPhone(number) : null;
  }

  getBySessionId(sessionId) {
    return this.sessions.get(String(sessionId)) || null;
  }

  reserveSession(value, options = {}) {
    const phoneNumber = normalizePhoneNumber(value);
    if (!phoneNumber) {
      const error = new Error('Numéro invalide (7–15 chiffres).');
      error.code = 'INVALID_PHONE';
      error.statusCode = 400;
      throw error;
    }
    const existing = this._findByPhone(phoneNumber);
    if (existing) return { session: existing, reused: true };
    const worker = this._findWorker();
    if (!worker) throw new SessionCapacityError();

    const session = this._normalizeRecord({
      sessionId: options.sessionId || `sess_${crypto.randomUUID()}`,
      phoneNumber,
      workerId: worker.workerId,
      status: options.status || 'PAIRING',
      sessionDir: options.sessionDir || null,
      createdAt: nowIso(),
      lastSeen: null,
      lastDisconnect: null,
      reconnectAttempts: 0,
    });
    this.sessions.set(session.sessionId, session);
    worker.sessionIds.add(session.sessionId);
    this._save();
    return { session, reused: false };
  }

  ensureSession(value, options = {}) {
    const existing = this.getByPhone(value);
    if (existing) {
      if (options.sessionDir && existing.sessionDir !== path.resolve(options.sessionDir)) {
        existing.sessionDir = path.resolve(options.sessionDir);
        this._save();
      }
      return { session: existing, reused: true };
    }
    return this.reserveSession(value, options);
  }

  updateSession(idOrPhone, patch = {}) {
    const session = this.getBySessionId(idOrPhone) || this.getByPhone(idOrPhone);
    if (!session) return null;
    if (patch.status && SESSION_STATUSES.has(patch.status)) session.status = patch.status;
    if (patch.sessionDir) session.sessionDir = path.resolve(patch.sessionDir);
    if (patch.lastSeen) session.lastSeen = patch.lastSeen;
    else if (session.status === 'CONNECTED') session.lastSeen = nowIso();
    if (Object.prototype.hasOwnProperty.call(patch, 'lastDisconnect')) {
      session.lastDisconnect = patch.lastDisconnect;
    }
    if (Number.isInteger(patch.reconnectAttempts)) {
      session.reconnectAttempts = patch.reconnectAttempts;
    }
    this._save();
    return session;
  }

  releaseSession(idOrPhone) {
    const session = this.getBySessionId(idOrPhone) || this.getByPhone(idOrPhone);
    if (!session) return false;
    this.sessions.delete(session.sessionId);
    const worker = this.workers.get(session.workerId);
    worker?.sessionIds.delete(session.sessionId);
    this._save();
    return true;
  }

  listSessions() {
    return [...this.sessions.values()].map(session => ({ ...session }));
  }

  listWorkers() {
    this._refreshWorkerStatuses();
    return [...this.workers.values()].map(worker => ({
      workerId: worker.workerId,
      status: worker.status,
      heartbeatAt: new Date(worker.heartbeatAt).toISOString(),
      sessions: worker.sessionIds.size,
      capacity: this.workerMaxSessions,
      available: Math.max(0, this.workerMaxSessions - worker.sessionIds.size),
    }));
  }

  summary() {
    const workers = this.listWorkers();
    return {
      workerId: this.workerId,
      workerMaxSessions: this.workerMaxSessions,
      maxWorkers: this.maxWorkers,
      totalCapacity: this.workerMaxSessions * workers.length,
      totalSessions: this.sessions.size,
      workersActive: workers.filter(worker => worker.status === 'ONLINE').length,
      workersConfigured: workers.length,
      storage: {
        mode: 'local',
        registryFile: this.registryFile,
        persistent: this.persist,
        externalConfigured: Boolean(process.env.REDIS_URL || process.env.DATABASE_URL),
      },
    };
  }

  getStatus() {
    return {
      ready: this.ready,
      ...this.summary(),
    };
  }
}

const sessionManager = new SessionManager();
sessionManager.init();

module.exports = {
  SessionManager,
  SessionCapacityError,
  SESSION_STATUSES,
  normalizePhoneNumber,
  maskPhoneNumber,
  logSessionEvent,
  sessionManager,
};