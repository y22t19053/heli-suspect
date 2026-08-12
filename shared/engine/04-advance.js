/* ===== engine/04-advance.js（game-core.js 行 491-586）===== */
      version: 1, seatCount,
      roundsLimit: opts.roundsLimit || 5,      // P1-4 快速模式：1 轮试玩 / 默认 5 轮（04-advance income 结算用）
      seed,                             // 种子码（可复现；分享战绩用，超级更新#13）
      seedRaw,                          // 用户输入的原始种子码字符串（无则 null；显示/分享用 #13 修复）
      rng,                              // 随机源（抽签质证等随机技能用；测试可注入种子）
      phase: 'pickChar',
      round: 0,                // 当前轮次（1 起）
      startingSeat: 0,         // 本轮起始角色
      turn: 0,                 // 当前行动座位
      seats,
      draftCandidates: [],     // 每人 3 张候选角色
      deck: buildDeck(rng),
      eventDeck: buildEventDeck(rng),
      used: [],                // 洗回池（行牌/整理/未买证物架牌）
      grave: [],               // 档案（【移除】的牌，不洗入牌堆）
      row: [],                 // 中央亮出行 [{seat, card, revealed}]
      votes: [],               // 本轮计票结果（含事件修正）
      voteMod: [],             // 计票前事件修正
      roundRank: [],           // 本轮排名（高→低）
      rankInfo: [],            // [{seat, votes, power}]
      supportReward: 0,
      supportBuff: [],         // 计票后事件：若第一额外奖励
      starterPicker: -1,       // 需要选择起始玩家的座位（-1 = 第 1 轮自动随机）
      starterChosen: false,    // 起始玩家是否已被选定（防止随机覆盖）
      leaderStreak: 0,         // 连续排名第一的轮数（恐惧税用）
      prevFirst: -1,           // 上轮第一名座位（用于连任判断）
      revealIndex: 0,          // 逐张亮出进度（当前亮出到 row 第几张）
      revealPending: null,     // {seat, cardUid} 等待恐怖分子选目标
      swapPending: null,       // {owner, cardUid, candidates} 等待选换位目标（政治操盘）
      eventTurnSeat: -1,       // 事件阶段当前轮到
      eventTargetPending: null,// {seat, eventUid} 等待选事件目标
      discardSeat: -1,         // 整理阶段当前轮到
      precedentSeat: -1,       // 触发"确立先例"的座位（终局先例胜利判定）
      juryTokens: new Array(seatCount).fill(0),  // 各玩家陪审员支持（集满 3 立即胜诉）
      winType: 'support',      // 胜利类型：support / precedent / juryNull
      winner: null, gameOver: false,
      logs: []
    };
    // 每人 3 张候选角色（同时亮出）
    const pool = shuffle(CHARACTERS.slice(), rng);
    for (let i = 0; i < seatCount; i++) {
      const cand = shuffle(CHARACTERS.slice(), rng);
      state.draftCandidates.push(cand.slice(0, 3));
    }
    void pool;
    state.votes = new Array(seatCount).fill(0);
    state.voteMod = new Array(seatCount).fill(0);
    state.supportBuff = new Array(seatCount).fill(0);
    return state;
  }

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
          state.logs.push('检方（控方）：' + proN + '  ｜  辩护方：' + defN);
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
