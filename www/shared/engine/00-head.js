/* ===== engine/00-head.js（game-core.js 行 1-39）===== */
/* ============================================================
 * 合理怀疑 · 共享游戏规则引擎（重构版）
 * 按 2026-08 新规则重写：⊙经济 → 暗置出牌 → 亮出 → ①②③技能计票
 * → 事件牌(①②③分级) → 排名 → 支持度 → 弃牌 → 发⊙
 * 纯函数 + JSON 可序列化 plain-object 状态机。
 * 供服务端（联机）与浏览器端（单机渲染）共同使用。
 * ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ElectionCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 工具 ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* mulberry32 单步核心（评审 P0-BUG 修复）。
   * mulberry32 的状态推进是确定性 a += 0x6D2B79F5，故第 n 次调用恒等于
   * mulberryStep((seed + n * 0x6D2B79F5) | 0)——「种子 + 已调用计数」即可精确序列化。 */
  function mulberryStep(a) {
    a |= 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /* 在 state 上重建可序列化随机源：rngSeed/rngCalls 是数字字段（JSON 可序列化），
   * rng 函数读写二者——快照落盘/恢复（JSON.stringify 会丢弃函数）后调用本函数
   * 即重建到精确调用点，同种子可复现不破（评审 P0-BUG：修复前恢复后 state.rng
   * 为 undefined，chooseStarter/aiPlay 直接 state.rng() 抛 TypeError，randomHit
   * 静默降级 Math.random）。 */
  function restoreRng(state) {
    if (!state || typeof state.rngSeed !== 'number' || typeof state.rngCalls !== 'number') return state;
    state.rng = function () {
