/* ===== engine/11-discard.js（game-core.js 行 1357-1411）===== */
  function beginDiscard(state) {
    state.phase = 'discard';
    state.discardSeat = -1;
    // 被【移除】的牌已在证据排除结算时进档案；其余洗回牌堆
    state.row.forEach(r => { if (!r.removed) state.used.push(r.card); });
    state.row = [];
    state.seats.forEach(s => { s.keepDone = false; s.played = []; });
    // 找到第一个手牌>0 且未保留的玩家
    const next = nextKeepSeat(state);
    state.discardSeat = next;
    if (next >= 0) {
      state.turn = next;
      state.logs.push('整理阶段：' + state.seats[next].name + ' 请保留最多 ' + keepMaxOf(state.seats[next]) + ' 份证据（其余归档）');
    }
  }
  function keepMaxOf(s) {
    return 2 + ((s.char && s.char.skill.type === 'keepPlus') ? s.char.skill.v : 0);
  }
  function nextKeepSeat(state) {
    for (let i = 0; i < state.seatCount; i++) {
      const s = state.seats[i];
      if (!s.keepDone && s.hand.length > 0) return i;
    }
    return -1;
  }
  function keepCard(state, s, uid) {
    if (state.phase !== 'discard' || state.discardSeat !== s.seat) return { ok: false, msg: '还没轮到你整理' };
    const card = s.hand.find(c => c.uid === uid);
    if (!card) return { ok: false, msg: '手牌不存在' };
    const keepMax = keepMaxOf(s);
    if (s.keepUids && s.keepUids.length >= keepMax) return { ok: false, msg: '最多保留 ' + keepMax + ' 张' };
    s.keepUids = s.keepUids || [];
    if (s.keepUids.indexOf(uid) >= 0) { s.keepUids = s.keepUids.filter(x => x !== uid); return { ok: true }; }
    s.keepUids.push(uid);
    return { ok: true };
  }
  function finishKeep(state, s) {
    if (state.phase !== 'discard' || state.discardSeat !== s.seat) return { ok: false, msg: '还没轮到你' };
    const keepMax = keepMaxOf(s);
    const kept = s.keepUids || [];
    if (kept.length < Math.min(keepMax, s.hand.length)) return { ok: false, msg: '请先选择要保留的证据' };
    // 未保留的手牌洗入牌堆
    const rest = s.hand.filter(c => kept.indexOf(c.uid) < 0);
    state.used.push(...rest);
    s.hand = s.hand.filter(c => kept.indexOf(c.uid) >= 0);
    s.keepDone = true;
    s.keepUids = [];
    state.logs.push(s.name + ' 保留了 ' + kept.length + ' 份证据');
    const next = nextKeepSeat(state);
    state.discardSeat = next;
    state.turn = next;
    if (next >= 0) state.logs.push('整理阶段：' + state.seats[next].name + ' 请保留最多 ' + keepMaxOf(state.seats[next]) + ' 份证据');
    return { ok: true };
  }

