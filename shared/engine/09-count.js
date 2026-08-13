/* ===== engine/09-count.js（game-core.js 行 999-1294）===== */
    for (let k = 1; k <= n; k++) {
      const seat = (state.eventTurnSeat + k) % n;
      const s = state.seats[seat];
      if (!s.eventPassed && s.eventCount < 2 && usableEvents(state, s).length > 0) return seat;
    }
    return -1;
  }
  function playEvent(state, s, uid, targetSeat) {
    const ev = s.events.find(e => e.uid === uid);
    if (!ev || ev.used) return { ok: false, msg: '事件牌不存在或已使用' };
    if (!usableEvents(state, s).some(e => e.uid === uid)) return { ok: false, msg: '该事件牌当前不可用（分级/数量限制）' };
    if (ev.timing !== (state.phase === 'preEvent' ? 'pre' : 'post')) return { ok: false, msg: '时机不符' };
    // enemy 类需指定目标
    if (ev.target === 'enemy') {
      if (targetSeat === undefined || targetSeat === null || targetSeat === s.seat) return { ok: false, msg: '请选择事件目标' };
      if (targetSeat < 0 || targetSeat >= state.seatCount || targetSeat === s.seat) return { ok: false, msg: '非法目标' };
    }
    if (state.eventTargetPending) return { ok: false, msg: '请先处理待选目标' };
    if (state.eventTurnSeat !== s.seat) return { ok: false, msg: '还没轮到你' };
    // 硅谷地区：事件牌费用 ⊙2（文化地域印记）
    ev.used = true;
    s.events = s.events.filter(e => e !== ev);
    state.grave.push(ev);   // 已打出的事件牌进档案（cardInGlobal 已查 grave，快照恢复时不会复活）
    s.eventCount++;
    s.stats.eventsPlayed++;
    const tgt = ev.target === 'enemy' ? targetSeat : (ev.target === 'self' ? s.seat : -1);
    if (ev.target === 'enemy') {
      state.logs.push(s.name + ' 打出事件【' + ev.name + '】→ ' + state.seats[tgt].name);
    } else {
      state.logs.push(s.name + ' 打出事件【' + ev.name + '】');
    }
    applyEventEff(state, s, ev, tgt);
    // 推进到下一个可行动者（多轮循环，直至所有角色都选择不继续）
    const next = nextEventSeat(state);
    if (next >= 0) { state.eventTurnSeat = next; state.turn = next; state.logs.push('轮到 ' + state.seats[next].name + ' 选择是否打出事件牌'); }
    return { ok: true };
  }
  function applyEventEff(state, s, ev, tgt) {
    const e = ev.eff;
    const buff = (s.char && s.char.skill.type === 'eventBuff' && e.val > 0) ? s.char.skill.v : 0;
    if (state.phase === 'preEvent') {
      // 庭审前：修改票数修正 / 全局公共议题
      if (e.type === 'vote') {
        if (e.val > 0) state.voteMod[s.seat] += e.val + buff;
        else {
          state.voteMod[tgt] += e.val;
          // 丑闻类事件（舆论风波/惊天丑闻）直接腐蚀对手声誉
          if (ev.id === 'e04' || ev.id === 'e06') applyScandalEffects(state, tgt);
        }
      } else if (e.type === 'scandalAll') {
        // 全局丑闻：所有玩家丑闻值 +val
        for (let i = 0; i < state.seatCount; i++) applyScandalEffects(state, i);
        state.logs.push('公共议题【' + ev.name + '】：所有玩家丑闻值 +' + (e.val || 1));
      }
    } else {
      // 计票后
      if (e.type === 'money') {
        if (e.val > 0) s.money += e.val + buff;
        else state.seats[tgt].money = Math.max(0, state.seats[tgt].money + e.val);
      } else if (e.type === 'rewardBuff') {
        state.supportBuff[s.seat] += e.val + buff;
      } else if (e.type === 'support') {
        state.seats[tgt].support = Math.max(0, state.seats[tgt].support + e.val);
      } else if (e.type === 'scandalAll') {
        for (let i = 0; i < state.seatCount; i++) applyScandalEffects(state, i);
        state.logs.push('公共议题【' + ev.name + '】：所有玩家丑闻值 +' + (e.val || 1));
      } else if (e.type === 'leadSupport') {
        // 庭审直播：本轮票数最高的玩家倾向 -val（树大招风，反制领先）
        const lead = state.votes.indexOf(Math.max(...state.votes));
        state.seats[lead].support = Math.max(0, state.seats[lead].support - e.val);
        state.logs.push('庭审直播：【' + state.seats[lead].name + '】树大招风，陪审团倾向 -' + e.val);
      } else if (e.type === 'moneyAll') {
        // 休庭补助：所有玩家 +val⊙（普惠福利，资金重新洗牌）
        state.seats.forEach(x => { x.money += e.val; });
        state.logs.push('休庭补助：所有玩家 +' + e.val + '⊙');
      } else if (e.type === 'richTax') {
        // 舆论转向：金钱最多的玩家 -val⊙（首富被征税，反制经济碾压流）
        const rich = state.seats.reduce((a, x, i) => (x.money > state.seats[a].money ? i : a), 0);
        state.seats[rich].money = Math.max(0, state.seats[rich].money - e.val);
        state.logs.push('舆论转向：【' + state.seats[rich].name + '】被舆论征税 -' + e.val + '⊙');
      } else if (e.type === 'poorAid') {
        // 证人保护：本方金钱最少 → +val⊙（扶弱济困）
        const minMoney = Math.min(...state.seats.map(x => x.money));
        if (s.money <= minMoney) {
          s.money += e.val;
          state.logs.push('证人保护：【' + s.name + '】获得扶弱津贴 +' + e.val + '⊙');
        }
      }
    }
  }
  function passEvent(state, s) {
    s.eventPassed = true;
    state.logs.push(s.name + ' 选择不打出事件牌');
    const next = nextEventSeat(state);
    if (next >= 0) { state.eventTurnSeat = next; state.turn = next; state.logs.push('轮到 ' + state.seats[next].name + ' 选择是否打出事件牌'); }
    return { ok: true };
  }

  /* —— 2 人局铺场条件（评审 P0-4）：位置技能退化为座位无关的「已亮牌数」条件 —— */
  function shownOf(state, seat) {
    return state.row.filter(x => !x.removed && !x._nullified && x.seat === seat).length;
  }
  /* ---------------- 计票中（换位 → 丑闻惩罚 → 技能 ①→②→③） ---------------- */
  function doCount(state) {
    state.phase = 'count';
    // 先结算换位技能：shift 自动换位；政治操盘需玩家选目标（暂停等待）
    if (!applyMoves(state)) return;
    doCountContinue(state);
  }
  function doCountContinue(state) {
    const n = state.seatCount;
    // 计票流水账本（供前端逐票动画 / 复盘回放；计算逻辑与旧版完全一致，仅记录）
    const ledger = [];
    // 1. 基础票：每张未移除的牌投其 votes 票（单卡自带丑闻按 scandal 扣票）
    const votes = new Array(n).fill(0);
    state.row.forEach(r => {
      if (r.removed || r._nullified) return;
      let base = (r.card.votes || 1) - (r.card.scandal || 0);
      base = Math.max(0, base);
      votes[r.seat] += base;
      ledger.push({ kind: 'base', seat: r.seat, delta: base, cardUid: r.card.uid, desc: '【' + r.card.name + '】基础票' });
    });
    // 1b. 质证压制扣票（评审 P0-2：每被压 1 次 -1 票，同一张牌最多压 2 次）
    state.row.forEach(r => {
      if (r.removed || r._nullified || !(r._press > 0)) return;
      const press = r._press;
      votes[r.seat] -= press;
      ledger.push({ kind: 'crossExPress', seat: r.seat, delta: -press, cardUid: r.card.uid, desc: '【' + r.card.name + '】被质证压制 -' + press + ' 票' });
    });
    // 2. 计票前事件修正
    for (let i = 0; i < n; i++) {
      if (state.voteMod[i] !== 0) ledger.push({ kind: 'event', seat: i, delta: state.voteMod[i], cardUid: null, desc: '舆情事件修正' });
      votes[i] += state.voteMod[i];
    }
    // 2.5 ⑦ 庭审阶段克制权重：本轮权重流派（开庭陈述→情感 / 证据开示→物证 / 交叉询问→攻击 / 结案陈词→情感）的所有已亮牌 +1
    {
      const ph = phaseArchOf(state.round);
      state.row.forEach(r => {
        if (r.removed || r._nullified) return;
        if (ARCH[r.card.skill] === ph.arch) {
          votes[r.seat] += 1;
          ledger.push({ kind: 'stage', seat: r.seat, delta: 1, cardUid: r.card.uid, desc: '【' + r.card.name + '】' + ph.label + '加成' });
        }
      });
    }
    // 4. 角色被动：组织能手 +1 票；AI 人格被动：激进人格 +票
    state.seats.forEach((s, i) => {
      if (s.char && s.char.skill.type === 'votePlus'){
        votes[i] += s.char.skill.v;
        ledger.push({ kind: 'char', seat: i, delta: s.char.skill.v, cardUid: null, desc: '【' + s.char.name + '】组织能手' });
      }
      if (s.personality && s.personality.bonus && s.personality.bonus.vote){
        votes[i] += s.personality.bonus.vote;
        ledger.push({ kind: 'char', seat: i, delta: s.personality.bonus.vote, cardUid: null, desc: '【' + s.name + '】激进人格' });
      }
    });
    // 5. 玩家丑闻指数：声誉腐蚀，全部票数 - scandal
    state.seats.forEach((s, i) => {
      if (s.scandal) {
        votes[i] -= s.scandal;
        ledger.push({ kind: 'scandal', seat: i, delta: -s.scandal, cardUid: null, desc: '丑闻缠身（' + s.scandal + '/5）' });
        state.logs.push('【' + s.name + '】丑闻缠身（' + s.scandal + '/5），票数 -' + s.scandal);
      }
    });
    // 7. 计票时技能：lv 1 → 2 → 3，行内从左到右（失效牌不发动）
    for (let lv = 1; lv <= 3; lv++) {
      state.row.forEach((r, idx) => {
        if (r.removed || r._nullified || !r.card.skill) return;
        const sk = SKILLS[r.card.skill];
        if (sk.when !== 'count' || sk.lv !== lv) return;
        const owner = r.seat;
        const before = votes.slice();
        switch (r.card.skill) {
          case 'fan': votes[owner] += 1; break;
          case 'troll': { const t = highestEnemy(votes, owner, n, state.rng); votes[t] -= 1; break; }
          case 'swap': case 'shiftLeft': case 'shiftRight': break; // 换位已在计票前结算
          /* —— 纳什均衡互锁系：攒钱/铺场/事件流都有反制 —— */
          case 'audit': {
            // 财务审计：对方有钱 → 查账（反制攒钱流）
            const richFoe = state.seats.some((x, j) => j !== owner && x.money >= 5);
            if (richFoe) votes[highestEnemy(votes, owner, n, state.rng)] -= 1;
            break;
          }
          case 'lobby': {
            // 游说金：本方有钱 → 买票（金钱转票）
            if (state.seats[owner].money >= 5) votes[owner] += 1;
            break;
          }
          case 'counsel': {
            // 2 人局（评审 P0-4）：本方已亮 ≥3 → +2 / ≥1 → +1；3-4 人局保持相邻联动
            if (state.seatCount === 2) {
              const own = shownOf(state, owner);
              if (own >= 3) votes[owner] += 2;
              else if (own >= 1) votes[owner] += 1;
              break;
            }
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
            // 2 人局（评审 P0-4）：本方已亮 ≥2 → 最高敌 -1；3-4 人局保持相邻联动
            if (state.seatCount === 2) {
              if (shownOf(state, owner) >= 2) votes[highestEnemy(votes, owner, n, state.rng)] -= 1;
              break;
            }
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
            // 2 人局（评审 P0-4）：本方已亮 ≥2 → 本方 +1；3-4 人局保持相邻联动
            if (state.seatCount === 2) {
              if (shownOf(state, owner) >= 2) votes[owner] += 1;
              break;
            }
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            const allyNear = (nbL && !nbL.removed && !nbL._nullified && nbL.seat === owner)
              || (nbR && !nbR.removed && !nbR._nullified && nbR.seat === owner);
            if (allyNear) votes[owner] += 1;
            break;
          }
          case 'chain': {
            // 连横合纵：左右都是本方 → 本方所有已亮牌 +1；左右都是敌方 → 最高敌 -1（三态左右博弈）
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            const allyL = nbL && !nbL.removed && !nbL._nullified && nbL.seat === owner;
            const allyR = nbR && !nbR.removed && !nbR._nullified && nbR.seat === owner;
            const foeL = nbL && !nbL.removed && !nbL._nullified && nbL.seat !== owner;
            const foeR = nbR && !nbR.removed && !nbR._nullified && nbR.seat !== owner;
            if (allyL && allyR) {
              state.row.forEach(x => { if (!x.removed && !x._nullified && x.seat === owner) votes[x.seat] += (r.card.v || 1); });
            } else if (foeL && foeR) {
              votes[highestEnemy(votes, owner, n, state.rng)] -= (r.card.v || 1);
            }
            break;
          }
          case 'pivot': {
            // 2 人局（评审 P0-4）：敌方已亮 ≥2 → +2；3-4 人局保持左右皆敌 +2
            if (state.seatCount === 2) {
              const foeSeat = 1 - owner;
              if (shownOf(state, foeSeat) >= 2) votes[owner] += 2;
              break;
            }
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            if (nbL && nbR && !nbL.removed && !nbR.removed && nbL.seat !== owner && nbR.seat !== owner) votes[owner] += 2;
            break;
          }
          case 'idol': votes[owner] += 2; break;
          case 'megaScandal': { const t = highestEnemy(votes, owner, n, state.rng); votes[t] -= 2; applyScandalEffects(state, t); break; }
          /* —— 纳什均衡互锁系（lv2）：支持度落后翻盘 / 铺场互锁 —— */
          case 'endorse': {
            // 名人背书：本方支持度落后 → 舆论救场（支持度维度反制）
            const mySup = state.seats[owner].support || 0;
            const behind = state.seats.some((x, j) => j !== owner && (x.support || 0) > mySup);
            if (behind) votes[owner] += 1;
            break;
          }
          case 'crossfire': {
            // 交叉火力：对方铺场 ≥3 → 集中反制（反制铺场流）
            const foeN = state.row.filter(x => !x.removed && !x._nullified && x.seat !== owner).length;
            if (foeN >= 3) votes[highestEnemy(votes, owner, n, state.rng)] -= 1;
            break;
          }
          case 'surge': {
            // 民意浪潮：本方铺场 ≥3 → 声势加成（铺场收益，与交叉火力互锁）
            const ownN = state.row.filter(x => !x.removed && !x._nullified && x.seat === owner).length;
            if (ownN >= 3) votes[owner] += 1;
            break;
          }
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
