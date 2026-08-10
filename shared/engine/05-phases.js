/* ===== engine/05-phases.js（game-core.js 行 587-654）===== */
  /* 起始玩家选择（第 1 轮随机，后续由上轮排名最低者选择） */
  function beginStarter(state) {
    if (state.round === 0) {
      state.round = 1;
      state.starterPicker = -1;            // 第 1 轮自动随机
      state.starterChosen = false;
    } else {
      const last = state.roundRank[state.roundRank.length - 1];
      state.starterPicker = (last === undefined) ? -1 : last;
      state.starterChosen = false;
      if (state.starterPicker >= 0) {
        state.logs.push('上轮排名最低的【' + state.seats[state.starterPicker].name + '】选择本轮起始玩家');
      }
    }
    state.phase = 'chooseStarter';
  }
  function beginRound(state) {
    state.phase = 'drawEvent';
    state.turn = state.startingSeat;
    state.voteMod = new Array(state.seatCount).fill(0);
    state.supportBuff = new Array(state.seatCount).fill(0);
    // 抽事件牌：从起始角色开始每人 1 张（状态机照常推进）
    for (let k = 0; k < state.seatCount; k++) {
      const s = state.seats[(state.startingSeat + k) % state.seatCount];
      if (!state.eventDeck.length) state.eventDeck = buildEventDeck(state.rng);
      s.events.push(state.eventDeck.pop());
    }
    state.logs.push('—— 第 ' + state.round + ' 轮 ——');
  }
  /* 抽证据（证物架）：保留上轮留证牌，补抽至证物架槽位 */
  function beginVoter(state) {
    state.phase = 'drawVoter';
    state.seats.forEach((s) => {
      // 上轮锁定的牌保留在市场
      const kept = s.market.filter(c => s.lastLockedUids.indexOf(c.uid) >= 0);
      const rest = s.market.filter(c => s.lastLockedUids.indexOf(c.uid) < 0);
      state.used.push(...rest);
      s.market = kept.slice();
      s.lockedUids = [];
      s.refreshCost = 1; s.refreshUsed = false; s.buyUsed = false;
      const need = marketSize(s) - s.market.length;
      for (let i = 0; i < need; i++) {
        if (!state.deck.length) reshuffle(state);
        if (!state.deck.length) break;
        s.market.push(state.deck.pop());
      }
    });
  }
  function beginBuy(state) {
    state.phase = 'buy';
    state.turn = state.startingSeat;
    state.seats.forEach(s => { s.buyDone = false; });
  }

  /* ---------------- 购买阶段 ---------------- */
