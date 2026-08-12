/* 断线恢复集成测试（node:test + socket.io-client）
 * 运行前置：服务器已启动（node server.js，或 _ci_test.js 自动拉起后运行）。
 * 服务器未启动时本文件优雅跳过（与 _render_test.js 同策略）。
 *
 * 覆盖（Task 2 断线恢复集成）：
 *  1) 掉线 → saveSnapshot → AI 保守托管（ghostAct）推进 → 同名重连 →
 *     快照恢复私有资源（手牌不丢不复制）、AI 接管取消、行动权回归、金钱不被托管消耗
 *  2) ghostAct discard 多手牌：弃牌阶段手牌 > keepMax 时只保留前 keepMax 张
 *     （原顺序），其余归档；重连后手牌 = min(keepMax, 断线时手牌) 前 N 张
 *     顺序保持，被弃牌绝不复活（冲突检测防复制）
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('./shared/game-core.js');
const { io } = require('socket.io-client');

const PORT = process.env.PORT || 3000;
const URL = 'http://localhost:' + PORT;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let hasClient = true;
try { require.resolve('socket.io-client'); } catch (e) { hasClient = false; }

function serverUp() {
  return fetch(URL + '/health').then(r => r.ok).catch(() => false);
}
test.before(async (t) => {
  if (!hasClient) return t.skip('缺少 socket.io-client（npm i -D socket.io-client）');
  if (!(await serverUp())) return t.skip('服务器未启动（node server.js）');
});

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 5000 });
    s.on('connect', () => {
      // 诊断：打印该 socket 收到的每个 state（phase/version）
      s.on('state', (v) => console.error('[state]', s.id.slice(0, 4), 'v' + v.version, 'phase=' + v.phase, 'round=' + v.round));
      resolve(s);
    });
    s.on('connect_error', (e) => { try { s.close(); } catch (_) {} reject(e); });
  });
}
/* ack 回调 + 小延迟摊开限流窗口（RATE_MAX_ACTIONS=10/2s），避免测试误触发限流。
 * 8s 超时兜底：若服务器未注册该事件处理器（例如连接被 guardConnection 拒绝），
 * ack 永不回调 → 快速失败而不是无限挂起。 */
function emitAck(sock, ev, data) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('emitAck 超时: ' + ev)), 8000);
    sock.emit(ev, data || {}, (r) => { clearTimeout(t); sleep(220).then(() => resolve(r)); });
  });
}
/* 等待 state 事件满足 pred；version 单调递增，pred 通常用 version 比较避免消费旧帧 */
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
/* 先注册再触发的 waitState：服务器 afterStateChange 的广播可能在 ack 之前到达客户端，
 * 若等 emit 完成后再注册监听器会丢失该帧（socket.io 事件不缓存、不重放）→ 永远超时。
 * 调用方必须先拿到 promise 再 emit，最后 await。 */
function waitStateP(sock, pred, timeoutMs = 20000, label = '') {
  return waitState(sock, pred, timeoutMs, label);
}
/* 发送行动并等待 version 递增的新 state（先注册监听器再 emit，防丢帧） */
async function myAction(sock, v, action) {
  const p = waitStateP(sock, vv => vv.version > v.version);
  const ra = await emitAck(sock, 'action', action);
  assert.ok(ra.ok, '行动失败 ' + JSON.stringify(action) + ' → ' + ra.msg);
  return p;
}
/* 当前玩家弃牌上限：2 + keepPlus 加成 */
function keepMaxOf(seatView) {
  const sk = seatView && seatView.char && seatView.char.skill;
  return 2 + ((sk && sk.type === 'keepPlus') ? sk.v : 0);
}
/* 从当前状态一路推进到 discard（或 gameover）：沿途处理人类 0 号的所有可选行动——
 * play 轮转轮到 0 → 出 1 张牌（⑩ 每轮必须出牌，非最后一位律师不可 finishPlay；
 *   无手牌则由 advance 自动置 playDone）；reveal 恐怖分子选目标；preEvent/postEvent → passEvent；
 * count 政治操盘选目标。AI 座位由服务器自动处理，无需测试干预。
 * 原因：每轮每人发 1 张事件牌，seat 0 可能拿到可用的 pre/post 事件而必须行动；
 * 若不做任何操作会等满 SEAT_TIMEOUT_MS(30s) 才被 AI 接管，测试等 discard 会超时。 */
