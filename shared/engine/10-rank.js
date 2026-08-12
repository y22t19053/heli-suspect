/* ===== engine/10-rank.js（game-core.js 行 1295-1356）===== */
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
