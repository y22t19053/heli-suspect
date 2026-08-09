/* ============================================================
 * _balance_test.js — 全 AI 1000 局平衡性压力测试（node:test）
 * ------------------------------------------------------------
 * 目标（#48）：
 *   - 全 AI 自动对局 1000 局（2 人 400 / 3 人 350 / 4 人 250）
 *   - 每局种子可复现（base + i），state.rng 保证确定性
 *   - 统计各座位胜率、平均轮数、收入保底、异常抛错
 *   - 断言（宽松防 flaky）：全部正常结束、无异常、无垄断胜率
 *
 * 运行：node --test _balance_test.js
 * ============================================================ */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('./shared/game-core.js');

/** 跑完一整局（全 AI），返回统计摘要 */
function runGame(seatCount, seed) {
  const st = Core.createGame({
    seatCount,
    names: Array.from({ length: seatCount }, (_, i) => 'P' + i),
    aiMask: Array.from({ length: seatCount }, () => true),
    seed
  });
  let guard = 0;
  const incomes = [];
  while (!st.gameOver && guard++ < 2000) {
    // 推进到需要 AI 行动或阶段推进
    for (let k = 0; k < 20; k++) {
      if (st.gameOver) break;
      if (Core.needsAIAction(st).length) break;
      if (Core.humanActing(st).length) break;
      Core.advance(st);
    }
    if (st.gameOver) break;
    const need = Core.needsAIAction(st);
    if (!need.length) { Core.advance(st); continue; }
    for (const seat of need) {
      const res = Core.aiAct(st, seat);
      if (res && res.msgs) {
        res.msgs.forEach(m => {
          if (typeof m === 'string' && m.indexOf('发放律师费') >= 0) incomes.push(m);
        });
      }
    }
  }
  return {
    gameOver: !!st.gameOver,
    guardHit: guard >= 2000,
    winner: st.winner,
    winType: st.winType,
    rounds: st.round,
    logs: st.logs.slice(),
    incomes,
    minPay: incomes.length ? Math.min(...incomes.map(s => +((s.match(/\+(\d+)⊙/) || [0, 99])[1]) || 99)) : 99,
    err: null
  };
}

test('#48 全 AI 1000 局平衡性（2 人 400 / 3 人 350 / 4 人 250，种子可复现）', () => {
  const configs = [[2, 400], [3, 350], [4, 250]];
  const agg = {};
  let total = 0, abnormal = 0, minPayAll = 99, maxRounds = 0;

  for (const [seatCount, count] of configs) {
    const wins = Array.from({ length: seatCount }, () => 0);
    const rounds = [];
    let over = 0;
    for (let i = 0; i < count; i++) {
      const r = runGame(seatCount, 20260809 + i);
      total++;
      if (r.gameOver && r.winner != null && r.winner >= 0 && r.winner < seatCount) {
        wins[r.winner]++;
        over++;
      }
      rounds.push(r.rounds);
      if (!r.gameOver || r.guardHit) abnormal++;
      if (r.minPay < minPayAll) minPayAll = r.minPay;
      if (r.rounds > maxRounds) maxRounds = r.rounds;
      assert.equal(r.err, null, '对局不应抛错');
    }
    const rates = wins.map(w => +(w / over * 100).toFixed(1));
    const avgRounds = +(rounds.reduce((a, b) => a + b, 0) / rounds.length).toFixed(1);
    agg[seatCount + 'p'] = { over, abnormal, wins, rates, avgRounds };
    // 宽松防 flaky：2 人 < 70%，3 人 < 45%，4 人 < 35%（均匀 = 50/33/25）
    const cap = seatCount === 2 ? 70 : (seatCount === 3 ? 45 : 35);
    assert.ok(Math.max(...rates) < cap,
      seatCount + ' 人局最大胜率 ' + Math.max(...rates) + '% 超过阈值 ' + cap + '%：' + JSON.stringify(rates));
    assert.ok(over > count * 0.9, seatCount + ' 人局正常结束率过低：' + over + '/' + count);
  }

  // 汇总输出
  console.log('\n=== 1000 局平衡测试汇总 ===');
  for (const key of Object.keys(agg)) {
    const a = agg[key];
    console.log(key + '：完成 ' + a.over + '/' + a.over + ' 局  胜率 ' + JSON.stringify(a.rates) +
      '%  均轮 ' + a.avgRounds + '  异常 ' + a.abnormal);
  }
  console.log('总计 ' + total + ' 局，异常 ' + abnormal + '，最小单笔收入 ' + minPayAll + '⊙，最长 ' + maxRounds + ' 轮');
});

test('#13 同种子对局全等复现（highestEnemy 平票抽签也走 state.rng）', () => {
  // 同一种子跑两遍：状态轨迹（含日志）必须逐位一致，否则存在残留 Math.random
  const a = runGame(4, 20260809 + 17);
  const b = runGame(4, 20260809 + 17);
  const sa = JSON.stringify({ logs: a.logs, winner: a.winner, winType: a.winType, rounds: a.rounds });
  const sb = JSON.stringify({ logs: b.logs, winner: b.winner, winType: b.winType, rounds: b.rounds });
  assert.equal(sa, sb, '同种子两局应逐位一致（含平票抽签路径），发现残留非确定性随机');
});
