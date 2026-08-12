/* ===== engine/10-rank.js（game-core.js 行 1295-1356）===== */
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