async function driveToDiscard(A, v, max = 40) {
  let g = 0;
  while (!['discard', 'gameover'].includes(v.phase) && g++ < max) {
    if (v.phase === 'play' && v.turn === 0 && !v.seats[0].playDone) {
      const hand = v.seats[0].hand || [];
      if (!hand.length) {
        v = await waitState(A, vv => vv.version > v.version, 15000);
        continue;
      }
      // ⑩ 每轮必须出牌：非最后一位有手牌者必须出 1 张；最后一位可 finishPlay（保留手牌）
      // 注意：服务器隐藏非我方手牌（hand=null），因此用 playDone 判断（AI 手牌空时 advance 会置 playDone）
      const isLast = !v.seats.some(x => x.seat !== 0 && !x.playDone);
      if (isLast) {
        v = await myAction(A, v, { type: 'finishPlay' });
      } else {
        v = await myAction(A, v, { type: 'playCards', uids: [hand[0].uid] });
      }
    } else if (v.phase === 'chooseStarter' && v.starterPicker === 0 && !v.starterChosen) {
      // 第 2 轮起：排名最低者（可能轮到自己）选择起始玩家 → 直接选自己
      v = await myAction(A, v, { type: 'pickStarter', starterSeat: 0 });
    } else if (v.phase === 'reveal' && v.revealPending && v.revealPending.owner === 0) {
      const tgt = (v.row || []).find(r => r.revealed && r.seat !== 0 && !r.removed);
      v = await myAction(A, v, { type: 'terroristTarget', targetUid: tgt ? tgt.card.uid : v.revealPending.cardUid });
    } else if ((v.phase === 'preEvent' || v.phase === 'postEvent') && v.eventTurnSeat === 0) {
      v = await myAction(A, v, { type: 'passEvent' });
    } else if (v.phase === 'count' && v.swapPending && v.swapPending.owner === 0) {
      const cand = (v.swapPending.candidates || [])[0];
      v = await myAction(A, v, { type: 'swapTarget', targetUid: cand });
    } else {
      v = await waitState(A, vv => vv.version > v.version, 15000);
    }
  }
  return v;
}

