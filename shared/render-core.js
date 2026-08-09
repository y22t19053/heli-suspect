/* ============================================================
 * shared/render-core.js — 双端共享渲染模块（超级雷霆大更新 第22条）
 * ------------------------------------------------------------
 * 职责：把 singleplayer.html 与 public/client.js 中逐字复制的
 *       渲染函数收敛为单一事实源，双端差异经 env 参数注入表达。
 *
 * 已收敛（单一事实源，双端仅保留一行薄封装）：
 *   RenderCore.renderScene      —— game 屏渲染骨架（清屏+背景+六段+尾部）
 *   RenderCore.drawGoalGuide    —— 阶段目标指引框（原 drawGoalGuide）
 *   RenderCore.updateHoverAnim  —— 悬浮卡动画状态机（原 updateHoverAnim）
 *   RenderCore.hoverAlpha       —— 悬浮卡透明度（原 hoverAlpha）
 *   RenderCore.drawHoverTooltip —— 放大卡+说明文字框（原 drawHoverTooltip）
 *   RenderCore.myTurnOf         —— 当前阶段行动权判定（原 myTurn/myTurnSP）
 *   RenderCore.currentActSeatOf —— 当前行动座位（原 currentActSeat，两端统一含 chooseStarter）
 *   RenderCore.keepMaxOf        —— 整理保留上限（原 keepMax，观战者恒 0）
 *   RenderCore.renderRowArea    —— 辩论台行区（原 renderRowArea，差异经 copy/注入表达）
 *   RenderCore.renderHudOf      —— 顶部信息条 HUD（原 renderHud，P1-7 双端合一，
 *                                  差异经 copy 注入：倒计时/观战 vs 轮次进度条/排名横幅）
 *   RenderCore.renderPanelsOf   —— 顶部座位面板（原 renderPanels，P1-7 双端合一，
 *                                  以联机流式 panelFlow 为基底，单机技能简述/活动红边经 copy 注入）
 *   RenderCore.renderBottomOf   —— 底部大卡牌区（原 renderBottom，P1-7 双端合一，
 *                                  骨架唯一，市场/事件/手牌子块与按钮体系经 env/copy 注入）
 *   RenderCore._panelFlowOf     —— 数值流式布局（原联机本地 panelFlow）
 *   RenderCore._renderMarketOf/_renderEventsOf/_renderHandOf —— 底部三子块（renderBottomOf 内部）
 *
 * 按设计保留双端本地实现（差异大，经 renderScene 的 env 注入调用）：
 *   renderLogs（右上角浮层 vs 贴底栏）、renderActionButtons（双端按钮体系语义必须各自保留）、
 *   checkFxDiffs（数据源与触发差异大）
 *   —— 这是 docs/UI_PRESENTER_REFACTOR.md 7.1 表格确认的设计收口，非未完成项。
 *
 * env 参数约定（两端各写一个 renderEnv() 组装）：
 *   ctx / W / H / PAL         渲染上下文（双端一致）
 *   G()                       数据源访问器（联机 () => view，单机 () => game）
 *   mySeat / HAND_AREA_H / HUD_H   布局参数
 *   mouse / hoverAnim         状态对象引用（本模块只改属性）
 *   hoverCards / buttons      命中/按钮数组引用
 *   screen                    当前屏幕状态值
 *   keepMax() / campColor     辅助函数（差异点注入）
 *   tooltipInfo(h)            悬浮说明内容组装（差异大，注入）
 *   UI / PHASE_STEPS          布局与阶段常量（双端同构，经 env 注入）
 *   vm() / panelRect(i) / panelHeight()   座位面板数据与布局
 *   selected / eventPick / buyMode / eventPage / handScroll / portraitMode / compact / isMobile
 *   marketSlots(me) / eventSlots() / canClickHand(c) / isEventUsable(ev) / renderActionButtons(me)
 *   copy { buyTip, playTip, rowLabel, ... }  文案与差异覆盖（详见各函数注释）
 *   renderScene 专用：drawBackdrop / renderRowArea / renderLogs / renderTail
 *
 * 依赖的全局绘制原语（双端已统一签名，必须为 function 声明）：
 *   drawPixelText / pxRect / pxBorder / drawWrapText / textWidth /
 *   clamp / comicShadow / UIKit / fitText / partyOf / contrast / campSoft
 *
 * 注意：hoverRect 需两端以 var 声明（挂 window），本模块直接读写；
 *       hoverAnim 两端为 let 对象，经 env 传引用即可。
 * ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RenderCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RC = { version: '1.0.0' };

  /* 当前阶段我是否有行动权（统一 myTurn / myTurnSP，逻辑逐字同构）
   * 观战者（mySeat = -1）恒 false */
  RC.myTurnOf = function (env) {
    var g = env.G();
    if (!g) return false;
    var me = env.mySeat;
    if (me == null || me < 0 || !g.seats[me]) return false;
    switch (g.phase) {
      case 'buy': return !g.seats[me].buyDone;
      case 'play': return g.turn === me && !g.seats[me].playDone;
      case 'reveal': return !!(g.revealPending && g.revealPending.owner === me);
      case 'count': return !!(g.swapPending && g.swapPending.owner === me);
      case 'preEvent': case 'postEvent': return g.eventTurnSeat === me;
      case 'discard': return g.discardSeat === me && !g.seats[me].keepDone;
      case 'chooseStarter': return g.starterPicker === me && !g.starterChosen;
      default: return false;
    }
  };

  /* 当前行动座位（统一两端 currentActSeat；chooseStarter 单机原缺失，收敛后一致） */
  RC.currentActSeatOf = function (env) {
    var g = env.G();
    if (!g) return -1;
    switch (g.phase) {
      case 'play': return g.turn;
      case 'preEvent': case 'postEvent': return g.eventTurnSeat;
      case 'discard': return g.discardSeat;
      case 'reveal': return g.revealPending ? g.revealPending.owner : -1;
      case 'count': return g.swapPending ? g.swapPending.owner : -1;
      case 'chooseStarter': return g.starterPicker;
      default: return -1;
    }
  };

  /* 整理阶段保留上限（统一两端 keepMax；观战者/无私有手牌恒 0） */
  RC.keepMaxOf = function (env) {
    var g = env.G();
    var me = env.mySeat;
    if (!g || me == null || me < 0 || !g.seats[me]) return 0;
    var s = g.seats[me];
    return 2 + (s.char && s.char.skill && s.char.skill.type === 'keepPlus' ? s.char.skill.v : 0);
  };

  /* 辩论台行区（统一两端 renderRowArea）
   * 差异经 env 注入：drawRowBackdrop（联机底座+标题 / 单机无）、rowCardAnim（单机 cardIn 动画）、
   * drawRowCard（双端各自实现）；copy 覆盖文案与配色（默认=联机版）：
   *   rowLabel { x, dy, size?, col }    —— 「证据 · 已亮出」位置/颜色
   *   countLine { dash, txt, dy }       —— 审议半区分隔线与标记颜色
   *   rowEmpty { text, size, col }      —— 空行提示 */
  RC.renderRowArea = function (env) {
    const ctx = env.ctx, W = env.W;
    const g = env.G();
    if (!g) return;
    const row = g.row || [];
    const lay = env.rowLayout();
    const cy = lay.cy, rh = lay.rh;
    const copy = env.copy || {};
    const drawRowCard = env.drawRowCard || function () { };
    if (env.drawRowBackdrop) env.drawRowBackdrop(cy, rh);
    const lb = copy.rowLabel || { x: 20, dy: -4, col: '#9FB3CE' };
    drawPixelText('证据 · 已亮出', lb.x, cy + lb.dy, lb.size || 13, lb.col, { shadow: false });
    // 审议阶段：行左/右半区分隔线 + 行首/行尾标记（位置博弈技能可读性）
    if (g.phase === 'count') {
      const act = lay.items.filter(it => it.revealed === true && it.removed !== true);
      if (act.length >= 2) {
        const x0 = act[0].x, x1 = act[act.length - 1].x + act[act.length - 1].w;
        const midX = (x0 + x1) / 2;
        const cl = copy.countLine || { dash: 'rgba(255,214,10,0.4)', txt: '#FFD60A', dy: -14 };
        ctx.save();
        ctx.strokeStyle = cl.dash;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(midX, cy - 24); ctx.lineTo(midX, cy + rh + 10); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.9;
        drawPixelText('◀ 左半区', x0 + 4, cy + cl.dy, 10, cl.txt, { shadow: false });
        drawPixelText('右半区 ▶', x1 - 48, cy + cl.dy, 10, cl.txt, { shadow: false });
        ctx.restore();
        drawPixelText('👈 行首', act[0].x + act[0].w / 2, act[0].y - 15, 10, cl.txt, { align: 'center', shadow: false });
        drawPixelText('行尾 👉', act[act.length - 1].x + act[act.length - 1].w / 2, act[act.length - 1].y - 15, 10, cl.txt, { align: 'center', shadow: false });
      }
    }
    lay.items.forEach(it => {
      if (env.rowCardAnim) env.rowCardAnim(it, () => drawRowCard(it));
      else drawRowCard(it);
    });
    if (!row.length) {
      const em = copy.rowEmpty || { text: '（等待暗置举证…）', size: 15, col: '#7E93B0' };
      drawPixelText(em.text, W / 2, cy + rh / 2, em.size, em.col, { align: 'center', shadow: false });
    }
  };

  /* 顶部信息条 HUD（统一两端 renderHud，P1-7 双端合一）
   * 骨架唯一：背景 → 轮次标题 → 阶段标题 → 支持度轨道 → 观战守卫 → 起始玩家 → 阶段进度条
   * 差异经 copy 注入（不注入即用联机默认值）：
   *   hudBg        —— 背景色（联机 '#101418' / 单机 '#111111'）
   *   roundTxt(g)  —— 轮次标题文本（联机 '第 X 轮'/'准备中' / 单机 '第 X/5 轮'）
   *   roundPos     —— 轮次标题 { x, y, size }（联机 14,HUD_H/2,20 / 单机 14,16,compact?14:17）
   *   roundBar(g)  —— 单机轮次进度条（联机无）
   *   phaseTxt(g)  —— 阶段标题（联机 view.phaseLabel||view.phase / 单机 ElectionCore.phaseLabel）
   *   phasePos     —— 阶段标题 { x, y, size }
   *   trackY/trackH—— 支持度轨道位置/高度（联机 HUD_H-5/5 / 单机 HUD_H-4/4）
   *   trackElse    —— round=0 时轨道替代（联机红蓝各半 / 单机金色全条）
   *   isSpectator()—— 观战守卫（联机 mySeat<0 / 单机恒 false）
   *   startTxt(g)  —— 起始玩家文本（联机防空 / 单机直接）
   *   startPos     —— 起始玩家 { x, y, size }
   *   rankBanner(g)—— 单机上轮排名横幅（联机无）
   *   countdown()  —— 联机行动倒计时（单机无）
   *   stepBar      —— 阶段进度条参数 { maxW, baseW, mobile, sx0, availR, nextSize, nextCol, nextDX, nextGuard } */
  RC.renderHudOf = function (env) {
    const ctx = env.ctx, W = env.W;
    const g = env.G();
    if (!g) return;
    const copy = env.copy || {};
    const HUD_H = env.HUD_H;
    pxRect(0, 0, W, HUD_H, copy.hudBg || '#101418');
    pxBorder(0, 0, W, HUD_H, '#FFD60A', 2.5);
    // 轮次标题
    const rp = copy.roundPos || { x: 14, y: HUD_H / 2, size: 20 };
    drawPixelText(copy.roundTxt ? copy.roundTxt(g) : ('第 ' + (g.round || 0) + ' 轮'), rp.x, rp.y, rp.size, '#FFD60A', { shadow: false });
    // 单机轮次进度条
    if (copy.roundBar) copy.roundBar(g);
    // 阶段标题
    const pp = copy.phasePos || { x: W / 2, y: HUD_H / 2, size: 22 };
    drawPixelText(copy.phaseTxt ? copy.phaseTxt(g) : (g.phaseLabel || g.phase), pp.x, pp.y, pp.size, '#FFFFFF', { align: 'center' });
    // 支持度轨道（观战者同样可见）
    const tY = (copy.trackY !== undefined) ? copy.trackY : HUD_H - 5;
    const tH = copy.trackH || 5;
    if (g.round > 0 && g.seats && g.seats.length) {
      const tot = Math.max(1, g.seats.reduce((a, b) => a + (b.support || 0), 0));
      let sx = 0;
      g.seats.forEach((s, i) => {
        const w2 = Math.max(2, Math.round(W * ((s.support || 0) / tot)));
        pxRect(sx, tY, w2, tH, env.campColor(i));
        sx += w2;
      });
    } else if (copy.trackElse) {
      copy.trackElse(tY, tH);
    } else {
      pxRect(0, tY, W * 0.5, tH, '#FF3B30');
      pxRect(W * 0.5, tY, W * 0.5, tH, '#0A84FF');
    }
    // 观战守卫：旁观者跳过玩家侧信息
    if (copy.isSpectator && copy.isSpectator()) {
      drawPixelText('👁 旁观中', W - 14, HUD_H / 2, 16, '#5AC8FA', { align: 'right', shadow: false });
      return;
    }
    // 起始玩家
    const sp = copy.startPos || { x: W - 14, y: HUD_H / 2, size: 16 };
    drawPixelText(copy.startTxt ? copy.startTxt(g) : '', sp.x, sp.y, sp.size, '#FFD60A', { align: 'right', shadow: false });
    // 单机排名横幅
    if (copy.rankBanner) copy.rankBanner(g);
    // 联机行动倒计时
    if (copy.countdown) copy.countdown();
    // 阶段进度条
    const steps = env.PHASE_STEPS || [];
    const idx = steps.findIndex(s => s[0] === g.phase);
    if (idx >= 0) {
      const sb = copy.stepBar || {};
      const maxW = sb.maxW || 30, baseW = sb.baseW || 320;
      let stepW = sb.mobile ? sb.mobile : Math.min(maxW, (W - baseW) / steps.length - 3);
      stepW = clamp(stepW, 2, maxW);
      let sx = sb.sx0 ? sb.sx0() : Math.max(76, 148);
      const availR = sb.availR ? sb.availR() : (W - 88);
      if (sx + steps.length * (stepW + 3) > availR) {
        stepW = Math.max(2, (availR - sx - (steps.length - 1) * 3) / steps.length);
      }
      steps.forEach((s, i) => {
        const active = i === idx;
        pxRect(sx, HUD_H - 16, stepW, 9, active ? '#FFD60A' : i < idx ? '#4A9A5A' : '#39425A');
        pxBorder(sx, HUD_H - 16, stepW, 9, '#111111', 1);
        sx += stepW + 3;
      });
      if (idx < steps.length - 1 && (!sb.nextGuard || sb.nextGuard(sx))) {
        drawPixelText('下一步：' + steps[idx + 1][1], sx + (sb.nextDX || 6), HUD_H - 11, sb.nextSize ? sb.nextSize() : 12, sb.nextCol || '#DCE6F5', { shadow: false });
      }
    }
  };

  /* 顶部座位面板（统一两端 renderPanels，P1-7 双端合一）
   * 骨架唯一：vm 投影 → 逐座位画面板 → 紧凑/非紧凑两布局 → 数值流(panelFlow) → 事件目标/起始选择
   * 差异经 copy 注入：
   *   panelBg     —— 面板底色（联机 '#F2E9D2' / 单机 '#efe6cd'）
   *   panelBorder —— 边框 (isAct)=>{col,w}（联机恒黑 2 / 单机活动红边 3）
   *   screenGuard —— 联机需 screen==='game' 前置（联机 true / 单机 false）
   *   charBrief(s)—— 非紧凑角色文本（联机 '检方·名' / 单机 '检方·名 · 技能简述'）
   *   charSize/charCol —— 角色名字号/颜色（联机 10.5 '#C0392B' / 单机 10 '#D82E2F'）
   *   scandalZero —— 丑闻 0 值是否显示灰标（联机 true / 单机 false 仅 >0）
   *   scandalCol  —— 丑闻红（联机 '#E04343' / 单机 '#E6392F'）
   *   actCol      —— ⚡举证中/▶行动中（联机 '#FF5A4E' / 单机 '#E6392F'）
   *   lockShow    —— 🔒门控 (s,isMe,g)（联机 UI.show.locked&&count / 单机 count&&(isMe||phase!=='buy')）
   *   lockCol     —— 🔒色（联机 '#0A84FF' / 单机 '#1E4FB5'）
   *   scandalBar  —— 丑闻条门控 (s,sc)（联机 UI.show.scandalBar / 单机 sc>0）
   *   pickCol     —— 事件目标边框（联机 '#FF5A4E' / 单机 '#E6392F'）
   *   starterGuard—— chooseStarter 需 !g.starterChosen（联机 true / 单机 false）
   *   pickBtn(x,y,w,h,kind,data) —— 选择点击注册（联机仅 hoverCards / 单机 btn+buttons） */
  RC.renderPanelsOf = function (env) {
    const ctx = env.ctx, W = env.W;
    const vm = env.vm();
    if (!vm) return;
    const g = vm.meta;
    const seats = vm.seats;
    const n = seats.length;
    const ph = env.panelHeight();
    const act = RC.currentActSeatOf(env);
    const copy = env.copy || {};
    const show = env.UI.show;
    for (let i = 0; i < n; i++) {
      const s = seats[i];
      const pr = env.panelRect(i);
      if (!pr) continue;
      const { x, y, w } = pr;
      const isMe = i === env.mySeat;
      const crown = vm.hud.leader === i ? ' 👑' : '';
      const focusPhase = g.phase === 'buy' || g.phase === 'play' || g.phase === 'discard' || g.phase === 'preEvent' || g.phase === 'postEvent';
      const focusDim = (copy.screenGuard === false || env.screen === 'game') && focusPhase && !RC.myTurnOf(env) && !isMe && act !== i;
      if (focusDim) { ctx.save(); ctx.globalAlpha = 0.4; }
      pxRect(x, y, w, ph - 4, isMe ? campSoft(i) : (copy.panelBg || '#F2E9D2'));
      const brd = copy.panelBorder ? copy.panelBorder(act === i) : { col: '#111111', w: 2 };
      pxBorder(x, y, w, ph - 4, brd.col, brd.w);
      const sc = s.scandal || 0;
      const fs2 = env.UI.fs.num;
      if (env.compact) {
        const av = 14, avY = y + 3;
        const pt = partyOf(i);
        pxRect(x + 6, avY, av, av, campColor(i));
        pxBorder(x + 6, avY, av, av, '#111111', 2);
        drawPixelText(pt.sym, x + 6 + av / 2, avY + av / 2, 10, contrast(campColor(i)), { align: 'center', shadow: false });
        const nmR1 = drawPixelText(s.name + (isMe ? '（你）' : '') + crown, x + 24, y + 6, 11, '#111111', { shadow: false });
        if (s.side) drawPixelText(s.side === 'prosecutor' ? '·检方' : '·辩护方', x + 24 + nmR1.w + 4, y + 6, 9, s.side === 'prosecutor' ? '#D82E2F' : '#2F6FD8', { shadow: false });
        let nx2 = x + 24;
        if (s.char) {
          const fCh = fitText('·' + s.char.name, Math.max(26, w * 0.20), 10);
          drawPixelText(fCh.text, x + 24, y + 15, fCh.size, copy.charCol || '#C0392B', { shadow: false });
          nx2 = x + 24 + fCh.w + 8;
          env.hoverCards.push({ x: x + 24, y: y + 6, w: Math.min(160, w * 0.32), h: 16, kind: 'charSkill', data: { ch: s.char } });
        }
        const flow = [];
        flow.push({ txt: '⊙' + s.money, col: '#B8860B' });
        flow.push({ txt: '⚖' + s.support, col: '#111111' });
        if (sc > 0 || copy.scandalZero) flow.push({ txt: '😈' + sc, col: sc > 0 ? (copy.scandalCol || '#E04343') : '#8A8A8A' });
        if (show.jury && s.juryTokens > 0) flow.push({ txt: '🕊' + s.juryTokens + '/3', col: '#7B4FC9' });
        if (show.prev && g.precedentSeat === i) flow.push({ txt: '⚖️先例', col: '#7B4FC9' });
        if (show.handN) {
          if (isMe) flow.push({ txt: '手牌' + s.handCount, col: '#333333' });
          else if (act === i && g.phase === 'play') flow.push({ txt: '⚡举证中', col: copy.actCol || '#FF5A4E' });
        }
        if (copy.lockShow ? copy.lockShow(s, isMe, g) : (show.locked && s.lockedCount)) flow.push({ txt: '🔒' + s.lockedCount, col: copy.lockCol || '#0A84FF' });
        if (act === i && g.phase !== 'play') flow.push({ txt: '▶行动中', col: copy.actCol || '#FF5A4E' });
        RC._panelFlowOf(env, nx2, y + ph / 2, fs2, flow);
        if (g.phase === 'play' && g.playLastSeat === i) {
          const on = Math.sin(performance.now() / 110) > 0 ? 1 : 0.35;
          ctx.save(); ctx.globalAlpha = on;
          pxBorder(x - 2, y - 2, w + 4, ph, '#FFD60A', 3);
          ctx.restore();
        }
      } else {
        const av = 22;
        const pt = partyOf(i);
        pxRect(x + 6, y + 4, av, av, campColor(i));
        pxBorder(x + 6, y + 4, av, av, '#111111', 2);
        drawPixelText(pt.sym, x + 6 + av / 2, y + 4 + av / 2, 13, contrast(campColor(i)), { align: 'center', shadow: false });
        const nmR2 = drawPixelText(s.name + (isMe ? '（你）' : '') + crown, x + 34, y + 9, 14, '#111111', { shadow: false });
        if (s.side) drawPixelText(s.side === 'prosecutor' ? '·检方' : '·辩护方', x + 34 + nmR2.w + 4, y + 9, 11, s.side === 'prosecutor' ? '#D82E2F' : '#2F6FD8', { shadow: false });
        let nx2 = x + 34;
        if (s.char) {
          const fCh2 = fitText(copy.charBrief ? copy.charBrief(s) : ((s.side === 'prosecutor' ? '检方·' : '辩方·') + s.char.name), Math.max(26, w * 0.22), copy.charSize || 10.5);
          drawPixelText(fCh2.text, x + 34, y + 21, fCh2.size, copy.charCol || '#C0392B', { shadow: false });
          nx2 = x + 34 + fCh2.w + 10;
          env.hoverCards.push({ x: x + 34, y: y + 14, w: Math.min(160, w * 0.32), h: 14, kind: 'charSkill', data: { ch: s.char } });
        }
        const flow = [];
        flow.push({ txt: '⊙ ' + s.money, col: '#B8860B' });
        flow.push({ txt: '⚖ ' + s.support, col: '#111111' });
        if (sc > 0 || copy.scandalZero) flow.push({ txt: '😈' + sc, col: sc > 0 ? (copy.scandalCol || '#E04343') : '#8A8A8A' });
        if (show.jury && s.juryTokens > 0) flow.push({ txt: '🕊' + s.juryTokens + '/3', col: '#7B4FC9' });
        if (show.prev && g.precedentSeat === i) flow.push({ txt: '⚖️先例', col: '#7B4FC9' });
        if (show.handN) {
          if (isMe) flow.push({ txt: '手牌 ' + s.handCount, col: '#333333' });
          else if (act === i && g.phase === 'play') flow.push({ txt: '⚡ 举证中', col: copy.actCol || '#FF5A4E' });
        }
        if (copy.lockShow ? copy.lockShow(s, isMe, g) : (show.locked && s.lockedCount)) flow.push({ txt: '🔒' + s.lockedCount, col: copy.lockCol || '#0A84FF' });
        if (act === i && g.phase !== 'play') flow.push({ txt: '▶ 行动中', col: copy.actCol || '#FF5A4E' });
        RC._panelFlowOf(env, nx2, y + ph / 2, fs2, flow);
        // 丑闻条
        if (copy.scandalBar ? copy.scandalBar(s, sc) : show.scandalBar) {
          pxRect(x + w * 0.52 + 24, y + 6, 40, 6, '#3A2A2A');
          pxBorder(x + w * 0.52 + 24, y + 6, 40, 6, '#111111', 1);
          if (sc > 0) {
            const scCol = sc <= 1 ? '#7DCEA0' : (sc <= 3 ? '#F1C40F' : (copy.scandalCol || '#E04343'));
            pxRect(x + w * 0.52 + 26, y + 8, Math.max(2, 36 * Math.min(1, sc / 5)), 2.5, scCol);
          }
        }
        if (g.phase === 'play' && g.playLastSeat === i) {
          const on = Math.sin(performance.now() / 110) > 0 ? 1 : 0.35;
          ctx.save(); ctx.globalAlpha = on;
          pxBorder(x - 2, y - 2, w + 4, ph, '#FFD60A', 3);
          ctx.restore();
          drawPixelText('🎙 结案陈词', x + w - 56, y + ph / 2, 12, '#B8860B', { align: 'center', shadow: false });
        }
      }
      // 事件目标选择 / 选择起始玩家（点击头像）
      const avX = 6, avY2 = env.compact ? y + 3 : y + 4, avSz = env.compact ? 14 : 22;
      if ((g.phase === 'preEvent' || g.phase === 'postEvent') && env.eventPick && env.eventPick.seat === env.mySeat && i !== env.mySeat) {
        pxBorder(x + 4, y + 2, avSz + 4, avSz + 4, copy.pickCol || '#FF5A4E', 4);
        env.hoverCards.push({ x: x + avX, y: avY2, w: avSz, h: avSz, kind: 'eventTarget', data: { targetSeat: i } });
        if (copy.pickBtn) copy.pickBtn(x + avX, avY2, avSz, avSz, 'eventTarget', i);
      }
      if (g.phase === 'chooseStarter' && g.starterPicker === env.mySeat && (copy.starterGuard === false || !g.starterChosen)) {
        pxBorder(x + 4, y + 2, avSz + 4, avSz + 4, '#FFD60A', 4);
        env.hoverCards.push({ x: x + avX, y: avY2, w: avSz, h: avSz, kind: 'starter', data: { starterSeat: i } });
        if (copy.pickBtn) copy.pickBtn(x + avX, avY2, avSz, avSz, 'starter', i);
      }
      if (focusDim) ctx.restore();
    }
  };

  /* 数值流式布局（原联机本地 panelFlow，P1-7 收敛至此；单机经 copy 保持固定坐标差异由 flow 内容表达） */
  RC._panelFlowOf = function (env, nx, y, size, items) {
    const W = env.W;
    const bold = '700 ';
    const gap = 12;
    for (const it of items) {
      const w2 = textWidth(it.txt, bold + size + 'px ' + env.fontBase) + gap;
      if (nx + w2 > W - 14) break;
      drawPixelText(it.txt, nx, y, size, it.col, { shadow: false });
      nx += w2;
    }
    return nx;
  };

  /* 底部大卡牌区（统一两端 renderBottom，P1-7 双端合一）
   * 骨架唯一：底台 → 观战守卫 → buy/事件/手牌三分支 → renderActionButtons
   * 差异经 env/copy 注入：
   *   env.marketSlots(me)  —— 证物架槽（联机 marketSlotRects / 单机 marketLayout）
   *   env.eventSlots()     —— 事件卡槽（联机 eventSlotRects / 单机 eventLayout）
   *   env.navBtn(id,x,y,w,h,text,enabled) —— 翻页按钮（联机 addButton / 单机 btn+drawBtn）
   *   env.canClickHand(c)/isEventUsable(ev)/renderActionButtons(me) —— 行为双端各自
   *   copy.marketTitleCol/pageCol/emptyCol/handTitleCol/handTitleSize/handSelCol/handEmptyCol/handEmptySize
   *   copy.marketCardAnim/eventCardAnim/handCardAnim —— 单机入场动画包裹（联机无）
   *   copy.marketBtn/eventBtn/handBtn —— 单机按钮注册（联机无）
   *   copy.hoverAll —— hoverCards 恒 push（单机 true / 联机仅可用时）
   *   copy.handMinH —— 手牌区最小高度（联机 64 / 单机 compact?64:100）
   *   copy.flexReserve —— flexRects 右侧预留（联机 0 / 单机 bottomReserve()） */
  RC.renderBottomOf = function (env) {
    const ctx = env.ctx, W = env.W, H = env.H;
    const g = env.G();
    if (!g) return;
    const me = g.seats[env.mySeat];
    const y0 = H - env.HAND_AREA_H;
    pxRect(6, y0 + 2, W - 12, env.HAND_AREA_H - 8, 'rgba(16,20,28,0.88)');
    pxBorder(6, y0 + 2, W - 12, env.HAND_AREA_H - 8, '#3A4258', 2);
    if (!me) {
      drawPixelText('👁 观战中 · 不参与对局', W / 2, y0 + env.HAND_AREA_H / 2 - 12, 24, '#FFD60A', { align: 'center', shadow: false });
      drawPixelText('当前阶段：' + (g.phaseLabel || g.phase), W / 2, y0 + env.HAND_AREA_H / 2 + 18, 15, '#CDD8E8', { align: 'center', shadow: false });
      return;
    }
    const showEvents = g.phase === 'preEvent' || g.phase === 'postEvent';
    const showHand = g.phase === 'play' || g.phase === 'discard';
    if (g.phase === 'buy') {
      RC._renderMarketOf(env, me, y0);
    } else if (showEvents) {
      RC._renderEventsOf(env, me, y0);
    } else if (showHand) {
      RC._renderHandOf(env, me, y0);
    }
    if (env.renderActionButtons) env.renderActionButtons(me);
  };

  /* 证物架：标题 + 槽位卡片（点牌传唤/留证） */
  RC._renderMarketOf = function (env, me, y0) {
    const ctx = env.ctx, W = env.W;
    const copy = env.copy || {};
    const x = 10, y = y0 + 28, w = env.portraitMode ? W - 20 : W - 260, h = env.HAND_AREA_H - 40;
    drawPixelText(env.buyMode === 'lock' ? '🔒 留证模式（点牌留证）' : '证物架 · 点牌传唤（⊙' + me.money + '）', 10, y0 + 12, 14, copy.marketTitleCol || '#FFD60A', { shadow: false });
    (env.marketSlots ? env.marketSlots(me) : []).forEach(r => {
      const card = r.card;
      const locked = me.lockedUids.indexOf(card.uid) >= 0;
      const cost = ElectionCore.buyCostOf(me, card);
      const afford = me.money >= cost;
      const draw = () => {
        ctx.save();
        // *= 而非 =：单机 marketCardAnim 先设入场淡入 alpha，此处相乘保留淡入效果
        ctx.globalAlpha *= (locked ? 1 : (afford ? 1 : 0.55));
        UIKit.drawCard(ctx, r.x, r.y, r.w, r.h, card, { col: locked ? '#cfc3f2' : '#f6e9c8' });
        ctx.restore();
      };
      if (copy.marketCardAnim) copy.marketCardAnim(r.x, r.y, r.w, r.h, card, draw);
      else draw();
      if (locked) drawPixelText('🔒', r.x + r.w / 2, r.y + r.h * 0.4, 18, '#1E4FB5', { align: 'center', shadow: false });
      env.hoverCards.push({ x: r.x, y: r.y, w: r.w, h: r.h, kind: 'market', data: { card, uid: card.uid } });
      if (copy.marketBtn) copy.marketBtn(r.x, r.y, r.w, r.h, card);
    });
  };

  /* 事件牌区：翻页 + 事件卡（可用于目标选择） */
  RC._renderEventsOf = function (env, me, y0) {
    const ctx = env.ctx, W = env.W;
    const copy = env.copy || {};
    const evs = me.events || [];
    const maxPage = Math.max(0, Math.ceil(evs.length / 4) - 1);
    let ep = env.eventPage();
    if (ep > maxPage) { ep = maxPage; env.setEventPage(ep); }
    drawPixelText('事件牌（' + evs.length + '）', 10, y0 + 14, 14, '#FFD60A', { shadow: false });
    if (maxPage > 0) {
      if (env.navBtn) {
        env.navBtn('evPrev', 118, y0 + 3, 40, 26, '◀', ep > 0);
        env.navBtn('evNext', 162, y0 + 3, 40, 26, '▶', ep < maxPage);
      }
      drawPixelText((ep + 1) + '/' + (maxPage + 1), 210, y0 + 16, 11, copy.pageCol || '#C9D6EA', { shadow: false });
    }
    (env.eventSlots ? env.eventSlots() : []).forEach(r => {
      const ev = r.ev;
      const usable = env.isEventUsable ? env.isEventUsable(ev) : true;
      const draw = () => UIKit.drawEventCard(ctx, r.x, r.y, r.w, r.h, ev, { col: usable ? env.PAL.events.a : '#8a8a9a' });
      if (copy.eventCardAnim) copy.eventCardAnim(r.x, r.y, r.w, r.h, ev, draw);
      else draw();
      if (usable || copy.hoverAll) env.hoverCards.push({ x: r.x, y: r.y, w: r.w, h: r.h, kind: 'event', data: { ev, uid: ev.uid } });
      if (copy.eventBtn) copy.eventBtn(r.x, r.y, r.w, r.h, ev, usable);
      if (ev.used) drawPixelText('✓ 已使用', r.x + r.w / 2, r.y + r.h - 12, 11, '#5AC8FA', { align: 'center', shadow: false });
    });
    if (!evs.length) drawPixelText('（暂无事件牌）', 10, y0 + 60, 13, copy.emptyCol || '#7E93B0', { shadow: false });
  };

  /* 手牌区：分页/横排 + 卡牌（选择举证/保留） */
  RC._renderHandOf = function (env, me, y0) {
    const ctx = env.ctx, W = env.W;
    const copy = env.copy || {};
    const handY = y0 + 28;
    const hh = env.HAND_AREA_H - 40;
    const minH = copy.handMinH ? copy.handMinH() : 64;
    if (hh >= minH && me.hand.length) {
      if (env.portraitMode) {
        const rects = handGridRects(me.hand.length, handY, hh);
        const perPage = env.portraitPerPage || 6;
        const pages = Math.max(1, Math.ceil(rects.length / perPage));
        let hs = env.handScroll();
        if (hs > pages - 1) hs = pages - 1;
        if (hs < 0) hs = 0;
        env.setHandScroll(hs);
        const from = hs * perPage, to = Math.min(rects.length, from + perPage);
        drawPixelText(copy.handTitle ? copy.handTitle(me, from, to, rects.length) : ('手牌 ' + me.hand.length + ' 张'), 12, y0 + 13, copy.handTitleSize || 12.5, copy.handTitleCol || '#FFD60A', { shadow: false });
        if (pages > 1) {
          drawPixelText((hs + 1) + '/' + pages, W / 2, y0 + 13, 12.5, copy.pageCol || '#C9D6EA', { align: 'center', shadow: false });
          if (env.navBtn) {
            env.navBtn('handPrev', W - 92, y0 + 2, 40, 24, '◀', hs > 0);
            env.navBtn('handNext', W - 48, y0 + 2, 40, 24, '▶', hs < pages - 1);
          }
        }
        for (let i = from; i < to; i++) {
          const r = rects[i];
          const card = me.hand[i];
          const sel = env.selected.indexOf(card.uid) >= 0;
          const clickable = env.canClickHand ? env.canClickHand(card) : false;
          const draw = () => {
            ctx.save();
            UIKit.drawCard(ctx, r.x, r.y, r.w, r.h, card, { col: sel ? env.PAL.accent.b : '#f6e9c8' });
            ctx.restore();
          };
          if (copy.handCardAnim) copy.handCardAnim(r.x, r.y, r.w, r.h, card, draw);
          else draw();
          if (clickable || copy.hoverAll) env.hoverCards.push({ x: r.x, y: r.y, w: r.w, h: r.h, kind: 'hand', data: { card, uid: card.uid } });
          if (copy.handBtn) copy.handBtn(r.x, r.y, r.w, r.h, card, clickable);
          if (sel) pxBorder(r.x - 3, r.y - 3, r.w + 6, r.h + 6, copy.handSelCol || '#FFD400', 4);
        }
      } else {
        const rects = flexRects(me.hand.length, handY, hh, 12, 200, copy.flexReserve ? copy.flexReserve() : 0);
        me.hand.forEach((card, i) => {
          const r = rects[i];
          const sel = env.selected.indexOf(card.uid) >= 0;
          const clickable = env.canClickHand ? env.canClickHand(card) : false;
          const draw = () => {
            ctx.save();
            UIKit.drawCard(ctx, r.x, r.y, r.w, r.h, card, { col: sel ? env.PAL.accent.b : '#f6e9c8' });
            ctx.restore();
          };
          if (copy.handCardAnim) copy.handCardAnim(r.x, r.y, r.w, r.h, card, draw);
          else draw();
          if (clickable || copy.hoverAll) env.hoverCards.push({ x: r.x, y: r.y, w: r.w, h: r.h, kind: 'hand', data: { card, uid: card.uid } });
          if (copy.handBtn) copy.handBtn(r.x, r.y, r.w, r.h, card, clickable);
          if (sel) pxBorder(r.x - 3, r.y - 3, r.w + 6, r.h + 6, copy.handSelCol || '#FFD400', 4);
        });
      }
    } else if (me.hand.length) {
      drawPixelText(copy.handEmpty ? copy.handEmpty(me) : ('手牌 ' + me.hand.length + ' 张'), 10, y0 + 40, copy.handEmptySize || 14.5, copy.handEmptyCol || '#9FB3CE', { shadow: false });
    }
  };

  /* 阶段目标指引框：呼吸灯边框 + 当前要做的事（按阶段与行动权） */
  RC.drawGoalGuide = function (env) {
    var ctx = env.ctx, W = env.W, H = env.H;
    var g = env.G();
    if (!g) return;
    var me = env.mySeat;
    if (!g.seats[me]) return;
    var ph = g.phase;
    var handY0 = H - env.HAND_AREA_H - 40;
    var myTurn = env.myTurn || function () { return RC.myTurnOf(env); };
    var copy = env.copy || {};
    var keepMax = env.keepMax || function () { return 0; };
    var tip = '', sub = '', bx2 = 0, by2 = 0;
    if (ph === 'buy' && myTurn()) { tip = copy.buyTip || '调查取证：传唤证物架上的证据'; sub = '点击证物传唤 · 完成后点「结束取证」'; bx2 = 12; by2 = handY0 - 40; }
    else if (ph === 'play' && myTurn()) { tip = copy.playTip || '暗置举证：从手牌打 1 张'; sub = '选中后点「举证」· 也可直接点「结束举证」放弃'; bx2 = 12; by2 = handY0 - 40; }
    else if (ph === 'discard' && g.discardSeat === me) { tip = '整理：保留最多 ' + keepMax() + ' 份'; sub = '点击手牌留证要保留的证词，其余归档'; bx2 = 12; by2 = handY0 - 40; }
    else if (ph === 'reveal' && myTurn()) { tip = '技能发动：点击目标卡牌'; sub = '证据排除 / 程序动议等技能需选择目标'; bx2 = W * 0.5; by2 = 38; }
    else if (ph === 'count' && myTurn()) { tip = '换位技能：点击金色高亮牌'; sub = '选择与目标互换位置'; bx2 = W * 0.5; by2 = 38; }
    else if ((ph === 'preEvent' || ph === 'postEvent') && g.eventTurnSeat === me) { tip = ph === 'preEvent' ? '庭审前事件：打出或跳过' : '庭审后事件：打出或跳过'; sub = '点击事件区可用的事件牌'; bx2 = 12; by2 = handY0 - 40; }
    else if (ph === 'chooseStarter' && g.starterPicker === me) { tip = '选择本轮起始玩家'; sub = '点击一位玩家的头像'; bx2 = W * 0.5; by2 = 38; }
    if (!tip) return;
    const bw2 = Math.min(430, W - 30);
    if (bx2 + bw2 > W - 8) bx2 = W - 8 - bw2;
    if (bx2 < 8) bx2 = 8;
    const on = 0.5 + 0.5 * Math.sin(performance.now() / 220);
    ctx.save();
    ctx.globalAlpha = 0.9;
    pxRect(bx2, by2, bw2, 42, 'rgba(16,20,28,0.92)');
    ctx.globalAlpha = 0.45 + on * 0.55;
    pxBorder(bx2 - 2, by2 - 2, bw2 + 4, 46, '#FFD60A', 3);
    ctx.globalAlpha = 0.9;
    drawPixelText('🎯 ' + tip, bx2 + 13, by2 + 14, 14.5, '#FFD60A', { shadow: false });
    drawPixelText(sub, bx2 + 13, by2 + 32, 11.5, '#CDD8E8', { shadow: false });
    ctx.restore();
    // 新手指引（策划意见1 轻量版）：前两轮附加指向目标区域的闪烁箭头
    if ((g.round || 0) <= 2) {
      const pu = Math.sin(performance.now() / 160);
      const drawArrow = (ax, ay, dir) => {
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.45 * Math.abs(pu);
        ctx.translate(ax, ay);
        ctx.scale(1 + 0.12 * pu, 1 + 0.12 * pu);
        ctx.fillStyle = '#FFD60A';
        ctx.strokeStyle = '#111111'; ctx.lineWidth = 2;
        ctx.beginPath();
        if (dir === 'down') { ctx.moveTo(0, 0); ctx.lineTo(-9, -13); ctx.lineTo(9, -13); }
        else { ctx.moveTo(0, 0); ctx.lineTo(-13, -9); ctx.lineTo(-13, 9); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      };
      const btnY = H - env.HAND_AREA_H + 30;
      if (ph === 'buy' && myTurn()) drawArrow(W - 200, btnY - 16, 'down');
      else if (ph === 'play' && myTurn()) drawArrow(W - 200, btnY - 16, 'down');
      else if ((ph === 'preEvent' || ph === 'postEvent') && g.eventTurnSeat === me) drawArrow(120, H - env.HAND_AREA_H + 20, 'down');
      else if (ph === 'discard' && g.discardSeat === me) drawArrow(150, H - env.HAND_AREA_H + 20, 'down');
    }
  };

  /* 悬浮卡动画状态机：命中检测 + 淡入淡出方向 */
  RC.updateHoverAnim = function (env) {
    if (env.screen !== 'game' && env.screen !== 'draft') { env.hoverAnim.card = null; return; }
    const now = performance.now();
    let hit = null;
    for (let i = 0; i < env.hoverCards.length; i++) {
      const h = env.hoverCards[i];
      if (env.mouse.x >= h.x && env.mouse.x <= h.x + h.w && env.mouse.y >= h.y && env.mouse.y <= h.y + h.h) { hit = h; break; }
    }
    if (hit) {
      const same = env.hoverAnim.card && env.hoverAnim.card.kind === hit.kind
        && (env.hoverAnim.card.data === hit.data) && (env.hoverAnim.card.card === hit.card);
      env.hoverAnim.card = hit;
      if (!same) { env.hoverAnim.t0 = now; env.hoverAnim.dir = 1; }
      else env.hoverAnim.t0 = now;   // 持续悬停：淡入保持满值
    } else if (env.hoverAnim.card) {
      // 兜底：鼠标停在放大卡上（放大卡不参与命中检测）→ 保持悬停，防止闪烁
      const hr = hoverRect;
      const onEnlarged = hr && env.mouse.x >= hr.bx && env.mouse.x <= hr.bx + hr.bw
        && env.mouse.y >= hr.by && env.mouse.y <= hr.by + hr.bh;
      if (onEnlarged) { env.hoverAnim.t0 = now; }
      else if (env.hoverAnim.dir === 1) { env.hoverAnim.t0 = now; env.hoverAnim.dir = 0; }
      else if (now - env.hoverAnim.t0 > 200) env.hoverAnim.card = null;   // 淡出完成清理
    }
  };

  /* 悬浮卡透明度：淡入 dt/130，淡出 1-dt/200 */
  RC.hoverAlpha = function (env) {
    if (!env.hoverAnim.card) return 0;
    const dt = performance.now() - env.hoverAnim.t0;
    if (env.hoverAnim.dir === 1) return clamp(dt / 130, 0, 1);
    return clamp(1 - dt / 200, 0, 1);
  };

  /* 绘制悬浮信息卡：放大 1.5 倍的卡牌 + 说明文字框（淡入淡出） */
  RC.drawHoverTooltip = function (env) {
    const ctx = env.ctx, W = env.W, H = env.H;
    const mouse = env.mouse, hoverAnim = env.hoverAnim;
    const h = hoverAnim.card;
    if (!h) return;
    const a = RC.hoverAlpha(env);
    if (a <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = a;
    const scale = 1.5;
    const bw = Math.round(h.w * scale), bh = Math.round(h.h * scale);
    // 放大卡水平：优先鼠标右侧，放不下则转左侧（始终不盖鼠标）
    let bx = mouse.x + 26;
    if (bx + bw > W - 8) bx = Math.max(8, mouse.x - bw - 26);
    // 放大卡垂直：优先鼠标上方（放大卡不遮鼠标 → 悬停不闪烁），上方放不下才放鼠标下方
    let by = mouse.y - bh - 20;
    if (by < 6) by = Math.min(Math.max(6, H - bh - 6), mouse.y + 26);
    hoverRect = { bx, by, bw, bh };
    let drawCardKind = false;
    if (h.kind === 'char' && h.data) { UIKit.drawCharCard(ctx, bx, by, bw, bh, h.data, env.campColor(env.mySeat), true); drawCardKind = true; }
    else if (h.kind === 'event' && h.data && h.data.ev) { UIKit.drawEventCard(ctx, bx, by, bw, bh, h.data.ev); drawCardKind = true; }
    else if (h.kind === 'charSkill') { /* 只出文字框 */ }
    else if (h.card || (h.data && (h.data.card || h.data.ev))) { UIKit.drawCard(ctx, bx, by, bw, bh, h.card || h.data.card || h.data.ev); drawCardKind = true; }
    const info = env.tooltipInfo(h);
    if (info) {
      const padX = 14, padY = 12, lh = 21, tSize = 20;
      const boxW = Math.min(360, W - 16);
      const content = info.lines.concat(info.extra || []);
      const extraH = info.extra && info.extra.length ? info.extra.length * 17 + 8 : 0;
      const boxH = padY * 2 + tSize + 10 + content.length * lh + extraH;
      // 文字框：有放大卡时与放大卡垂直居中对齐放其右侧，放不下转左侧；无卡时跟随鼠标
      let bx2 = (drawCardKind ? bx + bw + 18 : mouse.x + 26);
      let by2 = (drawCardKind ? by + bh / 2 - boxH / 2 : mouse.y + 34);
      if (bx2 + boxW > W - 8) bx2 = Math.max(8, (drawCardKind ? bx - boxW - 18 : W - 8 - boxW));
      if (by2 + boxH > H - 8) by2 = Math.max(8, H - 8 - boxH);
      if (by2 < 8) by2 = 8;
      comicShadow(bx2, by2, boxW, boxH, 4, 4);
      pxRect(bx2, by2, boxW, boxH, '#FFFDF2');
      pxBorder(bx2, by2, boxW, boxH, '#111111', 2.5);
      drawPixelText(info.title, bx2 + padX, by2 + padY + tSize / 2, tSize, info.catCol || '#d64545', { shadow: false });
      ctx.save();
      ctx.strokeStyle = 'rgba(17,17,17,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(bx2 + 8, by2 + padY + tSize + 4); ctx.lineTo(bx2 + boxW - 8, by2 + padY + tSize + 4); ctx.stroke();
      ctx.restore();
      let ty = by2 + padY + tSize + 12;
      info.lines.forEach(ln => {
        ty += drawWrapText(ln, bx2 + padX, ty + lh / 2, 13.5, '#333333', boxW - padX * 2, lh, { shadow: false });
      });
      (info.extra || []).forEach(ln => {
        drawPixelText('◆ ' + ln, bx2 + padX, ty + 8, 11.5, '#c98a1b', { shadow: false });
        ty += 17;
      });
    }
    ctx.restore();
  };

  /* game 屏渲染骨架：清屏 + 背景 + 六段 + 尾部（统一 renderGame 主流程） */
  RC.renderScene = function (env) {
    env.buttons.length = 0;
    env.hoverCards.length = 0;
    env.ctx.clearRect(0, 0, env.W, env.H);
    env.drawBackdrop();          // 双端背景差异：联机速度线+聚光灯 / 单机 drawBg(PAL.bg)
    if (!env.G()) return;
    RC.renderHudOf(env);         // P1-7 双端合一：renderHud 差异经 copy 注入
    env.renderRowArea();
    RC.renderPanelsOf(env);      // P1-7 双端合一：renderPanels 差异经 copy 注入
    RC.renderBottomOf(env);      // P1-7 双端合一：renderBottom 差异经 copy/env 注入
    env.renderLogs();
    RC.drawGoalGuide(env);
    env.renderTail();            // 双端尾部差异：联机 renderFx / 单机 renderToast+遮罩
  };

  return RC;
});
