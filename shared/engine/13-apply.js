/* ===== engine/13-apply.js（game-core.js 行 1495-1591）===== */
  /* ---------------- 玩家动作 ---------------- */
  function apply(state, seat, action) {
    if (seat < 0 || seat >= state.seats.length) return { ok: false, msg: '非法座位' };
    const s = state.seats[seat];
    if (!action || !action.type) return { ok: false, msg: '未知操作' };
    const msgs = [];
    let res = { ok: true };
    switch (action.type) {
      case 'pickChar': {
        if (state.phase !== 'pickChar' || s.char) return { ok: false, msg: '当前不能选择角色' };
        const cand = (state.draftCandidates[seat] || []).find(c => c.id === action.charId);
        if (!cand) return { ok: false, msg: '非法角色' };
        s.char = cand;
        s.camp = cand.camp;
        if (cand.skill.type === 'startMoney') s.money += cand.skill.v;
        msgs.push(s.name + ' 选择了【' + cand.name + '】');
        break;
      }
      case 'pickStarter': {
        if (state.phase !== 'chooseStarter') return { ok: false, msg: '当前不是选择起始玩家阶段' };
        if (state.starterChosen) return { ok: false, msg: '起始玩家已选定，不能重复指定' };
        if (state.starterPicker !== seat) return { ok: false, msg: '不由你选择起始玩家' };
        if (action.starterSeat === undefined || action.starterSeat < 0 || action.starterSeat >= state.seatCount) return { ok: false, msg: '非法选择' };
        state.startingSeat = action.starterSeat;
        state.starterChosen = true;
        msgs.push(s.name + ' 指定【' + state.seats[action.starterSeat].name + '】开始本轮');
        break;
      }
      case 'buyCard': {
        res = buyCard(state, s, action.uid);
        break;
      }
      case 'lockCard': {
        res = lockCard(state, s, action.uid);
        break;
      }
      case 'refreshMarket': {
        res = refreshMarket(state, s);
        break;
      }
      case 'endBuy': {
        if (state.phase !== 'buy' || s.buyDone) return { ok: false, msg: '当前不能结束取证' };
        s.buyDone = true;
        msgs.push(s.name + ' 完成取证');
        break;
      }
      case 'playCards': {
        res = playCards(state, s, action.uids || []);
        break;
      }
      case 'finishPlay': {
        res = finishPlay(state, s);
        break;
      }
      case 'terroristTarget': {
        if (state.phase !== 'reveal') return { ok: false, msg: '当前没有待选的恐怖分子目标' };
        if (state.revealPending && state.revealPending.owner !== seat) return { ok: false, msg: '不由你选择目标' };
        res = resolveTerrorist(state, action.targetUid);
        break;
      }
      case 'swapTarget': {
        if (state.phase !== 'count') return { ok: false, msg: '当前没有待选的换位目标' };
        if (state.swapPending && state.swapPending.owner !== seat) return { ok: false, msg: '不由你选择换位目标' };
        res = resolveSwap(state, action.targetUid);
        break;
      }
      case 'playEvent': {
        res = playEvent(state, s, action.uid, action.targetSeat);
        break;
      }
      case 'passEvent': {
        if (state.phase !== 'preEvent' && state.phase !== 'postEvent') return { ok: false, msg: '当前不是事件阶段' };
        if (state.eventTurnSeat !== seat) return { ok: false, msg: '还没轮到你' };
        res = passEvent(state, s);
        break;
      }
      case 'keepCard': {
        res = keepCard(state, s, action.uid);
        break;
      }
      case 'finishKeep': {
        res = finishKeep(state, s);
        break;
      }
      case 'continue': {
        // 结算屏/结束屏继续
        break;
      }
      default: return { ok: false, msg: '未知操作' };
    }
    if (!res.ok) return res;
    if (msgs.length) state.logs.push(...msgs);
    advance(state);
    return { ok: true, msgs, combo: res.combo === true };
  }

  /* ---------------- AI 决策 ---------------- */
