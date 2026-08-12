/* ===== engine/13-apply.js（game-core.js 行 1495-1591）===== */
      const power = state.row.filter(r => !r.removed && r.seat === i).reduce((sum, r) => sum + r.card.cost, 0);
      return { seat: i, votes: state.votes[i], power };
    });
    // 票数 desc → ⊙ 总和 desc → 亮出顺序（座位靠前）高
    info.sort((a, b) => b.votes - a.votes || b.power - a.power || a.seat - b.seat);
    state.rankInfo = info;
    state.roundRank = info.map(x => x.seat);
    state.logs.push('本轮排名：' + state.roundRank.map((s, i) => (i + 1) + '.' + state.seats[s].name).join(' '));
    doSettle(state);
  }
  function doSettle(state) {
    state.phase = 'settle';
    const first = state.roundRank[0];
    const reward = rewardOf(state.round);
    // 差额计分（防滚雪球）：第一名 +reward，之后每名 -1（最低 +1）→ 落后方不白卷
    state.rankInfo.forEach((info, idx) => {
      const s = state.seats[info.seat];
      let r = Math.max(1, reward - idx);
      if (idx === 0 && state.supportBuff[first]) r += state.supportBuff[first];
      s.support += r;
      if (idx === 0) s.stats.roundsWon++;
      state.logs.push('【' + s.name + '】排名第 ' + (idx + 1) + '，陪审团倾向 +' + r + '（累计 ' + s.support + '）');
    });
    state.supportReward = reward + (state.supportBuff[first] || 0);
    // 连任计数（恐惧税：连续 2 轮第一，下轮刷新成本 +1）
    if (state.prevFirst === first) state.leaderStreak = (state.leaderStreak || 0) + 1;
    else state.leaderStreak = 1;
    state.prevFirst = first;
    // 结算后技能（some voters' skills trigger here）
    state.row.forEach(r => {
      if (r.removed || !r.card.skill) return;
      const sk = SKILLS[r.card.skill];
      if (sk.when !== 'post') return;
      const owner = r.seat;
      if (r.card.skill === 'donor') {
        state.seats[owner].money += 1;
        state.logs.push('【' + state.seats[owner].name + '】的【胜诉酬金】+1⊙');
      } else if (r.card.skill === 'buyback') {
        const t = highestEnemy(state.votes, owner, state.seatCount, state.rng);
        state.seats[t].money = Math.max(0, state.seats[t].money - 1);
        state.logs.push('【' + state.seats[owner].name + '】的【收买证词】使【' + state.seats[t].name + '】-1⊙');
      } else if (r.card.skill === 'whistleblower') {
        // 内部吹哨人：丑闻最高的对方 -1⊙ 且丑闻 +1（瑟皮科扳倒系统）
        const t = highestEnemy(state.votes, owner, state.seatCount, state.rng);
        state.seats[t].money = Math.max(0, state.seats[t].money - 1);
        applyScandalEffects(state, t);
        state.logs.push('内部吹哨人：【' + state.seats[owner].name + '】的线人曝光【' + state.seats[t].name + '】内部腐败（-1⊙ +丑闻）');
      } else if (r.card.skill === 'grant') {
        // 法律援助：本方金钱最少 → 公益津贴 +1⊙（扶弱，反制经济碾压流）
        const minMoney = Math.min(...state.seats.map(x => x.money));
        if (state.seats[owner].money <= minMoney) {
          state.seats[owner].money += 1;
          state.logs.push('法律援助：【' + state.seats[owner].name + '】获得公益津贴 +1⊙（当前 ' + state.seats[owner].money + '⊙）');
        }
      } else if (r.card.skill === 'integrity') {
        // 清廉档案：本方无丑闻且对方有人有丑闻 → +1⊙（清白就是武器，正面对抗丑闻流）
        const foeScandal = state.seats.some((x, j) => j !== owner && (x.scandal || 0) > 0);
        if (!state.seats[owner].scandal && foeScandal) {
          state.seats[owner].money += 1;
          state.logs.push('清廉档案：【' + state.seats[owner].name + '】清白无瑕，获得 +1⊙（当前 ' + state.seats[owner].money + '⊙）');
        }
      }
    });
    // 角色被动：小镇市长每轮结束 +1⊙
    state.seats.forEach(s => {
      if (s.char && s.char.skill.type === 'roundMoney') { s.money += s.char.skill.v; }
    });
    beginDiscard(state);
  }

  /* ---------------- 整理（保留本阵营 2 张，其余洗入牌堆） ---------------- */
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
