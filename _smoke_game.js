/* 冒烟测试（node:test）：双 AI 完整对局 5 轮，验证收入逐人日志、保底 +1⊙、新位置技能不抛错 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Core = require('./shared/game-core.js');

function runFullGame(seed) {
  const st = Core.createGame({ seatCount: 2, names: ['A', 'B'], aiMask: [true, true], seed });
  const pumpAutoAdvance = () => {
    for (let k = 0; k < 20; k++) {
      if (st.gameOver) return;
      if (Core.needsAIAction(st).length) return;
      if (Core.humanActing(st).length) return;
      Core.advance(st);
    }
  };
  let guard = 0;
  while (!st.gameOver && guard++ < 900) {
    pumpAutoAdvance();
    if (st.gameOver) break;
    const need = Core.needsAIAction(st);
    if (!need.length) { Core.advance(st); continue; }
    for (const seat of need) Core.aiAct(st, seat);
  }
  return st;
}

test('双 AI 对局正常结束（5 轮内）', () => {
  const st = runFullGame(20260817);
  assert.ok(st.gameOver, '对局应正常结束（超时 guard 内）');
  assert.ok(st.winner != null, '应有胜者');
  assert.ok(st.round >= 1 && st.round <= 5, '轮数应在 1-5 之间，实际 ' + st.round);
});

test('收入保底：每轮每人实得 >= 1⊙', () => {
  const st = runFullGame(20260817);
  const pays = [];
  st.logs.forEach(l => {
    const m = l.match(/发放律师费 \+(\d+)⊙/);
    if (m) pays.push(+m[1]);
  });
  assert.ok(pays.length >= 5, '至少应有 5 条收入日志，实际 ' + pays.length);
  assert.ok(pays.every(v => v >= 1), '所有收入应 >= 1，实际 ' + JSON.stringify(pays));
  assert.ok(pays.length <= 12, '收入日志不应异常膨胀（<= 5轮*2人+余量），实际 ' + pays.length);
});

test('新位置技能在牌堆中正常存在（不出错即通过）', () => {
  const st = runFullGame(20260817);
  const deckSkills = {};
  st.used.concat(st.seats.flatMap(s => s.hand.concat(s.market))).forEach(c => {
    if (c && c.skill) deckSkills[c.skill] = (deckSkills[c.skill] || 0) + 1;
  });
  assert.ok(Object.keys(deckSkills).length > 0, '牌堆中应出现技能');
});

test('种子码原串保留：字符串种子存 seedRaw，数字/缺省为 null', () => {
  const s1 = Core.createGame({ seatCount: 2, names: ['A', 'B'], aiMask: [true, true], seed: 'abc123' });
  assert.equal(s1.seedRaw, 'abc123', '字符串种子应原样保留到 seedRaw');
  assert.equal(typeof s1.seed, 'number', 'seed 仍是可复现的 hash 数字');
  assert.equal(Core.createGame({ seatCount: 2, names: ['A', 'B'], aiMask: [true, true], seed: 42 }).seedRaw, null, '数字种子 seedRaw 应为 null');
  assert.equal(Core.createGame({ seatCount: 2, names: ['A', 'B'], aiMask: [true, true] }).seedRaw, null, '缺省种子 seedRaw 应为 null');
});

