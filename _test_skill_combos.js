/* ============================================================
 * _test_skill_combos.js — doCountContinue 技能组合结算单测
 * ------------------------------------------------------------
 * 覆盖范围（保持原评审任务）：
 *   A. A 有 fan，B 有 troll
 *   B. A 有 orator，B 有 megaScandal
 *   C. tagBoost/tagHate 无条件化（标签系统已删）
 *   D. 封神技·合理怀疑（v93）
 *   E. 封神技·确立先例（v99）
 *   F. 封神技·陪审团否决（v100）
 *   G. finishGame 先例胜利 / 常规支持度胜利
 *   H. 黑天鹅事件行为触发（e55/e56/e59）
 *   I. 位置博弈系（v101 首座 / v102 末席 / v103 左翼 / v104 抽签）
 *   J. 收入保底（榜首 -1 + 疲劳轰炸 -1 仍 +1）+ 逐人日志
 *
 * 运行：node --test _test_skill_combos.js（或 npm test）
 * 说明：直接调用 Core 导出的测试钩子，构造完整结算状态，
 *       不经过完整对局流程，聚焦计票结算的确定性。
 * ============================================================ */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('./shared/game-core.js');

/* ---------------- 测试工具 ---------------- */

function findTemplate(id) {
  const tpl = Core.data.VOTER_TEMPLATES.find(t => t.id === id);
  if (!tpl) throw new Error('未知模板 ' + id);
  return tpl;
}

/**
 * 以 Core.createGame 生成完整 state，再改造成 count 阶段。
 * seats 数组表示每张牌所属座位；缺省时按 0,1,2... 顺序分配。
 * 清空 char/personality，避免角色/AI 被动加成干扰技能结算。
 */
function makeCountState(cardIds, seats) {
  const st = Core.createGame({
    seatCount: 2,
    names: ['A', 'B'],
    aiMask: [false, true],
    seed: 20260817
  });

  st.phase = 'count';
  st.round = 1;
  st.votes = [0, 0];
  st.voteMod = [0, 0];
  st.tagEvents = [];

  st.row = (cardIds || []).map((id, i) => {
    const tpl = findTemplate(id);
    return {
      seat: seats ? seats[i] : i,
      revealed: true,
      removed: false,
      card: Object.assign({}, tpl, { uid: 'test_' + i })
    };
  });

  st.seats.forEach(s => {
    s.char = null;
    s.personality = null;
    s.scandal = 0;
  });

  return st;
}

/** 创建 count 状态 → 执行 doCountContinue → 返回结算后 state */
function runCount(cardIds, seats) {
  const st = makeCountState(cardIds, seats);
  Core.doCountContinue(st);
  return st;
}

/** 构造 finishGame 测试用最小状态 */
function makeFinishState(opts) {
  opts = opts || {};
  const support = opts.support || [0, 0];
  return {
    seatCount: 2,
    seats: [0, 1].map(i => ({
      seat: i,
      name: 'P' + i,
      support: support[i] != null ? support[i] : 0
    })),
    precedentSeat: opts.precedentSeat != null ? opts.precedentSeat : -1,
    juryTokens: [0, 0],
    logs: [],
    winner: null,
    winType: 'support',
    gameOver: false
  };
}

/* ============================================================
 * 组合 A：A 有 fan（铁杆粉丝 lv1 本方 +1），B 有 troll（庭外抹黑 lv1 打最高）
 * 期望：fan 先 +1 至 2，troll 后打回 1
 * ============================================================ */
test('组合 A：fan vs troll', () => {
  const st = runCount(['v15', 'v16'], [0, 1]);   // v15 fan / v16 troll
  assert.deepEqual(st.votes, [1, 1], 'A=1 B=1');
  assert.ok(st.seats.every(s => s.scandal === 0), '无丑闻产生，scandal=' + st.seats.map(s => s.scandal));
});

/* ============================================================
 * 组合 B：A 有 orator（雄辩陈词 lv2 本方 +1），B 有 megaScandal（致命污点 lv3 最高敌 -2 + 丑闻）
 * 基础：A=1，B=0（v21 自带 scandal 1）；
 * orator 后 A=2，megaScandal 后 A=0、A.scandal=1
 * ============================================================ */
test('组合 B：orator vs megaScandal', () => {
  const st = runCount(['v17', 'v21'], [0, 1]);   // v17 orator / v21 megaScandal
  assert.deepEqual(st.votes, [0, 0], 'A=0 B=0');
  assert.deepEqual(st.seats.map(s => s.scandal), [1, 0], 'A 丑闻 0→1');
});

test('组合 B2：对照 orator + tagBoost（无 megaScandal）', () => {
  const st = runCount(['v17', 'v01'], [0, 1]);   // 对照：orator + tagBoost，无 megaScandal
  assert.deepEqual(st.votes, [2, 2], '对照：A=2 B=2');
});

