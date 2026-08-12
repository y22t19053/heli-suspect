/* ===== engine/99-tail.js（game-core.js 行 1872-2091）===== */
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
    const val = c => (c.votes || 1) * 1.5 + skillVal(c.skill)
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
    if (isLast && state.rng() < keepChance && hand.length > 1) { s.playDone = true; return; }
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
    ['preEvent', '前庭审'],
    ['count', '审议'],
    ['postEvent', '后庭审'],
    ['rank', '排名'],
    ['settle', '结算'],
    ['discard', '整理'],
    ['income', '酬金'],
    ['gameover', '终局']
  ];
  /* 进度条显示用：过滤瞬时自动阶段（无玩家操作），与历史 10 步展示一致 */
  const PHASE_STEPS_VISIBLE = PHASE_STEPS.filter(s => !['pickChar', 'drawEvent', 'drawVoter', 'settle', 'income'].includes(s[0]));
  function phaseLabel(state) {
    const map = {
      pickChar: '抽取角色', chooseStarter: '决定起始玩家', drawEvent: '抽取事件牌', drawVoter: '抽取证据',
      buy: '调查取证', play: '暗置举证', reveal: '亮出证据', preEvent: '庭审前·事件', count: '审议中',
      postEvent: '庭审后·事件', rank: '本轮排名', settle: '本轮结算', discard: '整理', income: '发放酬金', gameover: '游戏结束'
    };
    return map[state.phase] || state.phase;
  }
  /* 可点击卡牌（供渲染器高亮） */
  function myClickable(state, seat) {
    const s = state.seats[seat];
    const out = { market: [], hand: [], events: [], targets: [], chars: [] };
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
    needsAIAction, humanActing, phaseLabel, myClickable,
    PHASE_STEPS, PHASE_STEPS_VISIBLE,
    PHASES,   // 状态描述表（评审四：每个阶段自包含 label/needsInput/update）
    buyCostOf, refreshCostOf, eventLvMax, incomeOf, rewardOf, marketSize,
    data: { CHARACTERS, VOTER_TEMPLATES, EVENT_TEMPLATES, SKILLS, CAMPS, AI_PERSONALITIES, ARCH, phaseArchOf },
    mulberry32,
    doCountContinue,   // 测试钩子：仅用于单元测试直调结算（不影响任何运行路径）
    finishGame, beginIncome  // 测试钩子：终局判定 / 收入发放（供单测直调）
  };
});
