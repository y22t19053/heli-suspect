/* ===== engine/08-events.js（game-core.js 行 865-998）===== */
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
    const tgt = ev.target === 'enemy' ? targetSeat : (ev.target === 'self' ? s.seat : -1);
    if (ev.target === 'enemy') {
      state.logs.push(s.name + ' 打出事件【' + ev.name + '】→ ' + state.seats[tgt].name);
    } else {
      state.logs.push(s.name + ' 打出事件【' + ev.name + '】');
    }
    applyEventEff(state, s, ev, tgt);
    // 推进到下一个可行动者（多轮循环，直至所有角色都选择不继续）
    const next = nextEventSeat(state);
    if (next >= 0) { state.eventTurnSeat = next; state.turn = next; state.logs.push('轮到 ' + state.seats[next].name + ' 选择是否打出事件牌'); }
    return { ok: true };
  }
  function applyEventEff(state, s, ev, tgt) {
    const e = ev.eff;
    const buff = (s.char && s.char.skill.type === 'eventBuff' && e.val > 0) ? s.char.skill.v : 0;
    if (state.phase === 'preEvent') {
      // 庭审前：修改票数修正 / 全局公共议题
      if (e.type === 'vote') {
        if (e.val > 0) state.voteMod[s.seat] += e.val + buff;
        else {
          state.voteMod[tgt] += e.val;
          // 丑闻类事件（舆论风波/惊天丑闻）直接腐蚀对手声誉
          if (ev.id === 'e04' || ev.id === 'e06') applyScandalEffects(state, tgt);
        }
      } else if (e.type === 'scandalAll') {
        // 全局丑闻：所有玩家丑闻值 +val
        for (let i = 0; i < state.seatCount; i++) applyScandalEffects(state, i);
        state.logs.push('😱 公共议题【' + ev.name + '】：所有玩家丑闻值 +' + (e.val || 1));
      }
    } else {
      // 计票后
      if (e.type === 'money') {
        if (e.val > 0) s.money += e.val + buff;
        else state.seats[tgt].money = Math.max(0, state.seats[tgt].money + e.val);
      } else if (e.type === 'rewardBuff') {
        state.supportBuff[s.seat] += e.val + buff;
      } else if (e.type === 'support') {
        state.seats[tgt].support = Math.max(0, state.seats[tgt].support + e.val);
      } else if (e.type === 'scandalAll') {
        for (let i = 0; i < state.seatCount; i++) applyScandalEffects(state, i);
        state.logs.push('😱 公共议题【' + ev.name + '】：所有玩家丑闻值 +' + (e.val || 1));
      }
    }
  }
  function passEvent(state, s) {
    s.eventPassed = true;
    state.logs.push(s.name + ' 选择不打出事件牌');
    const next = nextEventSeat(state);
    if (next >= 0) { state.eventTurnSeat = next; state.turn = next; state.logs.push('轮到 ' + state.seats[next].name + ' 选择是否打出事件牌'); }
    return { ok: true };
  }

