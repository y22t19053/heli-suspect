/* ===== engine/12-income.js（game-core.js 行 1412-1494）===== */
  /* ---------------- 分发每轮 ⊙ ---------------- */
  function beginIncome(state) {
    state.phase = 'income';
    const prevRank = state.rankInfo;
    const hasPrev = prevRank && prevRank.length > 0;
    const first = hasPrev ? prevRank[0].seat : -1;
    const last = hasPrev ? prevRank[prevRank.length - 1].seat : -1;
    const tax = hasPrev && state.leaderStreak >= 2 ? 1 : 0;   // 连任恐惧税：下轮刷新起点 +1
    const base = incomeOf(state.round);                        // 固定 2
    state.seats.forEach((s, i) => {
      const pbonus = (s.personality && s.personality.bonus && s.personality.bonus.money) || 0;
      let amt = base + pbonus;
      if (!hasPrev) amt += 2;       // 第 1 轮无排名：全体 +4 启动资金
      else {
        if (i === first) amt -= 1;  // 领先税：榜首 -1⊙（政治资本消耗）
        if (i === last) amt += 1;   // 保底酬金：末位 +1⊙（胜诉基金）
      }
      // 永久规则（黑天鹅·疲劳轰炸）：每轮收入 -1⊙
      if (state.permaRules && state.permaRules.fatigueTax && state.permaRules.fatigueTax[i]) amt -= 1;
      // 收入保底：每轮至少 +1⊙（榜首 -1 + 疲劳轰炸 -1 时也不会白板回合）
      const pay = Math.max(1, amt);
      s.money += pay;
      state.logs.push('💰 【' + s.name + '】发放律师费 +' + pay + '⊙（累计 ' + s.money + '⊙）');
    });
    state.logs.push(hasPrev
      ? '第 ' + state.round + ' 轮结束，发放律师费（榜首 -1⊙ / 末位 +1⊙）' + (tax ? '，连任榜首更换证物架成本 +1' : '')
      : '第 ' + state.round + ' 轮结束，发放启动酬金 +4⊙');
    if (state.permaRules && state.permaRules.fatigueTax) {
      state.seats.forEach((s, i) => { if (state.permaRules.fatigueTax[i]) state.logs.push('📜 疲劳轰炸：' + s.name + ' 每轮收入 -1⊙（超负荷庭审开销）'); });
    }
    // 轮末：市场未买牌洗回，锁定牌留作下轮
    state.seats.forEach((s, i) => {
      s.lastLockedUids = s.lockedUids.slice();
      const kept = s.market.filter(c => s.lockedUids.indexOf(c.uid) >= 0);
      const rest = s.market.filter(c => s.lockedUids.indexOf(c.uid) < 0);
      state.used.push(...rest);
      s.market = kept.slice();
      s.lockedUids = [];
      // 重置每轮状态
      s.buyDone = false; s.playDone = false; s.eventCount = 0; s.eventPassed = false; s.buyUsed = false;
      s.refreshUsed = false;
      s.refreshCost = (tax && i === first) ? 2 : 1;   // 连任恐惧税：榜首下轮刷新起点 +1
    });
    state.voteMod = new Array(state.seatCount).fill(0);
    state.supportBuff = new Array(state.seatCount).fill(0);
  }
  function finishGame(state, opts) {
    opts = opts || {};
    const n = state.seatCount;
    state.gameOver = true;
    // 胜利路径 1：陪审团否决（立即胜诉，已由 doCountContinue 直接触发）
    if (opts.juryNull) {
      const winner = (state.juryTokens || []).indexOf(Math.max(...(state.juryTokens || [])));
      state.winner = winner >= 0 ? winner : 0;
      state.winType = 'juryNull';
      state.logs.push('🕊️ 陪审团否决裁定生效：人民拒绝适用恶法');
      state.logs.push('🏆 ' + state.seats[state.winner].name + ' 胜诉！（陪审团否决）');
      return;
    }
    // 胜利路径 2：先例胜利——触发"确立先例"的一方即使票数落后也直接获胜
    if (state.precedentSeat !== undefined && state.precedentSeat >= 0) {
      state.winner = state.precedentSeat;
      state.winType = 'precedent';
      state.logs.push('⚖️ 先例胜利：虽然票数落后，但【' + state.seats[state.winner].name + '】的辩护已确立判例，后世将以此为准');
      state.logs.push('🏆 ' + state.seats[state.winner].name + ' 胜诉！（先例胜利）');
      return;
    }
    // 胜利路径 3（默认）：无特殊情况第五轮结算后按照倾向判定胜者
    // 平衡修复（#48 千局测试发现）：平局不再按座位号偏袒（原 a.seat-b.seat 让座位 0 吃掉 91.9% 平局），
    // 改用种子 RNG 随机抽签——确定可复现且对所有座位公平。
    const maxSupport = Math.max(...state.seats.map(s => s.support));
    const tied = state.seats.filter(s => s.support === maxSupport);
    if (tied.length > 1) {
      const pick = tied[Math.floor(state.rng() * tied.length)];
      state.winner = pick.seat;
    } else {
      state.winner = state.seats.find(s => s.support === maxSupport).seat;
    }
    state.winType = 'support';
    state.logs.push('最终陪审团倾向：' + state.seats.map((s, i) => s.name + ' ' + s.support).join('，'));
    state.logs.push('🏆 ' + state.seats[state.winner].name + ' 胜诉！');
  }

