/* ===== engine/02-numeric.js（game-core.js 行 341-363）===== */
  /* 事件牌按轮次解锁：轮1→①；轮2~3→①②；轮4+→①②③ */
  function eventLvMax(round) { return round <= 1 ? 1 : (round <= 3 ? 2 : 3); }
  /* 每轮结束发放的 ⊙（卡牌降价后同步加钱，保证买得起更多牌） */
  function incomeOf(round) { return 2; }   // 固定基础收入（卡价压缩后 2⊙ 即可循环买牌；末位+1/榜首-1 动态调整见 beginIncome）
  /* 支持度奖励 */
  function rewardOf(round) { return round <= 3 ? 2 : (round === 4 ? 3 : 4); }
  /* 市场槽位数（初始 4，组织能手 +1） */
  function marketSize(s) { return 4 + ((s.char && s.char.skill.type === 'drawPlus') ? s.char.skill.v : 0); }
  /* 购买价（全局 -1 降价；铁腕大状再 -1） */
  function buyCostOf(s, card) {
    let cost = Math.max(1, card.cost - 1 - ((s.char && s.char.skill.type === 'buyDiscount') ? s.char.skill.v : 0));
    return cost;
  }
  /* 刷新成本（幕后金主 -1；外交官每轮首次免费） */
  function refreshCostOf(s) {
    let c = s.refreshCost;
    if (s.char && s.char.skill.type === 'refreshDiscount') c = Math.max(0, c - s.char.skill.v);
    if (s.char && s.char.skill.type === 'firstRefreshFree' && !s.refreshUsed && !s.buyUsed) c = 0;
    return c;
  }
  /* 锁定上限（务实派 2 张） */
  function lockMax(s) { return 1 + ((s.char && s.char.skill.type === 'lockPlus') ? s.char.skill.v : 0); }