/* ---------- 测试 1：掉线-重连全程（快照恢复 + 托管不消费） ---------- */
test('掉线重连：AI 托管期间私有资源恢复，金钱不被消耗，行动权回归', async () => {
  let A = null, B = null;
  try {
    A = await connect();
    const r1 = await emitAck(A, 'createRoom', { name: 'A1', mode: 'solo', maxSeats: 2, seed: 'rc-1' });
  assert.ok(r1.ok, '建房失败: ' + r1.msg);
  const code = r1.code;
  // 选角 → 定起始 → （可能的事件选择）→ buy
  // 注意：startGame 的 pickChar 广播可能在 ack 之前到达客户端（afterStateChange 在 ack 前触发），
  // 若等 ack 完成后再注册监听器会丢帧 → 永远超时。因此必须先拿到 waitStateP 的 promise 再 startGame。
  const v1P = waitStateP(A, vv => vv.phase === 'pickChar' && vv.draftCandidates.length);
  assert.ok((await emitAck(A, 'startGame')).ok, '开局失败');
  let v = await v1P;
  v = await myAction(A, v, { type: 'pickChar', charId: v.draftCandidates[0].id });
  v = await waitState(A, vv => vv.phase === 'buy');
  // buy 初始手牌为 0（beginBuy 不发牌，手牌靠买证/技能/事件获得）：
  // 最大化手牌（买最便宜，买不动再刷新，目标 3 张）——保证 discard 阶段手牌 > keepMax
  // 触发人类弃牌（否则手牌 ≤ keepMax 时 discard 自动过，driveToDiscard 会一路冲到下一轮）
  let guard = 0;
  while (guard++ < 12) {
    const seat = v.seats[0];
    const afford = (seat.market || []).filter(c => Core.buyCostOf(seat, c) <= seat.money)
      .sort((a, b) => Core.buyCostOf(seat, a) - Core.buyCostOf(seat, b));
    if (afford.length) { v = await myAction(A, v, { type: 'buyCard', uid: afford[0].uid }); continue; }
    if (guard < 10 && seat.money >= 1 && Core.refreshCostOf(seat) <= seat.money) {
      const rp = waitStateP(A, vv => vv.version > v.version);
      const rc = await emitAck(A, 'action', { type: 'refreshMarket' });
      if (!rc.ok) break;
      v = await rp;
      continue;
    }
    break;
  }
  // 记录断线时私有资源（市场/金钱 buy 后与掉线时一致，直接记录；手牌需等 driveToDiscard 后再记）
  const m0 = (v.seats[0].market || []).map(c => c.uid);
  const money0 = v.seats[0].money;
  assert.ok(m0.length >= 1, 'buy 阶段应有市场，实际 ' + m0.length);
  const keepMax0 = keepMaxOf(v.seats[0]);

  // 保守托管基准：不买不锁不刷新，直接 endBuy
  v = await myAction(A, v, { type: 'endBuy' });
  // 一路推进到 discard：沿途处理人类 0 号在 chooseStarter/play/reveal/事件/换位阶段的可选行动
  v = await driveToDiscard(A, v);
  // driveToDiscard 返回时已消费 discard state（v.phase === 'discard'）。
  // 注意：driveToDiscard 的 play 分支会按⑩规则出掉 0 号的手牌（非最后一位必须出 1 张），
  // 因此掉线时的真实手牌 = driveToDiscard 之后的手牌，需在此重新记录（h0 断言基准）
  const hDiscard = (v.seats[0].hand || []).map(c => c.uid);
  assert.ok(hDiscard.length >= 1, '掉线前（discard）应有手牌，实际 ' + hDiscard.length);
  const h0 = hDiscard;
  const n0 = Math.min(keepMax0, h0.length);
  // 注意不能再 waitState(discard)：discard state 已被消费，下一个版本要等人类弃牌
  // （SEAT_TIMEOUT 30s 或 AI 接管）→ 会超时。直接掉线，让 AI 接管处理弃牌。
  assert.equal(v.phase, 'discard', '应推进到 discard，实际 ' + v.phase);
  A.disconnect();
  await sleep(2500);   // AI 托管推进（ghostAct：discard 保留前 keepMax 张 + 继续后续轮次）

  // 同名重连（先注册 state 监听器，避免 joinRoom ack 前的 state 广播丢帧）
  B = await connect();
  const v2P = waitStateP(B, () => true, 15000, '重连B');
  const r2 = await emitAck(B, 'joinRoom', { code, name: 'A1' });
  assert.ok(r2.ok && r2.reconnected, '重连失败: ' + JSON.stringify(r2));
  assert.equal(r2.seat, 0);
  const v2 = await v2P;
  assert.equal(v2.mySeat, 0);
  const s2 = v2.seats[0];
  assert.equal(s2.isAI, false, '重连后应取消 AI 接管');
  const h1 = (s2.hand || []).map(c => c.uid);
  // 快照恢复 + ghostAct discard：重连后手牌前 n0 张 = 断线时前 n0 张（顺序保持），
  // 被 AI 托管归档的（n0 之后）不复活（冲突检测防复制）；跨轮新发牌只允许附加在尾部
  assert.deepEqual(h1.slice(0, n0), h0.slice(0, n0), '保留牌顺序应保持（前 ' + n0 + ' 张）');
  assert.equal(new Set(h1).size, h1.length, '手牌不应有重复 uid（快照恢复防复制）');
  if (h0.length > n0) {
    for (const uid of h0.slice(n0)) assert.ok(!h1.includes(uid), '被弃牌不应恢复回手牌: ' + uid);
  }
  assert.ok(s2.money >= money0, '保守托管不应消耗金钱: ' + money0 + ' → ' + s2.money);
  // 行动权回归：发一个当前阶段允许的探测行动，不得再被「AI 接管」拒绝
  let probe = null;
  switch (v2.phase) {
    case 'pickChar': probe = { type: 'pickChar', charId: v2.draftCandidates[0].id }; break;
    case 'chooseStarter': probe = v2.starterPicker === 0 ? { type: 'pickStarter', starterSeat: 0 } : null; break;
    case 'buy': probe = s2.buyDone ? null : { type: 'endBuy' }; break;
    case 'play': probe = (v2.turn === 0 && !s2.playDone && (s2.hand || []).length) ? { type: 'playCards', uids: [s2.hand[0].uid] } : null; break;
    case 'discard': probe = (v2.discardSeat === 0 && !s2.keepDone && h1.length) ? { type: 'keepCard', uid: h1[0] } : null; break;
    default: probe = null;
  }
  if (probe) {
    const ra = await emitAck(B, 'action', probe);
    assert.notEqual(ra.msg, '你已被 AI 接管（等待重连或下局）', '重连后仍被 AI 接管拒绝');
  }
  // 必须 close() 而非仅 disconnect()：否则 socket.io-client manager 的 ping 定时器
  // 会挂住事件循环，node --test 测试全部通过后进程无法退出（npm test 卡死）
  // 且连接计数（guardConnection 按 IP 计数）若泄漏会令后续测试连接被 ban → 务必 finally 关闭
  } finally {
    try { B && B.close && B.close(); } catch (e) {}
    try { A && A.close && A.close(); } catch (e) {}
  }
});

