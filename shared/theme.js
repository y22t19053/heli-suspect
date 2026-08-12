/* ============================================================
 * shared/theme.js — 合理怀疑 · 全局主题唯一源（超级更新#3/#4/#5）
 * 单主题（#5 十组配色三维分层）：
 *   包豪斯炭黑 #1A1A1D × 包豪斯红光晕 #FF3B30
 *   克莱因蓝辩论台 #012696 × 薄荷青高光 #66D4C8
 *   象牙白纸 #FFFFF0 × 柠檬黄 #FFED00 × 正红 #C01E25
 *   （删 PvZ 草地绿 / 旧报纸米黄 / 演播室深蓝风，双端共用一套）
 * ------------------------------------------------------------
 * 挂载方式（双挂载）：
 *   浏览器：window.PAL / window.PARTY_META / window.campColor ...
 *   Node：  module.exports = { PAL, PARTY_META, campColor, ... }
 * 阵营工具（campColor/campSoft/partyOf/campOf/contrast）唯一源在此，
 * 两端禁止另写副本；渲染层直接读全局（运行时自动取 view/game 数据源）。
 * ============================================================ */
(function (g) {
  'use strict';
  /* 四方法律团队：公诉方红 / 被告方蓝 / 第三方绿 / 第四方金 */
  const PARTY_META = {
    red:   { name: '公诉方律师团', short: '公诉', sym: '检', col: '#FF3B30', soft: '#FFD9D2' },
    blue:  { name: '被告方律师团', short: '被告', sym: '辩', col: '#0A84FF', soft: '#CFE3FF' },
    green: { name: '第三方律师团', short: '第三', sym: '席', col: '#2FBF5F', soft: '#D0F5DD' },
    gold:  { name: '第四方律师团', short: '第四', sym: '议', col: '#FFC61A', soft: '#FFEEC9' }
  };
  /* #5 十组配色三维分层（键名：bg/ui/accent/paper 保留原键名兼容旧渲染，
   * 新增 court/neutral/fx；paper 由字符串升级为对象——旧代码若直接当字符串
   * 用会被 render-core 收口，见 ui-kit drawCard 的 PAPER 兜底） */
  const PAL = {
    bg:     { a: '#1A1A1D', b: '#222222', light: '#FF3B30' },  // 包豪斯炭黑 + 红光晕（背景聚光灯）
    court:  { a: '#012696', b: '#66D4C8' },                    // 克莱因蓝辩论台 + 薄荷青高光
    ui:     { a: '#FFFFF0', b: '#C01E25', gold: '#FFED00' },   // 象牙白纸 + 正红 + 柠檬黄
    accent: { a: '#F7EEAD', b: '#8A2BE2', danger: '#D24735' }, // 淡黄 + 紫罗兰 + 危险红
    paper:  { a: '#01847F', b: '#1A6840', c: '#F9D2E4', d: '#FFB7C5' }, // 卡纸四档（物证绿/程序绿/封神技粉/攻击粉）
    neutral:{ a: '#7B2CBF', b: '#80ED99' },                    // 中性紫 + 荧光绿
    fx:     { a: '#D3FFAF', b: '#05A5FA' },                    // 特效荧光绿 + 亮蓝
    /* —— 兼容旧键（历史渲染仍引用，值映射到新配色）—— */
    events: { a: '#012696', b: '#66D4C8' },    // 事件牌克莱因蓝 + 薄荷青
    reward: { a: '#FFED00', b: '#1A1A1D' },    // 奖励柠檬黄
    draft:  { a: '#1A1A1D', b: '#FFED00' },    // 选角炭黑 + 柠檬黄
    ink:    '#F7EEAD',
    grave:  '#5A5A5A',
    /* —— P0.5 语义色键（颜色纪律：渲染层高频最终色收口到此，键名即用途）—— */
    gold:      '#FFD60A',   // 主题金（悬浮标题/脉冲边框/金条）
    goldSoft:  '#E9C46A',   // 柔金（副标题/次要金）
    red:       '#FF3B30',   // 公诉方红（统一鲜红）
    blue:      '#0A84FF',   // 被告方蓝
    green:     '#2FBF5F',   // 第三方绿
    partyGold: '#FFC61A',   // 第四方金（阵营金）
    darkBg:    '#0F1B2D',   // 演播室深蓝底
    panel:     '#F2E9D2',   // 浅面板底
    textSoft:  '#C9D6EA',   // 柔和正文（深底）
    border:    '#3A4258',   // 深底边框
    white:     '#FFFFFF',
    black:     '#111111',
    /* —— 高频语义色收口（渲染层高频复用色，颜色纪律最终收口）—— */
    coin:      '#FFB020',   // 金币/奖励金（⊙ 数字/皇冠/技能标签金）
    deepRed:   '#A31B1B',   // 档案深红（恐怖分子条/事件牌/负效果）
    linkBlue:  '#5AC8FA',   // 信息亮蓝（旁观/已使用标记）
    brownInk:  '#4A3100'    // 浅底深棕墨（卡片浅底正文）
  };
  /* 卡纸底色兜底（旧代码把 PAL.paper 当字符串用：升级后由这里补默认档） */
  const PAPER_FALLBACK = PAL.paper.a;
  /* 未选定阵营时的兜底色板（按座位索引） */
  const FALLBACK_COL = ['#FF3B30', '#0A84FF', '#2FBF5F', '#C78A1A'];
  const FALLBACK_SOFT = ['#F6C8C8', '#C8D6F2', '#C6EAD8', '#F2E2C0'];

  /* 运行时数据源：联机渲染读 view（makeView 防作弊视图），单机读 game。
   * 两端渲染层都有同名全局，theme 函数仅在被调用时读取，故加载顺序无关。 */
  function seatsOf() {
    if (typeof view !== 'undefined' && view && view.seats) return view.seats;
    if (typeof game !== 'undefined' && game && game.seats) return game.seats;
    return null;
  }

  /* 该座位当前阵营 key（'red'/'blue'/'green'/'gold'），未选角返回 null */
  function campOf(seat) {
    const seats = seatsOf();
    if (!seats || !seats[seat] || !seats[seat].camp) return null;
    return seats[seat].camp;
  }
  /* 阵营主色：已选角取 PARTY_META.col，否则按座位兜底 */
  function campColor(seat) {
    const c = campOf(seat);
    const m = c && PARTY_META[c];
    if (m) return m.col;
    return FALLBACK_COL[seat % 4];
  }
  /* 阵营浅色（面板底/卡背等） */
  function campSoft(seat) {
    const c = campOf(seat);
    const m = c && PARTY_META[c];
    if (m) return m.soft;
    return FALLBACK_SOFT[seat % 4];
  }
  /* 阵营元信息（名称/符号），未选角返回待定 */
  function partyOf(seat) {
    const c = campOf(seat);
    const m = c && PARTY_META[c];
    return m || { name: '待定', sym: '?' };
  }
  /* 对比色：深底用白字 / 浅底用黑字（自绘文本专用） */
  function contrast(hex) {
    const c = String(hex).replace('#', '');
    if (c.length < 6) return '#ffffff';
    const r = parseInt(c.substr(0, 2), 16), gg = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    return (r * 0.299 + gg * 0.587 + b * 0.114) > 150 ? '#1a1a1a' : '#ffffff';
  }

  g.PARTY_META = PARTY_META;
  g.PAL = PAL;
  g.PAPER_FALLBACK = PAPER_FALLBACK;
  g.campOf = campOf;
  g.campColor = campColor;
  g.campSoft = campSoft;
  g.partyOf = partyOf;
  g.contrast = contrast;
  /* Node 双挂载（超级更新#3）：server/_test 等 require 时可用 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PARTY_META, PAL, PAPER_FALLBACK, campOf, campColor, campSoft, partyOf, contrast, FALLBACK_COL, FALLBACK_SOFT };
  }
})(typeof window !== 'undefined' ? window : globalThis);
