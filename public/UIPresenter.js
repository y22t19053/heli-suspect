/* ============================================================================
 * UIPresenter — 渲染层 ViewModel 投影层（评审任务 1 参考实现）
 * ----------------------------------------------------------------------------
 * 目标：把「读 ElectionCore 状态」与「画 Canvas」解耦。
 *   渲染函数（renderGame/renderPanels/...）不再直接触碰 view/game 的原始字段，
 *   而是消费 UIPresenter.project() 产出的纯数据 ViewModel。
 *
 * 类图（完整版见 docs/UI_PRESENTER_REFACTOR.md）：
 *
 *   UIPresenter (静态工具层，无状态)
 *   ├── project(view, opts) → ViewModel    // 只读投影：状态 → 纯 UI 数据
 *   ├── layouts(view, opts) → Layouts      // 布局计算（面板条/手牌/行/市场槽）
 *   ├── myTurn(view) → boolean             // 当前是否轮到我（各阶段判定）
 *   ├── phaseIndex(view) → int             // 阶段进度条当前下标
 *   ├── phaseSteps() → string[][]          // 阶段流转常量
 *   └── _selfTest() → void                 // node 环境自检（无 DOM 依赖）
 *
 *   ViewModel（纯数据，可 JSON 序列化 / 可单测）：
 *   ├── meta  { phase, phaseLabel, round, cultureName, mySeat, gameOver, winner }
 *   ├── seats [ { seat, name, isMe, isAI, money, support, scandal,
 *   │             charName, handCount, acting, leading } ]
 *   ├── row   [ { seat, revealed, removed, hidden, uid, name, votes, tags, skill } ]
 *   ├── market/events        // 仅己方可见（遵守 makeView 防作弊）
 *   ├── hud   { phaseIdx, nextLabel, supportBar, rankOrder, leader, deadline }
 *   └── myTurn
 *
 * 防作弊约定：view.seats[i].hand 由服务端 makeView 对非我方置 null，
 *   本层一律不展开他人手牌内容（handCount 仅 isMe 时有效）。
 *
 * 设计权衡：
 *  - 纯函数、无副作用：project() 不缓存、不依赖全局 canvas/ctx，便于 node 单测。
 *  - 与现有渲染 100% 兼容：本文件可独立存在，渲染函数按需逐步迁移；
 *    迁移完成前两端渲染逻辑保持现状（渐进式重构，避免一次性大改风险）。
 *  - 性能：ViewModel 每帧由 project() 重建（O(n)），Canvas 全量重绘本就是
 *    主开销；未来如需要可加 version 记忆做脏检查（见 checkFxDiffs 已有短路）。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* 阶段流转常量：唯一源在 shared/game-core.js（超级更新#2），此处仅引用。
   * 浏览器端 game-core 先行加载必命中；node 自检环境无 ElectionCore 时兜底。 */
  const PHASE_STEPS = (global.ElectionCore && global.ElectionCore.PHASE_STEPS) || [
    ['pickChar', '抽取角色'], ['chooseStarter', '起始'], ['drawEvent', '抽事件'], ['drawVoter', '发选民'],
    ['buy', '取证'], ['play', '举证'], ['reveal', '亮出'], ['preEvent', '前庭审'], ['count', '审议'],
    ['postEvent', '后庭审'], ['rank', '排名'], ['settle', '结算'], ['discard', '整理'], ['income', '酬金'], ['gameover', '终局']
  ];

  const UIPresenter = {
    PHASE_STEPS,

    /* 阶段进度条当前下标（-1 = 不在流程内） */
    phaseIndex(view) {
      if (!view || !view.phase) return -1;
      const i = PHASE_STEPS.findIndex(s => s[0] === view.phase);
      return i;
    },

    /* 当前阶段之后的下一个用户可见阶段（跳过瞬时自动阶段） */
    nextStep(view) {
      const i = this.phaseIndex(view);
      if (i < 0) return null;
      const skip = new Set(['drawEvent', 'drawVoter', 'count', 'rank', 'settle']);
      for (let k = i + 1; k < PHASE_STEPS.length; k++) {
        if (!skip.has(PHASE_STEPS[k][0])) return PHASE_STEPS[k];
      }
      return null;
    },

    /* 是否轮到我（抽取两端 myTurnSP 逻辑为单一事实源） */
    myTurn(view) {
      if (!view || view.mySeat == null) return false;
      const me = view.mySeat;
      switch (view.phase) {
        case 'buy': return !view.seats[me].buyDone;
        case 'play': return view.turn === me && !view.seats[me].playDone;
        case 'reveal': return !!(view.revealPending && view.revealPending.owner === me);
        case 'count': return !!(view.swapPending && view.swapPending.owner === me);
        case 'preEvent': case 'postEvent': return view.eventTurnSeat === me;
        case 'discard': return view.discardSeat === me && !view.seats[me].keepDone;
        case 'chooseStarter': return view.starterPicker === me && !view.starterChosen;
        case 'pickChar': return !view.seats[me].char;
        default: return false;
      }
    },

    /* ================= 投影：状态 → ViewModel（纯数据，只读） ================= */
    project(view, opts) {
      opts = opts || {};
      if (!view) return null;
      const mySeat = view.mySeat != null ? view.mySeat : (opts.mySeat != null ? opts.mySeat : 0);

      /* 每位玩家的面板数据 */
      const seats = view.seats.map((s, i) => {
        const acting =
          view.phase === 'play' ? (view.turn === i && !s.playDone) :
          view.phase === 'buy' ? !s.buyDone :
          view.phase === 'discard' ? (view.discardSeat === i && !s.keepDone) :
          view.phase === 'preEvent' || view.phase === 'postEvent' ? view.eventTurnSeat === i :
          view.phase === 'chooseStarter' ? (view.starterPicker === i && !view.starterChosen) :
          false;
        return {
          seat: i,
          name: s.name || ('玩家' + (i + 1)),
          isMe: i === mySeat,
          isAI: !!s.isAI,
          side: s.side || null,
          money: s.money != null ? s.money : 0,
          support: s.support != null ? s.support : 0,
          scandal: s.scandal || 0,
          /* 完整 char 对象（公共信息：名字/技能/desc，供悬停卡与面板角色名） */
          char: s.char || null,
          charName: s.char ? s.char.name : '',
          charSkill: s.char && s.char.skill ? s.char.skill.id : null,
          juryTokens: (view.juryTokens && view.juryTokens[i]) || 0,
          /* 防作弊：他人手牌内容/数量不暴露（makeView 已置 null） */
          handCount: s.hand ? s.hand.length : null,
          locked: !!(s.lockedUids && s.lockedUids.length),
          lockedCount: (s.lockedUids && s.lockedUids.length) || 0,
          keepDone: !!s.keepDone,
          buyDone: !!s.buyDone,
          playDone: !!s.playDone,
          acting
        };
      });

      /* 中央行：暗置牌不暴露内容（遵守 makeView 的 {hidden:true} 约定） */
      const row = (view.row || []).map(r => ({
        seat: r.seat,
        revealed: !!r.revealed,
        removed: !!r.removed,
        hidden: !!r.card.hidden,
        uid: r.card.hidden ? null : r.card.uid,
        name: r.card.hidden ? '' : (r.card.name || ''),
        votes: r.card.hidden ? 0 : (r.card.votes || 0),
        tags: r.card.hidden ? [] : (r.card.tags || []).slice(),
        skill: r.card.hidden ? null : (r.card.skill || null)
      }));

      /* 支持度轨道：各阵营占比（谁领先一目了然） */
      const total = view.seats.reduce((a, s) => a + (s.support || 0), 0);
      const supportBar = view.seats.map((s, i) => ({
        seat: i, share: total > 0 ? (s.support || 0) / total : 1 / Math.max(1, view.seats.length)
      }));

      /* 连任恐惧徽章：leaderStreak ≥ 2 且 prevFirst 指向自己 */
      const leading = (view.leaderStreak >= 2 && view.prevFirst != null) ? view.prevFirst : -1;

      const vm = {
        meta: {
          phase: view.phase,
          phaseLabel: view.phaseLabel || view.phase,
          round: view.round || 0,
          cultureName: view.cultureName || '',
          mySeat,
          gameOver: !!view.gameOver,
          winner: view.winner,
          startingSeat: view.startingSeat,
          turn: view.turn,
          playTurn: view.playTurn,
          playLastSeat: view.playLastSeat,
          eventTurnSeat: view.eventTurnSeat,
          discardSeat: view.discardSeat,
          starterPicker: view.starterPicker,
          starterChosen: view.starterChosen,
          precedentSeat: view.precedentSeat != null ? view.precedentSeat : -1,
          deadline: view.deadline || opts.deadline || null
        },
        seats,
        row,
        /* 仅己方可见的市场/事件（他人市场不暴露——makeView 已清空） */
        market: (mySeat != null && view.seats[mySeat] && view.seats[mySeat].market) || [],
        events: (mySeat != null && view.seats[mySeat] && view.seats[mySeat].events) || [],
        hud: {
          phaseIdx: this.phaseIndex(view),
          nextStep: this.nextStep(view),
          supportTotal: total,
          supportBar,
          rankOrder: (view.roundRank || []).slice(),
          leader: leading,          // 连任恐惧徽章候选座位
          votes: (view.votes || []).slice(),
          voteMod: (view.voteMod || []).slice()
        },
        myTurn: this.myTurn(view)
      };
      return vm;
    },

    /* ================= 布局（P1-6：双端布局收口唯一源，client.js 薄封装消费） =================
     * 依赖 opts：{ W, H, compact, isMobile, mySeat, eventPage, HAND_AREA_H, PANEL_Y, panelH }
     * 高度/字号断点由各端 applyUI()（或等价）算出后传入，本层只负责「形状」公式。 */
    layouts(view, opts) {
      opts = opts || {};
      const W = opts.W, H = opts.H;
      if (!W || !H) return null;
      const compact = !!opts.compact, isMobile = !!opts.isMobile, portraitMode = !!opts.portraitMode;
      const mySeat = view.mySeat != null ? view.mySeat : (opts.mySeat != null ? opts.mySeat : 0);
      const eventPage = opts.eventPage || 0;
      const HAND_AREA_H = opts.HAND_AREA_H || 230;
      const PANEL_Y = opts.PANEL_Y || 56;
      const panelH = opts.panelH || 30;
      const reserveR = opts.reserveR || 0;   // 右侧按钮区让位（单机版双列按钮 212px；联机 0）
      const seats = view.seats || [];
      const n = seats.length;
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

      /* 顶部紧凑信息条（每座位一条） */
      const panelRects = seats.map((s, i) => ({ seat: i, x: 10, y: PANEL_Y + i * (panelH + 6), w: W - 20, h: panelH - 4 }));

      /* 中央辩论台：从信息条下方延伸到底栏上方（按钮行让位） */
      const row = view.row || [];
      const rw = clamp(Math.min(118, (W - 60) / Math.max(1, row.length) - 12), 40, 118);
      const cy = PANEL_Y + n * (panelH + 6) + (compact ? 10 : 30);
      const btnH = compact ? 38 : (isMobile ? 50 : 46);
      const availRh = H - HAND_AREA_H - (btnH + 8) - cy;
      const rh = clamp(availRh, compact ? 64 : 88, H * 0.5);
      const total = row.length * (rw + 10) - 10;
      let cx = (W - total) / 2;
      const rowItems = row.map(r => {
        const it = { seat: r.seat, card: r.card, revealed: r.revealed, removed: r.removed, x: cx, y: cy, w: rw, h: rh };
        cx += rw + 10;
        return it;
      });

      /* 底部大卡牌区：手牌（仅我的，防作弊）/ 市场槽 / 事件槽（翻页） */
      const me = seats[mySeat] || {};
      const handY = H - HAND_AREA_H + 8, hh = HAND_AREA_H - 24;
      /* 竖屏触屏：2 列网格（手牌抽屉/市场/事件共用），宽屏保持单行横排 */
      const _grid = (n, y, h, reserveR2, maxW) => {
        if (n <= 0) return [];
        const gap = 8;
        const avail = W - 20 - (reserveR2 || 0) - gap;
        const cw = clamp((avail - gap) / 2, 60, maxW || 200);
        const rows = Math.ceil(n / 2);
        const ch = clamp((h - 8 - (rows - 1) * gap) / rows, 40, 190);
        const out = [];
        for (let i = 0; i < n; i++) {
          const r = i % rows;
          const c = Math.floor(i / rows);
          out.push({ x: 10 + (reserveR2 || 0) / 2 + c * (cw + gap), y: y + 4 + r * (ch + gap), w: cw, h: ch });
        }
        return out;
      };
      const handItems = (me.hand && me.hand.length && hh >= 64)
        ? (portraitMode
          ? _grid(me.hand.length, handY, hh, reserveR, 200).map((r, i) => Object.assign({ card: me.hand[i] }, r))
          : this._flexRects(me.hand.length, handY, hh, 12, 200, reserveR, W).map((r, i) => Object.assign({ card: me.hand[i] }, r)))
        : [];
      const mk = me.market || [];
      const marketItems = mk.length
        ? (portraitMode
          ? _grid(mk.length, H - HAND_AREA_H + 28, HAND_AREA_H - 40, reserveR, 200).map((r, i) => Object.assign({ card: mk[i] }, r))
          : this._flexRects(mk.length, H - HAND_AREA_H + 28, HAND_AREA_H - 40, 12, 200, reserveR, W).map((r, i) => Object.assign({ card: mk[i] }, r)))
        : [];
      const evs = (me.events || []).slice(eventPage * 4, eventPage * 4 + 4);
      const eventItems = evs.length
        ? (portraitMode
          ? _grid(evs.length, H - HAND_AREA_H + 34, HAND_AREA_H - 56, reserveR, 150).map((r, i) => Object.assign({ ev: evs[i] }, r))
          : this._flexRects(evs.length, H - HAND_AREA_H + 34, HAND_AREA_H - 56, 12, 150, reserveR, W).map((r, i) => Object.assign({ ev: evs[i] }, r)))
        : [];

      return { panelRects, rowItems, row: { items: rowItems, rw, rh, cy }, handItems, marketItems, eventItems, HAND_AREA_H, PANEL_Y, panelH };
    },

    /* 通用卡牌槽位：均分可用宽 = W - 20 - 右预留，左对齐，永不溢出（flexRects 唯一源） */
    _flexRects(n, y, h, gap, maxW, reserveR, W) {
      if (n <= 0) return [];
      gap = gap || 12; maxW = maxW || 200; reserveR = reserveR || 0;
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      const avail = Math.max(40, W - 20 - reserveR);
      let cw = clamp((avail - (n - 1) * gap) / n, 16, maxW);
      if (n * cw + (n - 1) * gap > avail) cw = Math.max(10, (avail - (n - 1) * gap) / n);   // 兜底：数量极多时强制收缩
      const out = [];
      for (let i = 0; i < n; i++) out.push({ x: 10 + i * (cw + gap), y, w: cw, h });
      return out;
    },

    /* ================= node 自检（无 DOM 依赖） ================= */
    _selfTest() {
      const view = {
        version: 7, seatCount: 2, phase: 'play', phaseLabel: '出牌阶段',
        round: 2, cultureName: '铁锈带', mySeat: 0, gameOver: false, winner: null,
        startingSeat: 0, turn: 1, playTurn: 1, playLastSeat: 0,
        eventTurnSeat: -1, discardSeat: -1, starterPicker: -1, starterChosen: true,
        leaderStreak: 2, prevFirst: 1,
        seats: [
          { name: '玩家1', isAI: false, money: 4, support: 5, scandal: 0, buyDone: true, playDone: true,
            lockedUids: [], char: { name: '共和党人', skill: { id: 'drawPlus' } }, hand: [{ uid: 1 }],
            market: [{ uid: 9, name: 'X', votes: 1 }], events: [] },
          { name: 'AI 对手', isAI: true, money: 6, support: 7, scandal: 1, buyDone: true, playDone: false,
            lockedUids: [5], char: { name: '民主党人', skill: { id: 'votePlus' } }, hand: null, market: [], events: [] }
        ],
        row: [{ seat: 1, revealed: true, removed: false, card: { uid: 5, name: '网络喷子', votes: 1, tags: ['网络'], skill: 'troll' } }],
        votes: [3, 4], voteMod: [0, 0], roundRank: [1, 0],
        logs: []
      };
      const vm = this.project(view, { W: 800, H: 600 });
      const checks = [];
      checks.push(['phase 投影', vm.meta.phase === 'play']);
      checks.push(['他人手牌不暴露', vm.seats[1].handCount === null]);
      checks.push(['自己手牌数量可见', vm.seats[0].handCount === 1]);
      checks.push(['行动中判定（AI 回合）', vm.seats[1].acting === true && vm.seats[0].acting === false]);
      checks.push(['我的回合判定 false', vm.myTurn === false]);
      checks.push(['连任徽章指向 prevFirst', vm.hud.leader === 1]);
      checks.push(['支持度占比和=1', Math.abs(vm.hud.supportBar.reduce((a, b) => a + b.share, 0) - 1) < 1e-9]);
      checks.push(['阶段进度条下标（play=3）', vm.hud.phaseIdx === 3]);
      const lay = this.layouts(view, { W: 800, H: 600, compact: false, isMobile: false });
      checks.push(['布局：手牌区高 230', lay && lay.HAND_AREA_H === 230]);
      return checks;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = UIPresenter;
  else global.UIPresenter = UIPresenter;
})(typeof window !== 'undefined' ? window : globalThis);
