/* ===== engine/15-meta.js（game-core.js 行 1768-1871）===== */
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
      case 'crossExView': {
        res = crossExView(state, s, action.targetSeat);
        if (res.ok) crossExAdvance(state);
        break;
      }
      case 'crossExPress': {
        res = crossExPress(state, s, action.targetUid);
        if (res.ok) crossExAdvance(state);
        break;
      }
      case 'crossExPass': {
        res = crossExPass(state, s);
        if (res.ok) crossExAdvance(state);
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
      case 'crossEx': {
        if (state.crossExTurn === seat) aiCrossEx(state, s);
        break;
      }
      case 'count': {
