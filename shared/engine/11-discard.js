/* ===== engine/11-discard.js（game-core.js 行 1357-1411）===== */
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
              state.logs.push('判例确立：【' + state.seats[owner].name + '】的辩护将成为后世先例');
            }
            break;
          }
          case 'juryNull': {
            // 陪审团否决：+1 票并获得 1 名陪审员支持（集满 3 名立即胜诉）
            votes[owner] += 1;
            state.juryTokens = state.juryTokens || new Array(state.seatCount).fill(0);