/* ---------- 测试 2：ghostAct discard 多手牌（只保留 keepMax 张，顺序保持） ---------- */
test('ghostAct discard 多手牌：只保留前 keepMax 张，被弃牌不复活', async () => {
  let A = null, B = null;
  try {
    A = await connect();
  const r1 = await emitAck(A, 'createRoom', { name: 'A2', mode: 'solo', maxSeats: 2, seed: 'rc-2' });
  assert.ok(r1.ok, '建房失败: ' + r1.msg);
  const code = r1.code;
  // 同测试 1：startGame 的 pickChar 广播可能在 ack 前到达，先注册监听器再 startGame 防丢帧
  const v1P = waitStateP(A, vv => vv.phase === 'pickChar' && vv.draftCandidates.length);
  assert.ok((await emitAck(A, 'startGame')).ok, '开局失败');
  let v = await v1P;
  v = await myAction(A, v, { type: 'pickChar', charId: v.draftCandidates[0].id });
  // 第 1 轮起始玩家自动随机，chooseStarter 阶段不广播 → 直接等 buy
  v = await waitState(A, vv => vv.phase === 'buy');

  // 最大化手牌：先买最便宜的（cost-1 卡 1⊙），买不动再刷新（尽量让手牌 > keepMax，触发弃牌）
  let guard = 0;
  while (guard++ < 12) {
    const seat = v.seats[0];
    const afford = (seat.market || []).filter(c => Core.buyCostOf(seat, c) <= seat.money)
      .sort((a, b) => Core.buyCostOf(seat, a) - Core.buyCostOf(seat, b));
    if (afford.length) { v = await myAction(A, v, { type: 'buyCard', uid: afford[0].uid }); continue; }
    // 买不动：刷新成本 < 剩余钱则刷新（1⊙ 换新市场）
    if (guard < 10 && seat.money >= 1 && Core.refreshCostOf(seat) <= seat.money) {
      const rp = waitStateP(A, vv => vv.version > v.version);   // 先注册，防 ack 前广播丢帧
      const rc = await emitAck(A, 'action', { type: 'refreshMarket' });
      if (!rc.ok) break;
      v = await rp;
      continue;
    }
    break;
  }
  v = await myAction(A, v, { type: 'endBuy' });
  // 一路推进到 discard：沿途处理人类 0 号在 play/reveal/事件/换位阶段的可选行动。
  // driveToDiscard 返回时已消费 discard state（v.phase === 'discard'），
  // 不能再 waitState(discard)：discard state 已被消费，下一个版本要等人类弃牌
  // （SEAT_TIMEOUT 30s 或 AI 接管）→ 会超时。直接记录手牌后掉线。
  v = await driveToDiscard(A, v);
  assert.equal(v.phase, 'discard', '应推进到 discard，实际 ' + v.phase);
  const h0 = (v.seats[0].hand || []).map(c => c.uid);
  const keepMax = keepMaxOf(v.seats[0]);
  const n = Math.min(keepMax, h0.length);
  assert.ok(h0.length >= 2, '断线时手牌应 >= 2，实际 ' + h0.length);

  A.disconnect();
  await sleep(6000);   // AI 托管推进：ghostAct 处理 A 的 discard 并继续

  B = await connect();
  // 重连后等 A 的弃牌完成（可能仍在 discard，ghostAct 已处理则 keepDone）；先注册防丢帧
  const v2P = waitStateP(B, vv => vv.seats[0].keepDone === true || vv.phase !== 'discard' || vv.gameOver, 15000);
  const r2 = await emitAck(B, 'joinRoom', { code, name: 'A2' });
  assert.ok(r2.ok && r2.reconnected, '重连失败: ' + JSON.stringify(r2));
  const v2 = await v2P;
  const s2 = v2.seats[0];
  const h1 = (s2.hand || []).map(c => c.uid);
  // 通用不变式：重连后手牌前 n 张 = 断线时前 n 张（顺序保持），
  // 后续新增（跨轮新发牌）只允许附加在尾部的、断线时不存在的新 uid
  assert.deepEqual(h1.slice(0, n), h0.slice(0, n), '保留牌顺序应保持（前 ' + n + ' 张）');
  assert.equal(new Set(h1).size, h1.length, '手牌不应有重复 uid');
  assert.equal(s2.isAI, false, '重连后应取消 AI 接管');
  // 若确实触发了弃牌：断线时 n 之后的牌已归档，绝不复活回手牌
  if (h0.length > n) {
    for (const uid of h0.slice(n)) {
      assert.ok(!h1.includes(uid), '被弃牌不应恢复回手牌: ' + uid);
    }
  }
  // 每张断线手牌要么保留在手、要么被归档（不会凭空消失成"卡牌复制"）：
  // 保留子集全在手牌中（前 n 张已验证）；归档子集已断言不复活。✓
  } finally {
    try { B && B.close && B.close(); } catch (e) {}
    try { A && A.close && A.close(); } catch (e) {}
  }
});
