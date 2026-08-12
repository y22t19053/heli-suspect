/* ============================================================
 * shared/ui-kit.js — 卡牌积木（P0-2 五段式信息架构）
 * ------------------------------------------------------------
 * 单一事实源：client.js 直接 <script src="/shared/ui-kit.js"> 引用；
 * singleplayer.html 由 _build_ui.js 自动内联。
 * 所有绘制原语（drawPixelText/pxRect/...）通过环境注入，
 * 默认回退到全局同名函数——双端永不漂移。
 *
 * 卡面信息架构（自上而下五段，完整描述进悬停）：
 *   ① 费用位 → 左上角票数金徽（矢量天平 + 票数）
 *   ② 标题栏 → 名字大字（顶部居中，fitText 截断）
 *   ③ 插图区 → 程序化几何纹理（按卡 uid 确定性生成，低端机
 *               无字体依赖）+ 中央技能矢量图标（技能可识别）
 *   ④ 效果区 → 至多 2 行：Lv.技能名 一行 + 精简效果一行
 *               （完整 desc 只在悬停 tooltip）
 *   ⑤ 稀有度边框 → 按技能流派着色的双层边框
 *   阵营色带保留（o.seat）；铁证 → 绿色 天平 图标。
 *   想改卡面任何元素的位置/大小：只改 planCard()。
 * ============================================================ */
