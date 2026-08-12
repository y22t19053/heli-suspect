/* ===== engine/11-discard.js（game-core.js 行 1357-1411）===== */
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
              state.logs.push('判例确立：【' + state.seats[owner].name + '】的辩护将成为后世先例');
            }
            break;
          }
          case 'juryNull': {
            // 陪审团否决：+1 票并获得 1 名陪审员支持（集满 3 名立即胜诉）
            votes[owner] += 1;
            state.juryTokens = state.juryTokens || new Array(state.seatCount).fill(0);
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
