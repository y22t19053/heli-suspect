/* ===== engine/08-events.js（game-core.js 行 819-1043）===== */
  /* ---------------- 亮出阶段（从左到右逐张亮出，恐怖分子按亮出顺序发动） ---------------- */
  function beginReveal(state) {
    state.phase = 'reveal';
    state.revealIndex = 0;
    state.revealPending = null;
    revealNext(state);
  }
  /* 亮出下一张（每次调用只亮一张，便于渲染逐张播放动画）；亮完则进入计票前事件阶段 */
  function revealNext(state) {
    // 跳过已被恐怖分子炸掉的牌
    while (state.revealIndex < state.row.length && state.row[state.revealIndex].removed) state.revealIndex++;
    if (state.revealIndex >= state.row.length) {
      if (!state.row.length) state.logs.push('无人举证，直接进入事件阶段');
      beginCrossEx(state);
      return;
    }
    const r = state.row[state.revealIndex];
    r.revealed = true;
    state.logs.push('亮出：' + state.seats[r.seat].name + ' 的【' + r.card.name + '】');
    // 恐怖分子：亮出时立即发动（只能炸已亮出的对方牌）
    if (r.card.skill === 'terrorist') {
      const targets = state.row.filter(x => x.revealed && x.seat !== r.seat && !x.removed);
      if (targets.length) {
        state.revealPending = { seat: r.seat, cardUid: r.card.uid, owner: r.seat };
        state.logs.push('【' + state.seats[r.seat].name + '】的【证据排除】发动：请选择 1 份对方已亮出的证据');
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

  /* ---------------- 质证阶段（评审 P0-2：亮牌后、事件前，花 ⊙ 翻看手牌 / 压制已亮牌） ---------------- */
  /* 每轮每人最多 3 次质证，每次 1⊙；座位序轮询「质证 or 过」，全部过完 → 进入事件/计票 */
  function beginCrossEx(state) {
    state.phase = 'crossEx';
    state.crossExTurn = state.startingSeat;
    state.crossExUsed = new Array(state.seatCount).fill(0);
    state.crossExPassed = new Array(state.seatCount).fill(false);
    state.turn = state.crossExTurn;
    state.logs.push('质证阶段开始：' + state.seats[state.crossExTurn].name + ' 是否质证？（每次 1⊙，每轮最多 3 次，翻看/压制）');
  }
  function crossExCanAct(state, s) {
    if (state.phase !== 'crossEx') return { ok: false, msg: '当前不是质证阶段' };
    if (state.crossExTurn !== s.seat) return { ok: false, msg: '还没轮到你' };
    if (state.crossExPassed[s.seat]) return { ok: false, msg: '你已放弃质证' };
    if ((state.crossExUsed[s.seat] || 0) >= 3) return { ok: false, msg: '本轮质证次数已用完' };
    if (s.money < 1) return { ok: false, msg: '⊙ 不足（质证需 1⊙）' };
    return { ok: true };
  }
  /* 质证动作 A：花 1⊙ 翻看对手 1 张手牌（信息获取，牌仍留在对手手牌、不计入本轮票数）
   * targetSeat 可省：省略时自动翻看全场最贵的一张未翻看对手手牌 */
  function crossExView(state, s, targetSeat) {
    const chk = crossExCanAct(state, s);
    if (!chk.ok) return chk;
    let foe, t;
    if (targetSeat != null) {
      if (targetSeat === s.seat) return { ok: false, msg: '只能翻看对手手牌' };
      foe = state.seats[targetSeat];
      if (!foe) return { ok: false, msg: '对手不存在' };
      t = (foe.hand || []).filter(c => !c._viewed).sort((a, b) => b.cost - a.cost)[0];
    } else {
      const cands = state.seats.flatMap((x, j) => j === s.seat ? [] : (x.hand || []).map(c => ({ c, owner: x })))
        .filter(o => !o.c._viewed)
        .sort((a, b) => b.c.cost - a.c.cost);
      if (!cands.length) return { ok: false, msg: '对手没有可翻看的手牌' };
      t = cands[0].c; foe = cands[0].owner;
    }
    if (!t) return { ok: false, msg: '目标手牌不存在或已翻看' };
    if (t._viewed) return { ok: false, msg: '该手牌已被翻看过' };
    t._viewed = true;
    s.money -= 1;
    state.crossExUsed[s.seat] = (state.crossExUsed[s.seat] || 0) + 1;
    state.logs.push(s.name + ' 花 1⊙ 翻看了【' + foe.name + '】的手牌【' + t.name + '】（信息公开，仍留在其手牌）');
    return { ok: true, msg: '翻看成功' };
  }
  /* 质证动作 B：花 1⊙ 压制对手 1 张已亮牌，令其 -1 票（同一张牌最多被压 2 次） */
  function crossExPress(state, s, targetUid) {
    const chk = crossExCanAct(state, s);
    if (!chk.ok) return chk;
    const t = state.row.find(r => r.card.uid === targetUid);
    if (!t || t.removed) return { ok: false, msg: '目标不存在' };
    if (t.seat === s.seat) return { ok: false, msg: '只能质证对方的证据' };
    if (!t.revealed) return { ok: false, msg: '该牌未亮出' };
    if ((t._press || 0) >= 2) return { ok: false, msg: '该牌已被压制 2 次，不能再压' };
    t._press = (t._press || 0) + 1;
    s.money -= 1;
    state.crossExUsed[s.seat] = (state.crossExUsed[s.seat] || 0) + 1;
    state.logs.push(s.name + ' 花 1⊙ 压制了【' + state.seats[t.seat].name + '】的【' + t.card.name + '】（-1 票，已压 ' + t._press + '/2 次）');
    return { ok: true, msg: '压制成功' };
  }
  /* 质证：放弃（本轮不再质证） */
  function crossExPass(state, s) {
    if (state.phase !== 'crossEx') return { ok: false, msg: '当前不是质证阶段' };
    if (state.crossExTurn !== s.seat) return { ok: false, msg: '还没轮到你' };
    state.crossExPassed[s.seat] = true;
    state.logs.push(s.name + ' 放弃质证');
    return { ok: true };
  }
  /* 质证阶段结束条件：所有座位都已过 或 次数用完 */
  function crossExDone(state) {
    return state.seats.every((x, i) => state.crossExPassed[i] || (state.crossExUsed[i] || 0) >= 3);
  }
  /* 轮转到下一个还能质证的座位（未过且次数未用完） */
  function crossExNext(state) {
    const n = state.seatCount;
    for (let k = 1; k <= n; k++) {
      const seat = (state.crossExTurn + k) % n;
      if (!state.crossExPassed[seat] && (state.crossExUsed[seat] || 0) < 3) return seat;
    }
    return -1;
  }
  /* 质证动作后轮转（若无人可动则交还 update 收尾） */
  function crossExAdvance(state) {
    const next = crossExNext(state);
    if (next >= 0) {
      state.crossExTurn = next; state.turn = next;
      state.logs.push('轮到 ' + state.seats[next].name + ' 质证');
    } else {
      state.crossExTurn = -1;
    }
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
