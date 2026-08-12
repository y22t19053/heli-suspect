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
 *   I. 位置博弈系（v101 首座 / v102 末席 / v103 左翼 / v104 抽签）
 *   J. 收入分发（榜首 -1 / 末位 +1 / 保底 +1）+ 逐人日志
 *
 * 运行：node --test _test_skill_combos.js（或 npm test）
 * 说明：直接调用 Core 导出的测试钩子，构造完整结算状态，
 *       不经过完整对局流程，聚焦计票结算的确定性。
 *
 * ⑦ 庭审阶段克制权重：makeCountState 固定 round=1（开庭陈述），
 *     该轮所有 emotion 流派技能卡 +1 票（见 engine/02-numeric.js phaseArchOf）。
 *     各期望值均已计入此阶段加成。
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
 * 期望：基础 1-1；⑦R1 开庭陈述 emotion：fan +1 → A=2；
 *       fan 技能 +1 → 3，troll 打最高敌 → 2
 * ============================================================ */
test('组合 A：fan vs troll', () => {
  const st = runCount(['v15', 'v16'], [0, 1]);   // v15 fan / v16 troll
  assert.deepEqual(st.votes, [2, 1], 'A=2 B=1（⑦emotion +1 后 fan+1、troll-1）');
  assert.ok(st.seats.every(s => s.scandal === 0), '无丑闻产生，scandal=' + st.seats.map(s => s.scandal));
});

/* ============================================================
 * 组合 B：A 有 orator（雄辩陈词 lv2 本方 +1），B 有 megaScandal（致命污点 lv3 最高敌 -2 + 丑闻）
 * 基础：A=1，B=0（v21 自带 scandal 1）；
 * ⑦R1 emotion：orator +1 → A=2；orator 后 A=3，
 * megaScandal 后 A=1、A.scandal=1
 * ============================================================ */
test('组合 B：orator vs megaScandal', () => {
  const st = runCount(['v17', 'v21'], [0, 1]);   // v17 orator / v21 megaScandal
  assert.deepEqual(st.votes, [1, 0], 'A=1 B=0（⑦emotion +1，megaScandal -2）');
  assert.deepEqual(st.seats.map(s => s.scandal), [1, 0], 'A 丑闻 0→1');
});

test('组合 B2：对照 orator + tagBoost（无 megaScandal）', () => {
  const st = runCount(['v17', 'v01'], [0, 1]);   // 对照：orator + tagBoost，无 megaScandal
  assert.deepEqual(st.votes, [3, 2], '对照：A=3 B=2（⑦emotion +1、orator +1、tagBoost +1）');
});

/* ============================================================
 * 组合 C：tagBoost/tagHate 无条件化（标签系统已删，不依赖标签直接发动）
 * ============================================================ */
test('组合 C：tagBoost/tagHate 无条件化', () => {
  // A 有 v28 tagHate（最高敌 -1）+ v17 orator（本方 +1），B 有 v01 tagBoost（本方 +1）
  const st = runCount(['v28', 'v17', 'v01'], [0, 0, 1]);
  // 基础 A=2，B=1；⑦R1 emotion：orator A+1=3；①级：tagHate B-1=0、tagBoost B+1=1；②级：orator A+1=4
  assert.deepEqual(st.votes, [4, 1], 'A=4 B=1');
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
  // 基础 1-1；⑦emotion：precedent +1、fan +1 → 2-2；lv2 fan +1、lv3 precedent +1 → 3-3
  assert.deepEqual(st.votes, [3, 3], 'A=3 B=3（⑦emotion +2，先例 +1，fan +1）');
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
  // 基础 1-1；⑦emotion：fan（B）B+1=2；lv1 randomHit B-1=1；lv2 fan B+1=2
  assert.deepEqual(st.votes, [1, 2], 'B 唯一牌被命中（fan ②级 +1 再被 -1）→ A=1 B=2');
});

/* ============================================================
 * 组合 L：连横合纵 v105（左右博弈三态：连横 +N / 夹敌 -1 / 单侧不触发）
 * ============================================================ */