(function (global) {
  'use strict';

  /* 技能 → 徽章图标（48×48 矢量图标库 ID，见下方 ICONS；彻底移除 emoji） */
  const SKILL_ICON = {
    fan: 'star', troll: 'skull', orator: 'mic', scandal: 'news', wave: 'wave',
    idol: 'star', megaScandal: 'bomb', comeback: 'flame', pivot: 'dice', donor: 'coin',
    buyback: 'coin', terrorist: 'ban', swap: 'swap', shiftLeft: 'arrowL', shiftRight: 'arrowR',
    counsel: 'hand', flank: 'swords', poach: 'hook', rally: 'horn', chain: 'chain', tagBoost: 'target',
    tagHate: 'ban', edge: 'target', rowL: 'chevL', rowR: 'chevR', leftFoe: 'arrowL',
    rightFoe: 'arrowR', majority: 'trendUp', minority: 'trendDown', shame: 'eye', threat: 'crown',
    crossExam: 'glass', objection: 'bolt', reasonableDoubt: 'scale', timelineSnipe: 'clock',
    flipNarrative: 'swap', careerGamble: 'dice', credCollapse: 'heart', whistleblower: 'siren',
    precedent: 'temple', juryNull: 'dove', firstSeat: 'medal', lastSeat: 'flag',
    leftWall: 'wall', randomHit: 'card',
    audit: 'doc', lobby: 'purse', endorse: 'horn', crossfire: 'flame', surge: 'wave',
    veto: 'ban', momentum: 'bolt', grant: 'dove',
    /* ⑨ 庭审克制包：偏见揭露/最后一搏/证据链完整/禁言令/民意分裂/清廉档案 */
    bias: 'magnet', hailMary: 'card', fullChain: 'chain', gagOrder: 'ban', split: 'swap', integrity: 'shield'
  };

  /* ---------------- 48×48 矢量图标库（canvas path，彻底替换 emoji） ----------------
   * 每个图标为函数 (ctx, s)：以 (0,0) 为圆心、s 为半径（边长=2s，48×48 时 s=24）。
   * 线框图标用 stroke-only 子路径；实心图标用封闭路径 + evenodd 镂空。
   * 统一填充 + 细描边，低端机无字体依赖、永远清晰。 */
  const ICONS = {
    /* 趋势上升：领先/反扑（多数党领先） */
    trendUp(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.62, s * 0.42);
      ctx.lineTo(-s * 0.28, s * 0.02);
      ctx.lineTo(-s * 0.05, s * 0.26);
      ctx.lineTo(s * 0.38, -s * 0.22);
      ctx.moveTo(s * 0.12, -s * 0.3);
      ctx.lineTo(s * 0.48, -s * 0.34);
      ctx.lineTo(s * 0.42, s * 0.02);
    },
    /* 趋势下降：反扑受挫/少数党落后 */
    trendDown(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.62, -s * 0.42);
      ctx.lineTo(-s * 0.28, -s * 0.02);
      ctx.lineTo(-s * 0.05, -s * 0.26);
      ctx.lineTo(s * 0.38, s * 0.22);
      ctx.moveTo(s * 0.12, s * 0.3);
      ctx.lineTo(s * 0.48, s * 0.34);
      ctx.lineTo(s * 0.42, -s * 0.02);
    },
    /* 五角星：人气/偶像 */
    star(ctx, s) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? s : s * 0.45;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    },
    /* 骷髅：抹黑/攻击 */
    skull(ctx, s) {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.72, 0, Math.PI * 2);
      ctx.moveTo(-s * 0.42, -s * 0.05);
      ctx.arc(0, -s * 0.05, s * 0.42, Math.PI, 0, true);
      ctx.moveTo(-s * 0.22, -s * 0.1);
      ctx.arc(-s * 0.22, -s * 0.12, s * 0.13, 0, Math.PI * 2, true);
      ctx.moveTo(s * 0.09, -s * 0.1);
      ctx.arc(s * 0.22, -s * 0.12, s * 0.13, 0, Math.PI * 2, true);
      ctx.rect(-s * 0.34, s * 0.22, s * 0.22, s * 0.42);
      ctx.rect(s * 0.12, s * 0.22, s * 0.22, s * 0.42);
    },
    /* 麦克风：演说 */
    mic(ctx, s) {
      ctx.beginPath();
      ctx.arc(0, -s * 0.15, s * 0.32, Math.PI, 0);
      ctx.lineTo(s * 0.09, s * 0.05);
      ctx.lineTo(-s * 0.09, s * 0.05);
      ctx.closePath();
      ctx.strokeRect(-s * 0.09, s * 0.02, s * 0.18, s * 0.42);
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, s * 0.3);
      ctx.quadraticCurveTo(0, s * 0.7, s * 0.3, s * 0.3);
      ctx.moveTo(0, s * 0.52); ctx.lineTo(0, s * 0.85);
    },
    /* 报纸：丑闻 */
    news(ctx, s) {
      ctx.beginPath();
      ctx.strokeRect(-s * 0.7, -s * 0.75, s * 1.4, s * 1.5);
      ctx.moveTo(-s * 0.5, -s * 0.45); ctx.lineTo(s * 0.5, -s * 0.45);
      ctx.moveTo(-s * 0.5, -s * 0.15); ctx.lineTo(s * 0.2, -s * 0.15);
      ctx.moveTo(-s * 0.5, s * 0.15); ctx.lineTo(s * 0.5, s * 0.15);
      ctx.moveTo(-s * 0.5, s * 0.45); ctx.lineTo(s * 0.5, s * 0.45);
    },
    /* 波浪：浪潮/造势 */
    wave(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.8, 0);
      ctx.quadraticCurveTo(-s * 0.4, -s * 0.45, 0, 0);
      ctx.quadraticCurveTo(s * 0.4, s * 0.45, s * 0.8, 0);
      ctx.moveTo(-s * 0.8, -s * 0.4);
      ctx.quadraticCurveTo(-s * 0.4, -s * 0.85, 0, -s * 0.4);
      ctx.quadraticCurveTo(s * 0.4, s * 0.05, s * 0.8, -s * 0.4);
      ctx.moveTo(-s * 0.8, s * 0.4);
      ctx.quadraticCurveTo(-s * 0.4, -s * 0.05, 0, s * 0.4);
      ctx.quadraticCurveTo(s * 0.4, s * 0.85, s * 0.8, s * 0.4);
    },
    /* 炸弹：大丑闻 */
    bomb(ctx, s) {
      ctx.beginPath();
      ctx.arc(0, s * 0.1, s * 0.6, 0, Math.PI * 2);
      ctx.rect(-s * 0.1, -s * 0.5, s * 0.2, s * 0.3);
      ctx.moveTo(s * 0.12, -s * 0.62); ctx.lineTo(s * 0.45, -s * 0.9);
    },
    /* 火焰：翻盘/火力 */
    flame(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(0, s * 0.85);
      ctx.quadraticCurveTo(-s * 0.6, s * 0.35, -s * 0.3, -s * 0.25);
      ctx.quadraticCurveTo(-s * 0.18, -s * 0.55, 0, -s * 0.85);
      ctx.quadraticCurveTo(s * 0.18, -s * 0.55, s * 0.3, -s * 0.25);
      ctx.quadraticCurveTo(s * 0.6, s * 0.35, 0, s * 0.85);
      ctx.closePath();
    },
    /* 骰子：随机/赌 */
    dice(ctx, s) {
      ctx.beginPath();
      ctx.strokeRect(-s * 0.65, -s * 0.65, s * 1.3, s * 1.3);
      [[-0.3, -0.3], [0.3, -0.3], [0, 0], [-0.3, 0.3], [0.3, 0.3]].forEach(([dx, dy]) => {
        ctx.moveTo(dx * s + 0.12, dy * s);
        ctx.arc(dx * s, dy * s, s * 0.12, 0, Math.PI * 2);
      });
    },
    /* 硬币：金钱 */
    coin(ctx, s) {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.68, 0, Math.PI * 2);
      ctx.moveTo(-s * 0.3, -s * 0.35); ctx.lineTo(s * 0.3, -s * 0.35);
      ctx.moveTo(-s * 0.3, -s * 0.12); ctx.lineTo(s * 0.3, -s * 0.12);
      ctx.moveTo(-s * 0.3, s * 0.35); ctx.lineTo(s * 0.3, s * 0.35);
    },
    /* 禁止/否决/禁言 */
    ban(ctx, s) {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.72, 0, Math.PI * 2);
      ctx.moveTo(-s * 0.5, s * 0.5); ctx.lineTo(s * 0.5, -s * 0.5);
    },
    /* 交换/翻转/分裂 */
    swap(ctx, s) {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.52, Math.PI * 0.15, Math.PI * 0.85);
      ctx.arc(0, 0, s * 0.52, Math.PI * 1.15, Math.PI * 1.85);
      ctx.moveTo(s * 0.18, -s * 0.85); ctx.lineTo(s * 0.18, -s * 0.5); ctx.lineTo(s * 0.6, -s * 0.68);
      ctx.moveTo(-s * 0.18, s * 0.85); ctx.lineTo(-s * 0.18, s * 0.5); ctx.lineTo(-s * 0.6, s * 0.68);
    },
    /* 左/右箭头 */
    arrowL(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(s * 0.6, -s * 0.62); ctx.lineTo(-s * 0.4, 0); ctx.lineTo(s * 0.6, s * 0.62);
      ctx.closePath();
    },
    arrowR(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.6, -s * 0.62); ctx.lineTo(s * 0.4, 0); ctx.lineTo(-s * 0.6, s * 0.62);
      ctx.closePath();
    },
    /* 左/右双箭头 */
    chevL(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(s * 0.15, -s * 0.6); ctx.lineTo(-s * 0.5, 0); ctx.lineTo(s * 0.15, s * 0.6);
      ctx.moveTo(s * 0.75, -s * 0.6); ctx.lineTo(s * 0.1, 0); ctx.lineTo(s * 0.75, s * 0.6);
    },
    chevR(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.15, -s * 0.6); ctx.lineTo(s * 0.5, 0); ctx.lineTo(-s * 0.15, s * 0.6);
      ctx.moveTo(-s * 0.75, -s * 0.6); ctx.lineTo(-s * 0.1, 0); ctx.lineTo(-s * 0.75, s * 0.6);
    },
    /* 握手/同盟/援助 */
    hand(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.75, s * 0.1);
      ctx.quadraticCurveTo(-s * 0.35, s * 0.6, 0, s * 0.38);
      ctx.quadraticCurveTo(s * 0.3, s * 0.16, s * 0.72, s * 0.32);
      ctx.lineTo(s * 0.55, -s * 0.3);
      ctx.quadraticCurveTo(s * 0.2, -s * 0.6, -s * 0.3, -s * 0.48);
      ctx.lineTo(-s * 0.7, -s * 0.12);
      ctx.closePath();
      ctx.moveTo(-s * 0.25, s * 0.1); ctx.lineTo(-s * 0.1, s * 0.5);
      ctx.moveTo(s * 0.1, s * 0.05); ctx.lineTo(s * 0.22, s * 0.45);
    },
    /* 交叉剑：连坐/攻击 */
    swords(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.75, -s * 0.75); ctx.lineTo(s * 0.45, s * 0.45);
      ctx.moveTo(-s * 0.45, -s * 0.75); ctx.lineTo(-s * 0.75, -s * 0.45);
      ctx.moveTo(-s * 0.45, s * 0.45); ctx.lineTo(s * 0.75, s * 0.75);
      ctx.moveTo(s * 0.45, s * 0.75); ctx.lineTo(s * 0.75, s * 0.45);
      ctx.moveTo(s * 0.75, -s * 0.75); ctx.lineTo(-s * 0.45, s * 0.45);
      ctx.moveTo(s * 0.45, -s * 0.75); ctx.lineTo(s * 0.75, -s * 0.45);
      ctx.moveTo(-s * 0.45, s * 0.45); ctx.lineTo(-s * 0.75, s * 0.75);
      ctx.moveTo(s * 0.45, s * 0.75); ctx.lineTo(-s * 0.75, s * 0.75);
    },
    /* 钩子：挖票 */
    hook(ctx, s) {
      ctx.beginPath();
      ctx.arc(s * 0.2, -s * 0.35, s * 0.38, Math.PI * 0.75, Math.PI * 1.55);
      ctx.lineTo(s * 0.08, s * 0.5);
      ctx.moveTo(-s * 0.32, -s * 0.7); ctx.lineTo(s * 0.1, -s * 0.38);
      ctx.moveTo(-s * 0.52, -s * 0.55); ctx.lineTo(-s * 0.12, -s * 0.23);
    },
    /* 喇叭：声援/背书 */
    horn(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.7, -s * 0.25);
      ctx.lineTo(s * 0.05, -s * 0.65);
      ctx.lineTo(s * 0.5, -s * 0.65);
      ctx.quadraticCurveTo(s * 0.58, 0, s * 0.5, s * 0.65);
      ctx.lineTo(s * 0.05, s * 0.65);
      ctx.lineTo(-s * 0.7, s * 0.25);
      ctx.closePath();
      ctx.strokeRect(-s * 0.85, -s * 0.14, s * 0.2, s * 0.28);
    },
    /* 锁链：连横 */
    chain(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, -s * 0.55); ctx.lineTo(-s * 0.3, -s * 0.75);
      ctx.arc(-s * 0.15, -s * 0.55, s * 0.28, Math.PI * 1.15, Math.PI * 0.15);
      ctx.moveTo(s * 0.5, s * 0.55); ctx.lineTo(s * 0.3, s * 0.75);
      ctx.arc(s * 0.15, s * 0.55, s * 0.28, Math.PI * 0.15, Math.PI * 1.15);
      ctx.moveTo(-s * 0.12, -s * 0.28); ctx.lineTo(s * 0.12, s * 0.28);
    },
    /* 靶心：共鸣/端点/偏见 */
    target(ctx, s) {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.72, 0, Math.PI * 2);
      ctx.moveTo(-s * 0.95, -s * 0.95); ctx.lineTo(-s * 0.45, -s * 0.45);
      ctx.moveTo(s * 0.95, -s * 0.95); ctx.lineTo(s * 0.45, -s * 0.45);
      ctx.moveTo(-s * 0.95, s * 0.95); ctx.lineTo(-s * 0.45, s * 0.45);
      ctx.moveTo(s * 0.95, s * 0.95); ctx.lineTo(s * 0.45, s * 0.45);
    },
    /* 眼睛：借题/偏见 */
    eye(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.85, 0);
      ctx.quadraticCurveTo(0, -s * 0.68, s * 0.85, 0);
      ctx.quadraticCurveTo(0, s * 0.68, -s * 0.85, 0);
      ctx.closePath();
      ctx.moveTo(-s * 0.25, 0);
      ctx.arc(0, 0, s * 0.25, 0, Math.PI * 2, true);
    },
    /* 皇冠：威胁/领先 */
    crown(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.68, s * 0.35);
      ctx.lineTo(-s * 0.68, -s * 0.3);
      ctx.lineTo(-s * 0.34, -s * 0.08);
      ctx.lineTo(0, -s * 0.52);
      ctx.lineTo(s * 0.34, -s * 0.08);
      ctx.lineTo(s * 0.68, -s * 0.3);
      ctx.lineTo(s * 0.68, s * 0.35);
      ctx.closePath();
      ctx.moveTo(-s * 0.55, s * 0.52); ctx.lineTo(s * 0.55, s * 0.52);
    },
    /* 放大镜：质证/调查 */
    glass(ctx, s) {
      ctx.beginPath();
      ctx.arc(-s * 0.1, -s * 0.1, s * 0.5, 0, Math.PI * 2);
      ctx.moveTo(s * 0.28, s * 0.28); ctx.lineTo(s * 0.8, s * 0.8);
      ctx.strokeRect(s * 0.4, s * 0.72, s * 0.55, s * 0.14);
    },
    /* 闪电：反对/势头 */
    bolt(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(s * 0.22, -s * 0.85);
      ctx.lineTo(-s * 0.45, s * 0.15);
      ctx.lineTo(-s * 0.05, s * 0.15);
      ctx.lineTo(-s * 0.22, s * 0.85);
      ctx.lineTo(s * 0.45, -s * 0.15);
      ctx.lineTo(s * 0.05, -s * 0.15);
      ctx.closePath();
    },
    /* 天平：合理怀疑/先例/陪审团 */
    scale(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.85); ctx.lineTo(0, s * 0.55);
      ctx.moveTo(-s * 0.6, -s * 0.35); ctx.lineTo(s * 0.6, -s * 0.35);
      ctx.moveTo(-s * 0.6, -s * 0.35); ctx.lineTo(-s * 0.6, s * 0.25);
      ctx.moveTo(s * 0.6, -s * 0.35); ctx.lineTo(s * 0.6, s * 0.25);
      ctx.moveTo(-s * 0.88, s * 0.55); ctx.lineTo(s * 0.88, s * 0.55);
      ctx.moveTo(-s * 0.4, -s * 0.6); ctx.lineTo(-s * 0.8, -s * 0.2);
      ctx.moveTo(s * 0.4, -s * 0.6); ctx.lineTo(s * 0.8, -s * 0.2);
      ctx.moveTo(-s * 0.8, -s * 0.2); ctx.lineTo(-s * 0.92, -s * 0.05);
      ctx.moveTo(s * 0.8, -s * 0.2); ctx.lineTo(s * 0.92, -s * 0.05);
    },
    /* 时钟：时间线 */
    clock(ctx, s) {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.68, 0, Math.PI * 2);
      ctx.moveTo(0, 0); ctx.lineTo(0, -s * 0.42);
      ctx.moveTo(0, 0); ctx.lineTo(s * 0.32, s * 0.16);
    },
    /* 心：民心/崩塌 */
    heart(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(0, s * 0.72);
      ctx.bezierCurveTo(-s * 0.92, -s * 0.12, -s * 0.42, -s * 0.78, 0, -s * 0.22);
      ctx.bezierCurveTo(s * 0.42, -s * 0.78, s * 0.92, -s * 0.12, 0, s * 0.72);
      ctx.closePath();
    },
    /* 警笛：吹哨 */
    siren(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, -s * 0.1); ctx.lineTo(-s * 0.5, s * 0.55);
      ctx.lineTo(s * 0.5, s * 0.55); ctx.lineTo(s * 0.5, -s * 0.1);
      ctx.closePath();
      ctx.arc(0, -s * 0.3, s * 0.42, Math.PI * 0.95, Math.PI * 0.05);
      ctx.moveTo(0, -s * 0.85); ctx.lineTo(0, -s * 0.52);
      ctx.strokeRect(-s * 0.28, s * 0.68, s * 0.56, s * 0.16);
    },
    /* 神殿：先例 */
    temple(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.9);
      ctx.lineTo(-s * 0.55, -s * 0.9);
      ctx.lineTo(-s * 0.78, -s * 0.45);
      ctx.lineTo(-s * 0.55, -s * 0.45);
      ctx.lineTo(-s * 0.55, s * 0.5);
      ctx.lineTo(s * 0.55, s * 0.5);
      ctx.lineTo(s * 0.55, -s * 0.45);
      ctx.lineTo(s * 0.78, -s * 0.45);
      ctx.lineTo(s * 0.55, -s * 0.9);
      ctx.closePath();
      ctx.moveTo(-s * 0.34, -s * 0.15); ctx.lineTo(-s * 0.14, -s * 0.15);
      ctx.moveTo(-s * 0.34, s * 0.15); ctx.lineTo(-s * 0.14, s * 0.15);
      ctx.moveTo(s * 0.14, -s * 0.15); ctx.lineTo(s * 0.34, -s * 0.15);
      ctx.moveTo(s * 0.14, s * 0.15); ctx.lineTo(s * 0.34, s * 0.15);
    },
    /* 白鸽：陪审团否决/法援 */
    dove(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, -s * 0.78);
      ctx.quadraticCurveTo(s * 0.45, -s * 0.5, s * 0.8, -s * 0.05);
      ctx.quadraticCurveTo(s * 0.9, s * 0.25, s * 0.5, s * 0.3);
      ctx.quadraticCurveTo(s * 0.72, s * 0.4, s * 0.5, s * 0.78);
      ctx.quadraticCurveTo(s * 0.25, s * 0.5, 0, s * 0.3);
      ctx.quadraticCurveTo(-s * 0.35, s * 0.42, -s * 0.5, s * 0.15);
      ctx.lineTo(-s * 0.8, s * 0.4);
      ctx.lineTo(-s * 0.62, s * 0.05);
      ctx.quadraticCurveTo(-s * 0.55, -s * 0.4, -s * 0.3, -s * 0.78);
      ctx.closePath();
    },
    /* 奖牌：首座 */
    medal(ctx, s) {
      ctx.beginPath();
      ctx.arc(0, -s * 0.2, s * 0.42, 0, Math.PI * 2);
      ctx.moveTo(-s * 0.28, 0); ctx.lineTo(-s * 0.48, s * 0.72);
      ctx.lineTo(-s * 0.12, s * 0.42);
      ctx.moveTo(s * 0.28, 0); ctx.lineTo(s * 0.48, s * 0.72);
      ctx.lineTo(s * 0.12, s * 0.42);
    },
    /* 旗帜：末席 */
    flag(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.42, -s * 0.8); ctx.lineTo(-s * 0.42, s * 0.8);
      ctx.moveTo(-s * 0.42, -s * 0.78); ctx.lineTo(s * 0.58, -s * 0.4);
      ctx.lineTo(-s * 0.42, -s * 0.05);
      ctx.closePath();
    },
    /* 砖墙：左翼 */
    wall(ctx, s) {
      ctx.beginPath();
      ctx.strokeRect(-s * 0.78, -s * 0.78, s * 1.56, s * 1.56);
      ctx.moveTo(-s * 0.78, -s * 0.26); ctx.lineTo(s * 0.78, -s * 0.26);
      ctx.moveTo(-s * 0.78, s * 0.26); ctx.lineTo(s * 0.78, s * 0.26);
      ctx.moveTo(-s * 0.16, -s * 0.26); ctx.lineTo(-s * 0.16, s * 0.26);
      ctx.moveTo(s * 0.42, -s * 0.78); ctx.lineTo(s * 0.42, -s * 0.26);
      ctx.moveTo(-s * 0.42, s * 0.26); ctx.lineTo(-s * 0.42, s * 0.78);
      ctx.moveTo(s * 0.16, s * 0.26); ctx.lineTo(s * 0.16, s * 0.78);
    },
    /* 卡牌：随机/绝境 */
    card(ctx, s) {
      ctx.beginPath();
      ctx.strokeRect(-s * 0.58, -s * 0.75, s * 1.16, s * 1.5);
      ctx.moveTo(-s * 0.58, -s * 0.4); ctx.lineTo(s * 0.58, -s * 0.4);
      ctx.moveTo(-s * 0.34, 0); ctx.lineTo(s * 0.34, 0);
      ctx.moveTo(-s * 0.34, s * 0.35); ctx.lineTo(s * 0.34, s * 0.35);
    },
    /* 文档/审计 */
    doc(ctx, s) {
      ctx.beginPath();
      ctx.strokeRect(-s * 0.55, -s * 0.75, s * 1.1, s * 1.5);
      ctx.moveTo(-s * 0.3, -s * 0.35); ctx.lineTo(s * 0.3, -s * 0.35);
      ctx.moveTo(-s * 0.3, 0); ctx.lineTo(s * 0.3, 0);
      ctx.moveTo(-s * 0.3, s * 0.35); ctx.lineTo(s * 0.3, s * 0.35);
    },
    /* 挂锁：留证 */
    lock(ctx, s) {
      ctx.beginPath();
      ctx.arc(0, -s * 0.25, s * 0.42, Math.PI, 0);
      ctx.lineTo(s * 0.42, s * 0.45);
      ctx.lineTo(-s * 0.42, s * 0.45);
      ctx.closePath();
      ctx.moveTo(-s * 0.18, -s * 0.22);
      ctx.arc(0, -s * 0.18, s * 0.16, 0, Math.PI * 2, true);
      ctx.strokeRect(-s * 0.3, s * 0.18, s * 0.6, s * 0.38);
    },
    /* 钱袋：游说 */
    purse(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.6, s * 0.3);
      ctx.quadraticCurveTo(-s * 0.68, -s * 0.5, 0, -s * 0.72);
      ctx.quadraticCurveTo(s * 0.68, -s * 0.5, s * 0.6, s * 0.3);
      ctx.quadraticCurveTo(s * 0.45, s * 0.68, 0, s * 0.68);
      ctx.quadraticCurveTo(-s * 0.45, s * 0.68, -s * 0.6, s * 0.3);
      ctx.closePath();
      ctx.moveTo(-s * 0.3, -s * 0.42); ctx.lineTo(s * 0.3, -s * 0.42);
      ctx.moveTo(0, -s * 0.72); ctx.lineTo(0, -s * 0.55);
    },
    /* 磁铁：偏见 */
    magnet(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.75, -s * 0.7); ctx.lineTo(-s * 0.75, s * 0.55);
      ctx.lineTo(-s * 0.35, s * 0.55); ctx.lineTo(-s * 0.35, -s * 0.7);
      ctx.moveTo(s * 0.75, -s * 0.7); ctx.lineTo(s * 0.75, s * 0.55);
      ctx.lineTo(s * 0.35, s * 0.55); ctx.lineTo(s * 0.35, -s * 0.7);
      ctx.moveTo(-s * 0.35, -s * 0.15); ctx.lineTo(s * 0.35, -s * 0.15);
    },
    /* 盾牌：清廉/方阵 */
    shield(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.82);
      ctx.lineTo(s * 0.72, -s * 0.55);
      ctx.lineTo(s * 0.72, s * 0.15);
      ctx.quadraticCurveTo(s * 0.72, s * 0.78, 0, s * 0.88);
      ctx.quadraticCurveTo(-s * 0.72, s * 0.78, -s * 0.72, s * 0.15);
      ctx.lineTo(-s * 0.72, -s * 0.55);
      ctx.closePath();
      ctx.moveTo(-s * 0.2, -s * 0.2); ctx.lineTo(s * 0.2, -s * 0.2);
      ctx.moveTo(-s * 0.2, s * 0.1); ctx.lineTo(s * 0.2, s * 0.1);
    }
  };

  /* 矢量图标绘制：48×48 网格内以 (cx,cy) 为心、size 为边长绘制。
   * 统一填充（evenodd 处理镂空）+ 深色描边，低端机无字体依赖、永远清晰。 */
  function drawSkillIcon(ctx, id, cx, cy, size, col) {
    const fn = ICONS[id] || ICONS.star;
    const s = size / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(10,12,20,0.85)';
    ctx.lineWidth = Math.max(1.2, size * 0.07);
    ctx.fillStyle = col || PAL.white;
    ctx.beginPath();
    fn(ctx, s);
    ctx.fill('evenodd');
    ctx.stroke();
    ctx.restore();
  }

  /* 投票人身份标签（两字文本，唯一源：替代旧 VOTER_ICON emoji 死代码，卡面身份层） */
  const VOTER_TAG = {
    v01: '学生', v02: '老兵', v03: '骑手', v04: '主妇', v05: '教友',
    v06: '工人', v07: '码农', v08: '教授', v09: '创投', v10: '维权',
    v11: '沉默', v12: '忠诚', v13: '王牌', v14: '反证', v15: '狂热',
    v16: '抹黑', v17: '雄辩', v18: '揭短', v19: '舆情', v20: '明星',
    v21: '黑料', v22: '翻盘', v23: '献金', v24: '买票', v25: '乡村',
    v26: '牧师', v27: '工会', v28: '大亨', v29: '旁证', v30: '移民',
    v31: '执事', v32: '学贷', v33: '军人', v34: '店主', v35: '枪协',
    v36: '金主', v37: '教师', v38: '寡头', v39: '游说', v40: '水工',
    v41: '街头', v42: '租户', v43: '农场', v44: '司机', v45: '巡边',
    v46: '义工', v47: '单亲', v48: '主持', v49: '阴谋', v50: '布道',
    v51: '教职', v52: '家长', v53: '疫苗', v54: '跨性', v55: '权益',
    v56: '公诉', v57: '警长', v58: '质疑', v59: '商家', v60: '保守',
    v61: '社运', v62: '自由', v63: '元老', v64: '环保', v65: '掮客',
    v66: '鼓动', v67: '金融', v68: '社区', v69: '顽固', v70: '摇摆',
    v71: '流浪', v72: '交易', v73: '医护', v74: '主播', v75: '书店',
    v76: '咖啡', v77: '房产', v78: '军商', v79: '歌手', v80: '素食',
    v81: '健身', v82: '数据', v83: '快递', v84: '橄榄', v85: '矿工',
    v86: '护士', v87: '古董', v88: '算法', v89: '并肩', v90: '反水',
    v91: '质证', v92: '反对', v93: '手套', v94: '收据', v95: '原则',
    v96: '豪赌', v97: '伪证', v98: '吹哨', v99: '先例', v100: '人民',
    v101: '首座', v102: '末席', v103: '方阵', v104: '抽签',
    v105: '连横', v106: '左旗', v107: '右旗', v108: '对调',
    v109: '审计', v110: '游说', v111: '站台', v112: '火力',
    v113: '造势', v114: '否决', v115: '连胜', v116: '法援',
    v117: '揭底', v118: '绝境', v119: '卷宗', v120: '禁言', v121: '对峙', v122: '清廉'
  };

  /* 技能 → 飘字 + 触发色（唯一源：双端不再手抄，见 _build_ui 内联） */
  const SKILL_FX = {
    fan: { txt: '+1 票', col: PAL.green },
    troll: { txt: '敌方 -1', col: PAL.red },
    orator: { txt: '+1 票', col: PAL.green },
    scandal: { txt: '敌方 -1', col: PAL.red },
    wave: { txt: '+1 / -1', col: PAL.blue },
    idol: { txt: '+2 票', col: '#FFB020' },
    megaScandal: { txt: '敌方 -2', col: PAL.red },
    comeback: { txt: '翻盘 +1', col: '#FFB020' },
    donor: { txt: '+1 ⊙', col: '#FFB020' },
    buyback: { txt: '敌方 -1⊙', col: PAL.red },
    terrorist: { txt: '排除证据', col: '#A31B1B' },
    swap: { txt: '换位', col: PAL.gold },
    shiftLeft: { txt: '左移', col: PAL.gold },
    shiftRight: { txt: '右移', col: PAL.gold },
    counsel: { txt: '同盟 +1', col: PAL.green },
    flank: { txt: '连坐 -1', col: PAL.red },
    poach: { txt: '连坐挖票', col: '#FFB020' },
    rally: { txt: '声援 +1', col: PAL.green },
    chain: { txt: '连横 +N', col: '#FFB020' },
    pivot: { txt: '反超 +2', col: '#FFB020' },
    tagBoost: { txt: '共鸣 +1', col: PAL.blue },
    tagHate: { txt: '压制 -1', col: PAL.red },
    edge: { txt: '端点 +1', col: '#FFB020' },
    rowL: { txt: '左席 +1', col: PAL.blue },
    rowR: { txt: '右席 +1', col: PAL.blue },
    leftFoe: { txt: '左敌 -1', col: PAL.red },
    rightFoe: { txt: '右敌 -1', col: PAL.red },
    majority: { txt: '领先 +1', col: PAL.green },
    minority: { txt: '反扑 +1', col: '#FFB020' },
    shame: { txt: '借题 +1', col: '#FFB020' },
    threat: { txt: '对垒 -1', col: PAL.red },
    crossExam: { txt: '质证 -1', col: PAL.red },
    objection: { txt: '反对! -1', col: '#A31B1B' },
    reasonableDoubt: { txt: '合理怀疑 -2', col: '#FFB020' },
    timelineSnipe: { txt: '时间线 -1', col: '#FFB020' },
    flipNarrative: { txt: '翻转 +2', col: '#FFB020' },
    careerGamble: { txt: '豪赌 +2', col: '#FFB020' },
    credCollapse: { txt: '崩塌 -1', col: PAL.red },
    whistleblower: { txt: '吹哨 -1⊙', col: PAL.red },
    precedent: { txt: '先例 +1', col: '#7B4FC9' },
    juryNull: { txt: '陪审员 +1', col: '#7B4FC9' },
    firstSeat: { txt: '首座 -1', col: PAL.red },
    lastSeat: { txt: '末席 -1', col: PAL.red },
    leftWall: { txt: '左翼 +N', col: PAL.blue },
    randomHit: { txt: '随机 -1', col: '#FFB020' },
    audit: { txt: '查账 -1', col: PAL.red },
    lobby: { txt: '游说 +1', col: '#FFB020' },
    endorse: { txt: '背书 +1', col: PAL.green },
    crossfire: { txt: '火力 -1', col: PAL.red },
    surge: { txt: '浪潮 +1', col: PAL.blue },
    veto: { txt: '否决 -2', col: '#A31B1B' },
    momentum: { txt: '势头 +1', col: '#FFB020' },
    grant: { txt: '+1 ⊙', col: PAL.green },
    /* ⑨ 庭审克制包飘字 + 触发色（条件触发，飘字即触发条件提示） */
    bias: { txt: '偏见 -1', col: '#8A2BE2' },
    hailMary: { txt: '绝境 +3', col: PAL.red },
    fullChain: { txt: '链条 +1', col: '#01847F' },
    gagOrder: { txt: '禁言 -2', col: '#7B2CBF' },
    split: { txt: '分裂 -1', col: '#FFB020' },
    integrity: { txt: '清廉 +1⊙', col: '#80ED99' }
  };

  /* ⑨ 庭审流派查询：skill → 流派 key（唯一源引擎 ARCH，兜底本地表）
   * 流派：attack/procedure/emotion/evidence/logic/witness
   * 用途：⑦ 阶段权重（evidence 在证据开示阶段 +1）、③ 卡牌稀有度底色 */
  const ARCH_FALLBACK = {
    troll: 'attack', tagHate: 'attack', leftFoe: 'attack', rightFoe: 'attack',
    scandal: 'attack', megaScandal: 'attack', flank: 'attack', poach: 'attack',
    crossfire: 'attack', veto: 'attack', crossExam: 'attack', credCollapse: 'attack',
    firstSeat: 'attack', lastSeat: 'attack', randomHit: 'attack', threat: 'attack',
    audit: 'attack', buyback: 'attack', whistleblower: 'attack', reasonableDoubt: 'attack',
    bias: 'attack', gagOrder: 'attack', split: 'attack',
    terrorist: 'procedure', swap: 'procedure', shiftLeft: 'procedure', shiftRight: 'procedure', objection: 'procedure',
    fan: 'emotion', orator: 'emotion', wave: 'emotion', idol: 'emotion', comeback: 'emotion',
    endorse: 'emotion', rally: 'emotion', surge: 'emotion', momentum: 'emotion',
    flipNarrative: 'emotion', careerGamble: 'emotion', precedent: 'emotion', juryNull: 'emotion',
    shame: 'emotion', hailMary: 'emotion',
    timelineSnipe: 'evidence', donor: 'evidence', fullChain: 'evidence',
    edge: 'logic', rowL: 'logic', rowR: 'logic', majority: 'logic', minority: 'logic',
    leftWall: 'logic', chain: 'logic', pivot: 'logic', counsel: 'logic',
    tagBoost: 'witness'
  };
  function archOf(skill) {
    if (!skill) return null;
    const data = E('ElectionCore');
    if (data && data.data && data.data.ARCH && data.data.ARCH[skill]) return data.data.ARCH[skill];
    return ARCH_FALLBACK[skill] || null;
  }
  /* ③ 稀有度底色：按流派映射到 PAL.paper 四档 + 象牙白（无流派/普通）
   * evidence 物证→马尔济斯绿 | procedure 程序→深绿 | emotion/witness 封神技→玫瑰粉
   * attack 攻击→粉红 | 其余→象牙白 */
  function rarityCol(skill, PALo) {
    const pal = PALo || E('PAL') || {};
    const a = archOf(skill);
    if (a === 'evidence') return (pal.paper && pal.paper.a) || '#01847F';
    if (a === 'procedure') return (pal.paper && pal.paper.b) || '#1A6840';
    if (a === 'emotion' || a === 'witness') return (pal.paper && pal.paper.c) || '#F9D2E4';
    if (a === 'attack') return (pal.paper && pal.paper.d) || '#FFB7C5';
    return (pal.ui && pal.ui.a) || '#FFFFF0';
  }

  /* 主题读取：唯一源在 shared/theme.js（已挂 window/globalThis，超级更新#3），
   * 此处不再需要 setEnv 显式注入，直接读 global。 */
  function E(name, fallback) {
    if (global[name] !== undefined) return global[name];
    return fallback;
  }

  /* ---------------- 布局引擎：唯一的坐标决策点 ---------------- */
  /* P0-2 五段式：费用位→标题栏→插图区（程序化几何纹理）→效果区 ≤2 行→稀有度边框
   * mini 档（<70px 宽）：票徽+名字+技能名小字+价格（无插图区，杜绝元素重叠）
   * small 档（高瘦/过矮）：票徽+名字+紧凑插图条+技能名黑条+价格
   * normal 档（手牌/放大/行卡高卡）：完整五段式 */
  function planCard(x, y, w, h) {
    const ratio = w / h;
    const mini = w < 70 || h < 62 || ratio < 0.52;          // 迷你：名字+票数+价格
    const small = !mini && (w < 116 || h < 96 || ratio < 0.62); // 小档：高瘦或过矮才降级（150×206 手牌卡保持 normal）
    const pad = 4;
    const vbW = Math.min(48, w * 0.36);
    const vbH = Math.min(20, h * 0.2);
    const nameSize = Math.max(9, Math.min(h * (mini ? 0.10 : 0.14), 22));
    // 插图区（程序化几何纹理）：normal 占卡宽 68%、高度 30%；small 降为窄条（宽 60%、高 22%）
    const artH = mini ? 0 : Math.max(16, h * (small ? 0.22 : 0.30));
    const artW = mini ? 0 : w * (small ? 0.60 : 0.68);
    // 效果区 ≤2 行：normal/small 用技能名黑条 + 精简效果；mini 只有技能名小字
    return {
      mini, small, ratio,
      voteBadge: { x: x + pad, y: y + pad, w: vbW, h: vbH },
      name: { x: x + vbW + 8, y: y + h * (mini ? 0.04 : 0.06), w: w - vbW - 14, h: nameSize * 1.4, size: nameSize },
      art: { x: x + (w - artW) / 2, y: y + h * (small ? 0.30 : 0.30), w: artW, h: artH, icon: Math.min(34, Math.max(14, artH * 0.66)) },
      // 技能名黑条（normal/small：Lv.名 一行；mini：图标+名 左对齐小字）
      skillName: { x, y: y + h * (mini ? 0.36 : (small ? 0.56 : 0.64)), w, h: Math.max(mini ? 10 : 13, h * 0.07), size: Math.max(small ? 9 : 8, Math.min(h * 0.06, 12)) },
      // 效果区（normal ≤2 行；small 一行精简；mini 无）
      skillEff: { x: x + 4, y: y + h * (small ? 0.64 : 0.73), w: w - 8, size: Math.max(small ? 8 : 9.5, Math.min(h * 0.075, 11.5)), lineH: Math.max(10, h * 0.075) },
      cost: { x: x + w / 2 - Math.min(30, w * 0.25), y: y + h - Math.min(20, h * 0.34), w: Math.min(60, w * 0.5), h: Math.min(16, h * 0.3), size: Math.max(10, h * 0.082) },
      camp: { x, y: y + 1, w: 3, h: h - 2 }
    };
  }

  /* ---------------- 程序化几何纹理（P0-2 插图区） ----------------
   * 由卡 uid/id/名字 hash 确定性生成图案，同一张卡每次渲染完全一致；
   * 纯几何 path，无字体依赖，低端机永远清晰。
   * 图案库 8 种：同心环 / 放射线 / 斜纹 / 棋盘 / 圆点阵 / 波浪 / 三角 / 回廊。
   * 主色 = 卡面稀有度底色（base），深/浅变体由 base 派生。 */
  function seedOf(card) {
    const s = String(card.uid || card.id || ((card.name || '') + (card.skill || '')));
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  /* hex → rgba 字符串（alpha 0~1），纹理叠加用 */
  function tinta(hex, a) {
    const c = parseInt(String(hex).replace('#', ''), 16);
    if (isNaN(c)) return 'rgba(0,0,0,' + a + ')';
    return 'rgba(' + ((c >> 16) & 255) + ',' + ((c >> 8) & 255) + ',' + (c & 255) + ',' + a + ')';
  }
  function artTexture(ctx, card, x, y, w, h, base) {
    if (w <= 0 || h <= 0) return;
    const seed = seedOf(card);
    const kind = seed % 8;
    const cx = x + w / 2, cy = y + h / 2;
    const R = Math.min(w, h) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const dark = tinta(base, 0.20), mid = tinta(base, 0.42), faint = tinta(base, 0.16);
    if (kind === 0) {             // 同心环
      ctx.strokeStyle = mid; ctx.lineWidth = Math.max(1.5, R * 0.09);
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(cx, cy, R * (0.2 + i * 0.22), 0, Math.PI * 2); ctx.stroke(); }
    } else if (kind === 1) {      // 放射线
      ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1.5, R * 0.07);
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6 + seed * 0.01;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
      }
      ctx.strokeStyle = faint; ctx.lineWidth = Math.max(1.5, R * 0.05);
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6 + seed * 0.01 + Math.PI / 12;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
      }
    } else if (kind === 2) {      // 斜纹（方向 (1,1)，截距 b 平行线）
      ctx.strokeStyle = mid; ctx.lineWidth = Math.max(1.2, R * 0.06);
      const step = Math.max(7, R * 0.3);
      for (let b = -h; b <= w; b += step) {
        const x0 = x + Math.max(0, b), y0 = y + Math.max(0, -b);
        const x1 = b <= w - h ? x + b + h : x + w;
        const y1 = b <= w - h ? y + h : y + w - b;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
    } else if (kind === 3) {      // 棋盘
      const n = 3 + (seed >> 3) % 2, cs = w / (n * 2);
      ctx.fillStyle = mid;
      for (let i = 0; i < n * 2; i++) for (let j = 0; j < Math.ceil(h / cs) + 1; j++) {
        if ((i + j) % 2 === 0) { ctx.fillRect(x + i * cs, y + j * cs, cs, cs); }
      }
    } else if (kind === 4) {      // 圆点阵
      ctx.fillStyle = mid;
      const dr = Math.max(2, R * 0.12), ds = Math.max(9, R * 0.36);
      for (let px2 = x + ds / 2; px2 < x + w; px2 += ds) for (let py2 = y + ds / 2; py2 < y + h; py2 += ds) {
        ctx.beginPath(); ctx.arc(px2 + ((seed >> 4) % 3 - 1) * 2, py2, dr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(cx, cy, dr * 1.4, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 5) {      // 波浪
      ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1.5, R * 0.08);
      const amp = R * 0.2, ws = Math.max(10, w / 3.2);
      for (let wy = y + R * 0.4; wy < y + h; wy += R * 0.55) {
        ctx.beginPath();
        for (let wx = x; wx <= x + w; wx += 3) {
          const yy = wy + Math.sin((wx - x) / ws * Math.PI * 2 + seed * 0.05) * amp;
          if (wx === x) ctx.moveTo(wx, yy); else ctx.lineTo(wx, yy);
        }
        ctx.stroke();
      }
    } else if (kind === 6) {      // 三角拼接（斜锯齿）
      ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1.2, R * 0.05);
      const th = Math.max(8, R * 0.34), tw = th * 1.15;
      for (let ty = y - th; ty < y + h + th; ty += th) {
        ctx.beginPath();
        for (let tx = x - tw; tx < x + w + tw; tx += tw) {
          const up = (((tx / tw) | 0) + ((ty / th) | 0)) % 2 === 0;
          ctx.moveTo(tx, up ? ty + th : ty);
          ctx.lineTo(tx + tw / 2, up ? ty : ty + th);
          ctx.lineTo(tx + tw, up ? ty + th : ty);
        }
        ctx.stroke();
      }
    } else {                      // 回廊（方环嵌套）
      ctx.strokeStyle = mid; ctx.lineWidth = Math.max(1.5, R * 0.09);
      for (let i = 0; i < 4; i++) {
        const m = R * (0.15 + i * 0.2);
        ctx.strokeRect(cx - m, cy - m, m * 2, m * 2);
      }
      ctx.strokeStyle = dark;
      ctx.beginPath(); ctx.moveTo(cx - R * 0.5, cy); ctx.lineTo(cx + R * 0.5, cy); ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------- 卡背（唯一源：由双端抽入，超级更新#5） ---------------- */
  /* 卡背：机密档案封面「真相，由证据编织」（Task 4 叙事层） */
  function drawCardBackAt(ctx, x, y, w, h, col) {
    const shadow = E('comicShadow'), rect = E('pxRect'), border = E('pxBorder'), text = E('drawPixelText');
    const PAL = E('PAL') || {};
    const bc = col || (PAL.ui && PAL.ui.b) || '#14213D';
    shadow(x, y, w, h, 3, 3);
    rect(x, y, w, h, '#1C2530');                       // 深蓝黑档案袋底
    border(x, y, w, h, bc, 2.5);
    // 顶部机密条（红色封条）
    const barH = Math.max(11, h * 0.11);
    rect(x + 3, y + 3, w - 6, barH, '#A31B1B');
    border(x + 3, y + 3, w - 6, barH, PAL.black, 1);
    text('机密 CONFIDENTIAL', x + w / 2, y + 3 + barH / 2, Math.max(6.5, h * 0.05), PAL.white, { align: 'center', shadow: false });

    const mini = w < 70 || h < 62;                     // 迷你尺寸降级：只保留封条 + 问号
    if (mini) {
      text('?', x + w / 2, y + h / 2 + 3, h * 0.30, bc, { align: 'center', shadow: false });
      return;
    }

    // 档案四角金属护片（小三角）
    const c = Math.max(6, w * 0.06), e = 3;
    ctx.fillStyle = '#B8B8B8';
    ctx.beginPath();
    ctx.moveTo(x + c, y + e); ctx.lineTo(x + e, y + e); ctx.lineTo(x + e, y + c);
    ctx.moveTo(x + w - c, y + e); ctx.lineTo(x + w - e, y + e); ctx.lineTo(x + w - e, y + c);
    ctx.moveTo(x + c, y + h - e); ctx.lineTo(x + e, y + h - e); ctx.lineTo(x + e, y + h - c);
    ctx.moveTo(x + w - c, y + h - e); ctx.lineTo(x + w - e, y + h - e); ctx.lineTo(x + w - e, y + h - c);
    ctx.fill();

    // 中央 天平 金章（圆印）：矢量图标，替换 emoji
    const cx = x + w / 2, cy = y + h * 0.40;
    const r = Math.min(w, h) * 0.22;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(232,164,24,0.12)'; ctx.fill();
    ctx.strokeStyle = '#FFB020'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(232,164,24,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    drawSkillIcon(ctx, 'scale', cx, cy, r * 1.5, '#FFB020');

    // 主标题：真相，由证据编织
    text('真相', cx, y + h * 0.63, Math.min(w * 0.30, h * 0.15), '#F6E9C8', { align: 'center', shadow: false });
    text('由证据编织', cx, y + h * 0.75, Math.max(8, h * 0.065), '#9AA5B5', { align: 'center', shadow: false });

    // 底部档案底注
    const baseY = y + h - 12;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 8, baseY); ctx.lineTo(x + w - 8, baseY); ctx.stroke();
    text('机密档案', x + 8, baseY + 8, Math.max(6, h * 0.045), '#6B7686', { shadow: false });
    text('CASE FILE', x + w - 8, baseY + 8, Math.max(5.5, h * 0.04), '#4E5866', { align: 'right', shadow: false });
  }

  /* 技能效果文本：卡面 desc 优先（参数化卡牌自带），否则技能库 desc；前缀精简省字（语义不变） */
  function effText(card, sk) {
    let t = (card.desc != null && card.desc !== '') ? card.desc : (sk ? sk.desc : '');
    if (!t) return '';
    t = t.replace(/^(亮出时|审议时|结算后)：/, m => m[0] === '亮' ? '亮出：' : (m[0] === '结' ? '结算：' : '审议：'));
    return t;
  }

  /* 阶段 C 技能显示修复：自适应字号——估算文本在 maxW 内放下 maxLines 行所需的最小字号
   * 保守估算：中文字宽 ≈ 字号（⊙/数字/英文更窄，实际可容纳更多，故不会低估行数） */
  function effFit(text, maxW, maxLines, start, min) {
    let size = start;
    while (size > min) {
      const per = Math.max(1, Math.floor(maxW / (size * 1.0)));
      if (Math.ceil(text.length / per) <= maxLines) return size;
      size -= 0.5;
    }
    return min;
  }

  /* ---------------- 组装：drawCard（供 drawVoterCard 薄封装调用） ---------------- */
  function drawCard(ctx, x, y, w, h, card, o) {
    o = o || {};
    const text = E('drawPixelText'), rect = E('pxRect'), border = E('pxBorder'),
          shadow = E('comicShadow'), fit = E('fitText'), camp = E('campColor'),
          wrap = E('drawWrapText'), lv = E('lvMark'), PAL = E('PAL') || {};
    const core = E('ElectionCore');
    const skills = (core && core.data) ? core.data.SKILLS : null;
    if (card.hidden) {
      drawCardBackAt(ctx, x, y, w, h, o.backCol || (PAL.ui && PAL.ui.b) || '#14213D');
      return;
    }

    const col = o.col || rarityCol(card.skill, PAL) || '#f6e9c8';
    const lay = planCard(x, y, w, h);

    shadow(x, y, w, h, 3, 3);
    // P0-2 实体感：柔和投影（硬阴影下叠一层羽化投影）＋ 卡面顶部到中部微渐变
    ctx.save();
    const gradShadow = ctx.createLinearGradient(0, y + 6, 0, y + h + 10);
    gradShadow.addColorStop(0, 'rgba(8,10,18,0.42)');
    gradShadow.addColorStop(1, 'rgba(8,10,18,0)');
    ctx.fillStyle = gradShadow;
    ctx.fillRect(Math.round(x + 2), Math.round(y + 5), Math.round(w - 4), Math.round(h + 8));
    const faceGrad = ctx.createLinearGradient(0, y, 0, y + h);
    faceGrad.addColorStop(0, 'rgba(255,255,255,0.28)');
    faceGrad.addColorStop(0.16, 'rgba(255,255,255,0.07)');
    faceGrad.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.restore();
    rect(x, y, w, h, col);
    // P0-2 ⑤ 稀有度边框：双层（外层流派色 3px + 内层象牙细线高光），
    // 攻击粉/物证绿/程序深绿/封神玫瑰一眼可辨
    border(x, y, w, h, PAL.black, 3);
    ctx.save();
    ctx.globalAlpha = 0.85;
    border(x + 1.5, y + 1.5, w - 3, h - 3, '#FFF8E0', 1);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.75;
    const hz = ctx.createLinearGradient(0, y, 0, y + h * 0.30);
    hz.addColorStop(0, 'rgba(255,255,255,0.55)');
    hz.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hz;
    ctx.fillRect(Math.round(x + 1), Math.round(y + 1), Math.round(w - 2), Math.round(h * 0.30));
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = PAL.white;
    ctx.fillRect(Math.round(x + 1), Math.round(y + 1), Math.round(w - 2), 1.2);
    ctx.fillRect(Math.round(x + 1), Math.round(y + 1), 1.2, Math.round(h - 2));
    ctx.restore();
    // 底部内阴影（厚度感）
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#000000';
    ctx.fillRect(Math.round(x + 2), Math.round(y + h - 3), Math.round(w - 4), 2.4);
    ctx.restore();

    // 阵营色带（o.seat 提供时）
    if (o.seat !== undefined && o.seat >= 0) {
      rect(x, y + 1, 3, h - 2, camp(o.seat));
      border(x, y + 1, 3, h - 2, PAL.black, 1);
    }

    // 超矮行卡（h<34，如手机横屏 4 人局）：只画票徽+名字，杜绝元素重叠
    const ultraTiny = h < 34;
    if (ultraTiny) {
      const vb2 = lay.voteBadge;
      rect(vb2.x, vb2.y, vb2.w, vb2.h, PAL.black);
      border(vb2.x, vb2.y, vb2.w, vb2.h, PAL.black, 1);
      drawSkillIcon(ctx, 'scale', vb2.x + vb2.h / 2, vb2.y + vb2.h / 2, vb2.h * 0.8, PAL.gold);
      text(String(card.votes || 1), vb2.x + vb2.h / 2 + 2, vb2.y + vb2.h / 2, Math.max(9, h * 0.14), PAL.gold, { align: 'left', shadow: false });
      const fN2 = fit(card.name, w - vb2.w - 14, Math.max(9, h * 0.18));
      text(fN2.text, x + vb2.w + 8 + (w - vb2.w - 14) / 2, y + h / 2, fN2.size, PAL.black, { align: 'center', shadow: false });
      return;
    }

    // ① 费用位：票数金徽（左上，StS 费用位）：矢量天平 + 票数
    const vb = lay.voteBadge;
    rect(vb.x, vb.y, vb.w, vb.h, PAL.black);
    border(vb.x, vb.y, vb.w, vb.h, PAL.black, 1);
    drawSkillIcon(ctx, 'scale', vb.x + vb.h * 0.72, vb.y + vb.h / 2, vb.h * 0.85, PAL.gold);
    text(String(card.votes || 1), vb.x + vb.h * 1.25, vb.y + vb.h / 2, Math.max(10, h * 0.085), PAL.gold, { align: 'left', shadow: false });

    // ② 标题栏：名字大字（顶部居中，避开左上徽章）
    const nm = lay.name;
    const nameW = Math.max(22, nm.w - 4);
    const fName = fit(card.name, nameW, nm.size);
    text(fName.text, nm.x + nameW / 2, nm.y + nm.h / 2, fName.size, PAL.black, { align: 'center', shadow: false });

    const sk = card.skill ? (skills ? skills[card.skill] : null) : null;
    const icon = card.skill ? (SKILL_ICON[card.skill] || 'scale') : null;
    const fxc = (SKILL_FX[card.skill] && SKILL_FX[card.skill].col) || PAL.blue;

    if (!lay.mini) {
      // ③ 插图区：程序化几何纹理（按卡 uid 确定性生成）+ 中央技能矢量图标
      //    纹理主色 = 技能触发色（与飘字同源）；无技能铁证 → 绿色天平图标
      const ar = lay.art;
      artTexture(ctx, card, ar.x, ar.y, ar.w, ar.h, fxc);
      ctx.save();
      ctx.globalAlpha = 0.16;
      rect(ar.x, ar.y, ar.w, ar.h, PAL.white);
      ctx.restore();
      border(ar.x, ar.y, ar.w, ar.h, 'rgba(17,17,17,0.35)', 1.2);
      if (icon) {
        drawSkillIcon(ctx, icon, ar.x + ar.w / 2, ar.y + ar.h / 2, ar.icon, PAL.white);
      } else {
        // 铁证：绿色 天平 图标 + 证词字样
        drawSkillIcon(ctx, 'scale', ar.x + ar.w / 2, ar.y + ar.h / 2, ar.icon, PAL.white);
        text('铁证', ar.x + ar.w / 2, ar.y + ar.h / 2 + ar.icon * 0.72, Math.max(8, ar.icon * 0.3), PAL.green, { align: 'center', shadow: false });
      }
    }
    // ④ 效果区 ≤2 行：技能名黑条（Lv.名） + 精简效果（完整 desc 只在悬停）
    if (sk) {
      const sn = lay.skillName;
      if (lay.mini) {
        drawSkillIcon(ctx, icon, x + w * 0.5 - 24, sn.y + sn.h / 2, sn.h * 1.1, '#4A3100');
        text(lv(sk.lv) + sk.name, x + w * 0.5 + 2, sn.y + sn.h / 2, Math.max(7.5, sn.size), '#4A3100', { align: 'left', shadow: false });
      } else {
        // 技能名黑条（normal/small 统一；terrorist 暗红底警示）
        rect(x + 4, sn.y, w - 8, sn.h, card.skill === 'terrorist' ? '#A31B1B' : PAL.black);
        drawSkillIcon(ctx, icon, x + w * 0.5 - 34, sn.y + sn.h / 2, sn.h * 1.0, PAL.gold);
        text(lv(sk.lv) + sk.name, x + w * 0.5 + 2, sn.y + sn.h / 2, Math.max(9, sn.size), PAL.gold, { align: 'left', shadow: false });
      }
      // 精简效果（normal 至多 2 行 / small 1 行；完整 desc 移出卡面进悬停 tooltip）
      const se = lay.skillEff;
      const effTxt = effText(card, sk);
      if (effTxt && !o.noDesc && !lay.mini) {
        const availH = lay.cost.y - se.y - 3;
        const maxLines = lay.small ? 1 : (availH >= se.lineH * 2 ? 2 : 1);
        if (availH >= se.lineH) {
          const cap = lay.small ? 14 : (maxLines >= 2 ? 26 : 13);
          const slim = effTxt.length > cap ? effTxt.slice(0, cap) + '…' : effTxt;
          wrap(slim, x + 5, se.y, se.size, '#333333', w - 10, se.lineH, { maxLines, shadow: false });
        }
      }
    }

    // ④ 底部价格金条
    const cb = lay.cost;
    rect(cb.x, cb.y, cb.w, cb.h, '#FFB020');
    border(cb.x, cb.y, cb.w, cb.h, PAL.black, 2);
    text('⊙' + card.cost, cb.x + cb.w / 2, cb.y + cb.h / 2, cb.size, '#4A3100', { align: 'center', shadow: false, lineW: 0 });
  }

  /* ---------------- 事件牌（报纸头条「号外」，唯一源） ---------------- */
  function drawEventCard(ctx, x, y, w, h, ev, o) {
    o = o || {};
    const text = E('drawPixelText'), rect = E('pxRect'), border = E('pxBorder'),
          shadow = E('comicShadow'), wrap = E('drawWrapText');
    if (ev.hidden) { drawCardBackAt(ctx, x, y, w, h, '#1B2C4A'); return; }
    const used = ev.used;
    // 可用性：o.usable === false → 整卡置灰半透明（"亮着但不能点"的误导；时序不符/非我方回合/等级不足/已过）
    const unusable = o.usable === false && !used;
    // 报纸：新闻纸米黄底（已用 → 陈旧灰；不可用 → 雾灰 + 半透明）
    const paper = used ? '#B9B2A0' : (unusable ? '#CFC9B8' : '#EDE3CC');
    ctx.save();
    if (unusable) ctx.globalAlpha = 0.62;
    shadow(x, y, w, h, 3, 3);
    rect(x, y, w, h, paper);
    border(x, y, w, h, used ? '#555555' : (unusable ? '#8A8A94' : PAL.black), 2);
    // 报头条：号外（红） + 报眉：庭审公报（不可用 → 灰头）
    const barH = Math.max(11, h * 0.115);
    rect(x, y, w, barH, used ? '#666666' : (unusable ? '#7C7C86' : '#A31B1B'));
    text(used ? '归档' : (unusable ? '暂不可用' : '号外'), x + 4, y + barH / 2, Math.max(8.5, h * 0.07), PAL.white, { shadow: false });
    text('庭审公报 · 卷宗' + (ev.id || ''), x + w - 4, y + barH / 2, Math.max(6.5, h * 0.055), 'rgba(255,255,255,0.85)', { align: 'right', shadow: false });
    // 头条大字：事件名（黑体）+ 红双下划线
    const tSize = Math.max(10.5, Math.min(w * 0.082, h * 0.115));
    text(ev.name, x + w / 2, y + h * 0.30, tSize, (used || unusable) ? '#666666' : PAL.black, { align: 'center', shadow: false });
    const ruleY = y + h * 0.38;
    ctx.fillStyle = (used || unusable) ? '#777777' : '#A31B1B';
    ctx.fillRect(x + w * 0.12, ruleY, w * 0.76, 2.5);
    ctx.fillRect(x + w * 0.20, ruleY + 4.5, w * 0.60, 1.5);
    // 正文（报道）
    const evDescLines = Math.max(1, Math.floor((h * 0.50 - 20) / Math.max(8.5, h * 0.085)));
    wrap(ev.desc, x + 6, y + h * 0.55, Math.max(8, h * 0.06), (used || unusable) ? '#777777' : PAL.black, w - 12, Math.max(8.5, h * 0.085), { maxLines: evDescLines });
    // 效果章（报纸边栏小注，保留原语义）
    const effTxt = ev.eff ? (ev.eff.type === 'vote' ? (ev.eff.val > 0 ? '+票' : '−票')
      : ev.eff.type === 'money' ? (ev.eff.val > 0 ? '+⊙' : '−⊙')
      : ev.eff.type === 'support' ? '倾向'
      : ev.eff.type === 'leadSupport' ? '−倾向'
      : ev.eff.type === 'moneyAll' ? '普惠 +⊙'
      : ev.eff.type === 'richTax' ? '−⊙'
      : ev.eff.type === 'poorAid' ? '+⊙'
      : '加成') : '';
    const stampCol = ev.eff && ev.eff.val < 0 ? PAL.red : PAL.green;
    rect(x + 4, y + h - 18, 46, 14, used ? '#555555' : (unusable ? '#777781' : stampCol));
    border(x + 4, y + h - 18, 46, 14, PAL.black, 1);
    // 时序章：庭审前（蓝） / 庭审后（橙）——一眼区分前/后（不可用/已用 → 灰）
    const timingCol = used || unusable ? '#555555' : (ev.timing === 'pre' ? PAL.blue : '#B45309');
    rect(x + 4, y + h - 18, 46, 14, timingCol);
    border(x + 4, y + h - 18, 46, 14, PAL.black, 1);
    text(ev.timing === 'pre' ? '庭审前' : '庭审后', x + 27, y + h - 11, 10, PAL.white, { align: 'center', shadow: false });
    rect(x + w - 50, y + h - 18, 46, 14, used ? '#555555' : (unusable ? '#777781' : PAL.black));
    border(x + w - 50, y + h - 18, 46, 14, PAL.black, 1);
    text(effTxt, x + w - 27, y + h - 11, 10.5, used ? '#AAAAAA' : (unusable ? '#99999F' : PAL.gold), { align: 'center', shadow: false });
    ctx.restore();
  }

  /* ---------------- 角色候选卡（3 选 1，唯一源） ---------------- */
  function drawCharCard(ctx, x, y, w, h, ch, col, selected) {
    const text = E('drawPixelText'), rect = E('pxRect'), border = E('pxBorder'),
          shadow = E('comicShadow'), fit = E('fitText'), wrap = E('drawWrapText'),
          contrast = E('contrast'), jag = E('jaggedRectPath'),
          clamp = E('clamp') || ((v, a, b) => Math.max(a, Math.min(b, v))),
          PARTY_META = E('PARTY_META') || {},
          PAL = E('PAL') || { events: { a: '#14213D', b: PAL.gold }, accent: { b: PAL.black }, paper: '#F6E9C8' };
    // 美漫硬阴影
    shadow(x, y, w, h, 3, 3);
    // P0-2 实体感：柔和投影 + 顶部微渐变高光（与 drawCard 一致语言）
    ctx.save();
    const gradShadow = ctx.createLinearGradient(0, y + 6, 0, y + h + 10);
    gradShadow.addColorStop(0, 'rgba(8,10,18,0.42)');
    gradShadow.addColorStop(1, 'rgba(8,10,18,0)');
    ctx.fillStyle = gradShadow;
    ctx.fillRect(Math.round(x + 2), Math.round(y + 5), Math.round(w - 4), Math.round(h + 8));
    ctx.restore();
    rect(x, y, w, h, selected ? PAL.accent.b : ((PAL.paper && PAL.paper.a) || '#F6E9C8'));
    border(x, y, w, h, selected ? PAL.black : col, selected ? 4 : 2.5);
    ctx.save();
    ctx.globalAlpha = 0.5;
    const hz = ctx.createLinearGradient(0, y, 0, y + h * 0.26);
    hz.addColorStop(0, 'rgba(255,255,255,0.5)');
    hz.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hz;
    ctx.fillRect(Math.round(x + 1), Math.round(y + 1), Math.round(w - 2), Math.round(h * 0.26));
    ctx.restore();

    const meta = PARTY_META[ch.camp] || { name: '独立', sym: '?' };

    // 1. 顶部标签：阵营色 + 锯齿手感
    const tagX = x + 8, tagY = y + 8, tagW = 74, tagH = 20;
    ctx.save();
    ctx.lineJoin = 'miter';
    jag(tagX, tagY, tagW, tagH, 2);   // 锯齿小条
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = PAL.black;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    // 去掉文字描边，利用高对比反色
    text(meta.sym + ' ' + meta.name, x + 45, y + 18, 10, contrast(col), { align: 'center', shadow: false });

    // 2. 角色名：黑底白字反色条（P0：fitText 防长名溢出 + 高度自适应）
    const nameBarY = y + h * 0.28;
    const nameBarH = clamp(h * 0.14, 20, 32);
    rect(x + 6, nameBarY, w - 12, nameBarH, PAL.black);
    rect(x + 6, nameBarY + nameBarH - 1, w - 12, 4, col);   // 底下加一条阵营色衬托
    const fN = fit(ch.name, w - 24, Math.max(13, h * 0.125));
    text(fN.text, x + w / 2, nameBarY + nameBarH / 2, fN.size, PAL.white, { align: 'center', shadow: false });

    // 3. 技能描述区：禁止描边，浅色底块（P0：动态高度 + 行数截断）
    const descY = nameBarY + nameBarH + 8;
    const descH = clamp(h - descY - 30, 20, h * 0.24);
    rect(x + 8, descY, w - 16, descH, '#f0e8d8');
    border(x + 8, descY, w - 16, descH, PAL.black, 1.5);
    const dSize = Math.max(8.5, Math.min(h * 0.085, 11));
    const dLines = Math.max(1, Math.floor(descH / (dSize * 1.18)));
    wrap(ch.desc, x + 10, descY + descH / 2, dSize, '#333333', w - 20, Math.max(10, dSize * 1.18), { shadow: false, maxLines: dLines });

    // 4. 底部：起始资金，发光效果
    rect(x + 8, y + h - 24, w - 16, 16, PAL.black);
    border(x + 8, y + h - 24, w - 16, 16, col, 2);
    text('起始 ⊙ ' + (ch.skill && ch.skill.type === 'startMoney' ? 4 + ch.skill.v : 4), x + w / 2, y + h - 16, 10, PAL.gold, { align: 'center', shadow: false });
  }

  const UIKit = { SKILL_ICON, SKILL_FX, VOTER_TAG, ARCH_FALLBACK, archOf, rarityCol, planCard, drawCard, drawEventCard, drawCharCard, drawCardBackAt, effFit, drawSkillIcon, artTexture, seedOf };
  global.UIKit = UIKit;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
