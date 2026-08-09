/* ============================================================
 * shared/render-core.js — 双端共享渲染模块（超级雷霆大更新 第22条）
 * ------------------------------------------------------------
 * 职责：把 singleplayer.html 与 public/client.js 中逐字复制的
 *       渲染函数收敛为单一事实源，双端差异经 env 参数注入表达。
 *
 * 本批收敛（完全/高度同构，低风险）：
 *   RenderCore.renderScene      —— game 屏渲染骨架（清屏+背景+六段+尾部）
 *   RenderCore.drawGoalGuide    —— 阶段目标指引框（原 drawGoalGuide）
 *   RenderCore.updateHoverAnim  —— 悬浮卡动画状态机（原 updateHoverAnim）
 *   RenderCore.hoverAlpha       —— 悬浮卡透明度（原 hoverAlpha）
 *   RenderCore.drawHoverTooltip —— 放大卡+说明文字框（原 drawHoverTooltip）
 *   RenderCore.myTurnOf         —— 当前阶段行动权判定（原 myTurn/myTurnSP）
 *
 * 后续待收敛（差异较大，保留双端本地实现，经 env 注入调用）：
 *   renderHud / renderRowArea / renderPanels / renderBottom /
 *   renderLogs / checkFxDiffs
 *
 * env 参数约定（两端各写一个 renderEnv() 组装）：
 *   ctx / W / H / PAL         渲染上下文（双端一致）
 *   G()                       数据源访问器（联机 () => view，单机 () => game）
 *   mySeat / HAND_AREA_H      布局参数
 *   mouse / hoverAnim         状态对象引用（本模块只改属性）
 *   hoverCards / buttons      命中/按钮数组引用
 *   screen                    当前屏幕状态值
 *   keepMax() / campColor     辅助函数（差异点注入）
 *   tooltipInfo(h)            悬浮说明内容组装（差异大，注入）
 *   copy { buyTip, playTip }  文案覆盖（单机版措辞与联机版不同）
 *   renderScene 专用：drawBackdrop / renderHud / renderRowArea /
 *                     renderPanels / renderBottom / renderLogs / renderTail
 *
 * 依赖的全局绘制原语（双端已统一签名，必须为 function 声明）：
 *   drawPixelText / pxRect / pxBorder / drawWrapText / textWidth /
 *   clamp / comicShadow / UIKit
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

  /* 当前阶段我是否有行动权（统一 myTurn / myTurnSP，逻辑逐字同构） */
  RC.myTurnOf = function (env) {
    var g = env.G();
    if (!g) return false;
    var me = env.mySeat;
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
    env.renderHud();
    env.renderRowArea();
    env.renderPanels();
    env.renderBottom();
    env.renderLogs();
    RC.drawGoalGuide(env);
    env.renderTail();            // 双端尾部差异：联机 renderFx / 单机 renderToast+遮罩
  };

  return RC;
});