/* ============================================================
 * 组合 C：tagBoost/tagHate 无条件化（标签系统已删，不依赖标签直接发动）
 * ============================================================ */
test('组合 C：tagBoost/tagHate 无条件化', () => {
  // A 有 v28 tagHate（最高敌 -1）+ v17 orator（本方 +1），B 有 v01 tagBoost（本方 +1）
  const st = runCount(['v28', 'v17', 'v01'], [0, 0, 1]);
  // 基础 A=2，B=1；①级：tagHate B-1=0、tagBoost B+1=1；②级：orator A+1=3
  assert.deepEqual(st.votes, [3, 1], 'A=3 B=1');
});

test('组合 C2：tagHate/tagBoost 互相抵消', () => {
  // 双方各一张：tagHate 减 B、tagBoost 加 B，互相抵消，均无条件发动
  const st = runCount(['v28', 'v01'], [0, 1]);
  assert.deepEqual(st.votes, [1, 1], '对照：A=1 B=1');
});

/* ============================================================
 * 组合 D：封神技·合理怀疑（手套证据 v93）
 * 对方证据 ≥3 时最高敌 -2
 * ============================================================ */
test('组合 D：合理怀疑（v93）', () => {
  // B 场上有 3 张，A 打出合理怀疑
  const st = runCount(['v93', 'v93', 'v93', 'v93'], [0, 1, 1, 1]);
  assert.deepEqual(st.votes, [1, 1], 'A=1 B=1（敌 3 张，-2）');
});

test('组合 D2：合理怀疑对照（敌 2 张不触发）', () => {
  const st = runCount(['v93', 'v93', 'v93'], [0, 1, 1]);
  assert.deepEqual(st.votes, [1, 2], '对照：敌 2 张不触发 → A=1 B=2');
});

/* ============================================================
 * 组合 E：封神技·确立先例（v99）
 * ============================================================ */
test('组合 E：确立先例（v99）', () => {
  const st = runCount(['v99', 'v15'], [0, 1]);   // v99 precedent / v15 fan
  assert.equal(st.precedentSeat, 0, 'precedentSeat = A（0）');
  assert.deepEqual(st.votes, [2, 2], 'A=2 B=2（先例 +1，fan +1）');
});

/* ============================================================
 * 组合 F：封神技·陪审团否决（v100）
 * 集满 3 名陪审员立即胜诉；首轮仅累积 1 名，不应结束
 * ============================================================ */
test('组合 F：陪审团否决（v100）', () => {
  const st = runCount(['v100', 'v01'], [0, 1]);
  assert.deepEqual(st.juryTokens, [1, 0], '第一轮：A 得 1 名陪审员');
  assert.ok(st.gameOver !== true, '未满 3 名不终止');
});

/* ============================================================
 * 组合 G：finishGame 胜利路径
 * ============================================================ */
test('组合 G1：先例胜利（支持度落后也直接获胜）', () => {
  const st = makeFinishState({ precedentSeat: 0, support: [1, 3] });
  Core.finishGame(st, {});
  assert.deepEqual([st.winner, st.winType], [0, 'precedent'], 'P0 触发先例 → 直接胜诉');
});

test('组合 G2：常规支持度胜利', () => {
  const st = makeFinishState({ precedentSeat: -1, support: [1, 3] });
  Core.finishGame(st, {});
  assert.deepEqual([st.winner, st.winType], [1, 'support'], '无先例 → 支持度高者胜');
});

/* ============================================================
 * 组合 H：黑天鹅事件行为触发
 * ============================================================ */
test('组合 H1：疲劳轰炸 e55 触发', () => {
  // 疲劳轰炸 e55：本轮打出 ≥3 张 → voteMod -1；无 flipNarrative 不抵消
  const st = makeCountState([], []);
  st.seats[0].stats.roundPlayed = 4;
  st.seats[0].hand.push({ skill: 'orator' });
  Core.checkBlackSwan(st);
  assert.deepEqual(st.voteMod, [-1, 0], '触发疲劳轰炸：A voteMod = -1');
  assert.ok(st.permaRules.fatigueTax && st.permaRules.fatigueTax[0] === true, '永久规则写入 fatigueTax[0]');
});

test('组合 H2：疲劳轰炸被 flipNarrative 抵消', () => {
  const st = makeCountState([], []);
  st.seats[0].stats.roundPlayed = 4;
  st.seats[0].hand.push({ skill: 'flipNarrative' });
  Core.checkBlackSwan(st);
  assert.deepEqual(st.voteMod, [0, 0], '被抵消：A voteMod 不变');
  assert.ok(!st.permaRules.fatigueTax || !st.permaRules.fatigueTax[0], '抵消后不写永久规则');
});

