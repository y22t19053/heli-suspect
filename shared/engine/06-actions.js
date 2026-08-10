/* ===== engine/06-actions.js（game-core.js 行 655-761）===== */
  function buyCard(state, s, uid) {
    const card = s.market.find(c => c.uid === uid);
    if (!card) return { ok: false, msg: '该牌不在市场中' };
    const cost = buyCostOf(s, card);
    if (s.money < cost) return { ok: false, msg: '⊙ 不足' };
    if (s.buyDone) return { ok: false, msg: '已结束取证' };
    s.money -= cost; s.buyUsed = true;
    s.hand.push(card);
    s.market = s.market.filter(c => c !== card);
    if (state.deck.length) s.market.push(state.deck.pop());
    return { ok: true, msg: s.name + ' 传唤了【' + card.name + '】（-' + cost + '⊙）' };
  }
  function lockCard(state, s, uid) {
    const card = s.market.find(c => c.uid === uid);
    if (!card) return { ok: false, msg: '该牌不在市场中' };
    if (s.buyDone) return { ok: false, msg: '已结束取证' };
    const idx = s.lockedUids.indexOf(uid);
    if (idx >= 0) { s.lockedUids.splice(idx, 1); return { ok: true, msg: s.name + ' 取消了留证' }; }
    if (s.lockedUids.length >= lockMax(s)) return { ok: false, msg: '本轮最多留证 ' + lockMax(s) + ' 张' };
    if (s.lastLockedUids.indexOf(uid) >= 0) return { ok: false, msg: '不能连续两轮留证同一份证据' };
    s.lockedUids.push(uid);
    return { ok: true, msg: s.name + ' 留证了【' + card.name + '】（下轮保留）' };
  }
  function refreshMarket(state, s) {
    if (s.buyDone) return { ok: false, msg: '已结束取证' };
    const cost = refreshCostOf(s);
    if (s.money < cost) return { ok: false, msg: '⊙ 不足（换证需 ' + cost + '⊙）' };
    s.money -= cost; s.refreshUsed = true;
    s.refreshCost++;
    const kept = s.market.filter(c => s.lockedUids.indexOf(c.uid) >= 0);
    const rest = s.market.filter(c => s.lockedUids.indexOf(c.uid) < 0);
    state.used.push(...rest);
    s.market = kept.slice();
    while (s.market.length < marketSize(s)) {
      if (!state.deck.length) reshuffle(state);
      s.market.push(state.deck.pop());
    }
    return { ok: true, msg: s.name + ' 更换证物架（-' + cost + '⊙，下次 ' + s.refreshCost + '⊙）' };
  }
  function reshuffle(state) {
    if (state.used.length) { state.deck = shuffle(state.used, state.rng); state.used = []; }
  }

  /* ---------------- 出牌阶段（轮流 1 张：A→B→C→A→B→C 循环，行首尾相邻成环桌） ---------------- */
  function beginPlay(state) {
    state.phase = 'play';
    state.seats.forEach(s => { s.playDone = false; });
    state.playTurn = state.startingSeat;
    state.playLastSeat = -1;
    state.row = [];
    state.turn = state.playTurn;
    state.logs.push('举证阶段：' + state.seats[state.playTurn].name + ' 请暗置提交 1 份证据（或放弃）');
  }
  /* 下一个可行动座位（从当前座位之后按座位顺序循环，跳过已放弃/无牌者） */
  function nextPlaySeat(state) {
    const n = state.seatCount;
    for (let k = 1; k <= n; k++) {
      const seat = (state.playTurn + k) % n;
      const s = state.seats[seat];
      if (!s.playDone && s.hand.length > 0) return seat;
    }
    return -1;
  }
  /* 每回合只能暗置打出 1 张；打出后轮转到下一个可行动者（自己还有牌则下次轮到自己） */
  function playCards(state, s, uids) {
    if (state.phase !== 'play') return { ok: false, msg: '当前不是举证阶段' };
    if (state.turn !== s.seat) return { ok: false, msg: '还没轮到你' };
    if (s.playDone) return { ok: false, msg: '已放弃举证' };
    if (!uids || uids.length !== 1) return { ok: false, msg: '每回合只能暗置提交 1 份证据' };
    const card = s.hand.find(c => c.uid === uids[0]);
    if (!card) return { ok: false, msg: '手牌不存在' };
    s.hand = s.hand.filter(x => x !== card);
    state.row.push({ seat: s.seat, card: card, revealed: false });
    s.played.push(card);
    s.stats.playedCards++;
    s.stats.roundPlayed++;
    if (card.scandal > 0) s.stats.roundScandal++;
    if (PROCEDURAL_SKILLS.indexOf(card.skill) >= 0) s.stats.roundProcedural++;
    if (!card.skill && (card.votes || 1) >= 1) s.stats.roundWitness++;
    // 永久规则（黑天鹅）：程序滥用者打程序牌 +1⊙ 成本 / 丑闻围猎者打丑闻牌 +1⊙ 成本
    if (state.permaRules && state.permaRules.proceduralTax && state.permaRules.proceduralTax[s.seat] && PROCEDURAL_SKILLS.indexOf(card.skill) >= 0) {
      s.money = Math.max(0, s.money - 1);
      state.logs.push('💸 缠讼罚款：' + s.name + ' 打出程序牌额外 -1⊙（黑天鹅·程序滥用）');
    }
    if (state.permaRules && state.permaRules.scandalCost && state.permaRules.scandalCost[s.seat] && card.scandal > 0) {
      s.money = Math.max(0, s.money - 1);
      state.logs.push('💸 公关成本：' + s.name + ' 打出丑闻牌额外 -1⊙（黑天鹅·媒体围猎）');
    }
    state.logs.push(s.name + ' 暗置提交 1 份证据');
    // 轮转：还有手牌则轮到下一个可行动者（若只剩自己则继续轮到自己）
    if (s.hand.length > 0) {
      const next = nextPlaySeat(state);
      state.playTurn = next; state.turn = next;
      if (next === s.seat) state.logs.push('轮到 ' + s.name + ' 继续举证（或放弃）');
      else state.logs.push('轮到 ' + state.seats[next].name + ' 举证');
    }
    return { ok: true };
  }
  /* 任何轮到的玩家都可放弃出牌（不再要求"最后一名"） */
  function finishPlay(state, s) {
    if (state.phase !== 'play' || state.turn !== s.seat || s.playDone) return { ok: false, msg: '当前不能放弃举证' };
    s.playDone = true;
    state.logs.push(s.name + ' 放弃举证');
    return { ok: true };
  }

  /* ---------------- 亮出阶段（从左到右逐张亮出，恐怖分子按亮出顺序发动） ---------------- */
