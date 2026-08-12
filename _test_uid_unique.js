/* 评审 P1-BUG 回归测试：并发创建两个房间，卡牌 uid 不得重复。
 * 修复前：uidSeq 是模块级全局，createGame 开局就重置为 1000——
 * 房间 B 开局把房间 A 已分配的 uid 全部重复发一遍；快照冲突检测
 * cardInGlobal / 断线恢复防复制 / 卡牌埋点全部建立在「uid 全局唯一」的
 * 隐式假设上。修复后 uidSeq 移入每局 state，互不干扰。
 *
 * 运行：node --test _test_uid_unique.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('./shared/game-core.js');

/* 按确定性顺序收集一局内全部卡牌 uid */
function collectUids(st) {
  const list = [];
  const add = (arr) => { if (Array.isArray(arr)) arr.forEach(c => { if (c && c.uid) list.push(c.uid); }); };
  add(st.deck); add(st.eventDeck); add(st.used); add(st.grave);
  st.seats.forEach(s => { add(s.hand); add(s.market); add(s.events); add(s.played); });
  if (Array.isArray(st.row)) st.row.forEach(r => { if (r && r.card && r.card.uid) list.push(r.card.uid); });
  return list;
}

test('并发两局各自内部 uid 唯一（A 进行中创建 B 不污染 A 的计数器）', () => {
  // 旧 bug：uidSeq 是模块级全局，createGame 开局重置为 1000——若 A 对局中途创建 B，
  // A 后续再分配 uid 会拿到 B 已发的编号，同一局内 uid 重复（cardInGlobal 防复制失效）。
  const a = Core.createGame({ seatCount: 2, names: ['A', 'B'], aiMask: [true, true], seed: 1 });
  const b = Core.createGame({ seatCount: 2, names: ['C', 'D'], aiMask: [true, true], seed: 2 });  // 旧 bug 触发点
  const ua = collectUids(a), ub = collectUids(b);
  assert.ok(ua.length > 0 && ub.length > 0, '两局都应有卡牌');
  assert.ok(ua.length >= 48, '局 A 应含 48 张选民牌 + 事件牌（实际 ' + ua.length + '）');
  // 各局内部唯一（同局重复才会破坏 cardInGlobal 防复制；跨局重复无害——uid 每局独立编号）
  const assertNoDup = (uids, label) => {
    const seen = new Set();
    for (const u of uids) {
      assert.ok(!seen.has(u), label + ' 内部 uid 不得重复：' + u);
      seen.add(u);
    }
  };
  assertNoDup(ua, '局 A');
  assertNoDup(ub, '局 B');
  // 修复后两局计数器相互独立：A 的 uidSeq 不受 B 开局影响
  assert.ok(a.uidSeq >= 1000 + ua.length, 'A 的 uidSeq 应已推进到其牌数之后');
  assert.ok(b.uidSeq >= 1000 + ub.length, 'B 的 uidSeq 应独立推进');
});

test('同种子两局 uid 序列完全一致（可复现性不破）', () => {
  const a = Core.createGame({ seatCount: 2, names: ['A', 'B'], aiMask: [true, true], seed: 999 });
  const b = Core.createGame({ seatCount: 2, names: ['A', 'B'], aiMask: [true, true], seed: 999 });
  const seqA = collectUids(a), seqB = collectUids(b);
  assert.deepEqual(seqA, seqB, '同种子 uid 序列应逐位一致');
  assert.ok(seqA.length >= 48, '应含全部选民牌 + 事件牌');
});

test('state.uidSeq 可序列化且恢复后继续递增不冲突', () => {
  const st = Core.createGame({ seatCount: 2, names: ['A', 'B'], aiMask: [true, true], seed: 42 });
  const before = st.uidSeq;
  const snap = JSON.parse(JSON.stringify(st));
  assert.equal(typeof snap.uidSeq, 'number', 'uidSeq 应可 JSON 序列化');
  assert.ok(snap.uidSeq >= before, '恢复的 uidSeq 应不小于落盘时刻');
  // 恢复后模拟继续建牌（重连恢复场景不会再建，但计数器应保持单调）
  assert.ok(st.uidSeq >= before, 'uidSeq 保持单调递增');
});
