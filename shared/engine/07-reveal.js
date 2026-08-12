/* ===== engine/07-reveal.js（game-core.js 行 762-864）===== */
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

  /* ---------------- 出牌阶段（每轮 1-2 张：A→B→C→A→B→C 循环，行首尾相邻成环桌） ---------------- */
  function beginPlay(state) {
    state.phase = 'play';
    state.seats.forEach(s => { s.playDone = false; });
    state.playTurn = state.startingSeat;
    state.playLastSeat = -1;
    state.row = [];
    state.turn = state.playTurn;
    state.logs.push('举证阶段：' + state.seats[state.playTurn].name + ' 请暗置提交 1-2 份证据（每轮至少 1 张，最后一位律师可放弃）');
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
  /* 每回合可暗置打出 1-2 张（每轮每人最多 2 张）；打出后轮转到下一个可行动者（自己还有牌则下次轮到自己）
   * 每轮必须出牌：仅当自己是最后一个还有手牌的律师时才允许放弃（见 finishPlay） */
  function playCards(state, s, uids) {
    if (state.phase !== 'play') return { ok: false, msg: '当前不是举证阶段' };
    if (state.turn !== s.seat) return { ok: false, msg: '还没轮到你' };
    if (s.playDone) return { ok: false, msg: '已放弃举证' };
    if (!uids || uids.length < 1 || uids.length > 2) return { ok: false, msg: '每回合可暗置提交 1-2 份证据' };
    const list = [];
    for (const uid of uids) {
      if (list.some(c => c.uid === uid)) return { ok: false, msg: '不能重复提交同一份证据' };
      const card = s.hand.find(c => c.uid === uid);
      if (!card) return { ok: false, msg: '手牌不存在' };
      list.push(card);
    }
    if (s.played.length + list.length > 2) return { ok: false, msg: '每轮最多暗置 2 份证据' };
    list.forEach(card => {
      s.hand = s.hand.filter(x => x !== card);
      state.row.push({ seat: s.seat, card: card, revealed: false });
      s.played.push(card);
      s.stats.playedCards++;
    });
    // 每轮最多 2 张：打满后自动完成本轮举证
    if (s.played.length >= 2) s.playDone = true;
    state.logs.push(s.name + ' 暗置提交 ' + list.length + ' 份证据' + (s.playDone ? '（本轮举证完成）' : ''));
    // 轮转：还有手牌则轮到下一个可行动者（若只剩自己则继续轮到自己；无人可动则由 advance 收尾进入亮出）
    if (s.hand.length > 0) {
      const next = nextPlaySeat(state);
      state.playTurn = next; state.turn = next;
      if (next === s.seat) state.logs.push('轮到 ' + s.name + ' 继续举证（或放弃）');
      else if (next >= 0) state.logs.push('轮到 ' + state.seats[next].name + ' 举证');
    }
    return { ok: true };
  }
  /* 每轮必须出牌：仅当自己是最后一个还有手牌的律师时可放弃（避免全场摆烂空过） */
  function finishPlay(state, s) {
    if (state.phase !== 'play' || state.turn !== s.seat || s.playDone) return { ok: false, msg: '当前不能放弃举证' };
    const othersActive = state.seats.some(x => x.seat !== s.seat && !x.playDone && x.hand.length > 0);
    if (othersActive) return { ok: false, msg: '每轮必须出牌：至少暗置提交 1 份证据（你是最后一位律师时才能放弃）' };
    s.playDone = true;
    state.logs.push(s.name + ' 放弃举证（已是最后一位律师）');
    return { ok: true };
  }

