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
    red:   { name: '公诉方律师团', short: '公诉', sym: '检', col: '#C94A3C', soft: '#E8C6B8' },
    blue:  { name: '被告方律师团', short: '被告', sym: '辩', col: '#2E5E8C', soft: '#C8D6E2' },
    green: { name: '第三方律师团', short: '第三', sym: '席', col: '#3F7D66', soft: '#C6DCCF' },
    gold:  { name: '第四方律师团', short: '第四', sym: '议', col: '#C79A4B', soft: '#E8D6B0' }
  };
  /* Ink Court：19 世纪法庭木刻 / 红丝绒 / 黄铜 / 羊皮纸 */
  const PAL = {
    bg:     { a: '#0B0D10', b: '#14120F', light: '#C94A3C' },
    court:  { a: '#1B1410', b: '#D8A84E' },
    ui:     { a: '#F0E2C6', b: '#A82E2A', gold: '#D8A84E' },
    accent: { a: '#E8D2A6', b: '#3F7D66', danger: '#B2352C' },
    paper:  { a: '#D8C39C', b: '#8FA88C', c: '#D8B0AA', d: '#B97868' },
    neutral:{ a: '#6F5A78', b: '#8FA88C' },
    fx:     { a: '#D8C39C', b: '#3F7D66' },
    events: { a: '#2E5E8C', b: '#D8A84E' },
    reward: { a: '#D8A84E', b: '#1B1410' },
    draft:  { a: '#0B0D10', b: '#D8A84E' },
    ink:    '#F0E2C6',
    grave:  '#6B6254',
    gold:      '#D8A84E',
    goldSoft:  '#E8C888',
    red:       '#C94A3C',
    blue:      '#2E5E8C',
    green:     '#3F7D66',
    partyGold: '#C79A4B',
    darkBg:    '#0B0D10',
    panel:     '#E8D8B4',
    textSoft:  '#D8CBB2',
    border:    '#6B5A3E',
    white:     '#FFFFFF',
    black:     '#17120C',
    coin:      '#D8A84E',
    deepRed:   '#8F2420',
    linkBlue:  '#7FB6C9',
    brownInk:  '#2B2015'
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
