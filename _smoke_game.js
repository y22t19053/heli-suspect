/* 一次性冒烟测试：双 AI 完整对局 5 轮，验证收入逐人日志、保底 +1⊙、新位置技能不抛错 */
'use strict';
const Core = require('./shared/game-core.js');

const st = Core.createGame({ seatCount: 2, names: ['A', 'B'], aiMask: [true, true], seed: 20260817 });

function pumpAutoAdvance() {
  for (let k = 0; k < 20; k++) {
    if (st.gameOver) return;
    if (Core.needsAIAction(st).length) return;
    if (Core.humanActing(st).length) return;
    Core.advance(st);
  }
}

let guard = 0;
let incomes = [];
while (!st.gameOver && guard++ < 900) {
  pumpAutoAdvance();
  if (st.gameOver) break;
  const need = Core.needsAIAction(st);
  if (!need.length) { Core.advance(st); continue; }
  for (const seat of need) {
    const res = Core.aiAct(st, seat);
    if (res && res.msgs) {
      // 记录轮末收入
      res.msgs.forEach(m => {
        if (typeof m === 'string' && m.indexOf('发放律师费') >= 0) incomes.push(m);
      });
    }
  }
}

console.log('=== 对局结束：' + (st.gameOver ? '正常结束' : '超时中断（guard=' + guard + '）'));
console.log('胜者：' + st.winner + '（' + st.winType + '）  轮数：' + st.round);

// 收入日志验证
const payLogs = st.logs.filter(l => l.indexOf('发放律师费') >= 0);
console.log('\n=== 收入逐人日志（' + payLogs.length + ' 条）===');
payLogs.forEach(l => console.log('  ' + l));

// 保底验证：每个人每轮实得 >= 1
console.log('\n=== 保底检查 ===');
let minPay = 99, maxPay = 0;
const pays = [];
st.logs.forEach(l => {
  const m = l.match(/发放律师费 \+(\d+)⊙/);
  if (m) { const v = +m[1]; pays.push(v); if (v < minPay) minPay = v; if (v > maxPay) maxPay = v; }
});
console.log('  AI 行动消息收入条数：' + incomes.length);
console.log('  日志收入条数：' + pays.length + '  最小 ' + minPay + '⊙  最大 ' + maxPay + '⊙');
console.log('  全部 >= 1：' + pays.every(v => v >= 1));

// 新技能在牌堆中的存在性
const deckSkills = {};
st.used.concat(st.seats.flatMap(s => s.hand.concat(s.market))).forEach(c => {
  if (c && c.skill) deckSkills[c.skill] = (deckSkills[c.skill] || 0) + 1;
});
console.log('\n=== 本局出现技能 ===');
console.log('  ' + JSON.stringify(deckSkills));

console.log('\n=== 角色（3 选 1 候选池）===');
console.log('  ' + JSON.stringify(Core.data.CHARACTERS.map(c => c.name + '(' + c.skill.type + ')')));
