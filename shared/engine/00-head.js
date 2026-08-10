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
  function hashStr(s) {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return h >>> 0;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  let uidSeq = 1000;
  const nextUid = () => 'c' + (uidSeq++);

