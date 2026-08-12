/* ===== engine/05-phases.js（game-core.js 行 587-654）===== */
    drawEvent: { label: 'drawEvent', needsInput: () => false, update: (state) => beginVoter(state) },
    drawVoter: { label: 'drawVoter', needsInput: () => false, update: (state) => beginBuy(state) },
    buy: {
      label: 'buy',
      needsInput: (state, seat) => !state.seats[seat].buyDone,
      update: (state) => {
        if (state.seats.every(s => s.buyDone)) beginPlay(state);
      }
    },
    play: {
      label: 'play',
      needsInput: (state, seat) => state.turn === seat && !state.seats[seat].playDone,
      update: (state) => {
        // 轮流出牌：每回合可打 1-2 张，A→B→C→A→B→C 循环轮转；每轮必须出牌（仅最后一位律师可放弃）
        if (state.seats.every(s => s.playDone || s.hand.length === 0)) { beginReveal(state); return; }
        const cur = state.seats[state.turn];
        if (!cur || cur.playDone || cur.hand.length === 0) {
          if (cur && cur.hand.length === 0) cur.playDone = true;
          const next = nextPlaySeat(state);
          if (next < 0) { beginReveal(state); return; }
          state.playTurn = next; state.turn = next;
          state.logs.push(state.seats[next].name + ' 请暗置提交 1-2 份证据（每轮至少 1 张）');
        }
      }
    },
    reveal: {
      label: 'reveal',
      needsInput: (state, seat) => !!(state.revealPending && state.revealPending.owner === seat),
      update: (state) => {
        // 逐张亮出：无待选目标时继续亮出下一张（恐怖分子按亮出顺序发动）
        if (!state.revealPending) revealNext(state);
      }
    },
    preEvent: {
      label: 'preEvent',
      needsInput: (state, seat) => state.eventTurnSeat === seat,
      update: (state) => {
        if (allEventsDone(state)) { doCount(state); }
      }
    },
    count: {
      label: 'count',
      needsInput: (state, seat) => !!(state.swapPending && state.swapPending.owner === seat),
      update: (state) => {
        // 政治操盘（换位）等待玩家选择目标则暂停；全部换位完成后继续计票
        if (state.swapPending) return;
        doCountContinue(state);
      }
    },
    postEvent: {
      label: 'postEvent',
      needsInput: (state, seat) => state.eventTurnSeat === seat,
      update: (state) => {
        if (allEventsDone(state)) doRank(state);
      }
    },
    rank: { label: 'rank', needsInput: () => false, update: (state) => doSettle(state) },
    settle: { label: 'settle', needsInput: () => false, update: (state) => beginDiscard(state) },
    discard: {
      label: 'discard',
      needsInput: (state, seat) => state.discardSeat === seat && !state.seats[seat].keepDone,
      update: (state) => {
        if (state.discardSeat < 0) { beginIncome(state); }
      }
    },
    income: {
      label: 'income',
      needsInput: () => false,
