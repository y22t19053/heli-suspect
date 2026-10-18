/* ===== engine/14-ai.js（game-core.js 行 1675-1844）===== */
    state.phase = 'discard';
    state.discardSeat = -1;
    // 被【移除】的牌已在证据排除结算时进档案；其余洗回牌堆
    state.row.forEach(r => { if (!r.removed) state.used.push(r.card); });
    state.row = [];
    state.seats.forEach(s => { s.keepDone = false; s.played = []; });
    // 找到第一个手牌>0 且未保留的玩家
    const next = nextKeepSeat(state);
    state.discardSeat = next;
    if (next >= 0) {
      state.turn = next;
      state.logs.push('整理阶段：' + state.seats[next].name + ' 请保留最多 ' + keepMaxOf(state.seats[next]) + ' 份证据（其余归档）');
    }
  }
  function keepMaxOf(s) {
    return 2 + ((s.char && s.char.skill.type === 'keepPlus') ? s.char.skill.v : 0);
  }
  function nextKeepSeat(state) {
    for (let i = 0; i < state.seatCount; i++) {
      const s = state.seats[i];
      if (!s.keepDone && s.hand.length > 0) return i;
    }
    return -1;
  }
  function keepCard(state, s, uid) {
    if (state.phase !== 'discard' || state.discardSeat !== s.seat) return { ok: false, msg: '还没轮到你整理' };
    const card = s.hand.find(c => c.uid === uid);
    if (!card) return { ok: false, msg: '手牌不存在' };
    const keepMax = keepMaxOf(s);
    if (s.keepUids && s.keepUids.length >= keepMax) return { ok: false, msg: '最多保留 ' + keepMax + ' 张' };
    s.keepUids = s.keepUids || [];
    if (s.keepUids.indexOf(uid) >= 0) { s.keepUids = s.keepUids.filter(x => x !== uid); return { ok: true }; }
    s.keepUids.push(uid);
    return { ok: true };
  }
  function finishKeep(state, s) {
    if (state.phase !== 'discard' || state.discardSeat !== s.seat) return { ok: false, msg: '还没轮到你' };
    const keepMax = keepMaxOf(s);
    const kept = s.keepUids || [];
    if (kept.length < Math.min(keepMax, s.hand.length)) return { ok: false, msg: '请先选择要保留的证据' };
    // 未保留的手牌洗入牌堆
    const rest = s.hand.filter(c => kept.indexOf(c.uid) < 0);
    state.used.push(...rest);
    s.hand = s.hand.filter(c => kept.indexOf(c.uid) >= 0);
    s.keepDone = true;
    s.keepUids = [];
    state.logs.push(s.name + ' 保留了 ' + kept.length + ' 份证据');
    const next = nextKeepSeat(state);
    state.discardSeat = next;
    state.turn = next;
    if (next >= 0) state.logs.push('整理阶段：' + state.seats[next].name + ' 请保留最多 ' + keepMaxOf(state.seats[next]) + ' 份证据');
    return { ok: true };
  }

  /* ---------------- 分发每轮 ⊙ ---------------- */
  function beginIncome(state) {
    state.phase = 'income';
    const prevRank = state.rankInfo;
    const hasPrev = prevRank && prevRank.length > 0;
    const first = hasPrev ? prevRank[0].seat : -1;
    const tax = hasPrev && state.leaderStreak >= 2 ? 1 : 0;   // 连任恐惧税：下轮刷新起点 +1（不影响收入）
    // 固定律师费（评审 P0-2）：删掉榜首 -1 / 末位 +1 / 保底，每轮 incomeOf(round)
    const base = incomeOf(state.round);
    state.seats.forEach((s, i) => {
      const pbonus = (s.personality && s.personality.bonus && s.personality.bonus.money) || 0;
      let amt = base + pbonus;
      if (!hasPrev) amt += 2;       // 第 1 轮无排名：全体 +4 启动资金
      s.money += amt;
      state.logs.push('【' + s.name + '】发放律师费 +' + amt + '⊙（累计 ' + s.money + '⊙）');
    });
    state.logs.push(hasPrev
      ? '第 ' + state.round + ' 轮结束，发放固定律师费'
      : '第 ' + state.round + ' 轮结束，发放启动酬金 +4⊙');
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
      state.logs.push('陪审团否决裁定生效：人民拒绝适用恶法');
      state.logs.push(state.seats[state.winner].name + ' 胜诉！（陪审团否决）');
      return;
    }
    // 胜利路径 2：先例胜利——触发"确立先例"的一方即使票数落后也直接获胜
    if (state.precedentSeat !== undefined && state.precedentSeat >= 0) {
      state.winner = state.precedentSeat;
      state.winType = 'precedent';
      state.logs.push('先例胜利：虽然票数落后，但【' + state.seats[state.winner].name + '】的辩护已确立判例，后世将以此为准');
      state.logs.push(state.seats[state.winner].name + ' 胜诉！（先例胜利）');
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
    state.logs.push(state.seats[state.winner].name + ' 胜诉！');
  }

  /* ---------------- 玩家动作 ---------------- */
  function apply(state, seat, action) {
    if (seat < 0 || seat >= state.seats.length) return { ok: false, msg: '非法座位' };
    const s = state.seats[seat];
    if (!action || !action.type) return { ok: false, msg: '未知操作' };
    const msgs = [];
    let res = { ok: true };
    switch (action.type) {
      case 'pickChar': {
        if (state.phase !== 'pickChar' || s.char) return { ok: false, msg: '当前不能选择角色' };
        const cand = (state.draftCandidates[seat] || []).find(c => c.id === action.charId);
        if (!cand) return { ok: false, msg: '非法角色' };
        s.char = cand;
        s.camp = cand.camp;
        if (cand.skill.type === 'startMoney') s.money += cand.skill.v;
        msgs.push(s.name + ' 选择了【' + cand.name + '】');
        break;
      }
      case 'pickStarter': {
        if (state.phase !== 'chooseStarter') return { ok: false, msg: '当前不是选择起始玩家阶段' };
        if (state.starterChosen) return { ok: false, msg: '起始玩家已选定，不能重复指定' };
        if (state.starterPicker !== seat) return { ok: false, msg: '不由你选择起始玩家' };
        if (action.starterSeat === undefined || action.starterSeat < 0 || action.starterSeat >= state.seatCount) return { ok: false, msg: '非法选择' };
        state.startingSeat = action.starterSeat;
        state.starterChosen = true;
        msgs.push(s.name + ' 指定【' + state.seats[action.starterSeat].name + '】开始本轮');
        break;
      }
      case 'buyCard': {
        res = buyCard(state, s, action.uid);
        break;
      }
      case 'lockCard': {
        res = lockCard(state, s, action.uid);
        break;
      }
      case 'refreshMarket': {
        res = refreshMarket(state, s);
        break;
      }
      case 'endBuy': {
        if (state.phase !== 'buy' || s.buyDone) return { ok: false, msg: '当前不能结束取证' };
        s.buyDone = true;
        msgs.push(s.name + ' 完成取证');
