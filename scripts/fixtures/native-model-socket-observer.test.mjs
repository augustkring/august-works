import assert from 'node:assert/strict';
import test from 'node:test';
import { observeSocketOwner } from './native-model-socket-observer.mjs';

const trustedUid = 4242;
const localPort = 1234, remotePort = 5678, inode = '987654321';
const local = `0100007F:${localPort.toString(16).padStart(4, '0').toUpperCase()}`;
const remote = `0100007F:${remotePort.toString(16).padStart(4, '0').toUpperCase()}`;
const request = (deadlineAt = 2_000) => ({ localPort, remotePort, deadlineAt });

function fakeProcIo({ pids, fdsByPid = new Map(), socketFds = new Set() }) {
  const table = Buffer.from(
    `  sl local_address rem_address st tx_queue:rx_queue tr:tm->when retrnsmt uid timeout inode\n` +
    `  0: ${local} ${remote} 01 00000000:00000000 00:00000000 00000000 ${trustedUid} 0 ${inode}\n`,
  );
  let tableOffset = 0, statReads = 0, readlinkCalls = 0;
  return {
    io: {
      openSync(path) { assert.equal(path, '/proc/net/tcp'); return 7; },
      closeSync(fd) { assert.equal(fd, 7); },
      readSync(fd, target) {
        assert.equal(fd, 7);
        if (tableOffset >= table.length) return 0;
        const count = table.copy(target, 0, tableOffset);
        tableOffset += count;
        return count;
      },
      readdirSync(path) {
        if (path === '/proc') return pids;
        const match = /^\/proc\/(\d+)\/fd$/.exec(path);
        if (match) return fdsByPid.get(match[1]) ?? [];
        throw new Error(`unexpected readdir: ${path}`);
      },
      statSync(path) {
        assert.match(path, /^\/proc\/\d+$/);
        statReads++;
        return { uid: trustedUid };
      },
      readFileSync(path) {
        const match = /^\/proc\/(\d+)\/stat$/.exec(path);
        assert.ok(match, `unexpected readFile: ${path}`);
        return `${match[1]} (fixture process) S 1`;
      },
      readlinkSync(path) {
        readlinkCalls++;
        return socketFds.has(path) ? `socket:[${inode}]` : 'pipe:[1]';
      },
    },
    counts: () => ({ statReads, readlinkCalls }),
  };
}

test('FD observations do not consume the independent PID scan budget', () => {
  const pids = ['100', '200'];
  const firstPidsFds = Array.from({ length: 8192 }, (_, i) => String(i));
  const secondFd = '/proc/200/fd/9';
  const fake = fakeProcIo({ pids, fdsByPid: new Map([['100', firstPidsFds], ['200', ['9']]]),
    socketFds: new Set([secondFd]) });
  const result = observeSocketOwner(request(), trustedUid, fake.io, () => 1_000);
  assert.deepEqual(result, { complete: true, pid: 200, inode, local, remote });
  assert.deepEqual(fake.counts(), { statReads: 2, readlinkCalls: 8193 });
});

test('the 131072-entry FD cap remains enforced independently', () => {
  const fds = Array.from({ length: 131073 }, (_, i) => String(i));
  const fake = fakeProcIo({ pids: ['100'], fdsByPid: new Map([['100', fds]]) });
  const result = observeSocketOwner(request(), trustedUid, fake.io, () => 1_000);
  assert.deepEqual(result, { complete: false, stage: 'fd_readlink', errno: null });
  assert.equal(fake.counts().readlinkCalls, 131072);
});

test('the 8192-PID cap remains enforced', () => {
  const pids = Array.from({ length: 8193 }, (_, i) => String(10_000 + i));
  const fake = fakeProcIo({ pids });
  const result = observeSocketOwner(request(), trustedUid, fake.io, () => 1_000);
  assert.deepEqual(result, { complete: false, stage: 'fd_directory_list', errno: null });
  assert.equal(fake.counts().statReads, 8192);
});

test('the observation deadline still fails closed during FD enumeration', () => {
  const fake = fakeProcIo({ pids: ['100'], fdsByPid: new Map([['100', ['1', '2']]]) });
  let clock = 0;
  const result = observeSocketOwner(request(6), trustedUid, fake.io, () => ++clock);
  assert.deepEqual(result, { complete: false, stage: 'fd_readlink', errno: null });
  assert.equal(fake.counts().readlinkCalls, 1);
});

test('a second matching owner still denies the observation after scanning both PIDs', () => {
  const fake = fakeProcIo({ pids: ['100', '200'], fdsByPid: new Map([['100', ['1']], ['200', ['2']]]),
    socketFds: new Set(['/proc/100/fd/1', '/proc/200/fd/2']) });
  const result = observeSocketOwner(request(), trustedUid, fake.io, () => 1_000);
  assert.deepEqual(result, { complete: false, stage: 'owner_count', errno: null });
  assert.deepEqual(fake.counts(), { statReads: 2, readlinkCalls: 2 });
});
