/* ===== engine/12-income.js（game-core.js 行 1412-1494）===== */
            state.juryTokens[owner] = (state.juryTokens[owner] || 0) + 1;
            state.logs.push('陪审员转向：【' + state.seats[owner].name + '】获得 1 名陪审员支持（' + state.juryTokens[owner] + '/3）');
            break;
          }
          /* —— 纳什均衡互锁系（lv3）：反制事件流 / 连胜滚雪球 —— */
          case 'veto': {
            // 一票否决：对方本轮打过事件牌 → 程序反噬（反制事件流）
            const foeEvent = state.seats.some((x, j) => j !== owner && x.eventCount > 0);
            if (foeEvent) votes[highestEnemy(votes, owner, n, state.rng)] -= 2;
            break;
          }
          case 'momentum': {
            // 势头：本方此前赢过轮次 → 连胜气势（滚雪球，需要对手反制）
            if ((state.seats[owner].stats && state.seats[owner].stats.roundsWon) > 0) votes[owner] += 1;
            break;
          }
          /* —— 庭审克制包（⑨：偏见揭露/最后一搏/证据链完整/禁言令/民意分裂） —— */
          case 'bias': {
            // 偏见揭露：对方铺场 ≥4 → 对方所有已亮牌各 -1（AOE 反铺场终极手段）
            const foeN = state.row.filter(x => !x.removed && !x._nullified && x.seat !== owner).length;
            if (foeN >= 4) {
              state.row.forEach(x => { if (!x.removed && !x._nullified && x.seat !== owner) votes[x.seat] -= 1; });
            }
            break;
          }
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
