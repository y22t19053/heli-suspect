/* ===== engine/04-advance.js（阶段推进状态机，评审四：状态对象化）===== */
  /* ---------------- 阶段推进 ---------------- */
  /* 状态描述表（顾问评审四）：每个阶段自包含
   *   label      —— 阶段标识
   *   needsInput —— (state, seat) 该座位当前是否需要玩家/AI 输入（驱动 needsAIAction/humanActing）
   *   update     —— 自动推进逻辑（调用 beginXxx 进入下一阶段；等待输入的阶段停在等待点）
   * advance(state) 查表驱动：签名与行为与旧巨型 switch 完全一致，
   * 服务端 pumpAutoAdvance / forceSkip / 全部单元测试直调不受影响。 */
  const PHASES = {
    pickChar: {
      label: 'pickChar',
      needsInput: (state, seat) => !state.seats[seat].char,
      update: (state) => {
        if (state.seats.every(s => s.char)) {
          const proN = state.seats.filter(s => s.side === 'prosecutor').map(s => s.name).join('、');
          const defN = state.seats.filter(s => s.side === 'defense').map(s => s.name).join('、');
          state.logs.push('⚖ 检方（控方）：' + proN + '  ｜  🛡 辩护方：' + defN);
          state.logs.push('律师揭晓：' + state.seats.map(s => s.name + '【' + s.char.name + '】').join('，'));
          beginStarter(state);
        }
      }
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
        // 轮流出牌：每回合只打 1 张，A→B→C→A→B→C 循环轮转，任何轮到的玩家都可放弃
        if (state.seats.every(s => s.playDone || s.hand.length === 0)) { beginReveal(state); return; }
        const cur = state.seats[state.turn];
        if (!cur || cur.playDone || cur.hand.length === 0) {
          if (cur && cur.hand.length === 0) cur.playDone = true;
          const next = nextPlaySeat(state);
          if (next < 0) { beginReveal(state); return; }
          state.playTurn = next; state.turn = next;
          state.logs.push(state.seats[next].name + ' 请暗置提交 1 份证据（或放弃）');
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
      update: (state) => {
        // 发 ⊙ 后进入下一轮或结束
        if (state.round >= 5) {
          state.phase = 'gameover';
          finishGame(state);
        } else {
          state.round++;
          beginStarter(state);
        }
      }
    }
  };

  /* 阶段推进：查表驱动。签名保持不变（服务端 pumpAutoAdvance/forceSkip 直调）。 */
  function advance(state) {
    if (state.gameOver) { state.version = (state.version || 0) + 1; return; }
    const def = PHASES[state.phase];
    if (def && def.update) def.update(state);
    state.version = (state.version || 0) + 1;
  }

