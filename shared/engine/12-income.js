/* ===== engine/12-income.js（game-core.js 行 1412-1494）===== */
          case 'hailMary': {
            // 最后一搏：落后 ≥2 且本方铺场 ≥3 → +3（绝境+铺场双条件翻盘）
            const maxOther = Math.max(...votes.filter((_, j) => j !== owner));
            const ownN = state.row.filter(x => !x.removed && !x._nullified && x.seat === owner).length;
            if (votes[owner] <= maxOther - 2 && ownN >= 3) votes[owner] += 3;
            break;
          }
          case 'fullChain': {
            // 证据链完整：本方已亮物证 ≥2 → 本方所有已亮牌 +1（与⑦证据开示轮联动）
            const eviN = state.row.filter(x => !x.removed && !x._nullified && x.seat === owner
              && ARCH[x.card.skill] === 'evidence').length;
            if (eviN >= 2) {
              state.row.forEach(x => { if (!x.removed && !x._nullified && x.seat === owner) votes[x.seat] += 1; });
            }
            break;
          }
          case 'gagOrder': {
            // 禁言令：对方本轮打过 ≥3 张牌 → 最高对方 -2（克制"每轮打 2 张"的激进铺场）
            const foeMany = state.seats.some((x, j) => j !== owner && x.played && x.played.length >= 3);
            if (foeMany) votes[highestEnemy(votes, owner, n, state.rng)] -= 2;
            break;
          }
          case 'split': {
            // 民意分裂：双方已亮牌数相等 → 双方最高票玩家各 -1（两败俱伤）
            const ownN = state.row.filter(x => !x.removed && !x._nullified && x.seat === owner).length;
            const foeN = state.row.filter(x => !x.removed && !x._nullified && x.seat !== owner).length;
            if (ownN === foeN) {
              votes[owner] -= 1;
              votes[highestEnemy(votes, owner, n, state.rng)] -= 1;
            }
            break;
          }
        }
        state.logs.push('【' + state.seats[owner].name + '】的【' + r.card.name + '】发动技能【' + sk.name + '】');
        // 账本：本技能对每座造成的票数净变化（逐条记录，供逐票动画）
        for (let j = 0; j < n; j++) {
          if (votes[j] !== before[j]) {
            ledger.push({ kind: 'skill', seat: j, delta: votes[j] - before[j], cardUid: r.card.uid, desc: '【' + r.card.name + '】' + sk.name });
          }
        }
      });
    }
    for (let i = 0; i < n; i++) votes[i] = Math.max(0, votes[i]);
    state.votes = votes;
    state.countLedger = ledger;   // 前端「逐票结算动画 + 复盘」数据源
    state.logs.push('审议结果：' + state.seats.map((s, i) => s.name + ' ' + votes[i] + ' 票').join('，'));
    // 陪审团否决胜利判定：任一玩家获得 3 名陪审员支持 → 立即胜诉（跳出常规轮次）
    if (state.juryTokens && Math.max(...state.juryTokens) >= 3) {
      const winner = state.juryTokens.indexOf(Math.max(...state.juryTokens));
      state.logs.push('陪审团否决！【' + state.seats[winner].name + '】说服 3 名陪审员拒绝适用现有法律——立即宣告胜诉');
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