test('组合 L1：连横合纵 v105 左右连横（三张连坐）', () => {
  // 三张 A 连坐：每张各结算一次「本方所有已亮牌 +1」→ 基础3 + 3次×3张 = 12
  const st = runCount(['v105', 'v105', 'v105'], [0, 0, 0]);
  assert.deepEqual(st.votes, [12, 0], '三张 A 连横 → A=12 B=0');
});

test('组合 L2：连横合纵 v105 左右夹敌（孤敌减票）', () => {
  // A 孤悬敌阵中央（左右都是 B）：最高敌 -1 → B 基础 2 减为 1
  const st = runCount(['v105', 'v105', 'v105'], [0, 1, 1]);
  assert.deepEqual(st.votes, [1, 1], 'A 孤敌：最高敌 B -1 → A=1 B=1');
});

test('组合 L3：连横合纵 v105 单侧邻友不触发（对照）', () => {
  // 行 A A B：i=0/i=1 的 A 均单侧邻友 → 不触发；i=2 的 B 左右都是敌 → 最高敌 A -1
  const st = runCount(['v105', 'v105', 'v105'], [0, 0, 1]);
  assert.deepEqual(st.votes, [1, 1], 'A 单侧不触发；B 双敌夹击 A-1 → A=1 B=1');
});

/* ============================================================
 * 组合 J：收入分发（榜首 -1 / 末位 +1 / 保底 +1，逐人日志）
 * ============================================================ */
test('组合 J：收入分发 + 逐人日志', () => {
  const st = makeCountState([], []);
  st.round = 3;
  st.rankInfo = [{ seat: 0, support: 5 }, { seat: 1, support: 2 }];  // A 榜首 / B 末位
  st.seats[0].money = 3;
  st.seats[1].money = 3;
  Core.beginIncome(st);
  // A：2 - 榜首1 = 1 → 3+1=4；B：2 + 末位1 = 3 → 3+3=6
  assert.deepEqual(st.seats.map(s => s.money), [4, 6], 'A 榜首 -1（3→4）、B 末位 +1（3→6）');
  assert.ok(st.logs.some(l => l.indexOf('发放律师费 +1⊙') >= 0), '逐人收入日志（含保底 +1⊙），logs=' + JSON.stringify(st.logs));
  assert.ok(st.logs.some(l => l.indexOf('发放律师费 +3⊙') >= 0), '逐人收入日志（含末位 +3⊙）');
});

/* ============================================================
 * 组合 M：纳什均衡互锁技能（阶段 C）
 *   M1. audit 财务审计：对方金钱 ≥5 → 最高敌 -1
 *   M2. lobby 游说金：本方金钱 ≥5 → 本方 +1
 *   M3. endorse 名人背书：本方支持度落后 → 本方 +1
 *   M4. crossfire 交叉火力：对方已亮 ≥3 → 最高敌 -1
 *   M5. surge 民意浪潮：本方已亮 ≥3 → 本方 +1
 *   M6. veto 一票否决：对方本轮打过事件 → 最高敌 -2
 *   M7. momentum 势头：本方此前赢过轮次 → 本方 +1
 * ============================================================ */
test('组合 M1：audit 财务审计（对方有钱 → 查账 -1）', () => {
  const st = makeCountState(['v109'], [0]);   // v109 = audit
  st.seats[0].money = 2;
  st.seats[1].money = 6;                       // 对方 ≥5 → 触发
  Core.doCountContinue(st);
  // A 基础 1 票；audit 使最高敌 B -1 → B 0，A 保持 1
  assert.deepEqual(st.votes, [1, 0], '对方有钱时审计 -1：A=1 B=0');
});

test('组合 M2：lobby 游说金（本方有钱 → 买票 +1）', () => {
  const st = makeCountState(['v110'], [0]);   // v110 = lobby
  st.seats[0].money = 6;                       // 本方 ≥5 → 触发
  Core.doCountContinue(st);
  assert.deepEqual(st.votes, [2, 0], '本方有钱时游说 +1：A=2 B=0');
});

