/* 服务器重启恢复集成测试（node:test + socket.io-client）
 * 覆盖（顾问评审 9：无重启集成测试的空白）：
 *  服务器进程被杀 → 快照落盘（SNAP_INTERVAL_MS）→ 重启 → restoreRooms 恢复房间 →
 *  同名 joinRoom 走重连分支 → 回到原对局（阶段不倒退、私有资源快照恢复、AI 接管取消）。
 *
 * 隔离设计：
 *  - 独立端口 PORT=3198（CI 主服务器占 3000，互不干扰）
 *  - 独立快照文件 SNAP_FILE=rooms-snapshot-test.json（不污染主服务器默认快照）
 *  - SNAP_INTERVAL_MS=500 缩短落盘周期，测试无需等 10 分钟
 *  - 测试结束删除测试快照文件，工作区保持干净
 *
 * 运行：node --test _test_restart.js
 * 前置：socket.io-client（npm i -D socket.io-client）；缺则整体 skip。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { io } = require('socket.io-client');

const PORT = 3198;
const URL = 'http://localhost:' + PORT;
const SNAP_FILE = 'rooms-snapshot-test.json';
const SNAP_PATH = path.join(__dirname, SNAP_FILE);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let hasClient = true;
try { require.resolve('socket.io-client'); } catch (e) { hasClient = false; }
test.before(async (t) => {
  if (!hasClient) return t.skip('缺少 socket.io-client（npm i -D socket.io-client）');
});

/* ---------- 服务器子进程管理 ---------- */
function startServer() {
  const p = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      SNAP_FILE,
      SNAP_INTERVAL_MS: '500'
    }),
    stdio: ['ignore', 'ignore', 'inherit']
  });
  return p;
}
function waitHealth(timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const probe = () => {
      const req = http.get({ host: 'localhost', port: PORT, path: '/health', timeout: 1500 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(probe, 200);
    };
    probe();
  });
}
function stopServer(p) {
  return new Promise((resolve) => {
    if (!p || p.exitCode !== null) return resolve();
    p.on('exit', () => resolve());
    p.kill('SIGTERM');
    setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} resolve(); }, 2500);
  });
}

/* ---------- socket helpers（同 _test_reconnect.js） ---------- */
function connect() {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 5000 });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => { try { s.close(); } catch (_) {} reject(e); });
  });
}
function emitAck(sock, ev, data) {
  return new Promise((resolve) => {
    sock.emit(ev, data || {}, (r) => { sleep(200).then(() => resolve(r)); });
  });
}
function waitState(sock, pred, timeoutMs = 20000, label = '') {
  return new Promise((resolve, reject) => {
    let last = null;
    const t = setTimeout(() => {
      sock.off('state', onS);
      const sum = last ? ('phase=' + last.phase + ' v' + last.version + ' round=' + last.round) : '未收到任何 state';
      reject(new Error('waitState 超时 [' + label + ']：最后收到 ' + sum));
    }, timeoutMs);
    const onS = (v) => { last = v; if (pred(v)) { clearTimeout(t); sock.off('state', onS); resolve(v); } };
    sock.on('state', onS);
  });
}
function waitStateP(sock, pred, timeoutMs = 20000) {
  return waitState(sock, pred, timeoutMs);
}
async function myAction(sock, v, action) {
  const p = waitStateP(sock, vv => vv.version > v.version);
  const ra = await emitAck(sock, 'action', action);
  assert.ok(ra.ok, '行动失败 ' + JSON.stringify(action) + ' → ' + ra.msg);
  return p;
}

