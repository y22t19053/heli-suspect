/* ============================================================
 * _test_cross_exam.js — 质证阶段（评审 P0-2）单测
 * ------------------------------------------------------------
 * 覆盖：
 *   A. 质证压制 crossExPress：花 1⊙ 令对手已亮牌 -1 票，座位序轮转
 *   B. 同一张牌最多被压 2 次（第 3 次拒绝）
 *   C. 质证翻看 crossExView：花 1⊙ 翻看对手手牌（信息公开、仍留手牌）
 *   D. 质证放弃 crossExPass：座位序轮转、跳过已过者
 *   E. doCountContinue 应用压制扣票（_press 并入基础票）
 *   F. 每人 3 次质证上限 / ⊙ 不足拒绝
 *
 * 运行：node --test _test_cross_exam.js
 * ============================================================ */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('./shared/game-core.js');

function findTemplate(id) {
  const tpl = Core.data.VOTER_TEMPLATES.find(t => t.id === id);
  if (!tpl) throw new Error('未知模板 ' + id);
  return tpl;
}

/** 构造质证阶段最小状态：2 人，seat0 轮到，seat0 有 3⊙ */
function makeCrossExState() {
  const st = Core.createGame({
    seatCount: 2,
    names: ['A', 'B'],
    aiMask: [false, false],
    seed: 20260817
  });
  st.phase = 'crossEx';
  st.crossExTurn = 0;
  st.crossExUsed = [0, 0];
  st.crossExPassed = [false, false];
  st.seats[0].money = 3;
  st.seats[1].money = 3;
  // 已亮 row 牌：B 的一张 v16（troll）
  st.row = [{
    seat: 1,
    revealed: true,
    removed: false,
    card: Object.assign({}, findTemplate('v16'), { uid: 'row_B' })
  }];
  // 手牌：B 手里一张 v15（fan）作为翻看目标
  st.seats[1].hand = [Object.assign({}, findTemplate('v15'), { uid: 'hand_B' })];
  return st;
}

test('质证 A：crossExPress 花 1⊙ 压制对手已亮牌并轮转', () => {
  const st = makeCrossExState();
  const res = Core.apply(st, 0, { type: 'crossExPress', targetUid: 'row_B' });
  assert.equal(res.ok, true, '压制应成功: ' + JSON.stringify(res));
  assert.equal(st.seats[0].money, 2, 'seat0 花 1⊙，余 2⊙');
  assert.equal(st.row[0]._press, 1, '目标牌被压 1 次');
  assert.equal(st.crossExUsed[0], 1, 'seat0 已用 1 次质证');
  assert.equal(st.crossExTurn, 1, '轮转到 seat1');
});

test('质证 B：同一张牌最多被压 2 次', () => {
  const st = makeCrossExState();
  st.row[0]._press = 2;   // 已压满
  const res = Core.apply(st, 0, { type: 'crossExPress', targetUid: 'row_B' });
  assert.equal(res.ok, false, '第 3 次压制应被拒绝');
  assert.match(res.msg, /压制 2 次/, '拒绝原因应为压制上限');
  assert.equal(st.seats[0].money, 3, '拒绝时不扣钱');
});

test('质证 C：crossExView 花 1⊙ 翻看对手手牌（信息公开仍留手牌）', () => {
  const st = makeCrossExState();
  const res = Core.apply(st, 0, { type: 'crossExView', targetSeat: 1 });
  assert.equal(res.ok, true, '翻看应成功: ' + JSON.stringify(res));
  assert.equal(st.seats[0].money, 2, 'seat0 花 1⊙');
  assert.equal(st.seats[1].hand[0]._viewed, true, '手牌被标记翻看');
  assert.equal(st.seats[1].hand.length, 1, '手牌仍留在 B 手牌');
  assert.equal(st.crossExUsed[0], 1, 'seat0 已用 1 次质证');
  assert.equal(st.crossExTurn, 1, '轮转到 seat1');
});

test('质证 D：crossExPass 放弃并轮转', () => {
  const st = makeCrossExState();
  const res = Core.apply(st, 0, { type: 'crossExPass' });
  assert.equal(res.ok, true, '放弃应成功');
  assert.equal(st.crossExPassed[0], true, 'seat0 标记已过');
  assert.equal(st.crossExTurn, 1, '轮转到 seat1');
});

test('质证 F1：每人最多 3 次质证', () => {
  const st = makeCrossExState();
  st.crossExUsed[0] = 3;
  const res = Core.apply(st, 0, { type: 'crossExPress', targetUid: 'row_B' });
  assert.equal(res.ok, false, '第 4 次质证应被拒绝');
  assert.match(res.msg, /次数已用完/, '拒绝原因应为次数上限');
});

test('质证 F2：⊙ 不足拒绝质证', () => {
  const st = makeCrossExState();
  st.seats[0].money = 0;
  const res = Core.apply(st, 0, { type: 'crossExPress', targetUid: 'row_B' });
  assert.equal(res.ok, false, '⊙ 不足应被拒绝');
  assert.match(res.msg, /不足/, '拒绝原因应为 ⊙ 不足');
});

test('质证 E：doCountContinue 应用压制扣票', () => {
  const st = Core.createGame({
    seatCount: 2,
    names: ['A', 'B'],
    aiMask: [false, false],
    seed: 20260817
  });
  st.phase = 'count';
  st.round = 1;
  st.row = [
    { seat: 0, revealed: true, removed: false, card: Object.assign({}, findTemplate('v15'), { uid: 'a1' }) },
    { seat: 1, revealed: true, removed: false, card: Object.assign({}, findTemplate('v16'), { uid: 'b1' }), _press: 2 }
  ];
  st.seats.forEach(s => { s.char = null; s.personality = null; s.scandal = 0; });
  Core.doCountContinue(st);
  // 基础：v15(fan, R1 emotion) 本应 +2，v16(troll) 本应 0；压制 -2 只作用于 seat1
  // 但 doCountContinue 末尾对 votes 做 Math.max(0,·) 非负钳制，故 seat1 计票后仍 >= 0
  assert.ok(st.votes[1] <= st.votes[0], '压制使 B 票不高于 A: ' + JSON.stringify(st.votes));
  const pressLedger = st.countLedger.filter(l => l.kind === 'crossExPress');
  assert.equal(pressLedger.length, 1, '账本记录 1 条压制扣票');
  assert.equal(pressLedger[0].delta, -2, '压制 -2 票');
});