test('组合 M3：endorse 名人背书（支持度落后 → +1）', () => {
  const st = makeCountState(['v111'], [0]);   // v111 = endorse
  st.seats[0].support = 1;
  st.seats[1].support = 3;                     // 本方落后 → 触发
  Core.doCountContinue(st);
  // 基础 1；⑦emotion +1 → 2；endorse lv2 触发 +1 → 3
  assert.deepEqual(st.votes, [3, 0], '支持度落后时背书 +1（⑦emotion +1）：A=3 B=0');
});

test('组合 M4：crossfire 交叉火力（对方铺场 ≥3 → -1）', () => {
  // A: fan×3（铺场 3 张）; B: crossfire + fan
  // crossfire 看到对方（A）已亮 3 张 → 最高敌 A -1
  // 基础 3-2；⑦emotion：A 3 fan +3=6、B fan +1=3
  // lv1：crossfire A-1=5、3 fan A+3=8、B fan B+1=4
  const st = runCount(['v15', 'v15', 'v15', 'v112', 'v15'], [0, 0, 0, 1, 1]);
  assert.deepEqual(st.votes, [8, 4], '对方铺场 3 张时交叉火力 -1（⑦emotion +4）：A=8 B=4');
});

test('组合 M5：surge 民意浪潮（本方铺场 ≥3 → +1）', () => {
  // A: surge + fan + fan = 3 张 → 本方 +1；B: fan
  // 基础 3-1；⑦emotion：A 3 张 +3=6、B +1=2；lv1 fan×2 A+2=8、B fan+1=3；lv2 surge +1 → 9
  const st = runCount(['v113', 'v15', 'v15', 'v15'], [0, 0, 0, 1]);
  assert.deepEqual(st.votes, [9, 3], '本方 3 张时民意浪潮 +1（⑦emotion +4）：A=9 B=3');
});

test('组合 M6：veto 一票否决（对方本轮打过事件 → -2）', () => {
  const st = makeCountState(['v114'], [0]);   // v114 = veto
  st.seats[1].eventCount = 1;                  // B 本轮打过事件 → 触发
  Core.doCountContinue(st);
  // A 基础 1 票；veto 使最高敌 B -2 → B 0，A 保持 1
  assert.deepEqual(st.votes, [1, 0], '对方打事件时否决 -2：A=1 B=0');
});

test('组合 M7：momentum 势头（此前赢过轮次 → +1）', () => {
  const st = makeCountState(['v115'], [0]);   // v115 = momentum
  st.seats[0].stats.roundsWon = 2;             // 本方赢过 → 触发
  Core.doCountContinue(st);
  // 基础 1；⑦emotion +1 → 2；momentum lv3 触发 +1 → 3
  assert.deepEqual(st.votes, [3, 0], '此前赢过时势头 +1（⑦emotion +1）：A=3 B=0');
});

test('组合 M8：veto 对方未打事件不触发（对照）', () => {
  const st = makeCountState(['v114'], [0]);
  st.seats[1].eventCount = 0;                  // 对方未打事件 → 不触发
  Core.doCountContinue(st);
  assert.deepEqual(st.votes, [1, 0], '对方未打事件时否决不触发：A=1 B=0');
});

/* ============================================================
 * 组合 N：庭审克制包（⑨：偏见揭露/最后一搏/证据链/禁言令/民意分裂/清廉档案）
 * 全部条件触发（非白板），与⑦庭审阶段克制权重联动。
 * R1=开庭陈述（emotion 加成）；本组攻击/物证类技能不受阶段加成，
 * 期望值已按 ⑦ 规则核对。
 * ============================================================ */
test('组合 N1：bias 偏见揭露（对方铺场 ≥4 → 对方所有已亮牌各 -1）', () => {
  // A: v117 bias；B: 4×v01 tagBoost → B 铺场 4 触发 AOE -4
  const st = runCount(['v117', 'v01', 'v01', 'v01', 'v01'], [0, 1, 1, 1, 1]);
  // 基础 1-4；lv1 tagBoost×4 B=8；lv3 bias B 铺场 4 → 每张 -1 → B=4
  assert.deepEqual(st.votes, [1, 4], 'B 铺场 4 张时被 AOE -4：A=1 B=4');
});

