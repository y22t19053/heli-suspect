/* ===== engine/08-events.js（game-core.js 行 865-998）===== */
        return; // 等待玩家选择目标
      }
      state.logs.push('【' + state.seats[r.seat].name + '】的恐怖分子无目标可炸');
    }
    state.revealIndex++;
  }
  /* 证据排除选择目标（被移除的牌进档案，不洗入牌堆） */
  function resolveTerrorist(state, targetUid) {
    const p = state.revealPending;
    if (!p) return { ok: false, msg: '没有待发动的恐怖分子' };
    const target = state.row.find(r => r.card.uid === targetUid);
    if (!target || target.removed || !target.revealed) return { ok: false, msg: '目标不存在或未亮出' };
    if (target.seat === p.owner) return { ok: false, msg: '不能炸自己的牌' };
    target.removed = true;
    state.grave.push(target.card);
    state.logs.push('【' + state.seats[p.owner].name + '】的证据排除作废了【' + state.seats[target.seat].name + '】的【' + target.card.name + '】（进档案）');
    state.revealPending = null;
    state.revealIndex++; // 跳过恐怖分子这张，由 advance('reveal') 继续亮下一张
    return { ok: true };
  }

  /* ---------------- 环形桌邻位（行首尾相邻：第 0 张的左边 = 最后一张） ---------------- */
  function rowNeighbor(state, idx, dir) {
    const n = state.row.length;
    if (n <= 1) return null;
    return state.row[(idx + dir + n) % n];
  }
  function swapRow(state, a, b) {
    const t = state.row[a];
    state.row[a] = state.row[b];
    state.row[b] = t;
  }
  /* 换位技能结算（计票前）：shift 自动换位（每张牌只换一次）；swap 需要玩家选择目标（swapPending） */
  function applyMoves(state) {
    // 1. 自动换位：合纵左移 / 连横右移（从左到右，与相邻牌互换；每张只执行一次防死循环）
    for (let i = 0; i < state.row.length; i++) {
      const r = state.row[i];
      if (r.removed || r._nullified || r._moved) continue;
      if (r.card.skill === 'shiftLeft' || r.card.skill === 'shiftRight') {
        const dir = r.card.skill === 'shiftLeft' ? -1 : 1;
        const nb = rowNeighbor(state, i, dir);
        if (nb && !nb.removed && nb.card.uid !== r.card.uid && !nb._moved) {
          const j = state.row.indexOf(nb);
          swapRow(state, i, j);
          r._moved = true;
          state.logs.push('【' + state.seats[r.seat].name + '】的【' + r.card.name + '】与【' + nb.card.name + '】互换位置');
          i = -1; // 重扫（位置已变化）
        }
      }
    }
    // 2. 政治操盘：需玩家选择目标（每张只处理一次）
    for (let i = 0; i < state.row.length; i++) {
      const r = state.row[i];
      if (r.removed || r._nullified || r._moved || r.card.skill !== 'swap') continue;
      const candidates = state.row.filter(x => !x.removed && x.card.uid !== r.card.uid);
      if (!candidates.length) continue;
      state.swapPending = { owner: r.seat, cardUid: r.card.uid, candidates: candidates.map(x => x.card.uid) };
      state.logs.push('【' + state.seats[r.seat].name + '】的【程序动议】发动：请选择 1 张其他证据互换位置');
      return false; // 暂停计票，等待选择
    }
    return true;
  }
  function resolveSwap(state, targetUid) {
    const p = state.swapPending;
    if (!p) return { ok: false, msg: '没有待处理的换位' };
    const t = state.row.find(x => x.card.uid === targetUid);
    if (!t || t.removed) return { ok: false, msg: '目标不存在' };
    if (t.card.uid === p.cardUid) return { ok: false, msg: '不能和自己互换' };
    const a = state.row.findIndex(x => x.card.uid === p.cardUid);
    const b = state.row.indexOf(t);
    swapRow(state, a, b);
    state.row[b]._moved = true; // 这张政治操盘已发动，不再重复
    state.logs.push('【' + state.seats[p.owner].name + '】的【程序动议】将【' + state.row[b].card.name + '】与【' + t.card.name + '】互换位置');
    state.swapPending = null;
    // 若还有下一张政治操盘则继续等待，否则由 advance('count') 继续计票
    if (!applyMoves(state)) return { ok: true, msg: '继续选择下一个换位目标' };
    return { ok: true };
  }

  /* ---------------- 事件牌阶段（计票前 / 计票后） ---------------- */
  function beginPreEvent(state) {
    state.phase = 'preEvent';
    startEventPhase(state);
  }
  function beginPostEvent(state) {
    state.phase = 'postEvent';
    startEventPhase(state);
  }
  /* 由起始角色指定的角色开始（MVP：默认从起始角色开始） */
  function startEventPhase(state) {
    const n = state.seatCount;
    state.seats.forEach(s => { s.eventCount = 0; s.eventPassed = false; });
    state.eventStall = 0;
    state.eventTurnSeat = state.startingSeat;
    state.turn = state.eventTurnSeat;
    state.logs.push((state.phase === 'preEvent' ? '庭审前' : '庭审后') + '事件阶段开始：' + state.seats[state.eventTurnSeat].name + ' 是否打出事件牌？');
  }
  function eventLvOK(state, ev) { return ev.lv <= eventLvMax(state.round); }
  function usableEvents(state, s) {
    if (s.eventPassed || s.eventCount >= 2) return [];
    return s.events.filter(ev => !ev.used && ev.timing === (state.phase === 'preEvent' ? 'pre' : 'post') && eventLvOK(state, ev));
  }
  /* 事件阶段结束条件：所有人都选择不继续或打满 2 张 */
  function allEventsDone(state) {
    return state.seats.every(s => s.eventPassed || s.eventCount >= 2 || usableEvents(state, s).length === 0);
  }
  /* 轮到下一个可行动者（多轮循环，直至所有角色都选择不继续） */
  function nextEventSeat(state) {
    const n = state.seatCount;
    for (let k = 1; k <= n; k++) {
      const seat = (state.eventTurnSeat + k) % n;
      const s = state.seats[seat];
      if (!s.eventPassed && s.eventCount < 2 && usableEvents(state, s).length > 0) return seat;
    }
    return -1;
  }
  function playEvent(state, s, uid, targetSeat) {
    const ev = s.events.find(e => e.uid === uid);
    if (!ev || ev.used) return { ok: false, msg: '事件牌不存在或已使用' };
    if (!usableEvents(state, s).some(e => e.uid === uid)) return { ok: false, msg: '该事件牌当前不可用（分级/数量限制）' };
    if (ev.timing !== (state.phase === 'preEvent' ? 'pre' : 'post')) return { ok: false, msg: '时机不符' };
    // enemy 类需指定目标
    if (ev.target === 'enemy') {
      if (targetSeat === undefined || targetSeat === null || targetSeat === s.seat) return { ok: false, msg: '请选择事件目标' };
      if (targetSeat < 0 || targetSeat >= state.seatCount || targetSeat === s.seat) return { ok: false, msg: '非法目标' };
    }
    if (state.eventTargetPending) return { ok: false, msg: '请先处理待选目标' };
    if (state.eventTurnSeat !== s.seat) return { ok: false, msg: '还没轮到你' };
    // 硅谷地区：事件牌费用 ⊙2（文化地域印记）
    ev.used = true;
    s.events = s.events.filter(e => e !== ev);
    state.grave.push(ev);   // 已打出的事件牌进档案（cardInGlobal 已查 grave，快照恢复时不会复活）
    s.eventCount++;
    s.stats.eventsPlayed++;
