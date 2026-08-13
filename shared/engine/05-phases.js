/* ===== engine/05-phases.js（game-core.js 行 587-654）===== */
    },
    chooseStarter: {
      label: 'chooseStarter',
      needsInput: (state, seat) => state.starterPicker === seat,
      update: (state) => {
        // 第 1 轮：随机；后续：排名最低者选择
        if (state.starterPicker < 0) {
          state.startingSeat = Math.floor(state.rng() * state.seatCount);
          state.logs.push('第 ' + state.round + ' 轮由【' + state.seats[state.startingSeat].name + '】开始');
          beginRound(state);
        } else if (state.starterChosen) {
          // 已选定（人类 apply 或 AI 自行选择）
          state.logs.push('第 ' + state.round + ' 轮由【' + state.seats[state.startingSeat].name + '】开始');
          beginRound(state);
        } else if (!state.seats[state.starterPicker].isAI) {
          // 等待人类选择
        } else {
          // AI：选自己
          state.startingSeat = state.starterPicker;
          state.starterChosen = true;
          state.logs.push('排名最低的【' + state.seats[state.starterPicker].name + '】选择自己开始');
          beginRound(state);
        }
      }
    },
    drawEvent: { label: 'drawEvent', hidden: true, needsInput: () => false, update: (state) => beginVoter(state) },
    drawVoter: { label: 'drawVoter', hidden: true, needsInput: () => false, update: (state) => beginBuy(state) },
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
    crossEx: {
      label: 'crossEx',
      needsInput: (state, seat) => state.crossExTurn === seat,
      update: (state) => {
        // 亮牌后、事件前的质证回合：所有人过完 → 进入事件阶段
        if (state.crossExTurn < 0 || crossExDone(state)) beginPreEvent(state);
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