test('组合 N1b：bias 对照（对方仅 3 张不触发）', () => {
  const st = runCount(['v117', 'v01', 'v01', 'v01'], [0, 1, 1, 1]);
  // 基础 1-3；lv1 tagBoost×3 B=6；bias 3<4 不触发
  assert.deepEqual(st.votes, [1, 6], '对方 3 张不触发：A=1 B=6');
});

test('组合 N2：hailMary 最后一搏（落后 ≥2 且本方铺场 ≥3 → +3）', () => {
  // A: v118 + fan×2（3 张，全 emotion）；B: 4×v01 tagBoost
  const st = runCount(['v118', 'v15', 'v15', 'v01', 'v01', 'v01', 'v01'], [0, 0, 0, 1, 1, 1, 1]);
  // 基础 3-4；⑦emotion：A 全 emotion +3 → 6；lv1 tagBoost×4 B=8、fan×2 A=8
  // lv3 hailMary：A=8 ≤ B-2=6？否 → 不触发（但 v118 无条件 stage +1 已计入）
  assert.deepEqual(st.votes, [8, 8], '落后不足不触发：A=8 B=8');
  const st2 = runCount(['v118', 'v15', 'v15', 'v01', 'v01', 'v01', 'v01', 'v01'], [0, 0, 0, 1, 1, 1, 1, 1]);
  // 基础 3-5；⑦emotion A=6；lv1 tagBoost×5 B=10、fan×2 A=8
  // lv3 hailMary：A=8 ≤ B-2=8 ✓ 且铺场 3 ✓ → A=11
  assert.deepEqual(st2.votes, [11, 10], '落后 ≥2 且铺场 ≥3 时 +3：A=11 B=10');
});

test('组合 N3：fullChain 证据链完整（本方物证 ≥2 → 本方所有已亮牌 +1）', () => {
  // A: v119 fullChain + v94 timelineSnipe + v23 donor（3 张物证）；B: v15 fan
  const st = runCount(['v119', 'v94', 'v23', 'v15'], [0, 0, 0, 1]);
  // 基础 3-1；⑦emotion：B fan +1=2；lv1 fan B=3
  // lv3 timelineSnipe：B 无物证不触发；fullChain：A 物证 3 ≥2 → A 全部 +3 → A=6
  assert.deepEqual(st.votes, [6, 3], '物证 ≥2 时整链 +1：A=6 B=3');
});

test('组合 N3b：fullChain 对照（物证不足不触发）', () => {
  const st = runCount(['v119', 'v15', 'v15'], [0, 0, 1]);
  // 基础 2-1；⑦emotion：A fan +1=3、B fan +1=2；lv1 fan×2 A=4、B=3
  // lv3 fullChain：A 物证仅 1（v119）<2 → 不触发
  assert.deepEqual(st.votes, [4, 3], '物证不足不触发：A=4 B=3');
});

test('组合 N4：gagOrder 禁言令（对方本轮打过 ≥3 张 → 最高对方 -2）', () => {
  const st = makeCountState(['v120', 'v15'], [0, 1]);   // v120 = gagOrder；B 有 fan
  st.seats[1].played = ['x', 'y', 'z'];        // B 本轮打过 3 张 → 触发
  Core.doCountContinue(st);
  // 基础 1-1；⑦emotion：B fan +1=2；lv1 fan B=3；lv3 gagOrder：最高敌 B -2 → B=1
  assert.deepEqual(st.votes, [1, 1], '对方打过 3 张时 -2：A=1 B=1');
});

test('组合 N4b：gagOrder 对照（对方仅打过 2 张不触发）', () => {
  const st = makeCountState(['v120', 'v15'], [0, 1]);
  st.seats[1].played = ['x', 'y'];
  Core.doCountContinue(st);
  // 基础 1-1；⑦emotion：B fan +1=2；lv1 fan B=3；gagOrder 2<3 不触发
  assert.deepEqual(st.votes, [1, 3], '对方 2 张不触发：A=1 B=3');
});