test('组合 H3：媒体围猎 e56 触发', () => {
  // 媒体围猎 e56：本轮打出 ≥2 张丑闻牌 → 全场丑闻 +1
  const st = makeCountState([], []);
  st.seats[0].stats.roundScandal = 2;
  Core.checkBlackSwan(st);
  assert.deepEqual(st.seats.map(s => s.scandal), [1, 1], '触发媒体围猎：双方丑闻 +1');
  assert.ok(st.permaRules.mediaHunt && st.permaRules.mediaHunt[0] === true, '永久规则写入 mediaHunt[0]');
});

test('组合 H4：树大招风 e59 触发', () => {
  // 树大招风 e59：连续领跑 2 轮 → 支持度 -1；无 reasonableDoubt 不抵消
  const st = makeCountState([], []);
  st.leaderStreak = 2;
  st.prevFirst = 0;
  st.seats[0].support = 5;
  st.seats[0].hand.push({ skill: 'crossExam' });
  Core.checkBlackSwan(st);
  assert.deepEqual(st.seats.map(s => s.support), [4, 0], '触发树大招风：A 支持度 5→4');
  assert.ok(st.permaRules.underdogBonus === true, '永久规则 underdogBonus 开启');
});

/* ============================================================
 * 组合 I：位置博弈系（v101 首座 / v102 末席 / v103 左翼 / v104 抽签）
 * ============================================================ */
test('组合 I1：首座质证 v101', () => {
  const st1 = runCount(['v101', 'v101'], [0, 1]);   // 行首=A（A 不触发）；B 的卡打行首 A → A-1
  assert.deepEqual(st1.votes, [0, 1], '行首=A：A=0 B=1');
  const st2 = runCount(['v101', 'v101'], [1, 0]);   // 行首=B（B 自己的牌不触发）；A 的卡打行首 B → B-1
  assert.deepEqual(st2.votes, [1, 0], '行首=B：A=1 B=0');
});

test('组合 I2：末席质证 v102', () => {
  const st1 = runCount(['v102', 'v102'], [0, 1]);   // 行尾=B → A 打 B
  assert.deepEqual(st1.votes, [1, 0], '行尾=B：A=1 B=0');
  const st2 = runCount(['v102', 'v102'], [1, 0]);   // 行尾=A → B 打 A
  assert.deepEqual(st2.votes, [0, 1], '行尾=A：A=0 B=1');
});

test('组合 I3：左翼壁垒 v103 叠加', () => {
  // 左翼壁垒：每张 v103 各结算一次（左半区本方牌各 +1）——两张叠加
  const st1 = runCount(['v103', 'v103', 'v103'], [0, 0, 1]);
  // 第 1 张 A 卡：A 左半 2 张 → +2；第 2 张 A 卡：再 +2 → A=2+4=6
  assert.deepEqual(st1.votes, [6, 1], 'A 两张左半区（各触发一次）→ A=6 B=1');
  const st2 = runCount(['v103', 'v103', 'v103'], [1, 0, 0]);
  // A 卡 i=1 左半：两次触发各 +1 → A=2+2=4；B 卡 i=0 左半：+1 → B=2
  assert.deepEqual(st2.votes, [4, 2], 'A 仅 i=1 左半（两次 +1）；B i=0 左半（+1）→ A=4 B=2');
});

test('组合 I4：抽签质证 v104', () => {
  // 抽签质证 v104：随机 1 张对方牌 -1（B 仅 1 张 → 必中）
  const st = runCount(['v104', 'v15'], [0, 1]);   // v15 fan 本方 +1
  assert.deepEqual(st.votes, [1, 1], 'B 唯一牌被命中（fan +1 再 -1）→ A=1 B=1');
});

/* ============================================================
 * 组合 J：收入保底（榜首 -1 + 疲劳轰炸 -1 时仍 +1，且逐人日志）
 * ============================================================ */
test('组合 J：收入保底 + 逐人日志', () => {
  const st = makeCountState([], []);
  st.round = 3;
  st.rankInfo = [{ seat: 0, support: 5 }, { seat: 1, support: 2 }];  // A 榜首 / B 末位
  st.permaRules = { fatigueTax: [true, false] };
  st.seats[0].money = 3;
  st.seats[1].money = 3;
  Core.beginIncome(st);
  // A：2 - 榜首1 - 疲劳1 = 0 → 保底 +1 → 4；B：2 + 末位1 = 3 → 6
  assert.deepEqual(st.seats.map(s => s.money), [4, 6], 'A 保底 +1（3→4）、B 末位 +1（3→6）');
  assert.ok(st.logs.some(l => l.indexOf('发放律师费 +1⊙') >= 0), '逐人收入日志（含保底 +1⊙），logs=' + JSON.stringify(st.logs));
  assert.ok(st.logs.some(l => l.indexOf('发放律师费 +3⊙') >= 0), '逐人收入日志（含末位 +3⊙）');
});

/* ---------------- 汇总（node:test 自动汇总，无需手动计数） ---------------- */

