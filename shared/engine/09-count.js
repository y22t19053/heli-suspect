/* ===== engine/09-count.js（game-core.js 行 999-1294）===== */
  /* ---------------- 计票中（换位 → 丑闻惩罚 → 技能 ①→②→③） ---------------- */
  function doCount(state) {
    state.phase = 'count';
    // 先结算换位技能：shift 自动换位；政治操盘需玩家选目标（暂停等待）
    if (!applyMoves(state)) return;
    doCountContinue(state);
  }
  function doCountContinue(state) {
    const n = state.seatCount;
    // 1. 基础票：每张未移除的牌投其 votes 票（单卡自带丑闻按 scandal 扣票）
    const votes = new Array(n).fill(0);
    state.row.forEach(r => {
      if (r.removed || r._nullified) return;
      let base = (r.card.votes || 1) - (r.card.scandal || 0);
      votes[r.seat] += Math.max(0, base);
    });
    // 2. 计票前事件修正
    for (let i = 0; i < n; i++) votes[i] += state.voteMod[i];
    // 4. 角色被动：组织能手 +1 票；AI 人格被动：激进人格 +票
    state.seats.forEach((s, i) => {
      if (s.char && s.char.skill.type === 'votePlus') votes[i] += s.char.skill.v;
      if (s.personality && s.personality.bonus && s.personality.bonus.vote) votes[i] += s.personality.bonus.vote;
    });
    // 5. 玩家丑闻指数：声誉腐蚀，全部票数 - scandal
    state.seats.forEach((s, i) => {
      if (s.scandal) {
        votes[i] -= s.scandal;
        state.logs.push('😈 【' + s.name + '】丑闻缠身（' + s.scandal + '/5），票数 -' + s.scandal);
      }
    });
    // 7. 计票时技能：lv 1 → 2 → 3，行内从左到右（失效牌不发动）
    for (let lv = 1; lv <= 3; lv++) {
      state.row.forEach((r, idx) => {
        if (r.removed || r._nullified || !r.card.skill) return;
        const sk = SKILLS[r.card.skill];
        if (sk.when !== 'count' || sk.lv !== lv) return;
        const owner = r.seat;
        switch (r.card.skill) {
          case 'fan': votes[owner] += 1; break;
          case 'troll': { const t = highestEnemy(votes, owner, n, state.rng); votes[t] -= 1; break; }
          case 'swap': case 'shiftLeft': case 'shiftRight': break; // 换位已在计票前结算
          case 'counsel': {
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            const allyL = nbL && !nbL.removed && !nbL._nullified && nbL.seat === owner;
            const allyR = nbR && !nbR.removed && !nbR._nullified && nbR.seat === owner;
            if (allyL && allyR) votes[owner] += 2;        // 左右夹逼：攻守同盟完全体 +2
            else if (allyL || allyR) votes[owner] += 1;   // 单侧联动 +1
            break;
          }
          case 'orator': votes[owner] += 1; break;
          case 'scandal': { const t = highestEnemy(votes, owner, n, state.rng); votes[t] -= 1; applyScandalEffects(state, t); break; }
          case 'wave': votes[owner] += 1; votes[highestEnemy(votes, owner, n, state.rng)] -= 1; break;
          // —— 左右博弈技能：相邻有本方牌才发动（想触发就得多牌连坐 / 用换位凑阵） ——
          case 'flank': {
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            const allyNear = (nbL && !nbL.removed && !nbL._nullified && nbL.seat === owner)
              || (nbR && !nbR.removed && !nbR._nullified && nbR.seat === owner);
            if (allyNear) votes[highestEnemy(votes, owner, n, state.rng)] -= 1;
            break;
          }
          case 'poach': {
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            const allyNear = (nbL && !nbL.removed && !nbL._nullified && nbL.seat === owner)
              || (nbR && !nbR.removed && !nbR._nullified && nbR.seat === owner);
            if (allyNear) { votes[highestEnemy(votes, owner, n, state.rng)] -= 1; votes[owner] += 1; }
            break;
          }
          case 'rally': {
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            const allyNear = (nbL && !nbL.removed && !nbL._nullified && nbL.seat === owner)
              || (nbR && !nbR.removed && !nbR._nullified && nbR.seat === owner);
            if (allyNear) votes[owner] += 1;
            break;
          }
          case 'pivot': {
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            if (nbL && nbR && !nbL.removed && !nbR.removed && nbL.seat !== owner && nbR.seat !== owner) votes[owner] += 2;
            break;
          }
          case 'idol': votes[owner] += 2; break;
          case 'megaScandal': { const t = highestEnemy(votes, owner, n, state.rng); votes[t] -= 2; applyScandalEffects(state, t); break; }
          case 'comeback': {
            const maxOther = Math.max(...votes.filter((_, j) => j !== owner));
            if (votes[owner] < maxOther) votes[owner] += 1;
            break;
          }
          // —— 议题/站位系技能（无条件发动） ——
          case 'tagBoost': votes[owner] += 1; break;
          case 'tagHate': votes[highestEnemy(votes, owner, n, state.rng)] -= 1; break;
          case 'edge': {
            const act = state.row.filter(x => !x.removed && !x._nullified);
            const pos = act.indexOf(r);
            if (pos === 0 || pos === act.length - 1) votes[owner] += (r.card.v || 1);
            break;
          }
          case 'rowL': {
            const act = state.row.filter(x => !x.removed && !x._nullified);
            const pos = act.indexOf(r);
            if (pos >= 0 && pos * 2 < act.length) votes[owner] += (r.card.v || 1);
            break;
          }
          case 'rowR': {
            const act = state.row.filter(x => !x.removed && !x._nullified);
            const pos = act.indexOf(r);
            if (pos >= 0 && pos * 2 >= act.length) votes[owner] += (r.card.v || 1);
            break;
          }
          case 'leftFoe': {
            const nbL = rowNeighbor(state, idx, -1);
            if (nbL && !nbL.removed && !nbL._nullified && nbL.seat !== owner) votes[nbL.seat] -= (r.card.v || 1);
            break;
          }
          case 'rightFoe': {
            const nbR = rowNeighbor(state, idx, 1);
            if (nbR && !nbR.removed && !nbR._nullified && nbR.seat !== owner) votes[nbR.seat] -= (r.card.v || 1);
            break;
          }
          case 'majority': {
            const maxOther = Math.max(...votes.filter((_, j) => j !== owner));
            if (votes[owner] >= maxOther) votes[owner] += (r.card.v || 1);
            break;
          }
          case 'minority': {
            const maxOther = Math.max(...votes.filter((_, j) => j !== owner));
            if (votes[owner] < maxOther) votes[owner] += (r.card.v || 1);
            break;
          }
          /* —— 位置博弈系（做题：看谁占行首/行尾/左半区） —— */
          case 'firstSeat': {
            // 首座质证：行首（最左一张）是对方牌 → 该牌 -1
            const act = state.row.filter(x => !x.removed && !x._nullified);
            const lead = act[0];
            if (lead && lead.seat !== owner) votes[lead.seat] -= (r.card.v || 1);
            break;
          }
          case 'lastSeat': {
            // 末席质证：行尾（最右一张）是对方牌 → 该牌 -1
            const act = state.row.filter(x => !x.removed && !x._nullified);
            const tail = act[act.length - 1];
            if (tail && tail.seat !== owner) votes[tail.seat] -= (r.card.v || 1);
            break;
          }
          case 'leftWall': {
            // 左翼壁垒：本方所有位于行左半区的牌各 +1（站位团）
            const act = state.row.filter(x => !x.removed && !x._nullified);
            act.forEach((x, i) => {
              if (x.seat === owner && i * 2 < act.length) votes[owner] += 1;
            });
            break;
          }
          case 'randomHit': {
            // 抽签质证：随机 1 张对方牌 -1（赌运气）
            const act = state.row.filter(x => !x.removed && !x._nullified && x.seat !== owner);
            if (act.length) {
              const rng = state.rng || Math.random;
              const hit = act[Math.floor(rng() * act.length)];
              votes[hit.seat] -= (r.card.v || 1);
            }
            break;
          }
          case 'shame': {
            if (state.row.some(x => !x.removed && !x._nullified && (x.card.scandal || 0) > 0)) votes[owner] += 1;
            break;
          }
          case 'threat': {
            const hasLv3 = state.row.some(x => !x.removed && !x._nullified && x.seat !== owner
              && x.card.skill && SKILLS[x.card.skill] && SKILLS[x.card.skill].lv >= 3);
            if (hasLv3) votes[highestEnemy(votes, owner, n, state.rng)] -= 1;
            break;
          }
          /* —— 封神技（真实传奇律师招牌战术） —— */
          case 'crossExam': {
            // 交叉询问：相邻敌方证人 -1；若该证人带丑闻，额外 -1
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            [nbL, nbR].forEach(nb => {
              if (nb && !nb.removed && !nb._nullified && nb.seat !== owner) {
                let dmg = 1;
                if ((nb.card.scandal || 0) > 0) dmg += 1;
                votes[nb.seat] -= dmg;
              }
            });
            break;
          }
          case 'objection': {
            // 反对!：对方本场亮出 ②/③ 级技能牌 → 最高对方 -1
            const hasHigh = state.row.some(x => !x.removed && !x._nullified && x.seat !== owner
              && x.card.skill && SKILLS[x.card.skill] && SKILLS[x.card.skill].lv >= 2);
            if (hasHigh) votes[highestEnemy(votes, owner, n, state.rng)] -= 1;
            break;
          }
          case 'reasonableDoubt': {
            // 合理怀疑：对方场上证据 ≥3 → 最高对方 -2（"戴不上，就无罪"）
            const enemyN = state.row.filter(x => !x.removed && !x._nullified && x.seat !== owner).length;
            if (enemyN >= 3) votes[highestEnemy(votes, owner, n, state.rng)] -= 2;
            break;
          }
          case 'timelineSnipe': {
            // 时间线狙击：对方带技能证据 ≥2 → 最高对方 -1（收据时间戳）
            const skN = state.row.filter(x => !x.removed && !x._nullified && x.seat !== owner
              && x.card.skill && SKILLS[x.card.skill]).length;
            if (skN >= 2) votes[highestEnemy(votes, owner, n, state.rng)] -= 1;
            break;
          }
          case 'flipNarrative': {
            // 翻转叙事：本方落后 ≥2 → 本方 +2（把事实之争翻成原则之争）
            const maxOther = Math.max(...votes.filter((_, j) => j !== owner));
            if (votes[owner] <= maxOther - 2) votes[owner] += 2;
            break;
          }
          case 'careerGamble': {
            // 职业生涯赌局：+2 票；未领先则丑闻 +1（豪赌的代价）
            votes[owner] += 2;
            const maxOther = Math.max(...votes.filter((_, j) => j !== owner));
            if (votes[owner] < maxOther) applyScandalEffects(state, owner);
            break;
          }
          case 'credCollapse': {
            // 证人信誉崩塌：对方有丑闻牌 → 最高对方 -1
            const hasScandal = state.row.some(x => !x.removed && !x._nullified && x.seat !== owner
              && (x.card.scandal || 0) > 0);
            if (hasScandal) votes[highestEnemy(votes, owner, n, state.rng)] -= 1;
            break;
          }
          case 'precedent': {
            // 确立先例：+1 票并记录先例标记（终局先例胜利）
            votes[owner] += 1;
            if (state.precedentSeat === undefined || state.precedentSeat < 0) {
              state.precedentSeat = owner;
              state.logs.push('⚖️ 判例确立：【' + state.seats[owner].name + '】的辩护将成为后世先例');
            }
            break;
          }
          case 'juryNull': {
            // 陪审团否决：+1 票并获得 1 名陪审员支持（集满 3 名立即胜诉）
            votes[owner] += 1;
            state.juryTokens = state.juryTokens || new Array(state.seatCount).fill(0);
            state.juryTokens[owner] = (state.juryTokens[owner] || 0) + 1;
            state.logs.push('⚖️ 陪审员转向：【' + state.seats[owner].name + '】获得 1 名陪审员支持（' + state.juryTokens[owner] + '/3）');
            break;
          }
        }
        state.logs.push('【' + state.seats[owner].name + '】的【' + r.card.name + '】发动技能【' + sk.name + '】');
      });
    }
    for (let i = 0; i < n; i++) votes[i] = Math.max(0, votes[i]);
    state.votes = votes;
    state.logs.push('审议结果：' + state.seats.map((s, i) => s.name + ' ' + votes[i] + ' 票').join('，'));
    // 陪审团否决胜利判定：任一玩家获得 3 名陪审员支持 → 立即胜诉（跳出常规轮次）
    if (state.juryTokens && Math.max(...state.juryTokens) >= 3) {
      const winner = state.juryTokens.indexOf(Math.max(...state.juryTokens));
      state.logs.push('🕊️ 陪审团否决！【' + state.seats[winner].name + '】说服 3 名陪审员拒绝适用现有法律——立即宣告胜诉');
      finishGame(state, { juryNull: true });
      return;
    }
    beginPostEvent(state);
  }
  /* 丑闻曝光（舆情事件）：目标玩家声誉腐蚀 +1（上限 5），此后每轮票数 -1 */
  function applyScandalEffects(state, targetSeat) {
    if (targetSeat < 0 || targetSeat >= state.seatCount) return;
    const s = state.seats[targetSeat];
    s.scandal = Math.min(5, (s.scandal || 0) + 1);
    state.logs.push('😈 丑闻曝光！【' + s.name + '】声誉受损，丑闻指数 ' + s.scandal + '/5');
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