test('组合 N5：split 民意分裂（双方已亮牌数相等 → 双方最高票各 -1）', () => {
  // A: v121 + fan；B: fan×2 → 双方各 2 张相等
  const st = runCount(['v121', 'v15', 'v15', 'v15'], [0, 0, 1, 1]);
  // 基础 2-2；⑦emotion：A fan +1=3、B fan×2 +2=4；lv1 fan×2 A=4、B=6
  // lv2 split：2=2 ✓ → A-1=3、最高敌 B-1=5
  assert.deepEqual(st.votes, [3, 5], '牌数相等两败俱伤：A=3 B=5');
});

test('组合 N5b：split 对照（牌数不等不触发）', () => {
  const st = runCount(['v121', 'v15', 'v15'], [0, 0, 1]);
  // 基础 2-1；⑦emotion：A fan +1=3、B fan +1=2；lv1 fan×2 A=4、B=3
  // lv2 split：2≠1 不触发
  assert.deepEqual(st.votes, [4, 3], '牌数不等不触发：A=4 B=3');
});

test('组合 N6：integrity 清廉档案（本方无丑闻且对方有丑闻 → +1⊙）', () => {
  // v122 integrity 为 post 技能，经 doSettle 结算（rank.update → advance）
  const st = makeCountState(['v122', 'v01'], [0, 1]);
  st.votes = [2, 1];
  st.roundRank = [0, 1];                     // A 第一（供 doSettle 使用）
  st.seats[1].scandal = 1;                   // B 有丑闻、A 无丑闻 → 触发
  const money0 = st.seats[0].money;
  const money1 = st.seats[1].money;
  st.phase = 'rank';
  Core.advance(st);                          // rank.update → doSettle → integrity
  assert.equal(st.seats[0].money, money0 + 1, 'A 清白且对方有丑闻 → +1⊙');
  assert.equal(st.seats[1].money, money1, 'B 的 ⊙ 不变');
});

test('组合 N6b：integrity 对照（双方均无丑闻不触发）', () => {
  const st = makeCountState(['v122', 'v01'], [0, 1]);
  st.votes = [2, 1];
  st.roundRank = [0, 1];
  const money0 = st.seats[0].money;
  st.phase = 'rank';
  Core.advance(st);
  assert.equal(st.seats[0].money, money0, '双方无丑闻 → 不触发');
});

/* ============================================================
 * 组合 K：幽灵事件牌（评审 bug）——事件牌打出后必须进档案
 * 背景：playEvent 曾只从手牌移除、不落任何全局数组 → AI 托管期间
 *       打掉的事件牌在断线快照恢复时经 cardInGlobal 查不到 → 幽灵复活。
 * 修复：playEvent 将已用事件牌 push 进 state.grave（cardInGlobal 已查 grave）。
 * 本测试在引擎级复刻 server.js 的 saveSnapshot/cardInGlobal/restoreSnapshot
 * 关键逻辑，验证修复后事件牌不会复活（确定性，无需起服务器）。
 * ============================================================ */

/** 构造 preEvent 阶段最小状态：两个座位各持 1 张 e01（当庭陈词 lv1 pre self） */
function makeEventState() {
  const st = Core.createGame({
    seatCount: 2, names: ['A', 'B'], aiMask: [false, true], seed: 20260917
  });
  st.phase = 'preEvent';
  st.round = 1;
  st.startingSeat = 0;
  st.eventTurnSeat = 0;
  st.turn = 0;
  st.seats.forEach(s => { s.eventCount = 0; s.eventPassed = false; s.events = []; });
  const tpl = Core.data.EVENT_TEMPLATES.find(t => t.id === 'e01');
  st.seats[0].events = [Object.assign({}, tpl, { uid: 'evt-1', used: false })];
  st.seats[1].events = [Object.assign({}, tpl, { uid: 'evt-2', used: false })];
  return st;
}

