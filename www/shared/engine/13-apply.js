/* ===== engine/13-apply.js（game-core.js 行 1579-1674）===== */
    const s = state.seats[targetSeat];
    s.scandal = Math.min(5, (s.scandal || 0) + 1);
    state.logs.push('丑闻曝光！【' + s.name + '】声誉受损，丑闻指数 ' + s.scandal + '/5');
  }
  /* 票数最高的对方（平票时随机抽签，避免同一目标被连续针对或可预测）
   * #13 修复：随机源必须用 state.rng（同种子可复现），不能用 Math.random */
  function highestEnemy(votes, owner, n, rng) {
    let bv = -Infinity;
    for (let i = 0; i < n; i++) {
      if (i === owner) continue;
      if (votes[i] > bv) bv = votes[i];
    }
    if (bv === -Infinity) return owner;
    const ties = [];
    for (let i = 0; i < n; i++) {
      if (i !== owner && votes[i] === bv) ties.push(i);
    }
    return ties.length === 1 ? ties[0] : ties[Math.floor((rng || Math.random)() * ties.length)];
  }

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
    // 赢家通吃（评审 P0-2）：第一名 +4，其余 +1（无论几人局、无论票差）→ 争冠激励
    state.rankInfo.forEach((info, idx) => {
      const s = state.seats[info.seat];
      let r = idx === 0 ? 4 : 1;
      if (idx === 0 && state.supportBuff[first]) r += state.supportBuff[first];
      s.support += r;
      if (idx === 0) s.stats.roundsWon++;
      state.logs.push('【' + s.name + '】排名第 ' + (idx + 1) + '，陪审团倾向 +' + r + '（累计 ' + s.support + '）');
    });
    state.supportReward = 4 + (state.supportBuff[first] || 0);
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
