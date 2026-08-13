/* ===== engine/99-tail.js（game-core.js 行 1872-2123）===== */
        // 政治操盘：选对手票数最高的牌换到自己这张牌旁（改变邻位博弈）
        if (state.swapPending && state.swapPending.owner === seat) {
          const cands = state.row.filter(x => state.swapPending.candidates.indexOf(x.card.uid) >= 0 && x.seat !== seat);
          cands.sort((a, b) => (b.card.votes || 1) - (a.card.votes || 1) || b.card.cost - a.card.cost);
          let t = cands[0];
          if (!t) t = state.row.find(x => state.swapPending.candidates.indexOf(x.card.uid) >= 0);
          if (t) resolveSwap(state, t.card.uid);
          else state.swapPending = null;
        }
        break;
      }
      case 'preEvent':
      case 'postEvent': {
        if (state.eventTurnSeat === seat) aiEvents(state, s);
        break;
      }
      case 'discard': {
        if (state.discardSeat === seat && !s.keepDone) {
          s.keepUids = [];
          if (s.hand.length) {
            // 保留契合当前选区文化 + 人格偏好的强牌（最多 keepMax 张）
            const sorted = s.hand.slice().sort((a, b) => aiCardScore(state, b, s.seat) - aiCardScore(state, a, s.seat));
            s.keepUids = sorted.slice(0, Math.min(keepMaxOf(s), s.hand.length)).map(c => c.uid);
          }
          finishKeep(state, s);
        }
        break;
      }
    }
    advance(state);
    return { ok: true, msgs };
  }

  /* AI 卡牌评分：数值 + 技能（SK_VAL 表）+ 丑闻减分 */
  function aiCardScore(state, c, seat) {
    return (c.votes || 1) + skillVal(c.skill) - (c.scandal || 0) * 0.8;
  }

  /* AI 购买：买高价值牌，市场差则刷新，好牌买不起则锁定 */
  function aiBuy(state, s) {
    // 策略多样性（评审 P3）：economy 高的策略更看重票数（攒钱买大牌），
    // 修复「攒钱流攒了钱却不买好牌、还承担少出牌的代价」——让经济型策略真正成立。
    const eco = (s.personality && s.personality.economy != null) ? s.personality.economy : 0.5;
    const val = c => (c.votes || 1) * (1.5 + eco * 0.7) + skillVal(c.skill)
      - (c.scandal || 0) * 0.6 - buyCostOf(s, c) * 0.4;
    for (let guard = 0; guard < 8; guard++) {
      if (s.money < 1) break;
      const buyable = s.market.filter(c => buyCostOf(s, c) <= s.money);
      if (!buyable.length) break;
      buyable.sort((a, b) => val(b) - val(a));
      const best = buyable[0];
      if (val(best) < 0.8 && s.hand.length >= 4) break;
      if (buyCard(state, s, best.uid).ok) continue;
      break;
    }
    // 锁定：市场有高价值牌但暂时买不起（或刷新后保留）
    if (s.lockedUids.length < lockMax(s) && s.market.some(c => s.lastLockedUids.indexOf(c.uid) < 0 && (c.votes || 1) >= 2)) {
      const good = s.market.filter(c => s.lastLockedUids.indexOf(c.uid) < 0 && (c.votes || 1) >= 2).sort((a, b) => b.votes - a.votes)[0];
      if (good && (good.cost > s.money || s.hand.length < 3)) lockCard(state, s, good.uid);
    }
    // 刷新：手牌少且市场差（经济型人格更愿刷新；弱卡 = 单票 + 低价值技能 + 不便宜）
    if (s.hand.length < 2 && s.market.length) {
      const weak = s.market.every(c => (c.votes || 1) === 1 && skillVal(c.skill) <= 1.6 && (c.cost || 1) >= 2);
      // 经济型人格更愿刷新（per 即 s.personality；此处修复历史未定义引用）
      const threshold = (s.personality && s.personality.economy >= 0.7) ? 3 : 2;
      if (weak && s.hand.length < threshold && refreshCostOf(s) <= s.money) refreshMarket(state, s);
    }
  }

  /* AI 出牌：每轮至少打 1 张、最多 2 张（评分最高）；温和人格可保留战略（仅最后一人时弃权），激进人格追加第 2 张 */
  function aiPlay(state, s) {
    if (s.playDone) return;
    const hand = s.hand.slice().sort((a, b) => aiCardScore(state, b, s.seat) - aiCardScore(state, a, s.seat));
    if (!hand.length) { s.playDone = true; return; }
    const agg = (s.personality && s.personality.aggression !== undefined) ? s.personality.aggression : 0.5;
    const keepChance = (1 - agg) * 0.3; // 温和人格保留战略
    const isLast = state.seats.every(x => x.seat === s.seat || x.playDone || x.hand.length === 0);
    // 策略多样性（评审 P3）：保留战略只在「没有高价值牌」时触发——攒钱流买到大牌必出，
    // 弱手才保留；修复「保留=纯弃权」让保守策略不可行（修复前 2p 激进流 71.7% 碾压攒钱流）。
    const hasStrong = hand.some(c => (c.votes || 1) >= 3);
    if (isLast && state.rng() < keepChance && !hasStrong && hand.length > 1) { s.playDone = true; return; }
    const picks = [hand[0].uid];
    // 激进人格且还有额度 → 一次暗置 2 张
    if (agg >= 0.6 && hand.length >= 2 && s.played.length < 1) picks.push(hand[1].uid);
    playCards(state, s, picks);
  }

  /* 全局事件（auto）对 AI 的价值评估：>0 则对己方有利 */
  function aiAutoValue(state, s, ev) {
    const e = ev.eff;
    if (e.type === 'scandalAll') {
      let maxOther = 0;
      state.seats.forEach((x, i) => { if (i !== s.seat) maxOther = Math.max(maxOther, x.scandal); });
      return maxOther - s.scandal;
    }
    if (e.type === 'leadSupport') {
      // 庭审直播：自己不是票数最高 → 有利（打领先者）
      const lead = state.votes ? state.votes.indexOf(Math.max(...state.votes)) : -1;
      return (lead >= 0 && lead !== s.seat) ? 1 : -1;
    }
    if (e.type === 'moneyAll') {
      // 休庭补助：自己钱少 → 更有利
      const avg = state.seats.reduce((a, x) => a + x.money, 0) / state.seatCount;
      return s.money <= avg ? 1 : 0.5;
    }
    if (e.type === 'richTax') {
      // 舆论转向：自己不是最富 → 有利
      const rich = state.seats.reduce((a, x, i) => (x.money > state.seats[a].money ? i : a), 0);
      return rich !== s.seat ? 1 : -1;
    }
    return 0;
  }

  /* AI 事件：依据人格 aggression 选择攻击/增益事件；全局 auto 事件经价值评估后才打 */
  function aiEvents(state, s) {
    const agg = (s.personality && s.personality.aggression !== undefined) ? s.personality.aggression : 0.5;
    for (let i = 0; i < 2; i++) {
      const usable = usableEvents(state, s);
      if (!usable.length) break;
      const selfEv = usable.find(e => e.target === 'self');
      const enemyEv = usable.find(e => e.target === 'enemy');
      const autoCands = usable.filter(e => e.target === 'auto' && aiAutoValue(state, s, e) > 0)
        .sort((a, b) => aiAutoValue(state, s, b) - aiAutoValue(state, s, a));
      const goodAuto = autoCands[0];
      let ev;
      if (agg >= 0.7) {
        // 激进人格（MAGA/茶党）：优先攻击对手
        ev = enemyEv || goodAuto || selfEv;
      } else if (agg >= 0.5) {
        // 平衡人格：先打正价值全局事件，再考虑增益/攻击
        ev = goodAuto || selfEv || enemyEv;
      } else {
        // 温和人格（自由意志/永不特朗普）：优先增益自己，auto 次之，攻击仅偶尔
        ev = selfEv || goodAuto || (enemyEv && state.rng() < 0.3 ? enemyEv : null);
      }
      if (!ev) break;
      let tgt;
      if (ev.target === 'enemy') {
        // 选当前最高票/最高倾向的对手
        const scores = state.seats.map((x, i) => (state.votes && state.votes[i]) || x.support);
        tgt = highestEnemy(scores, s.seat, state.seatCount, state.rng);
      }
      if (!playEvent(state, s, ev.uid, tgt).ok) break;
      // playEvent 已推进 eventTurnSeat
      if (state.eventTurnSeat !== s.seat) return;
    }
    if (state.eventTurnSeat === s.seat) passEvent(state, s);
  }

  /* AI 质证：落后时压制对手最重的已亮牌，富余时翻看对手手牌，否则放弃 */
  function aiCrossEx(state, s) {
    if ((state.crossExUsed[s.seat] || 0) >= 3 || s.money < 1) {
      crossExPass(state, s);
      crossExAdvance(state);
      return;
    }
    // 预估本轮己方 vs 对手证据强度
    const myPower = state.row.filter(r => r.seat === s.seat && !r.removed)
      .reduce((a, r) => a + (r.card.votes || r.card.v || 0), 0);
    let foePower = 0;
    state.seats.forEach((x, i) => {
      if (i === s.seat) return;
      foePower = Math.max(foePower, state.row.filter(r => r.seat === i && !r.removed)
        .reduce((a, r) => a + (r.card.votes || r.card.v || 0), 0));
    });
    const pressable = state.row.filter(r => r.seat !== s.seat && r.revealed && !r.removed && (r._press || 0) < 2)
      .sort((a, b) => (b.card.votes || b.card.v || 0) - (a.card.votes || a.card.v || 0));
    const hasUnviewed = state.seats.some((x, i) => i !== s.seat && (x.hand || []).some(c => !c._viewed));
    if (foePower > myPower && pressable.length) {
      // 落后：压制对手最重证据
      crossExPress(state, s, pressable[0].card.uid);
    } else if (hasUnviewed && s.money >= 3) {
      // 富余：翻看对手最贵手牌（信息获取）
      crossExView(state, s);
    } else {
      crossExPass(state, s);
    }
    crossExAdvance(state);
  }

  /* ---------------- 服务端/渲染器辅助 ---------------- */
  /* 每个阶段"谁需要输入"统一由 PHASES 表（engine/04-advance.js）判定，
   * 本文件只按 AI/人类筛选座位，杜绝双份 switch（评审四/五：单一来源）。 */
  function needsAIAction(state) {
    if (!state || state.gameOver) return [];
    const list = [];
    const def = PHASES[state.phase];
    state.seats.forEach((s, i) => {
      const isAI = s.isAI || !s.connected;
      if (!isAI) return;
      if (def && def.needsInput(state, i)) list.push(i);
    });
    return list;
  }
  function humanActing(state) {
    if (!state || state.gameOver) return [];
    const list = [];
    const def = PHASES[state.phase];
    state.seats.forEach((s, i) => {
      if (s.isAI || !s.connected) return;
      if (def && def.needsInput(state, i)) list.push(i);
    });
    return list;
  }
  /* 阶段流转唯一源（超级更新#2）：全部 15 个 phase 按真实流转顺序。
   * 两端进度条 / UIPresenter.phaseIndex 一律引用本常量，禁止另写副本。 */
  const PHASE_STEPS = [
    ['pickChar', '抽取角色'],
    ['chooseStarter', '起始'],
    ['drawEvent', '抽事件'],
    ['drawVoter', '发选民'],
    ['buy', '取证'],
    ['play', '举证'],
    ['reveal', '亮出'],
    ['crossEx', '质证'],
    ['preEvent', '前庭审'],
    ['count', '审议'],
    ['postEvent', '后庭审'],
    ['rank', '排名'],
    ['settle', '结算'],
    ['discard', '整理'],
    ['income', '酬金'],
    ['gameover', '终局']
  ];
  /* 庭审回合 = 亮牌+质证+事件+计票+排名+结算 的连续审议（评审 P0：流程 16→8 合并展示）。
   * 前端把这段渲染成同一屏的连续交互，玩家视角是一次连贯审议。 */
  const TRIAL_PHASES = ['reveal', 'crossEx', 'preEvent', 'count', 'postEvent', 'rank', 'settle'];
  /* 进度条显示用：8 个对玩家可见的回合节拍（评审 P0：流程 16→8）。
   * 选角 → 开局 → 购买回合 → 举证回合 → 庭审回合 → 整理 → 收入 → 终局
   * drawEvent/drawVoter 为 hidden（抽牌瞬时阶段，PHASES 表已标 hidden，不显示、不播放动画，逻辑照走）。 */
  const PHASE_STEPS_VISIBLE = [
    ['pickChar', '选角'],
    ['chooseStarter', '开局'],
    ['buy', '购买回合'],
    ['play', '举证回合'],
    ['trial', '庭审回合'],
    ['discard', '整理'],
    ['income', '收入'],
    ['gameover', '终局']
  ];
  /* 子阶段 → 可见宏阶段（阶段条/标题用；'trial' 为庭审回合合并展示的虚拟宏阶段） */
  function phaseGroupOf(phase) {
    return (phase && TRIAL_PHASES.indexOf(phase) >= 0) ? 'trial' : phase;
  }
  function phaseLabel(state) {
    const map = {
      pickChar: '抽取角色', chooseStarter: '决定起始玩家', drawEvent: '抽取事件牌', drawVoter: '抽取证据',
      buy: '调查取证', play: '暗置举证', reveal: '庭审回合', crossEx: '庭审回合', preEvent: '庭审回合', count: '庭审回合',
      postEvent: '庭审回合', rank: '庭审回合', settle: '庭审回合', discard: '整理', income: '发放酬金', gameover: '游戏结束'
    };
    return map[state.phase] || state.phase;
  }
  /* 可点击卡牌（供渲染器高亮） */
  function myClickable(state, seat) {
    const s = state.seats[seat];
    const out = { market: [], hand: [], events: [], targets: [], chars: [], crossView: [], crossPress: [] };
    if (!s) return out;
    switch (state.phase) {
      case 'pickChar':
        out.chars = (state.draftCandidates[seat] || []).map(c => c.id);
        break;
      case 'buy':
        if (!s.buyDone) { out.market = s.market.map(c => c.uid); }
        break;
      case 'play':
        if (state.turn === seat && !s.playDone) { out.hand = s.hand.map(c => c.uid); }
        break;
      case 'reveal':
        if (state.revealPending && state.revealPending.owner === seat) {
          out.targets = state.row.filter(r => r.revealed && r.seat !== seat && !r.removed).map(r => r.card.uid);
        }
        break;
      case 'crossEx':
        if (state.crossExTurn === seat && !state.crossExPassed[seat] && (state.crossExUsed[seat] || 0) < 3 && s.money >= 1) {
          // 翻看目标：对手未翻看的手牌；压制目标：对手已亮且未满 2 压的牌
          out.crossView = state.seats.flatMap((x, i) => i !== seat ? x.hand.filter(c => !c._viewed).map(c => c.uid) : []);
          out.crossPress = state.row.filter(r => r.seat !== seat && r.revealed && !r.removed && (r._press || 0) < 2).map(r => r.card.uid);
        }
        break;
      case 'count':
        if (state.swapPending && state.swapPending.owner === seat) {
          out.targets = state.swapPending.candidates.slice();
        }
        break;
      case 'preEvent':
      case 'postEvent':
        if (state.eventTurnSeat === seat) { out.events = usableEvents(state, s).map(e => e.uid); }
        break;
      case 'discard':
        if (state.discardSeat === seat && !s.keepDone) { out.hand = s.hand.map(c => c.uid); }
        break;
    }
    return out;
  }

  return {
    createGame, apply, aiAct, advance,
    needsAIAction, humanActing, phaseLabel, phaseGroupOf, myClickable,
    PHASE_STEPS, PHASE_STEPS_VISIBLE, TRIAL_PHASES,
    PHASES,   // 状态描述表（评审四：每个阶段自包含 label/needsInput/update）
    buyCostOf, refreshCostOf, eventLvMax, incomeOf, marketSize,
    data: { CHARACTERS, VOTER_TEMPLATES, EVENT_TEMPLATES, SKILLS, CAMPS, AI_PERSONALITIES, ARCH, phaseArchOf },
    mulberry32,
    restoreRng,   // 评审 P0-BUG：快照恢复后重建可序列化随机源（rngSeed/rngCalls 支撑）
    doCountContinue,   // 测试钩子：仅用于单元测试直调结算（不影响任何运行路径）
    finishGame, beginIncome  // 测试钩子：终局判定 / 收入发放（供单测直调）
  };
});
