/* 房间快照持久化单测（node:test）：serialize → write → read → deserialize 完整往返，
 * 验证房间 / 对局状态 / 断线快照 / 座位表在重启场景下完整恢复（纯函数，无需服务器）。 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Core = require('./shared/game-core.js');
const {
  serializeRooms, deserializeRooms, writeSnapshotFile, readSnapshotFile
} = require('./shared/room-snapshot.js');

/* 与 server.js createRoom 同构的骨架工厂（单测版，真实代码由 server.js 传入） */
function factory(code, opts) {
  return {
    code,
    mode: opts.mode,
    maxSeats: opts.maxSeats,
    seed: opts.seed,
    password: opts.password,
    seats: [],
    state: null,
    started: false,
    hostSeat: 0,
    lastActivity: Date.now(),
    timers: new Map(),
    deadlines: new Map(),
    aiRetries: new Map(),
    aiBusy: new Set(),
    aiQueue: Promise.resolve(),
    snapshots: new Map()
  };
}

function makeRoom(code, seed) {
  const st = Core.createGame({ seed, seatCount: 2, names: ['A', 'B'], aiMask: [true, true] });
  // 推进几手，模拟进行中的对局
  for (let i = 0; i < 3 && !st.gameOver; i++) {
    for (const seat of Core.needsAIAction(st)) Core.aiAct(st, seat);
    Core.advance(st);
  }
  const room = factory(code, { mode: 'multi', maxSeats: 2, seed: String(seed), password: 'p' + code });
  room.started = true;
  room.hostSeat = 0;
  room.lastActivity = Date.now() - 5000;
  room.seats = [{ name: 'A', isAI: false, connected: true }, { name: 'B', isAI: true, connected: false }];
  room.state = st;
  // 断线快照：模拟 A 掉线时保存的状态
  room.snapshots.set(0, { state: JSON.parse(JSON.stringify(st)), savedAt: Date.now() - 3000 });
  return room;
}

test('roundtrip：房间 + 对局状态 + 断线快照完整恢复', () => {
  const rooms = new Map();
  rooms.set('AB23', makeRoom('AB23', 20260817));
  rooms.set('CD34', makeRoom('CD34', 7));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  try {
    assert.ok(writeSnapshotFile(dir, rooms), '写入应成功');
    const list = readSnapshotFile(dir);
    assert.equal(list.length, 2, '应读到 2 个房间');
    const restored = deserializeRooms(list, factory);

    assert.equal(restored.size, 2);
    for (const [code, room] of restored) {
      const orig = rooms.get(code);
      assert.equal(room.code, code);
      assert.equal(room.mode, 'multi');
      assert.equal(room.maxSeats, 2);
      assert.equal(room.password, 'p' + code, '密码应保留（重连校验依赖）');
      assert.equal(room.started, true);
      assert.equal(room.hostSeat, 0);
      assert.equal(room.seats[0].name, 'A');
      assert.equal(room.seats[0].isAI, false);
      assert.equal(room.seats[0].connected, false, '重启后 connected 应为 false（断线态）');
      assert.equal(room.seats[1].isAI, true);
      // 对局状态：核心字段一致（深比较关键子集）
      assert.equal(room.state.phase, orig.state.phase);
      assert.equal(room.state.round, orig.state.round);
      assert.equal(room.state.version, orig.state.version);
      assert.equal(room.state.hostSeat, 0);
      assert.deepEqual(room.state.seats[0].hand, orig.state.seats[0].hand, '手牌应一致');
      assert.deepEqual(room.state.seats[1].hand, orig.state.seats[1].hand, 'AI 手牌应一致');
      // 断线快照恢复
      assert.equal(room.snapshots.size, 1, '断线快照应保留');
      const sn = room.snapshots.get(0);
      assert.ok(sn, '座位 0 的快照应存在');
      assert.equal(sn.state.phase, orig.state.phase);
      assert.deepEqual(sn.state.seats[0].hand, orig.state.seats[0].hand, '快照手牌应一致');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('损坏/空快照文件优雅降级', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-bad-'));
  try {
    const bad = path.join(dir, 'rooms-snapshot.json');
    fs.writeFileSync(bad, '{ 这不是 JSON', 'utf8');
    const list = readSnapshotFile(dir);
    assert.deepEqual(list, [], '损坏文件应返回空数组');
    const empty = deserializeRooms(null, factory);
    assert.equal(empty.size, 0, 'null 列表应返回空 Map');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
