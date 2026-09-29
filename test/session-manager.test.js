'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SessionManager,
  SessionCapacityError,
} = require('../lib/session-manager');

function createManager(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'varnox-session-manager-'));
  const manager = new SessionManager({
    registryFile: path.join(dir, 'registry.json'),
    heartbeatIntervalMs: 60_000,
    ...options,
  });
  manager.init();
  return { manager, dir };
}

test('creates a session with a real worker assignment', () => {
  const { manager } = createManager({ workerMaxSessions: 2, maxWorkers: 2 });
  const result = manager.reserveSession('224610835573');
  assert.equal(result.reused, false);
  assert.match(result.session.sessionId, /^sess_/);
  assert.equal(result.session.workerId, 'worker-1');
  assert.equal(result.session.phoneMasked, '22***73');
  assert.equal(manager.listWorkers()[0].sessions, 1);
});

test('reuses an existing phone instead of creating a second session', () => {
  const { manager } = createManager();
  const first = manager.reserveSession('224610835573').session;
  const second = manager.reserveSession('+224 610 835 573');
  assert.equal(second.reused, true);
  assert.equal(second.session.sessionId, first.sessionId);
  assert.equal(manager.listSessions().length, 1);
});

test('rejects invalid numbers and concurrent duplicate reservations', async () => {
  const { manager } = createManager();
  assert.throws(() => manager.reserveSession('123'), /Numéro invalide/);
  const results = await Promise.all([
    Promise.resolve().then(() => manager.reserveSession('224610835573')),
    Promise.resolve().then(() => manager.reserveSession('224610835573')),
  ]);
  assert.equal(results[0].session.sessionId, results[1].session.sessionId);
  assert.equal(manager.summary().totalSessions, 1);
});

test('selects the least-loaded worker and rejects a full pool', () => {
  const { manager } = createManager({ workerMaxSessions: 2, maxWorkers: 2 });
  const a = manager.reserveSession('224610835573').session;
  const b = manager.reserveSession('33612345678').session;
  const c = manager.reserveSession('447911123456').session;
  assert.equal(a.workerId, 'worker-1');
  assert.equal(b.workerId, 'worker-2');
  assert.equal(c.workerId, 'worker-1');
  const d = manager.reserveSession('14155552671').session;
  assert.equal(d.workerId, 'worker-2');
  assert.throws(() => manager.reserveSession('81355501234'), SessionCapacityError);
  assert.equal(manager.summary().totalSessions, 4);
});

test('releases capacity when a session is deleted', () => {
  const { manager } = createManager({ workerMaxSessions: 1, maxWorkers: 1 });
  const session = manager.reserveSession('224610835573').session;
  assert.equal(manager.releaseSession(session.sessionId), true);
  assert.equal(manager.summary().totalSessions, 0);
  assert.equal(manager.listWorkers()[0].available, 1);
  assert.equal(manager.releaseSession(session.sessionId), false);
});

test('does not allocate sessions to an offline worker', () => {
  const { manager } = createManager({ workerMaxSessions: 1, maxWorkers: 1, heartbeatTtlMs: 20 });
  manager.workers.get('worker-1').heartbeatAt = Date.now() - 1000;
  assert.equal(manager.listWorkers()[0].status, 'OFFLINE');
  assert.throws(() => manager.reserveSession('224610835573'), SessionCapacityError);
});

test('persists and restores session metadata without credentials', () => {
  const { manager, dir } = createManager();
  const session = manager.reserveSession('224610835573', { status: 'CONNECTING' }).session;
  manager.updateSession(session.sessionId, {
    status: 'RECONNECTING',
    reconnectAttempts: 3,
    lastDisconnect: { code: 408 },
  });
  manager.close();
  const restored = new SessionManager({
    registryFile: path.join(dir, 'registry.json'),
    heartbeatIntervalMs: 60_000,
  });
  restored.init();
  const record = restored.getBySessionId(session.sessionId);
  assert.equal(record.phoneNumber, '224610835573');
  assert.equal(record.status, 'RECONNECTING');
  assert.equal(record.reconnectAttempts, 3);
  assert.deepEqual(record.lastDisconnect, { code: 408 });
  assert.equal(Object.hasOwn(record, 'creds'), false);
  restored.close();
});

test('logical simulation handles 100, 200, 500 and 800 sessions', () => {
  for (const count of [100, 200, 500, 800]) {
    const { manager } = createManager({ workerMaxSessions: 100, maxWorkers: count / 100 });
    for (let index = 0; index < count; index += 1) {
      const phone = `${String(index + 1).padStart(3, '0')}555${String(index).padStart(7, '0')}`;
      manager.reserveSession(phone);
    }
    assert.equal(manager.summary().totalSessions, count);
    assert.equal(manager.summary().totalCapacity, count);
    manager.close();
  }
});