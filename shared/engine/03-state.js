/* ===== engine/03-state.js（game-core.js 行 364-490）===== */
  /* ---------------- 状态构建 ---------------- */
  function makeSeat(i, name, isAI, rng) {
    return {
      seat: i, name, isAI, connected: !isAI,
      char: null, camp: null,
      side: null,              // 庭审角色：'prosecutor' 检方 / 'defense' 辩护方（开局分配）
      personality: null,       // AI 人格（人类为 null；AI 从 AI_PERSONALITIES 分配）
      money: 4, support: 0,          // 起始 ⊙ = 4（卡价压缩后 4⊙ 起步；倾向累计）
      scandal: 0,                    // 丑闻指数（声誉腐蚀，0~5）
      hand: [], market: [], events: [], played: [],   // 手牌 / 市场 / 事件手牌 / 本轮已亮出牌
      lockedUids: [], lastLockedUids: [],             // 本轮锁定（下轮保留）/ 上轮锁定
      refreshCost: 1, refreshUsed: false, buyUsed: false,
      buyDone: false, playDone: false, keepDone: false,
      eventCount: 0, eventPassed: false,
      stats: {
        playedCards: 0, eventsPlayed: 0, roundsWon: 0  // 历史累计
      }
    };
  }
  function makeVoter(tpl) { return Object.assign({}, tpl, { uid: nextUid(), scandal: tpl.scandal || 0 }); }
  function makeEvent(tpl) { return Object.assign({}, tpl, { uid: nextUid(), used: false }); }

  /* 初始牌堆：24 种 × 2 份 = 48 张 */
  function buildDeck(rng) {
    const list = [];
    VOTER_TEMPLATES.forEach(t => { list.push(makeVoter(t)); list.push(makeVoter(t)); });
    return shuffle(list, rng);
  }
  function buildEventDeck(rng) {
    const list = [];
    EVENT_TEMPLATES.forEach(t => { list.push(makeEvent(t)); list.push(makeEvent(t)); });
    return shuffle(list, rng);
  }

  function createGame(opts) {
    opts = opts || {};
    uidSeq = 1000;                    // 每局重置 uid（同种子完全可复现，超级更新#14）
    // —— 字段校验（超级更新#13）：seatCount / names / aiMask / seed 容错收敛 ——
    const rawCount = opts.seatCount;
    const seatCount = (typeof rawCount === 'number' && Number.isFinite(rawCount))
      ? clamp(Math.floor(rawCount), 2, 4)
      : (rawCount === undefined || rawCount === null ? 2 : clamp(Math.floor(Number(rawCount)) || 2, 2, 4));
    const rawSeed = opts.seed;
    const seed = (typeof rawSeed === 'number' && Number.isFinite(rawSeed))
      ? (rawSeed >>> 0)
      : (typeof rawSeed === 'string' && rawSeed.trim() !== '' ? hashStr(rawSeed) : (Date.now() % 2147483647));
    // #13 修复：保留用户输入的原始种子码字符串（无则 null），供结算屏/战报显示原串而非 hash 数字
    const seedRaw = (typeof rawSeed === 'string' && rawSeed.trim() !== '') ? rawSeed.trim() : null;
    const rng = mulberry32(seed);
    const names = Array.isArray(opts.names) ? opts.names : [];
    const aiMask = Array.isArray(opts.aiMask) ? opts.aiMask : [];
    const seats = [];
    for (let i = 0; i < seatCount; i++) {
      const isAI = !!aiMask[i];
      const rawName = names[i];
      const name = (typeof rawName === 'string' && rawName.trim())
        ? String(rawName).slice(0, 12)
        : ('玩家' + (i + 1));
      const seat = makeSeat(i, name, isAI, rng);
      if (isAI && AI_PERSONALITIES.length) {
        seat.personality = AI_PERSONALITIES[Math.floor(rng() * AI_PERSONALITIES.length)];
      }
      seats.push(seat);
    }
    // 庭审角色分配：检方 = ceil(n/2) 人（代表控方），其余为辩护方（代表被告律师）
    // 随机洗牌分配到座位——玩家每局可能扮演检方，也可能扮演辩护方
    {
      const nPros = Math.ceil(seatCount / 2);
      const sideList = [];
      for (let i = 0; i < seatCount; i++) sideList.push(i < nPros ? 'prosecutor' : 'defense');
      const shuffled = shuffle(sideList, rng);
      seats.forEach((s, i) => { s.side = shuffled[i]; });
    }
    const state = {
      version: 1, seatCount,
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