/** 复刻 server.js cardInGlobal：行区/牌堆/档案/他人手牌市场 */
function cardInGlobalReplica(st, seat, uid) {
  if (Array.isArray(st.row) && st.row.some(r => r.card && r.card.uid === uid)) return true;
  if (Array.isArray(st.used) && st.used.some(c => c.uid === uid)) return true;
  if (Array.isArray(st.grave) && st.grave.some(c => c.uid === uid)) return true;
  for (let i = 0; i < st.seats.length; i++) {
    if (i === seat) continue;
    const s2 = st.seats[i];
    if (s2 && Array.isArray(s2.hand) && s2.hand.some(c => c.uid === uid)) return true;
    if (s2 && Array.isArray(s2.market) && s2.market.some(c => c.uid === uid)) return true;
  }
  return false;
}

test('组合 K1：人类打出事件牌 → 进 grave + 快照恢复不复活', () => {
  const st = makeEventState();
  const snap = JSON.parse(JSON.stringify(st));   // 模拟 saveSnapshot（AI 接管前）

  const r = Core.apply(st, 0, { type: 'playEvent', uid: 'evt-1', targetSeat: null });
  assert.ok(r.ok, 'playEvent 应成功：' + (r && r.msg));
  assert.equal(st.phase, 'preEvent', '座位 1 仍有事件可出 → preEvent 不应自动流转');
  assert.deepEqual(st.seats[0].events, [], '打出后事件牌应从手牌移除');
  assert.ok(st.grave.some(c => c.uid === 'evt-1'), '已打出的事件牌应进档案 grave，实际 grave=' + st.grave.map(c => c.uid));
  assert.equal(st.seats[0].eventCount, 1, 'eventCount 应 +1（尚未进入 postEvent，不会被重置）');
  assert.deepEqual(st.voteMod, [1, 0], 'e01 效果：本方 +1 票');
  assert.ok(!st.grave.some(c => c.uid === 'evt-2'), '他人未打出的事件牌不应进档案');

  // 模拟 restoreSnapshot：快照私有事件牌过滤掉"已在全局"的牌
  const cur = st.seats[0];
  const old = snap.seats[0];
  const restored = old.events.filter(e => e && !cardInGlobalReplica(st, 0, e.uid));
  cur.events = restored;
  assert.deepEqual(cur.events, [], '快照恢复不应复活已打出的事件牌（幽灵牌 bug）');
});

test('组合 K2：AI 托管期间打事件牌 → 断线重连不复活（端到端语义）', () => {
  const st = makeEventState();
  // 场景：座位 1（AI/托管）行动前 saveSnapshot；AI 打掉事件牌；重连 restore
  const snap = JSON.parse(JSON.stringify(st));
  st.eventTurnSeat = 1; st.turn = 1;   // 轮到座位 1 行动

  // AI（座位 1）在 preEvent 轮到自己时打出事件牌（aiAct → aiEvents → playEvent）
  const r = Core.aiAct(st, 1);
  assert.ok(r && r.ok !== false, 'AI 应能执行动作：' + JSON.stringify(r));
  assert.deepEqual(st.seats[1].events, [], 'AI 打出后事件牌应被移除');
  assert.ok(st.grave.some(c => c.uid === 'evt-2'), 'AI 打掉的事件牌也应进档案');

  // 座位 1 重连：restoreSnapshot 语义（过滤掉已出现在全局的快照事件牌）
  const old = snap.seats[1];
  const revived = old.events.filter(e => e && !cardInGlobalReplica(st, 1, e.uid));
  assert.deepEqual(revived, [], '重连恢复后事件牌不应复活（修复前会以 used:false 复活并可二次生效）');

  // 二次验证：档案中的事件牌保留 used=true（即使被恢复也不会重复生效）
  const evt = st.grave.find(c => c.uid === 'evt-2');
  assert.ok(evt && evt.used === true, '档案中的事件牌应保留 used=true（防止二次生效）');
});

/* ---------------- 汇总（node:test 自动汇总，无需手动计数） ---------------- */