/* ---------- 测试：杀进程 → 落盘 → 重启 → 重连回原对局 ---------- */
test('服务器重启：快照恢复房间，同名重连回到原对局且私有资源不丢', async () => {
  // 干净起点：删掉上次测试残留的快照
  try { fs.rmSync(SNAP_PATH, { force: true }); } catch (e) {}

  // ① 启动服务器 1，建房开局推进到 buy（产生手牌与市场，可验证私有资源恢复）
  const srv1 = startServer();
  assert.ok(await waitHealth(15000), '服务器 1 未就绪');
  let A = null, code = null, h0 = [], round0 = 0;
  try {
    A = await connect();
    const r1 = await emitAck(A, 'createRoom', { name: 'RST', mode: 'solo', maxSeats: 2, seed: 'rst-1' });
    assert.ok(r1.ok, '建房失败: ' + r1.msg);
    code = r1.code;
    assert.ok((await emitAck(A, 'startGame')).ok, '开局失败');

    let v = await waitState(A, vv => vv.phase === 'pickChar' && vv.draftCandidates.length);
    v = await myAction(A, v, { type: 'pickChar', charId: v.draftCandidates[0].id });
    // 第 1 轮起始玩家自动随机（starterPicker=-1 直接 beginRound），chooseStarter 不广播 → 直接等 buy
    v = await waitState(A, vv => vv.phase === 'buy');
    round0 = v.round;
    // 买一张可负担的证 → 拥有手牌（断线后可验证「快照恢复不丢牌」）
    const seat = v.seats[0];
    const cand = (seat.market || []).find(c => seat.money >= (c.cost != null ? c.cost : 3));
    if (cand) v = await myAction(A, v, { type: 'buyCard', uid: cand.uid });
    h0 = (v.seats[0].hand || []).map(c => c.uid);
    assert.ok(h0.length >= 1, '买证后应有手牌，实际 ' + h0.length);
    const ph0 = v.phase;
    console.log('  [阶段1] 断线前 phase=' + ph0 + ' round=' + round0 + ' 手牌=' + h0.length + ' code=' + code);

    // ② 等快照落盘（SNAP_INTERVAL_MS=500，等 1.8s 保证至少 3 次落盘）
    await sleep(1800);
    assert.ok(fs.existsSync(SNAP_PATH), '快照文件应已落盘');
    const snap = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8'));
    assert.ok(snap.some(x => x.code === code), '快照应包含房间 ' + code);
    A.close && A.close();
  } finally {
    // ③ 杀服务器 1（不依赖 SIGTERM handler：Windows 下 kill 即终止，靠已完成的定时落盘）
    await stopServer(srv1);
    A && A.close && A.close();
  }

  // ④ 启动服务器 2 → restoreRooms 从快照恢复房间
  const srv2 = startServer();
  assert.ok(await waitHealth(15000), '服务器 2 未就绪');
  let B = null;
  try {
    // ⑤ 同名 joinRoom → 重连分支（reconnected=true）→ 回到原对局
    B = await connect();
    const v2P = waitStateP(B, () => true);
    const r2 = await emitAck(B, 'joinRoom', { code, name: 'RST' });
    assert.ok(r2.ok, '重启后加入失败: ' + JSON.stringify(r2));
    assert.equal(r2.reconnected, true, '重启后同名应走重连分支，实际 ' + JSON.stringify(r2));
    const v2 = await v2P;
    assert.equal(v2.mySeat, 0, '重连后应回到原座位');
    const s2 = v2.seats[0];
    assert.equal(s2.isAI, false, '重连后应取消 AI 接管');
    // 阶段/轮次不倒退：重启后对局应延续（可能被 AI 推进几手，但不得回到 lobby/起始）
    assert.ok(v2.round >= round0, '轮次不应倒退: ' + round0 + ' → ' + v2.round);
    assert.ok(v2.phase !== 'pickChar' || v2.round > round0, '不应回到开局选角（除非已推进轮次）');
    // 私有资源快照恢复：断线时手牌全部保留、无重复
    const h1 = (s2.hand || []).map(c => c.uid);
    for (const uid of h0) assert.ok(h1.includes(uid), '重启后断线手牌丢失: ' + uid);
    assert.equal(new Set(h1).size, h1.length, '手牌不应有重复 uid（快照恢复防复制）');
    console.log('  [阶段2] 重启后 phase=' + v2.phase + ' round=' + v2.round
      + ' 手牌=' + h1.length + ' reconnected=' + r2.reconnected);
  } finally {
    B && B.close && B.close();
    await stopServer(srv2);
    // 清理测试快照文件，工作区保持干净
    try { fs.rmSync(SNAP_PATH, { force: true }); } catch (e) {}
  }
});
