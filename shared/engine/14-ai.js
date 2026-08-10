/* ===== engine/14-ai.js（game-core.js 行 1592-1767）===== */
  function aiAct(state, seat) {
    const s = state.seats[seat];
    if (!s || state.gameOver) return { ok: false, msg: '游戏已结束' };
    const msgs = [];
    switch (state.phase) {
      case 'pickChar': {
        if (!s.char) {
          const cands = state.draftCandidates[seat] || [];
          if (cands.length) {
            const v = c => ({ startMoney: 2, buyDiscount: 1.5, refreshDiscount: 1, drawPlus: 1.5, votePlus: 1.5, lockPlus: 0.8, eventBuff: 1.2, postMoney: 1, keepPlus: 0.8, roundMoney: 1.5, firstRefreshFree: 1 }[c.skill.type] || 0);
            cands.sort((a, b) => v(b) - v(a));
            s.char = cands[0];
            s.camp = s.char.camp;
            if (s.char.skill.type === 'startMoney') s.money += s.char.skill.v;
          }
        }
        break;
      }
      case 'chooseStarter': {
        if (state.starterPicker === seat) {
          state.startingSeat = seat;
          state.starterChosen = true;
          state.logs.push('排名最低的【' + s.name + '】选择自己开始');
        }
        break;
      }
      case 'buy': {
        if (!s.buyDone) {
          aiBuy(state, s);
          s.buyDone = true;
        }
        break;
      }
      case 'play': {
        if (state.turn === seat && !s.playDone) aiPlay(state, s);
        break;
      }
      case 'reveal': {
        if (state.revealPending && state.revealPending.owner === seat) {
          const targets = state.row.filter(r => r.revealed && r.seat !== seat && !r.removed);
          if (targets.length) {
            // 选对手最"重"的牌（cost 最高）炸
            targets.sort((a, b) => b.card.cost - a.card.cost || b.card.votes - a.card.votes);
            resolveTerrorist(state, targets[0].card.uid);
          } else {
            state.revealPending = null;
          }
        }
        break;
      }
      case 'count': {
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

  /* AI 出牌：新规则每回合只打 1 张（评分最高）；温和人格更可能保留战略，激进人格打完 */
  function aiPlay(state, s) {
    if (s.playDone) return;
    const hand = s.hand.slice().sort((a, b) => aiCardScore(state, b, s.seat) - aiCardScore(state, a, s.seat));
    if (!hand.length) { s.playDone = true; return; }
    const agg = (s.personality && s.personality.aggression !== undefined) ? s.personality.aggression : 0.5;
    const keepChance = (1 - agg) * 0.3; // 温和人格保留战略
    if (state.rng() < keepChance && hand.length > 1) { s.playDone = true; return; }
    playCards(state, s, [hand[0].uid]);
  }

  /* 全局事件（scandalAll）对 AI 的价值评估：>0 则对己方有利 */
  function aiAutoValue(state, s, ev) {
    const e = ev.eff;
    if (e.type === 'scandalAll') {
      let maxOther = 0;
      state.seats.forEach((x, i) => { if (i !== s.seat) maxOther = Math.max(maxOther, x.scandal); });
      return maxOther - s.scandal;
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
