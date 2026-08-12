/* 评审 P0-BUG 回归测试：快照恢复后随机源必须可用且同种子可复现。
 * 修复前：state.rng 是 mulberry32 闭包函数，JSON 序列化静默丢弃；
 * 恢复后 state.rng() 抛 TypeError（被 try/catch 吞掉走 forceSkip）或
 * randomHit 静默降级 Math.random——「同种子全等复现」在快照恢复后当场作废。
 * 修复：rngSeed/rngCalls 数字字段可序列化，restoreRng() 重建到精确调用点。
 *
 * 运行：node --test _test_rng_restore.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('./shared/game-core.js');

/* 全自动推进：advance + AI 行动直到 gameOver 或 guard 耗尽 */
function pump(st, maxSteps) {
  let guard = 0;
  while (!st.gameOver && guard++ < maxSteps) {
    const need = Core.needsAIAction(st);
    if (need.length) { for (const seat of need) Core.aiAct(st, seat); continue; }
    Core.advance(st);
  }
  return st;
}

/* 推进到 rngCalls 超过阈值（确保 rng 已被大量使用：洗牌/选起始/AI 保留/抽签/tied） */
function pumpUntilCalls(st, threshold) {
  let guard = 0;
  while (!st.gameOver && st.rngCalls < threshold && guard++ < 3000) {
    const need = Core.needsAIAction(st);
    if (need.length) { for (const seat of need) Core.aiAct(st, seat); continue; }
    Core.advance(st);
  }
  return st;
}

/* 终局摘要（对比用：winner/轮次/各座经济/日志数量与尾部） */
function digest(st) {
  return {
    winner: st.winner,
    round: st.round,
    supports: st.seats.map(s => s.support),
    monies: st.seats.map(s => s.money),
    scandals: st.seats.map(s => s.scandal),
    logCount: st.logs.length,
    logTail: st.logs.slice(-20).join('\n')
  };
}

test('快照往返丢弃 rng 函数；restoreRng 重建后可用且输出合法', () => {
  const st = Core.createGame({ seatCount: 2, names: ['A', 'B'], aiMask: [true, true], seed: 777 });
  pumpUntilCalls(st, 80);
  assert.ok(st.rngCalls >= 80, 'rng 应已被大量调用（当前 ' + st.rngCalls + '）');
  const snap = JSON.parse(JSON.stringify(st));      // 模拟快照落盘（serializeRooms → writeSnapshotFile）
  assert.equal(snap.rng, undefined, '序列化后 rng 函数应被丢弃');
  assert.equal(typeof snap.rngSeed, 'number', 'rngSeed 数字字段应保留');
  assert.equal(typeof snap.rngCalls, 'number', 'rngCalls 数字字段应保留');
  assert.ok(snap.rngCalls > 0, 'rngCalls 应为正（已调用计数）');
  Core.restoreRng(snap);                            // 服务器重启恢复点
  for (let i = 0; i < 50; i++) {
    const v = snap.rng();
    assert.ok(typeof v === 'number' && v >= 0 && v < 1, '恢复后 rng() 应返回 [0,1)');
  }
  assert.ok(snap.rngCalls > 80, '恢复后继续调用应递增 rngCalls');
});

test('快照恢复后继续推进与直接推进逐日志一致（同种子可复现不破）', () => {
  // 路径 A：不中断直接跑完
  const A = Core.createGame({ seatCount: 2, names: ['A', 'B'], aiMask: [true, true], seed: 20260812 });
  pump(A, 3000);
  assert.ok(A.gameOver, '路径 A 应正常结束');
  // 路径 B：推进到中途（rng 已大量调用）→ JSON 往返 → restoreRng → 继续跑完
  const B = Core.createGame({ seatCount: 2, names: ['A', 'B'], aiMask: [true, true], seed: 20260812 });
  pumpUntilCalls(B, 60);
  const snap = JSON.parse(JSON.stringify(B));
  Core.restoreRng(snap);
  pump(snap, 3000);
  assert.ok(snap.gameOver, '路径 B（恢复后）应正常结束');
  assert.deepEqual(digest(snap), digest(A), '恢复路径与直接路径结果完全一致');
  assert.deepEqual(snap.logs, A.logs, '恢复路径日志与直接路径完全一致');
});

test('同种子对局完全可复现：两次 createGame 推进结果一致（回归护栏）', () => {
  const a = Core.createGame({ seatCount: 2, names: ['A', 'B'], aiMask: [true, true], seed: 555 });
  const b = Core.createGame({ seatCount: 2, names: ['A', 'B'], aiMask: [true, true], seed: 555 });
  pump(a, 3000); pump(b, 3000);
  assert.deepEqual(digest(b), digest(a), '同种子应产生完全一致的结果');
});
