/* ===== engine/15-meta.js（game-core.js 行 1768-1871）===== */
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

