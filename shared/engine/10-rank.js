/* ===== engine/10-rank.js（game-core.js 行 1295-1356）===== */
  /* ---------------- 本轮排名 ---------------- */
  function doRank(state) {
    state.phase = 'rank';
    const n = state.seatCount;
    const info = state.seats.map((s, i) => {
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
        state.logs.push('📢 内部吹哨人：【' + state.seats[owner].name + '】的线人曝光【' + state.seats[t].name + '】内部腐败（-1⊙ +丑闻）');
      }
    });
    // 角色被动：小镇市长每轮结束 +1⊙
    state.seats.forEach(s => {
      if (s.char && s.char.skill.type === 'roundMoney') { s.money += s.char.skill.v; }
    });
    beginDiscard(state);
  }

  /* ---------------- 整理（保留本阵营 2 张，其余洗入牌堆） ---------------- */
