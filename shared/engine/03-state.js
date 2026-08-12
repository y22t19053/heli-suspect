/* ===== engine/03-state.js（game-core.js 行 364-490）===== */
    { id: 'e38', name: '桃色丑闻案',    lv: 3, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },               desc: '庭审后：所有玩家丑闻值 +1' },
    { id: 'e40', name: '计票争议案',    lv: 1, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },              desc: '庭审后：所有玩家丑闻值 +1' },
    { id: 'e41', name: '水门案',        lv: 3, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },              desc: '庭审后：所有玩家丑闻值 +1' },
    /* ============ 纳什均衡事件包（e42+：反制领先/普惠/经济） ============ */
    { id: 'e42', name: '庭审直播',      lv: 2, timing: 'post', target: 'auto', eff: { type: 'leadSupport', val: 1 },            desc: '庭审后：本轮票数最高的玩家倾向 -1（树大招风）' },
    { id: 'e43', name: '休庭补助',      lv: 1, timing: 'post', target: 'auto', eff: { type: 'moneyAll', val: 1 },               desc: '庭审后：所有玩家 +1⊙（普惠福利）' },
    { id: 'e44', name: '舆论转向',      lv: 2, timing: 'post', target: 'auto', eff: { type: 'richTax', val: 1 },                desc: '庭审后：金钱最多的玩家 -1⊙（首富被征税）' },
    { id: 'e45', name: '证人保护',      lv: 1, timing: 'post', target: 'self',  eff: { type: 'poorAid', val: 1 },               desc: '庭审后：若本方金钱最少，+1⊙（扶弱济困）' }
  ];

  /* 事件牌按轮次解锁：轮1→①；轮2~3→①②；轮4+→①②③ */
  function eventLvMax(round) { return round <= 1 ? 1 : (round <= 3 ? 2 : 3); }
  /* ⑦ 庭审阶段克制权重：5 轮庭审节奏映射到克制三角
   * 第 1 轮开庭陈述 → 情感型 +1；第 2~3 轮证据开示 → 物证型 +1；
   * 第 4 轮交叉询问 → 攻击型 +1；第 5 轮起结案陈词 → 情感型 +1 */
  function phaseArchOf(round) {
    if (round <= 1) return { arch: 'emotion', label: '开庭陈述', tip: '情感型证据 +1 票' };
    if (round <= 3) return { arch: 'evidence', label: '证据开示', tip: '物证型证据 +1 票' };
    if (round <= 4) return { arch: 'attack', label: '交叉询问', tip: '攻击型证据 +1 票' };
    return { arch: 'emotion', label: '结案陈词', tip: '情感型证据 +1 票' };
  }
  /* 每轮结束发放的 ⊙（卡牌降价后同步加钱，保证买得起更多牌）
   * 阶段 C 改造：收入随轮次递增——第 1~3 轮 2⊙（前期克制），第 4 轮起 3⊙（后期资金加速，弱势方有翻盘机会） */
  function incomeOf(round) { return round >= 4 ? 3 : 2; }
  /* 支持度奖励 */
  function rewardOf(round) { return round <= 3 ? 2 : (round === 4 ? 3 : 4); }
  /* 市场槽位数（初始 4，组织能手 +1） */
  function marketSize(s) { return 4 + ((s.char && s.char.skill.type === 'drawPlus') ? s.char.skill.v : 0); }
  /* 购买价（全局 -1 降价；铁腕大状再 -1）
   * 阶段 C 改造——供需定价：
   *   ① 市场内同技能卡 ≥2 张 → 该技能卡 +1⊙（供不应求溢价，反制"只买同一种技能"的垄断套路）
   *   ② 第 4 轮起市场清仓 -1⊙（后期甩卖，加速资金流转，给落后方抄底机会） */
  function buyCostOf(s, card) {
    let cost = Math.max(1, card.cost - 1 - ((s.char && s.char.skill.type === 'buyDiscount') ? s.char.skill.v : 0));
    if (card.skill && s.market) {
      const same = s.market.filter(c => c.skill === card.skill && c.uid !== card.uid).length;
      if (same >= 1) cost += 1;             // 同技能已有 1 张 → +1⊙（稀缺溢价）
    }
    if (s.round && s.round >= 4) cost = Math.max(1, cost - 1);   // 后期清仓 -1⊙
    return cost;
  }
  /* 刷新成本（幕后金主 -1；外交官每轮首次免费）
   * 阶段 C 改造：刷新成本封顶 3⊙——1→2→3→3（不再无限递增，避免滚雪球到买不起） */
  function refreshCostOf(s) {
    let c = Math.min(3, s.refreshCost);
    if (s.char && s.char.skill.type === 'refreshDiscount') c = Math.max(0, c - s.char.skill.v);
    if (s.char && s.char.skill.type === 'firstRefreshFree' && !s.refreshUsed && !s.buyUsed) c = 0;
    return c;
  }
  /* 锁定上限（务实派 2 张） */
  function lockMax(s) { return 1 + ((s.char && s.char.skill.type === 'lockPlus') ? s.char.skill.v : 0); }

  /* ---------------- 状态构建 ---------------- */
  function makeSeat(i, name, isAI, rng) {
    return {
      seat: i, name, isAI, connected: !isAI,
      char: null, camp: null,
      side: null,              // 庭审角色：'prosecutor' 检方 / 'defense' 辩护方（开局分配）
      personality: null,       // AI 人格（人类为 null；AI 从 AI_PERSONALITIES 分配）
      money: 4, support: 0,          // 起始 ⊙ = 4（卡价压缩后 4⊙ 起步；倾向累计）
      round: 1,                      // 当前轮次（阶段 C：供需定价按轮次折扣需要）
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
