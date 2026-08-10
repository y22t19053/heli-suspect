/* ============================================================
 * 合理怀疑 · 联机版客户端（2026-08 重构适配 16 步状态机）
 * 流程：pickChar→chooseStarter→drawEvent→drawVoter→buy→play→reveal
 *       →preEvent→count→postEvent→rank→settle→discard→income→gameover
 * 职责：菜单/大厅（DOM）+ 对局渲染（Canvas 美漫像素风）+ Socket 交互
 * 视觉与单机版 singleplayer.html 一致（c2 可读性调色板）
 * ============================================================ */
'use strict';

/* ---------------- Canvas 与工具 ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;
let DPR = 1;
const DEBUG = false;       // 调试面板开关：发布时 false（右上角可视化游戏状态）
const mouse = { x: 0, y: 0 };
let hoverTickOn = false, hoverTickT = 0;   // 悬停音效节流：进入可点区域瞬间极短滴答
let buttons = [];          // 本帧按钮命中区
let btnFlash = {};         // 按钮点击闪光（id → alpha，主循环衰减）
let hoverCards = [];       // 本帧卡牌命中区（悬停显示详情）
let termHits = [];         // 本帧术语链接命中区（点击打开术语弹窗）
let helpPage = 0;          // 新手教程当前页
let termPopup = null;      // {kind:'term'|'skill', id}
let lastTouchTime = 0;     // 触摸已处理标记（防止模拟 click 重复触发）
let touchStart = null;     // 触摸起点（touchstart 记录，位移>10px 或长按取消点击）

/* ---------------- 移动端检测与布局常量 ---------------- */
const isMobile = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
let compact = false;      // 横屏触屏：紧凑布局（HUD/信息条/底栏压缩，文字 1:1 不缩小）
let portraitMode = false; // 竖屏触屏：底栏纵向手牌抽屉（超级更新#37）
let handScroll = 0;       // 竖屏抽屉当前页（0 起）
let HUD_H = 52, PANEL_Y = 56;
let HAND_AREA_H = isMobile ? 190 : 230;
const PORTRAIT_ACT_H = 48;   // Task 5 竖屏固定操作栏高度（含上下留白）
/* 四档屏幕断点：wide(>1280) / normal(≥800) / narrow(≥600) / tiny(<600)
 * 每档独立调整 HUD/面板/底栏高度与字号，信息条字段按档位级联隐藏 */
const UI = {
  size: 'normal', hudH: 52, panelY: 56, handH: 230, panelH: 30,
  fs: { name: 14, num: 15, stat: 12.5, small: 12 },
  show: { scandalBar: true, handN: true, locked: true, act: true, prev: true, jury: true }
};
function screenSize() {
  if (W > 1280) return 'wide';
  if (W >= 800) return 'normal';
  if (W >= 600) return 'narrow';
  return 'tiny';
}
function applyUI() {
  const ph = screenSize();
  const s = UI;
  s.size = ph;
  s.hudH = compact ? (ph === 'tiny' ? 34 : 40) : (ph === 'narrow' || ph === 'tiny' ? 44 : 52);
  s.panelY = s.hudH + 4;
  s.handH = portraitMode ? (ph === 'tiny' ? 300 : 270)
    : compact ? (ph === 'tiny' ? 118 : 140)
    : (ph === 'narrow' ? 168 : (ph === 'tiny' ? 132 : (isMobile ? 190 : 230)));
  s.panelH = compact ? 34 : (portraitMode ? 40 : (ph === 'tiny' ? 32 : (ph === 'narrow' ? 34 : 42)));
  s.fs.name = compact ? (ph === 'tiny' ? 12 : 13) : (ph === 'tiny' ? 12.5 : (ph === 'narrow' ? 13.5 : 15));
  s.fs.num = compact ? (ph === 'tiny' ? 11 : 12) : (ph === 'tiny' ? 13 : (ph === 'narrow' ? 14 : 16));
  s.fs.stat = compact ? (ph === 'tiny' ? 10 : 11) : (ph === 'tiny' ? 11.5 : (ph === 'narrow' ? 12.5 : 13.5));
  s.fs.small = compact ? 10 : (ph === 'tiny' ? 10.5 : 11.5);
  // 窄屏信息降级：仅「桌面小窗」隐藏次要徽章；触屏/竖屏手机保证资源（钱/支持/丑闻/手牌/锁/陪审）始终可见
  const thin = !isMobile && ph === 'tiny';
  s.show.scandalBar = !thin;
  s.show.handN = !thin;
  s.show.locked = !thin;
  s.show.act = true;
  s.show.prev = !thin;
  s.show.jury = !thin;
  HUD_H = s.hudH; PANEL_Y = s.panelY; HAND_AREA_H = s.handH;
  if (!portraitMode) handScroll = 0;   // 切回横屏/桌面时重置抽屉页
}
/* 安全区：刘海/底部横条（逻辑像素，由 CSS env(safe-area-inset-*) 提供） */
let SAFE = { top: 0, bottom: 0, left: 0, right: 0 };
let keyboardOpen = false;   // Task 5：键盘/工具栏占据判断（visualViewport 明显小于布局视口时）
function safeArea() {
  try {
    const cs = getComputedStyle(document.documentElement);
    const p = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
    return {
      top: p(cs.getPropertyValue('--sat') || '0px') || 0,
      bottom: p(cs.getPropertyValue('--sab') || '0px') || 0,
      left: p(cs.getPropertyValue('--sal') || '0px') || 0,
      right: p(cs.getPropertyValue('--sar') || '0px') || 0
    };
  } catch (e) { return { top: 0, bottom: 0, left: 0, right: 0 }; }
}

/* 高 DPI 适配：画布按 devicePixelRatio 放大，CSS 尺寸不变；
 * 竖屏不再等比缩放 800 宽，而是跟随真实视口（窄档布局公式自带下限，不至于崩溃） */
function resize() {
  DPR = window.devicePixelRatio || 1;
  SAFE = safeArea();
  const vv = window.visualViewport;
  const vw = Math.round(vv ? vv.width : window.innerWidth);
  const vh = Math.round(vv ? vv.height : window.innerHeight);
  const portrait = vh > vw;
  compact = isMobile && !portrait;
  portraitMode = isMobile && portrait;
  // Task 5 键盘识别：可视视口比布局视口矮 120px+ → 键盘/工具栏占据（允许画布更矮，避免内容被遮）
  keyboardOpen = !!(vv && window.innerHeight - vv.height > 120);
  const w = Math.max(340, vw - SAFE.left - SAFE.right);
  const h = Math.max(keyboardOpen ? 300 : 480, vh - SAFE.top - SAFE.bottom);
  // P0：画布 CSS 尺寸跟随逻辑尺寸并平移到安全区内（刘海/Home 条不再遮 HUD 与底栏按钮）；
  // Task 5：键盘弹出时 visualViewport.offsetTop 变化 → 画布随可视区上移/恢复
  canvas.style.position = 'fixed';
  canvas.style.left = SAFE.left + 'px';
  canvas.style.top = (SAFE.top + (vv ? vv.offsetTop : 0)) + 'px';
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * DPR);
  canvas.height = Math.round(h * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  W = w; H = h;
  applyUI();
}
window.addEventListener('resize', resize);
// Task 5 键盘弹出画布上移：visualViewport resize/scroll（键盘弹出不触发 window resize）
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resize);
  window.visualViewport.addEventListener('scroll', resize);
}
resize();
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* 通用卡牌槽位（P0 根因修复）：均分可用宽 = W - 20 - 右预留，左对齐，永不溢出。
 * 取代所有 (W - 300)/(W - 330) 硬编码减法——那些预留是“按钮还在底栏内”时代的历史遗留。 */
function flexRects(n, y, h, gap, maxW, reserveR) {
  if (n <= 0) return [];
  gap = gap || 12; maxW = maxW || 200; reserveR = reserveR || 0;
  const avail = Math.max(40, W - 20 - reserveR);
  let cw = clamp((avail - (n - 1) * gap) / n, 16, maxW);
  if (n * cw + (n - 1) * gap > avail) cw = Math.max(10, (avail - (n - 1) * gap) / n);   // 兜底：数量极多时强制收缩保证不越界
  const out = [];
  for (let i = 0; i < n; i++) out.push({ x: 10 + i * (cw + gap), y, w: cw, h });
  return out;
}
/* ============ 讽刺卡通调色板：大胆鲜艳 + 粗黑描边 ============ */
function c2(c) {
  const M = {
    '#f6f1e3': '#fdf0c9', '#efe8d5': '#f7e6a8', '#fffdf6': '#ffffff',
    'rgba(255,253,246,0.94)': 'rgba(255,255,255,0.95)',
    '#3a342a': '#111111', '#2f2b26': '#111111', '#2b2b2b': '#111111',
    /* 红系 → 鲜红 */
    '#ff4757': '#FF3B30', '#d64545': '#FF3B30', '#c0392b': '#FF3B30', '#b33a3a': '#FF3B30', '#e74c3c': '#FF3B30', '#e04343': '#FF3B30', '#D82E2F': '#FF3B30', '#E6392F': '#FF3B30',
    /* 蓝系 → 亮蓝 */
    '#3f6fb5': '#0A84FF', '#4a6fa5': '#0A84FF', '#3a63c8': '#0A84FF', '#1E4FB5': '#0A84FF', '#2f6fd8': '#0A84FF', '#3f8f8f': '#2FBF5F',
    /* 绿系 → 鲜绿 */
    '#4d9e5a': '#2FBF5F', '#5daa4f': '#2FBF5F', '#2ecc71': '#2FBF5F', '#2ed573': '#2FBF5F', '#0E8A5F': '#2FBF5F', '#2f9e62': '#2FBF5F', '#2e9e63': '#2FBF5F',
    /* 金系 → 亮金 */
    '#f0b429': '#FFC61A', '#d9a52e': '#FFC61A', '#c98a1b': '#FFB020', '#8a6a1a': '#B8860B', '#ffa502': '#FF9F0A', '#E8A418': '#FFB020', '#FFD400': '#FFD60A', '#B8860B': '#E8A418',
    '#2a2620': '#1A1410', '#5a5345': '#3A342A', '#7a7262': '#6B6355',
    '#8a816e': '#7d7564', '#a89e85': '#94886C', '#b8ae92': '#C4B894',
    '#c9bfa5': '#E8DDB8', '#d8d0b8': '#F0E8C8', '#e5ddc8': '#F5ECD0', '#e8dfc8': '#F0E8C8',
    '#8f8f98': '#9a917e', '#7a6fa0': '#7a6fa8', '#c06a2a': '#FF9F0A',
    '#553a20': '#4a2a10', '#3a3a3a': '#111111', '#6b4a2a': '#5a3a1a',
    '#2a2a2a': '#101418', '#20222c': '#0F1B2D', '#4a3520': '#3a2a12', '#8a6a3a': '#E8A418',
    /* 面板 / 背景旧色 → 演播室 */
    '#EDE4C8': '#0F1B2D', '#DCCFA8': '#1A2C44', '#F7F0DC': '#FFFFFF', '#efe6cd': '#F2E9D2',
    '#FDF6E3': '#F6E9C8', '#f6e9c8': '#F6E9C8', '#f0e8c8': '#F4ECD8', '#fffdf6': '#FFFFFF',
    '#DDD5BC': '#39425A', '#F3EBD6': '#F2E9D2',
    '#2A3A5A': '#1B2C4A', '#7A0E0E': '#A31B1B', '#8A7350': '#8A6A3F', '#e8e0c8': '#EAE2C8',
    'rgba(20,25,40,0.92)': 'rgba(10,16,28,0.94)', 'rgba(255,255,255,0.08)': 'rgba(255,255,255,0.10)'
  };
  return M[c] || c;
}

/* 美漫锯齿矩形路径（miter 折线 + 手绘纸边锯齿） */
function jaggedRectPath(x, y, w, h, j) {
  j = Math.max(1, j == null ? 2 : j);
  const rnd = Math.floor(x * 13 + y * 7 + w * 3 + h * 5);
  const n = 4;
  const jx = (i, t) => x + w * t + (((rnd + i * 3) % 5) - 2) * j * 0.4;
  const jy = (i, t) => y + h * t + (((rnd + i * 7) % 3) - 1) * j * 0.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 1; i <= n; i++) ctx.lineTo(jx(i, i / n), jy(i, 0));
  ctx.lineTo(x + w, y);
  for (let i = 1; i <= n; i++) ctx.lineTo(jx(i, 1), jy(i, i / n));
  ctx.lineTo(x + w, y + h);
  for (let i = 1; i <= n; i++) ctx.lineTo(jx(i, 1 - i / n), jy(i, 1));
  ctx.lineTo(x, y + h);
  for (let i = 1; i <= n; i++) ctx.lineTo(jx(i, 0), jy(i, 1 - i / n));
  ctx.closePath();
}

/** 平涂纯色色块（无圆角、无渐变） */
function pxRect(x, y, w, h, col) {
  ctx.save();
  ctx.fillStyle = c2(col);
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.restore();
}
/** 美漫粗墨线边框：miter 尖角 + 外粗内细双线 */
function pxBorder(x, y, w, h, col, t) {
  t = clamp(Math.max(1.5, t || 2), 1.5, 6);
  ctx.save();
  ctx.strokeStyle = c2(col);
  ctx.lineWidth = t;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  jaggedRectPath(x + t / 2, y + t / 2, w - t, h - t, 2);
  ctx.stroke();
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = Math.max(1, t * 0.55);
  const in2 = t * 1.9;
  jaggedRectPath(x + in2, y + in2, w - in2 * 2, h - in2 * 2, 1);
  ctx.stroke();
  ctx.restore();
}

const _FONT_BASE = '"Microsoft YaHei","PingFang SC","Impact","Arial Black",sans-serif';
const _twCache = new Map();
/** 精确测量文本宽度（带缓存：字体+文本 作为 key，避免每帧重复 measureText） */
function textWidth(text, font) {
  const k = font + '\u0000' + text;
  let v = _twCache.get(k);
  if (v === undefined) {
    // 只保存/恢复 font（save/restore 会快照整个画布状态栈，成本高；本函数只改 font）
    const prev = ctx.font;
    ctx.font = font;
    v = ctx.measureText(text).width;
    ctx.font = prev;
    if (_twCache.size > 6000) _twCache.clear();
    _twCache.set(k, v);
  }
  return v;
}
/** 自动缩字/截断：文本超过 maxW 时先降字号，仍超则截断加省略号（P0-4b：下限 9px，放不下就省略号）
 * 顾问评审 8.2：同 (text,maxW,size,bold) 同帧只算一次（fitText 结果缓存，防重复循环） */
const _fitCache = new Map();
function fitText(text, maxW, size, o) {
  o = o || {};
  const key = String(text) + '|' + maxW + '|' + size + '|' + (o.bold === false ? '0' : '1');
  const hit = _fitCache.get(key);
  if (hit) return { text: hit.text, size: hit.size, w: hit.w };
  let s = Math.max(9, size), t = String(text);
  const bold = o.bold === false ? '' : '700 ';
  const fontFor = ss => bold + ss + 'px ' + _FONT_BASE;
  while (s > 9 && textWidth(t, fontFor(s)) > maxW) s -= 0.5;
  while (t.length > 1 && textWidth(t + '…', fontFor(s)) > maxW) t = t.slice(0, -1);
  if (t !== String(text) && textWidth(t + '…', fontFor(s)) <= maxW) t += '…';
  const r = { text: t, size: s, w: textWidth(t, fontFor(s)) };
  if (_fitCache.size > 2000) _fitCache.clear();
  _fitCache.set(key, r);
  return r;
}
/** 美漫矢量文字：大字 900 粗体 + 粗黑墨线描边（P0-4a：≤13px 一律无粗体无描边，靠对比色区分）
 * 返回值 w 为精确测量宽度（非估算），供后续元素流式定位 */
function drawPixelText(text, x, y, size, color, o) {
  o = o || {};
  size = Math.max(5, size);
  ctx.save();
  const small = size <= 13;
  const bold = (small || o.bold === false) ? '' : '700 ';
  ctx.font = bold + size + 'px ' + _FONT_BASE;
  ctx.textBaseline = 'middle';
  ctx.textAlign = o.align === 'center' ? 'center' : (o.align === 'right' ? 'right' : 'left');
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  if (!small && o.shadow !== false) {
    ctx.lineWidth = o.lineW !== undefined ? o.lineW : Math.max(0.8, size / 12);
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = o.outline || '#111111';
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = c2(color);
  ctx.fillText(text, x, y);
  ctx.restore();
  return { w: Math.round(textWidth(text, bold + size + 'px ' + _FONT_BASE)), h: Math.round(size * 1.4) };
}
/** 按宽度折行的像素文字：逐字测量换行（不再按字数估算），优先在标点后断行 */
function drawWrapText(text, x, y, size, color, maxWidth, lineH, o) {
  o = o || {};
  const bold = o.bold === false ? '' : '700 ';
  const font = bold + size + 'px ' + _FONT_BASE;
  const lh = lineH || Math.round(size * 1.32);
  const maxLines = o.maxLines || 12;
  const lines = [];
  let rest = text;
  while (rest.length > 0 && lines.length < maxLines) {
    let take = rest.length;
    while (take > 1 && textWidth(rest.slice(0, take), font) > maxWidth) take--;
    if (take <= 0) take = 1;
    if (take < rest.length) {
      // 向回找最近的标点（含空格），在它后面断开
      for (let i = take - 1; i > Math.max(0, take - 8); i--) {
        if (/[，。；：、！？,.!?;: \u00b7·]/.test(rest[i])) { take = i + 1; break; }
      }
    }
    lines.push(rest.slice(0, take));
    rest = rest.slice(take);
  }
  if (rest.length > 0 && lines.length === maxLines) {
    // 超出行数：最后一行截断加省略号（自动缩字到能放下）
    const f = fitText(lines[lines.length - 1] + '…', maxWidth, size, { bold: o.bold === false ? false : true });
    lines[lines.length - 1] = f.text;
  }
  lines.forEach((ln, i) => drawPixelText(ln, x, y + i * lh - (lines.length - 1) * lh / 2, size, color, o.shadow === false ? { shadow: false } : { shadow: true }));
  return lines.length * lh;
}
/** 硬阴影：右下错位的纯黑硬色块 */
function comicShadow(x, y, w, h, dx, dy) {
  ctx.save();
  ctx.fillStyle = 'rgba(10,10,10,0.32)';
  ctx.fillRect(Math.round(x + (dx || 4)), Math.round(y + (dy || 4)), Math.round(w), Math.round(h));
  ctx.restore();
}
/** 漫画速度线：从中心向外放射 */
function drawSpeedLine(cx, cy, R0, R1, n, col, wdt) {
  ctx.save();
  ctx.strokeStyle = col || 'rgba(20,20,20,0.6)';
  ctx.lineWidth = wdt || 3;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = i * 2 * Math.PI / n + 0.18;
    ctx.moveTo(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0);
    ctx.lineTo(cx + Math.cos(a) * R1, cy + Math.sin(a) * R1);
  }
  ctx.stroke();
  ctx.restore();
}
/** 美漫背景：做旧报纸底 + 45° 平行墨线 */
function hatchBg() {
  ctx.save();
  ctx.fillStyle = '#f0e8c8';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(20,20,20,0.16)';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  const step = 26;
  for (let x = -H; x < W + H; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x + H, H); }
  ctx.stroke();
  ctx.restore();
}

/** Toast 通知（DOM 层） */
function toast(text, warn) {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast' + (warn ? ' warn' : '');
  el.textContent = text;
  wrap.appendChild(el);
  while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);   // 最多同时 3 条，防堆积遮挡
  setTimeout(() => el.remove(), 2600);
}

/* ---------------- 固定配色 · 阵营 ----------------
 * PAL / PARTY_META / campOf/campColor/campSoft/partyOf/contrast 唯一源
 * = shared/theme.js（超级更新#3/#4），index.html 已先行加载，此处直接读全局。 */

/* ============================ 音效（WebAudio 合成） ============================ */
let AC = null;
let sfxWarned = false;
function sfx(name) {
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const t = AC.currentTime;
    const osc = (type, f0, f1, dur, vol, delay) => {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t + (delay || 0));
      if (f1 !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + (delay || 0) + dur);
      g.gain.setValueAtTime(0.0001, t + (delay || 0));
      g.gain.exponentialRampToValueAtTime(vol, t + (delay || 0) + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (delay || 0) + dur);
      o.connect(g); g.connect(AC.destination);
      o.start(t + (delay || 0)); o.stop(t + (delay || 0) + dur + 0.05);
    };
    const noise = (dur, vol, delay) => {
      const len = Math.max(1, Math.floor(AC.sampleRate * dur));
      const buf = AC.createBuffer(1, len, AC.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = AC.createBufferSource(), g = AC.createGain();
      src.buffer = buf; g.gain.value = vol;
      src.connect(g); g.connect(AC.destination);
      src.start(t + (delay || 0));
    };
    switch (name) {
      case 'click': osc('square', 520, 300, 0.06, 0.12); break;
      case 'flip': osc('square', 720, 260, 0.11, 0.13); noise(0.08, 0.05); break;
      case 'swoosh': noise(0.28, 0.10); osc('sawtooth', 300, 900, 0.28, 0.06); break;
      case 'boom': noise(0.5, 0.30); osc('sine', 140, 38, 0.5, 0.35); osc('square', 90, 30, 0.5, 0.12); break;
      case 'gavel': noise(0.16, 0.20); osc('triangle', 210, 60, 0.30, 0.30); osc('square', 120, 40, 0.28, 0.10); break;   // 法槌：低闷重击
      case 'coin': osc('square', 1180, 1180, 0.08, 0.12); osc('square', 1568, 1568, 0.12, 0.10, 0.08); osc('square', 500, 200, 0.14, 0.20, 1.55); noise(0.1, 0.08, 1.55); break;   // 抛硬币：金属弹跳 + 落地闷响
      case 'news': osc('sawtooth', 620, 880, 0.28, 0.12); osc('sawtooth', 880, 620, 0.28, 0.12, 0.30); osc('sawtooth', 620, 880, 0.28, 0.12, 0.60); break;
      case 'star': osc('triangle', 660, 990, 0.14, 0.12); osc('triangle', 990, 1320, 0.14, 0.10, 0.12); break;
      case 'shatter': noise(0.22, 0.16); osc('square', 400, 120, 0.18, 0.08); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => osc('triangle', f, f, 0.22, 0.13, i * 0.13)); break;
      case 'boo': osc('sawtooth', 180, 120, 0.35, 0.10); noise(0.25, 0.06); break;
      case 'tick': osc('square', 1320, 1320, 0.05, 0.10); break;
      case 'tickFast': osc('square', 1500, 1100, 0.07, 0.13); osc('square', 900, 900, 0.05, 0.06, 0.06); break;
      case 'hover': osc('sine', 1900, 2400, 0.03, 0.035); break;   // 悬停滴答：极短、极轻
      case 'paper': noise(0.09, 0.05); osc('triangle', 500, 900, 0.08, 0.05); noise(0.13, 0.04, 0.06); break;  // 纸页翻动（刷新市场）
    }
  } catch (e) { if (!sfxWarned) { sfxWarned = true; console.warn('[sfx] 音频不可用：', e); } }
}
/* 移动端触觉反馈（D 类审查）：iOS 不支持 vibrate 时自动忽略；节流防连发 */
let lastHapticT = 0;
function haptic(ms) {
  try {
    if (!navigator.vibrate) return;
    const now = Date.now();
    if (now - lastHapticT < 60) return;   // 节流：60ms 内最多一次
    lastHapticT = now;
    navigator.vibrate(ms || 10);
  } catch (e) { /* 触觉不可用则忽略 */ }
}

/* ============================ FX 动画引擎 ============================ */
/* #60/#61：对象池复用 + 总量上限 + 高负载自动降级（低端机/移动端优化）
 * 顾问评审 8.1：主动低画质（不再等 FX 超载被动减速）——
 * 低内存（deviceMemory<=2）或低核（4 核内）移动设备，开局即降级：FX 上限减半、
 * 粒子密度减半、背景网点/聚光灯跳过、大字描边关闭。 */
const LOW_Q = isMobile && (
  (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 2) ||
  (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4)
);
const FX = [];
let shakeAmp = 0;
const FX_MAX = LOW_Q ? 24 : 48;   // FX 总量上限：低画质减半，超出丢弃最旧（防粒子爆炸拖垮低端机）
let fxLowQ = LOW_Q;               // 低质量模式：主动判定（低端机）+ 运行时 FX 超载自动降级
const _fxPool = [];           // FX 对象池：复用对象，减少每帧 GC 压力
function recycleFx(f) { for (const k in f) delete f[k]; if (_fxPool.length < 32) _fxPool.push(f); }
function addFx(f) {
  const obj = _fxPool.pop() || {};   // 从池取空对象复用，避免反复分配
  for (const k in f) obj[k] = f[k];
  obj.t = 0; obj.dur = f.dur || 800;
  if (FX.length >= FX_MAX) { const old = FX.shift(); recycleFx(old); }
  FX.push(obj);
  return obj;
}
function updateFx(dt) {
  for (let i = FX.length - 1; i >= 0; i--) {
    const f = FX[i];
    f.t += dt;
    if (f.t - (f.delay || 0) >= f.dur) { FX.splice(i, 1); recycleFx(f); }
  }
  shakeAmp *= 0.86;
  if (shakeAmp < 0.4) shakeAmp = 0;
  // #60：移动端 FX 高负载 → 自动降级粒子密度，保帧率（主动低画质设备恒为 true）
  fxLowQ = LOW_Q || (isMobile && FX.length > 24);
}
function ttOf(f) { return Math.max(0, f.t - (f.delay || 0)); }
function easeOutBack(p) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); }
function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }
function easeInOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
function renderFx() { for (const f of FX) drawFx(f); }
function drawFx(f) {
  const tt = ttOf(f);
  const p = clamp(tt / f.dur, 0, 1);
  switch (f.type) {
    case 'flipSeq': {
      const lay = rowLayout();
      lay.items.forEach((it, i) => {
        if (it.removed) return;
        const prog = clamp((tt - i * 140) / 300, 0, 1);
        if (prog <= 0 || prog >= 1) return;
        const cx = it.x + it.w / 2;
        const s = Math.cos(prog * Math.PI);
        ctx.save();
        ctx.translate(cx, it.y + it.h / 2);
        ctx.scale(s, 1);
        if (prog < 0.5) UIKit.drawCardBackAt(ctx, -it.w / 2, -it.h / 2, it.w, it.h, PAL.ui.b);
        else {
          UIKit.drawCard(ctx, -it.w / 2, -it.h / 2, it.w, it.h, it.card, { col: it.seat === mySeat ? campSoft(it.seat) : '#f6e9c8' });
          // 翻牌瞬间：顶部聚光灯打在刚亮出的牌上
          if (prog > 0.35 && prog < 0.8) {
            const sa = Math.sin((prog - 0.35) / 0.45 * Math.PI) * 0.45;
            ctx.save();
            ctx.globalAlpha = sa;
            ctx.fillStyle = '#FFF4C8';
            ctx.beginPath();
            ctx.moveTo(-it.w * 0.22, -it.h * 0.85);
            ctx.lineTo(it.w * 0.22, -it.h * 0.85);
            ctx.lineTo(it.w * 1.05, it.h * 0.9);
            ctx.lineTo(-it.w * 1.05, it.h * 0.9);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = sa * 0.9;
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(0, -it.h * 0.85);
            ctx.lineTo(0, it.h * 0.9);
            ctx.stroke();
            ctx.restore();
          }
        }
        ctx.restore();
      });
      break;
    }
    case 'boom': {
      const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
      const R = f.w * 0.9 * easeOutCubic(p);
      const a = p < 0.65 ? 1 : 1 - (p - 0.65) / 0.35;
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      // 中心白闪
      if (p < 0.25) {
        ctx.fillStyle = '#FFFFFF';
        ctx.globalAlpha = (0.25 - p) / 0.25 * 0.85;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.5 * (1 - p), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p < 0.4 ? '#FFD60A' : '#FF3B30';
      ctx.beginPath();
      const seg = 12;
      for (let i = 0; i <= seg; i++) {
        const ang = i / seg * Math.PI * 2;
        const r = R * (0.72 + 0.28 * Math.abs(Math.sin(i * 2.7 + f.t * 0.02)));
        const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.stroke();
      if (p > 0.15 && p < 0.7) {
        const s2 = 1 + 0.6 * Math.sin(p * 9);
        drawPixelText('BOOM!', cx, cy, 40 * s2 * (p < 0.3 ? p / 0.3 : 1), '#FFD60A', { align: 'center' });
      }
      // 飞溅碎片（fxLowQ 减半，保帧率）
      if (p > 0.2) {
        const rnd = f.seed || 11;
        ctx.globalAlpha = Math.max(0, 1 - p * 1.2);
        for (let i = 0; i < (fxLowQ ? 5 : 10); i++) {
          const ang = ((rnd * (i + 1) * 1.7) % 6.28);
          const dist = (p - 0.2) / 0.8 * (R * 1.4) * (0.4 + ((rnd * i) % 10) / 14);
          const px = cx + Math.cos(ang) * dist, py = cy + Math.sin(ang) * dist;
          ctx.save();
          ctx.translate(px, py); ctx.rotate(ang + p * 4);
          ctx.fillStyle = ['#FF3B30', '#FFD60A', '#FF9F0A', '#FFFFFF'][(rnd + i) % 4];
          ctx.fillRect(-4, -4, 8, 8);
          ctx.restore();
        }
      }
      ctx.restore();
      break;
    }
    case 'news': {
      const inP = clamp(tt / 220, 0, 1);
      const outP = clamp((tt - (f.dur - 200)) / 200, 0, 1);
      const slide = inP * (1 - outP);
      ctx.save();
      // 红蓝全屏脉冲（新闻冲击感）
      if (p < 0.12) { ctx.save(); ctx.globalAlpha = (0.12 - p) / 0.12 * 0.4; pxRect(0, 0, W, H, '#FFFFFF'); ctx.restore(); }
      else if (p > 0.45 && p < 0.6) { ctx.save(); ctx.globalAlpha = (0.6 - p) / 0.15 * 0.16; pxRect(0, 0, W, H, '#FF3B30'); ctx.restore(); }
      else if (p > 0.68 && p < 0.83) { ctx.save(); ctx.globalAlpha = (0.83 - p) / 0.15 * 0.16; pxRect(0, 0, W, H, '#0A84FF'); ctx.restore(); }
      const bw = W * 1.2, bh = 64, by = -50 + slide * 12;
      ctx.translate(-(1 - slide) * 60, 0);
      pxRect(-20, by, bw, bh, '#FFD60A');
      ctx.save();
      ctx.beginPath(); ctx.rect(-20, by, bw, bh); ctx.clip();
      for (let i = -2; i < 20; i += 2) {
        ctx.fillStyle = '#1A1A1A'; ctx.globalAlpha = 0.16;
        ctx.beginPath();
        ctx.moveTo(i * 46, by - 20); ctx.lineTo(i * 46 + 23, by + bh + 20); ctx.lineTo(i * 46 + 46, by + bh + 20); ctx.lineTo(i * 46 + 23, by - 20);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      pxBorder(-20, by, bw, bh, '#111111', 3);
      drawPixelText('⚡ BREAKING NEWS ⚡', W / 2, by + bh / 2, 26, '#111111', { align: 'center', shadow: false });
      const tIn = clamp((tt - 260) / 240, 0, 1);
      if (tIn > 0 && p < 0.94) {
        const ty = by + bh + 34 + (1 - easeOutBack(tIn)) * 60;
        const sc = easeOutBack(tIn);
        ctx.save();
        ctx.translate(W / 2, ty); ctx.scale(sc, sc);
        pxRect(-W / 2, -26, W, 52, '#111111');
        pxBorder(-W / 2, -26, W, 52, '#FFD60A', 3);
        drawPixelText(f.title, 0, 2, 30, '#FFFFFF', { align: 'center' });
        ctx.restore();
        if (f.sub) drawPixelText(f.sub, W / 2, ty + 58, 15, '#FF5A4E', { align: 'center' });
      }
      ctx.restore();
      break;
    }
    case 'objection': {   // 法庭高潮：事件生效瞬间的全屏反对
      const inP = clamp(tt / 140, 0, 1);
      const outP = clamp((tt - (f.dur - 200)) / 200, 0, 1);
      const a = clamp(Math.min(inP, 1 - outP), 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      if (p < 0.1) { ctx.save(); ctx.globalAlpha = (0.1 - p) / 0.1 * 0.5; pxRect(0, 0, W, H, '#FFFFFF'); ctx.restore(); }
      else if (p > 0.45 && p < 0.6) { ctx.save(); ctx.globalAlpha = (0.6 - p) / 0.15 * 0.22; pxRect(0, 0, W, H, '#FF3B30'); ctx.restore(); }
      pxRect(0, 0, W, H, 'rgba(10,12,20,0.42)');
      ctx.translate(W / 2, H * 0.32);
      ctx.scale(easeOutBack(inP), easeOutBack(inP));
      pxRect(-W * 0.38, -36, W * 0.76, 72, '#111111');
      pxBorder(-W * 0.38, -36, W * 0.76, 72, '#FFD60A', 5);
      drawPixelText('OBJECTION!', 0, 2, 46, '#FFD60A', { align: 'center', shadow: false });
      if (f.sub) drawPixelText(f.sub, 0, 66, 17, '#FFFFFF', { align: 'center' });
      ctx.restore();
      break;
    }
    case 'count': {
      const cx = W - 262, cy = 64, cw = 252, chh = 150;
      const a = p < 0.08 ? p / 0.08 : (p > 0.9 ? (1 - p) / 0.1 : 1);
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      pxRect(cx, cy, cw, chh, 'rgba(10,16,28,0.94)');
      pxBorder(cx, cy, cw, chh, '#FFD60A', 3);
      drawPixelText('审 议 中', cx + cw / 2, cy + 18, 17, '#FFD60A', { align: 'center', shadow: false });
      const votes = f.votes, mx = Math.max(1, ...votes);
      const n = votes.length;
      const bw2 = Math.min(44, (cw - 30) / n - 6);
      votes.forEach((v, i) => {
        const bx = cx + 15 + i * (bw2 + 6);
        const grow = easeOutCubic(clamp((p - i * 0.12) / 0.72, 0, 1));
        const bh2 = Math.max(6, (v / mx) * 74 * grow);
        const by = cy + chh - 42 - bh2;
        pxRect(bx, by, bw2, bh2, f.cols[i]);
        pxBorder(bx, by, bw2, bh2, '#111111', 2);
        const dg = Math.round(v * grow);
        if (grow < 0.92) {
          drawPixelText(String(dg), bx + bw2 / 2, by - 12, 15, '#FFFFFF', { align: 'center', shadow: false });
        } else {
          // 计票大数字：完成后向上弹出爆出（最高票金色放大+星星）
          const pop = easeOutBack(clamp((p - i * 0.12 - 0.86) / 0.14, 0, 1));
          const isWin = v === mx && f.t > 0;
          const sz = 15 + 14 * pop;
          const py = by - 12 - pop * 30;
          drawPixelText(String(dg), bx + bw2 / 2, py, sz, isWin ? '#FFD400' : '#FFFFFF', { align: 'center', shadow: false });
          if (isWin) {
            const tw = Math.sin(f.t / 60) * 3;
            drawPixelText('★ 领先', bx + bw2 / 2, py - sz - 6 + tw, 11, '#FFD60A', { align: 'center', shadow: false });
            const sp = clamp((f.t % 420) / 420, 0, 1);
            if (sp > 0.02 && sp < 0.9) {
              drawPixelText('✦', bx + bw2 / 2 + Math.sin(sp * 40) * 26, py - sz - 18 - sp * 34, 8 + 8 * sp, '#FFD60A', { align: 'center', shadow: false });
            }
          }
        }
        drawPixelText(f.names[i].charAt(0), bx + bw2 / 2, cy + chh - 26, 13, '#FFD60A', { align: 'center', shadow: false });
      });
      ctx.restore();
      break;
    }
    case 'podium': {
      const cx = W - 262, cy = 64, cw = 252, chh = 150;
      const a = p < 0.08 ? p / 0.08 : (p > 0.9 ? (1 - p) / 0.1 : 1);
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      pxRect(cx, cy, cw, chh, 'rgba(10,16,28,0.94)');
      pxBorder(cx, cy, cw, chh, '#FFD60A', 3);
      drawPixelText('本轮排名', cx + cw / 2, cy + 16, 17, '#FFD60A', { align: 'center', shadow: false });
      const order = f.order;
      const hs = [52, 34, 20];
      order.forEach((o, i) => {
        const px = cx + 22 + i * 70;
        const base = cy + chh - 26;
        const hh = hs[i] * easeOutBack(clamp((tt - i * 160) / 400, 0, 1));
        pxRect(px, base - hh, 58, hh, o.col);
        pxBorder(px, base - hh, 58, hh, '#111111', 2);
        drawPixelText(String(i + 1), px + 10, base - hh + 10, 12, contrast(o.col), { shadow: false });
        pxRect(px + 8, base - hh - 22, 42, 22, o.col);
        pxBorder(px + 8, base - hh - 22, 42, 22, '#111111', 2);
        drawPixelText(o.name.charAt(0), px + 29, base - hh - 11, 12, contrast(o.col), { align: 'center', shadow: false });
        if (i === 0 && hh > 40) {
          drawPixelText('👑', px + 29, base - hh - 36 + Math.sin(f.t / 80) * 3, 16, '#FFD60A', { align: 'center', shadow: false });
          if (p > 0.6) {
            const cp = clamp((p - 0.6) / 0.35, 0, 1);
            const rnd = f.seed || 5;
            for (let k = 0; k < (fxLowQ ? 5 : 10); k++) {
              const an = k / 10 * Math.PI * 2 + f.t * 0.012;
              const rr = cp * 26 * (0.5 + ((rnd + k) % 5) / 6);
              ctx.fillStyle = ['#FFD60A', '#FF5A4E', '#FFFFFF', '#0A84FF'][(rnd + k) % 4];
              ctx.fillRect(px + 29 + Math.cos(an) * rr - 2.5, base - hh - 26 + Math.sin(an) * rr - 2.5, 5, 5);
            }
          }
        }
      });
      if (p > 0.35 && p < 0.8) drawPixelText('🏆 领先', cx + cw - 58, cy + 44, 14, '#FFD60A', { align: 'center', shadow: false });
      ctx.restore();
      break;
    }
    case 'float': {
      const fy = f.y - 40 * easeOutCubic(p);
      const al = p < 0.7 ? 1 : (1 - p) / 0.3;
      ctx.save();
      ctx.globalAlpha = al;
      const sc = 1 + 0.5 * Math.sin(Math.min(1, p * 3) * Math.PI) * 0.3;
      ctx.translate(f.x, fy); ctx.scale(sc, sc);
      drawPixelText(f.text, 0, 0, f.size || 22, f.col || '#FFD400', { align: 'center' });
      ctx.restore();
      break;
    }
    case 'coin': {
      const al = p < 0.7 ? 1 : (1 - p) / 0.3;
      ctx.save();
      ctx.globalAlpha = al;
      ctx.translate(f.x, f.y - 26 * easeOutCubic(p));
      pxRect(-14, -14, 28, 28, '#E8A418');
      pxBorder(-14, -14, 28, 28, '#111111', 3);
      drawPixelText('⊙', 0, 1, 16, '#4A3100', { align: 'center', shadow: false, lineW: 0 });
      drawPixelText(f.text, 22, 4, 18, '#E8A418', { shadow: false });
      ctx.restore();
      break;
    }
    case 'cardIn': {
      const sc = easeOutBack(p);
      ctx.save();
      ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
      ctx.scale(sc, sc);
      ctx.globalAlpha = clamp(p * 4, 0, 1);
      ctx.translate(-f.w / 2, -f.h / 2);
      if (f.draw) f.draw();
      else { pxRect(0, 0, f.w, f.h, 'rgba(255,255,255,0.55)'); pxBorder(0, 0, f.w, f.h, '#FFD400', 2); }
      ctx.restore();
      break;
    }
    case 'shatter': {
      ctx.save();
      ctx.globalAlpha = 1 - p;
      const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
      const rnd = f.seed || 7;
      for (let i = 0; i < (fxLowQ ? 7 : 14); i++) {
        const ang = ((rnd * (i + 1) * 1.7) % 6.28) + 0.15;
        const dist = p * 90 * (0.4 + ((rnd * i) % 10) / 12);
        const px = cx + Math.cos(ang) * dist, py = cy + Math.sin(ang) * dist;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang + p * 3);
        const s = 6 + ((rnd * (i + 3)) % 8);
        ctx.fillStyle = f.col || '#E6392F';
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
        ctx.strokeRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      }
      ctx.restore();
      break;
    }
    case 'pulse': {
      ctx.save();
      const on = Math.sin(tt / 90) > 0 ? 0.8 : 0.2;
      ctx.globalAlpha = on * (1 - p * 0.5);
      pxRect(f.x - 3, f.y - 3, f.w + 6, f.h + 6, f.col || '#FFD400');
      ctx.restore();
      break;
    }
    case 'beam': {
      const a = p < 0.15 ? p / 0.15 : (p > 0.8 ? (1 - p) / 0.2 : 1);
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1) * 0.85;
      ctx.strokeStyle = f.col || '#FFD60A';
      ctx.lineWidth = 10 * (1 - p * 0.6);
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(f.x0, f.y0);
      ctx.lineTo(f.x1, f.y1);
      ctx.stroke();
      ctx.globalAlpha = clamp(a, 0, 1) * 0.5;
      ctx.lineWidth = 20 * (1 - p * 0.6);
      ctx.beginPath();
      ctx.moveTo(f.x0, f.y0);
      ctx.lineTo(f.x1, f.y1);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'phase': {
      const inP = clamp(tt / 200, 0, 1);
      const outP = clamp((tt - (f.dur - 250)) / 250, 0, 1);
      const a = Math.min(inP, 1 - outP);
      if (a <= 0) break;
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      const bh = 64;
      pxRect(0, H * 0.3, W, bh, '#101418');
      pxBorder(0, H * 0.3, W, bh, '#FFD60A', 3);
      // 红蓝双色左条 + 速度线
      pxRect(0, H * 0.3, 12, bh, '#FF3B30');
      pxRect(12, H * 0.3, 12, bh, '#0A84FF');
      drawSpeedLine(W / 2, H * 0.3 + bh / 2, bh * 0.7, W * 0.48, 26, 'rgba(255,255,255,0.14)', 2);
      drawPixelText((f.icon ? f.icon + ' ' : '') + '—— ' + f.label + ' ——', W / 2, H * 0.3 + bh / 2, 30, '#FFD60A', { align: 'center' });
      ctx.restore();
      break;
    }
    case 'confetti': {
      ctx.save();
      ctx.globalAlpha = p < 0.8 ? 1 : (1 - p) / 0.2;
      const rnd = f.seed || 7;
      const n = Math.min(f.n || 40, fxLowQ ? 18 : 40);
      for (let i = 0; i < n; i++) {
        const ang = ((rnd * (i + 1) * 1.7) % 6.28);
        const dist = p * (60 + ((rnd * i) % 120));
        const px = f.x + Math.cos(ang) * dist;
        const py = f.y + Math.sin(ang) * dist + p * 40;
        ctx.fillStyle = ['#E6392F', '#FFD60A', '#2f6fd8', '#2f9e62', '#E8A418'][(rnd + i) % 5];
        const s = 5 + ((rnd * (i + 2)) % 6);
        ctx.fillRect(px - s / 2, py - s / 2, s, s * 0.7);
      }
      ctx.restore();
      break;
    }
    case 'star': {
      const al = p < 0.7 ? 1 : (1 - p) / 0.3;
      ctx.save();
      ctx.globalAlpha = al;
      ctx.translate(f.x, f.y - 20 * easeOutCubic(p));
      drawPixelText(f.text, 0, 0, f.size || 22, f.col || '#FFD60A', { align: 'center' });
      ctx.restore();
      break;
    }
    case 'flow': {                // 支持度条填充：从左到右生长（x,y,w,h,col）
      const pr2 = clamp(easeOutCubic(p), 0, 1);
      ctx.save();
      ctx.globalAlpha = p < 0.75 ? 1 : (1 - p) / 0.25;
      pxRect(f.x, f.y, Math.max(2, f.w * pr2), f.h, f.col || '#FFD60A');
      pxBorder(f.x, f.y, Math.max(2, f.w * pr2), f.h, '#111111', 1);
      // 前缘高光
      if (pr2 < 1) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(f.x + Math.max(1, f.w * pr2 - 3), f.y + 1, 3, f.h - 2); }
      ctx.restore();
      break;
    }
    case 'spotlight': {           // 聚光灯：从上方扫过行区域（x0,y0,w0,h0）
      const a = p < 0.12 ? p / 0.12 : (p > 0.85 ? (1 - p) / 0.15 : 1);
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      const sx = f.x0 + (f.w0 || W) * easeInOut(p);
      const bw2 = (f.bw || 90) * (1 - p * 0.25);
      ctx.fillStyle = '#FFF4C8';
      ctx.beginPath();
      ctx.moveTo(sx - bw2, f.y0 - 50);
      ctx.lineTo(sx + bw2, f.y0 - 50);
      ctx.lineTo(sx + bw2 * 3.1, f.y0 + f.h0 + 70);
      ctx.lineTo(sx - bw2 * 3.1, f.y0 + f.h0 + 70);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = clamp(a, 0, 1) * 0.85;
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(sx, f.y0 - 50); ctx.lineTo(sx, f.y0 + f.h0 + 70); ctx.stroke();
      ctx.restore();
      break;
    }
    case 'wheel': {               // 庭审轮盘：旋转停在 winner 分区（cx,cy,r,seats[{name,col}],winner）
      const inP = clamp(tt / 220, 0, 1);
      const outP = clamp((tt - (f.dur - 300)) / 300, 0, 1);
      const a = Math.min(inP, 1 - outP);
      if (a <= 0) break;
      const n = f.seats.length;
      const r = f.r || 88;
      const step = 2 * Math.PI / n;
      let target = (-Math.PI / 2 - (f.winner * step + step / 2)) % (2 * Math.PI);
      if (target < 0) target += 2 * Math.PI;
      const rot = easeOutCubic(p) * (2 * Math.PI * 3 + target);
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      const cx = f.cx, cy = f.cy;
      // 外圈高帽边框
      ctx.beginPath(); ctx.arc(cx, cy, r + 14, 0, Math.PI * 2);
      ctx.fillStyle = '#111111'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
      ctx.fillStyle = '#FFD60A'; ctx.fill();
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(rot);
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, i * step, (i + 1) * step);
        ctx.closePath();
        ctx.fillStyle = f.seats[i].col;
        ctx.fill();
        ctx.strokeStyle = '#111111'; ctx.lineWidth = 3; ctx.stroke();
      }
      // 中心天平衡徽
      ctx.fillStyle = '#111111';
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
      drawPixelText('⚖️', 0, 1, 16, '#FFFFFF', { align: 'center', shadow: false });
      ctx.restore();
      // 顶部金色指针
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy - r - 8);
      ctx.lineTo(cx + 8, cy - r - 8);
      ctx.lineTo(cx, cy - r + 10);
      ctx.closePath();
      ctx.fillStyle = '#FF3B30'; ctx.fill();
      ctx.strokeStyle = '#111111'; ctx.lineWidth = 2; ctx.stroke();
      // 底部结果名（p 过半后弹出）
      if (p > 0.42) {
        const lp = clamp((p - 0.42) / 0.3, 0, 1);
        ctx.globalAlpha = clamp(a, 0, 1) * lp;
        ctx.save();
        ctx.translate(cx, cy + r + 26);
        ctx.scale(0.7 + 0.3 * easeOutBack(lp), 0.7 + 0.3 * easeOutBack(lp));
        pxRect(-70, -16, 140, 32, '#FFD60A');
        pxBorder(-70, -16, 140, 32, '#111111', 2.5);
        drawPixelText('🎩 ' + f.seats[f.winner].name + ' 起始！', 0, 1, 14, '#111111', { align: 'center', shadow: false });
        ctx.restore();
      }
      ctx.restore();
      break;
    }
    case 'coinFlip': {            // 抛硬币决定阵营：全屏覆盖旋转 → 落下揭示（side: 'prosecutor'|'defense'）
      const inP = clamp(tt / 180, 0, 1);
      const outP = clamp((tt - (f.dur - 300)) / 300, 0, 1);
      const a = Math.min(inP, 1 - outP);
      if (a <= 0) break;
      const cx = W / 2, cy = H * 0.38;
      const R = f.r || Math.min(54, W * 0.09);
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      // 深色遮罩突出硬币
      ctx.fillStyle = 'rgba(8,10,18,0.72)';
      ctx.fillRect(0, 0, W, H);
      // 金币：旋转 6 圈下落，两面 ⚖(检方) / 🛡(辩护方) 交替，旋转到侧面时压扁
      const spins = 6;
      const faceP = (p * spins) % 1;
      const isPro = faceP < 0.5;
      const y = cy + (1 - easeOutCubic(p)) * -120;
      const wob = Math.sin(p * Math.PI * spins * 2) * 0.1;
      ctx.translate(cx, y);
      ctx.scale(1 + wob, 1 - wob);
      pxRect(-R, -R, R * 2, R * 2, '#E8A418');
      pxBorder(-R, -R, R * 2, R * 2, '#111111', 4);
      ctx.beginPath(); ctx.arc(0, 0, R - 6, 0, Math.PI * 2);
      ctx.fillStyle = '#FFC61A'; ctx.fill();
      ctx.strokeStyle = '#111111'; ctx.lineWidth = 2.5; ctx.stroke();
      const squeeze = Math.abs(Math.cos(p * Math.PI * spins));   // 1 正面 / 0 侧面
      ctx.globalAlpha = clamp(a, 0, 1) * (0.3 + 0.7 * squeeze);
      drawPixelText(isPro ? '⚖' : '🛡', 0, 0, R * 0.95, '#4A3100', { align: 'center', shadow: false });
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      drawPixelText('抛硬币决定阵营', cx, cy - R - 30, 15, '#FFD60A', { align: 'center' });
      // 落地揭示：弹出版本横幅
      if (p > 0.72) {
        const lp = clamp((p - 0.72) / 0.22, 0, 1);
        const side = f.side === 'prosecutor' ? '检方' : '辩护方';
        const col = f.side === 'prosecutor' ? '#FF5A4E' : '#2F6FD8';
        ctx.globalAlpha = clamp(a, 0, 1) * lp;
        ctx.translate(cx, cy + R + 26);
        ctx.scale(0.7 + 0.3 * easeOutBack(lp), 0.7 + 0.3 * easeOutBack(lp));
        pxRect(-92, -20, 184, 40, col);
        pxBorder(-92, -20, 184, 40, '#111111', 3.5);
        drawPixelText('你代表【' + side + '】', 0, 1, 17, '#FFFFFF', { align: 'center', shadow: false });
      }
      ctx.restore();
      break;
    }
    case 'chain': {               // 铁链锁卡：两条交叉链 + 中央金锁（x,y,w,h）
      const al = p < 0.8 ? 1 : (1 - p) / 0.2;
      ctx.save();
      ctx.globalAlpha = clamp(al, 0, 1);
      const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
      const grow = easeOutCubic(clamp(p * 1.15, 0, 1));
      ctx.strokeStyle = '#7A8494'; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(f.x + 4, f.y + 4);
      ctx.lineTo(f.x + 4 + (f.w - 8) * grow, f.y + 4 + (f.h - 8) * grow);
      ctx.moveTo(f.x + f.w - 4, f.y + 4);
      ctx.lineTo(f.x + f.w - 4 - (f.w - 8) * grow, f.y + 4 + (f.h - 8) * grow);
      ctx.stroke();
      ctx.strokeStyle = '#3E4654'; ctx.lineWidth = 2.5;
      for (let i = 0; i < 5; i++) {
        const t = i / 4 * grow;
        ctx.beginPath(); ctx.arc(f.x + 4 + (f.w - 8) * t, f.y + 4 + (f.h - 8) * t, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(f.x + f.w - 4 - (f.w - 8) * t, f.y + 4 + (f.h - 8) * t, 6, 0, Math.PI * 2); ctx.stroke();
      }
      const lp = clamp((p - 0.45) / 0.4, 0, 1);
      if (lp > 0) {
        const ly = cy - 12 + (1 - easeOutBack(lp)) * 16;
        pxRect(cx - 13, ly, 26, 22, '#FFD60A');
        pxBorder(cx - 13, ly, 26, 22, '#111111', 2.5);
        ctx.beginPath(); ctx.arc(cx, ly + 2, 8, Math.PI, 0);
        ctx.strokeStyle = '#111111'; ctx.lineWidth = 3; ctx.stroke();
        drawPixelText('🔒', cx, ly + 15, 12, '#111111', { align: 'center', shadow: false });
      }
      ctx.restore();
      break;
    }
    case 'shred': {               // 碎纸机：市场卡切条坠落（x,y,w,h）
      const al = p < 0.75 ? 1 : (1 - p) / 0.25;
      ctx.save();
      ctx.globalAlpha = clamp(al, 0, 1);
      const n2 = 8;
      for (let i = 0; i < n2; i++) {
        const sx = f.x + (i / n2) * f.w;
        const sw = f.w / n2 * 0.72;
        const sy = f.y + easeOutCubic(p) * f.h * (0.55 + 0.5 * ((i * 37) % 10) / 10);
        const rot = (p * 0.7 + i * 0.13) * ((i % 2) ? 1 : -1);
        ctx.save();
        ctx.translate(sx + sw / 2, sy); ctx.rotate(rot);
        ctx.fillStyle = i % 2 ? '#E9D9B2' : '#F6E9C8';
        ctx.fillRect(-sw / 2, 0, sw, 6 + (i % 3) * 2);
        ctx.strokeStyle = '#111111'; ctx.lineWidth = 1;
        ctx.strokeRect(-sw / 2, 0, sw, 6 + (i % 3) * 2);
        ctx.restore();
      }
      ctx.fillStyle = '#D8C89E';
      ctx.fillRect(f.x - 6, f.y + f.h - 8 + p * 8, f.w + 12, 12);
      ctx.strokeStyle = '#111111'; ctx.lineWidth = 1.5;
      ctx.strokeRect(f.x - 6, f.y + f.h - 8 + p * 8, f.w + 12, 12);
      ctx.restore();
      break;
    }
    case 'recycle': {             // 弃牌回收：卡背弧线飞入选票箱（x0,y0 → x1,y1）
      const al = p < 0.8 ? 1 : (1 - p) / 0.2;
      ctx.save();
      ctx.globalAlpha = clamp(al, 0, 1);
      const x = f.x0 + (f.x1 - f.x0) * easeOutCubic(p);
      const y = f.y0 + (f.y1 - f.y0) * easeOutCubic(p) + Math.sin(p * Math.PI * 3) * 14;
      ctx.translate(x, y);
      ctx.rotate(p * Math.PI * 2);
      const sc = 1 - 0.45 * p;
      ctx.scale(sc, sc);
      UIKit.drawCardBackAt(ctx, -f.w / 2, -f.h / 2, f.w, f.h, '#7E93B0');
      ctx.restore();
      if (p > 0.55) {
        ctx.save();
        ctx.globalAlpha = clamp((p - 0.55) / 0.35, 0, 1) * 0.92;
        drawRecycleBin(f.x1, f.y1);
        ctx.restore();
      }
      break;
    }
    case 'flyTo': {               // 购买飞牌/出牌飞行：x0,y0,w0,h0 → x1,y1,w1,h1
      const al = p < 0.85 ? 1 : (1 - p) / 0.15;
      ctx.save();
      ctx.globalAlpha = clamp(al, 0, 1);
      const x = f.x0 + (f.x1 - f.x0) * easeOutCubic(p);
      const y = f.y0 + (f.y1 - f.y0) * easeOutCubic(p) - Math.sin(p * Math.PI) * 30;
      const w = f.w0 + (f.w1 - f.w0) * p, h = f.h0 + (f.h1 - f.h0) * p;
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(Math.sin(p * Math.PI) * 0.35);
      ctx.translate(-w / 2, -h / 2);
      if (f.card) UIKit.drawCard(ctx, 0, 0, w, h, f.card, { col: '#F6E9C8' });
      else UIKit.drawCardBackAt(ctx, 0, 0, w, h, PAL.ui.b);
      ctx.restore();
      // 落台高亮：即将到位时金色脉冲描边
      if (f.landGlow && p > 0.88) {
        const gl = clamp((p - 0.88) / 0.12, 0, 1) * (0.5 + 0.5 * Math.sin(f.t / 70));
        ctx.save();
        ctx.globalAlpha = gl;
        pxBorder(f.x1 - 5, f.y1 - 5, f.w1 + 10, f.h1 + 10, '#FFD60A', 4);
        ctx.restore();
      }
      break;
    }
    case 'tombstone': {           // 墓碑落下：标记被炸毁的牌（x,y,w,h）
      const al = p < 0.8 ? 1 : (1 - p) / 0.2;
      ctx.save();
      ctx.globalAlpha = clamp(al, 0, 1);
      const rise = easeOutBack(clamp(p / 0.55, 0, 1));
      const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
      const tw = 44 * rise, th = 58 * rise;
      ctx.fillStyle = '#8B93A3';
      ctx.beginPath();
      ctx.moveTo(cx - tw, cy);
      ctx.lineTo(cx - tw, cy - th * 0.72);
      ctx.quadraticCurveTo(cx, cy - th, cx + tw, cy - th * 0.72);
      ctx.lineTo(cx + tw, cy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#111111'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - tw * 0.55, cy + 6);
      ctx.lineTo(cx + tw * 0.55, cy + 6);
      ctx.stroke();
      drawPixelText('✝', cx, cy - th * 0.5, 13, '#FFFFFF', { align: 'center', shadow: false });
      drawPixelText('RIP', cx, cy - 8, 10, '#E9ECF2', { align: 'center', shadow: false });
      ctx.restore();
      break;
    }
  }
}
function drawRecycleBin(cx, cy) {   // 蓝色选票回收箱
  pxRect(cx - 26, cy - 20, 52, 36, '#0A84FF');
  pxBorder(cx - 26, cy - 20, 52, 36, '#111111', 2.5);
  pxRect(cx - 30, cy - 26, 60, 10, '#FFD60A');
  pxBorder(cx - 30, cy - 26, 60, 10, '#111111', 2);
  pxRect(cx - 26, cy - 12, 52, 3, 'rgba(255,255,255,0.18)');
  drawPixelText('�', cx, cy + 1, 14, '#FFFFFF', { align: 'center', shadow: false });
}

/* 风味名池数据唯一源 = shared/flavor.js（挂 window.VOTER_FLAVOR），flavorName 直接引用全局 */
/* 技能飘字 + 触发色：唯一源在 shared/ui-kit.js（UIKit.SKILL_FX），这里只做别名引用 */
const SKILL_FX = UIKit.SKILL_FX;
/* PAL / PARTY_META / 阵营工具唯一源 = shared/theme.js（已挂 window，E() 自动命中） */
/* 卡牌底部风味名（纯装饰：每次渲染按 uid 取一句） */
function flavorName(card) {
  const arr = VOTER_FLAVOR[card.id];
  if (!arr) return '';
  return arr[(card.uid || 0) % arr.length];
}
function lvMark(lv) { return lv === 1 ? '①' : (lv === 2 ? '②' : (lv === 3 ? '③' : '')); }

/* ============================ 卡牌绘制 ============================
 * 卡牌绘制唯一源在 shared/ui-kit.js（超级更新#5）：
 *   UIKit.drawCard(ctx,...) / UIKit.drawEventCard(ctx,...) /
 *   UIKit.drawCharCard(ctx,...) / UIKit.drawCardBackAt(ctx,...)
 * 渲染层直接调用，不再维护本地薄封装。 */

/* ---------------- 连接状态与全局 UI 状态 ---------------- */
const socket = io();
let roomInfo = null;        // {code, mode, maxSeats, started, seats[]}
let view = null;            // 服务端下发的我的视角
let vm = null;              // P1-8：UIPresenter.project(view) 投影 ViewModel（renderPanels 等消费）
let mySeat = null;
let deadline = null;        // 我的行动截止时间
let thinkSeat = -1;         // AI 对手思考遮罩（座位，服务端 aiThink 广播）
let thinkT = 0;             // 思考开始时间戳（1.2s 兜底自动清除）
let lastTickSec = -1;       // 倒计时上次滴答的秒数（防重复发声）
let selected = [];          // 出牌/弃牌阶段已选卡 uid
let buyMode = 'buy';        // buy | lock
let eventPick = null;       // {seat, ev, target} 事件目标选择
let screen = 'menu';        // menu | lobby | help | glossary | draft | game | over
let lastRoomCode = null;
let lastPlayerName = null;

/* ---------------- 诊断日志黑匣子（程序意见3） ----------------
 * 记录 phase/version/action 等关键状态变更，出错时输出最近快照，辅助定位联机状态问题 */
const DIAG = [];
const DIAG_MAX = 200;
function diagLog(ev) {
  DIAG.push(Object.assign({ t: Date.now() }, ev));
  if (DIAG.length > DIAG_MAX) DIAG.shift();
}
function diagDump(n) {
  return DIAG.slice(-(n || 50)).map(d => '[' + new Date(d.t).toISOString().slice(11, 23) + '] ' + (d.msg || d.type || ''));
}
function diagOut(reason) {
  try { if (console && console.warn) console.warn('[diag] ' + reason + '\n' + diagDump(40).join('\n')); } catch (e) { /* 忽略 */ }
}

const $ = id => document.getElementById(id);
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function mySeatObj() { return view && mySeat != null ? view.seats[mySeat] : null; }

/* ---------------- Socket 事件 ---------------- */
socket.on('connect', () => {
  toast('已连接服务器');
  if (lastRoomCode && lastPlayerName) {
    socket.emit('joinRoom', { name: lastPlayerName, code: lastRoomCode }, ack => {
      if (ack && !ack.ok) {
        toast('自动重连失败：' + ack.msg, true);
        lastRoomCode = null;
      } else {
        toast('已自动重连房间 ' + lastRoomCode);
        hide('menu');
        show('lobby');
      }
    });
  }
});
socket.on('disconnect', () => toast('与服务器断开连接，正在重连…', true));
socket.on('room', (data) => {
  roomInfo = data;
  if (data.you != null) mySeat = data.you;
  renderLobby();
});
socket.on('state', (st) => {
  if (view && view.version !== undefined && st.version !== undefined && view.version !== st.version) {
    diagLog({ type: 'state', msg: 'version ' + view.version + '→' + st.version + ' phase ' + (view.phase || '?') + '→' + st.phase });
  }
  view = st;
  mySeat = st.mySeat;
  isProcessing = false;   // 服务端状态已确认到达 → 解锁互斥锁
  if (st.gameOver) screen = 'over';
  else if (st.phase === 'pickChar') screen = 'draft';
  else screen = 'game';
  deadline = null;
  selected = [];
  eventPick = null;
  // 注意：不再在此处同步 lastStarterSeat（曾无条件对齐导致轮盘 FX 永不触发）——
  // 改为 checkFxDiffs 的新局/重连分支对齐，正常轮次由 diff 检测触发轮盘
  hide('menu');
  hide('lobby');
  show('game');
});
socket.on('turn', (t) => { if (t.seat === mySeat) deadline = t.deadline; });
socket.on('aiThink', (d) => {
  if (d && d.on) { thinkSeat = d.seat; thinkT = Date.now(); }
  else if (d && thinkSeat === d.seat) thinkSeat = -1;
});
socket.on('notice', (t) => toast(t, true));
socket.on('error', (m) => toast(m || '操作失败', true));

/* ---------------- 菜单 / 大厅 ---------------- */
function defaultName() {
  const n = localStorage.getItem('elec_name');
  if (n) return n;
  return '玩家' + Math.floor(100 + Math.random() * 900);
}
function initMenu() {
  $('inp-name').value = defaultName();
  // 恢复上次座位数设置（#108 localStorage）
  const savedSeats = localStorage.getItem('elec_seats');
  if (savedSeats && ['2', '3', '4'].indexOf(savedSeats) >= 0) $('sel-seats').value = savedSeats;
  // #13 恢复上次种子码（可选，留空随机）
  const savedSeed = localStorage.getItem('elec_seed');
  if (savedSeed) $('inp-seed').value = savedSeed;
  $('btn-create').onclick = () => doCreate('multi');
  $('btn-solo').onclick = () => doCreate('solo');
  $('btn-join').onclick = () => doJoin();
  $('btn-quickjoin').onclick = () => doQuickJoin();
  const bs = $('btn-spectate');
  if (bs) bs.onclick = () => doSpectate();
  $('btn-start').onclick = () => socket.emit('startGame', {}, ack => { if (ack && !ack.ok) toast(ack.msg, true); });
  $('btn-leave').onclick = () => location.reload();
  $('btn-tutorial').onclick = () => { screen = 'help'; helpPage = 0; hide('menu'); show('game'); };
  $('btn-glossary').onclick = () => { screen = 'glossary'; GLOSSARY_TAB.tab = 'terms'; GLOSSARY_TAB.page = 0; hide('menu'); show('game'); };
  // #109 版本号与关于弹窗
  $('btn-about').onclick = () => show('about');
  $('about-close').onclick = () => hide('about');
  $('inp-code').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
  // 昵称回车 → 跳到房间代码（触屏拉起键盘后按回车继续）
  $('inp-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('inp-code').focus(); });
}
function setBusy(busy) {
  $('btn-create').disabled = busy;
  $('btn-solo').disabled = busy;
  $('btn-join').disabled = busy;
  $('btn-quickjoin').disabled = busy;
  const bs = $('btn-spectate');
  if (bs) bs.disabled = busy;
  if (busy) $('menu-msg').textContent = '连接中…';
}
function doCreate(mode) {
  const name = $('inp-name').value.trim() || '玩家';
  localStorage.setItem('elec_name', name);
  const maxSeats = parseInt($('sel-seats').value, 10) || 2;
  localStorage.setItem('elec_seats', String(maxSeats));   // #108 保存座位数
  localStorage.setItem('elec_mode', mode);                // #108 保存模式（solo/multi）
  // #13 种子码（可选，留空=服务器随机；同种子=同一对局，可复现）
  // 仅在有输入时记住，避免空串覆盖上次记忆（与单机端一致）
  const seed = $('inp-seed').value.trim();
  if (seed) { try { localStorage.setItem('elec_seed', seed); } catch (err) { /* 忽略 */ } }
  const password = $('inp-pass').value.trim();
  setBusy(true);
  socket.emit('createRoom', { name, mode, maxSeats, seed, password }, ack => {
    setBusy(false);
    if (ack && !ack.ok) { $('menu-msg').textContent = ack.msg; return; }
    lastRoomCode = ack.code;
    lastPlayerName = name;
    hide('menu');
    show('lobby');
  });
}
function doJoin() {
  const name = $('inp-name').value.trim() || '玩家';
  localStorage.setItem('elec_name', name);
  localStorage.setItem('elec_mode', 'multi');   // #108 加入房间即联机模式
  const code = $('inp-code').value.trim().toUpperCase();
  if (!code) { $('menu-msg').textContent = '请输入房间代码'; return; }
  const password = $('inp-pass').value.trim();
  setBusy(true);
  socket.emit('joinRoom', { name, code, password }, ack => {
    setBusy(false);
    if (ack && !ack.ok) { $('menu-msg').textContent = ack.msg; return; }
    lastRoomCode = code;
    lastPlayerName = name;
    hide('menu');
    show('lobby');
  });
}
function doQuickJoin() {
  const name = $('inp-name').value.trim() || '玩家';
  localStorage.setItem('elec_name', name);
  localStorage.setItem('elec_mode', 'multi');
  setBusy(true);
  socket.emit('quickJoin', { name }, ack => {
    setBusy(false);
    if (ack && !ack.ok) { $('menu-msg').textContent = ack.msg; return; }
    lastRoomCode = ack.code;
    lastPlayerName = name;
    hide('menu');
    show('lobby');
  });
}
function doSpectate() {
  // 观战模式（E 类）：观看对局，不占座位。需房间号；密码房需正确密码。
  const name = $('inp-name').value.trim() || '观众' + Math.floor(100 + Math.random() * 900);
  localStorage.setItem('elec_name', name);
  localStorage.setItem('elec_mode', 'multi');
  const code = $('inp-code').value.trim().toUpperCase();
  if (!code) { $('menu-msg').textContent = '请输入要旁观的房间代码'; return; }
  const password = $('inp-pass').value.trim();
  setBusy(true);
  socket.emit('joinRoom', { name, code, password, spectate: true }, ack => {
    setBusy(false);
    if (ack && !ack.ok) { $('menu-msg').textContent = ack.msg; return; }
    lastRoomCode = code;
    lastPlayerName = name;
    hide('menu');
    show('lobby');
  });
}
function renderLobby() {
  if (!roomInfo) return;
  $('room-code').textContent = roomInfo.code;
  const list = $('seat-list');
  list.innerHTML = '';
  roomInfo.seats.forEach((s) => {
    const div = document.createElement('div');
    div.className = 'seat';
    const nameEl = document.createElement('span');
    if (s.name) {
      nameEl.textContent = s.name;
      if (s.seat === mySeat) nameEl.className = 'me';
      else if (s.isAI) nameEl.className = 'ai';
    } else {
      nameEl.textContent = '— 空位 —';
      nameEl.className = 'empty';
    }
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = s.host ? '房主' : (s.isAI ? 'AI' : (s.seat === mySeat ? '我' : '玩家'));
    div.appendChild(nameEl);
    div.appendChild(tag);
    list.appendChild(div);
  });
  const humans = roomInfo.seats.filter(s => s.connected).length;
  if (mySeat < 0) {
    // 观战者：不占座位，等待对局开始（未开局旁观）或等 state 切入对局画面
    $('lobby-msg').textContent = '👁 旁观中：等待对局画面…';
    hide('btn-start');
    return;
  }
  $('lobby-msg').textContent = '已就绪 ' + humans + ' / ' + roomInfo.maxSeats + ' 人';
  const isHost = roomInfo.seats[mySeat] && roomInfo.seats[mySeat].host;
  if (isHost) { show('btn-start'); $('btn-start').disabled = humans < 1; }
  else hide('btn-start');
}

/* ---------------- 发送操作（带互斥锁） ----------------
 * 互斥锁以服务端 ack 为唯一解锁信号（防双击重复提交）。
 * ACK_TIMEOUT_MS 仅为 ack 永远不回来（断网/服务器卡死）时的兜底，
 * 避免永久锁死；正常路径下锁由 ack 回调显式释放。 */
let isProcessing = false;
const ACK_TIMEOUT_MS = 4000;
function send(action, cb) {
  socket.emit('action', action, ack => {
    if (ack && !ack.ok) toast(ack.msg || '操作失败', true);
    if (cb) cb(ack);
  });
}
function doAction(action, cb) {
  if (isProcessing) return;
  diagLog({ type: 'action', msg: (action && action.type) + (action && action.charId ? ':' + action.charId : '') });
  isProcessing = true;
  send(action, ack => {
    isProcessing = false;
    if (cb) cb(ack);
  });
  setTimeout(() => { isProcessing = false; }, ACK_TIMEOUT_MS);
}

/* ---------------- 布局函数 ---------------- */
const ROW_H = 150;      // HUD_H / PANEL_Y / HAND_AREA_H 已在顶部声明，resize 按横屏/桌面动态更新
let eventPage = 0;      // 事件牌分批翻页（每页 4 张）
// 回合进程状态条（阶段进度）
/* 阶段进度条常量：唯一源在 shared/game-core.js（超级更新#2），此处仅引用显示版 */
const PHASE_STEPS = (typeof ElectionCore !== 'undefined' && ElectionCore.PHASE_STEPS_VISIBLE) || [];
function panelHeight() {
  // 顶部紧凑信息条：桌面 30 / 横屏触屏 20（按四档断点动态调整）
  return UI.panelH;
}
/* P1-6：布局唯一源在 UIPresenter.layouts()（双端收口），以下均为薄封装 */
function _layouts() {
  if (!view) return null;
  return UIPresenter.layouts(view, { W, H, compact, isMobile, portraitMode, mySeat: view.mySeat, eventPage, HAND_AREA_H, PANEL_Y, panelH: UI.panelH });
}
function panelRect(seat) {
  const L = _layouts();
  return L ? L.panelRects[seat] : null;
}
function rowLayout() {
  const L = _layouts();
  return L ? L.row : { items: [], rw: 80, rh: 100, cy: 0 };
}
function handLayout() {
  const L = _layouts();
  return L ? L.handItems : [];
}
function marketSlotRects(s) {
  const L = _layouts();
  return L ? L.marketItems : [];
}
function eventSlotRects() {
  const L = _layouts();
  return L ? L.eventItems : [];
}

/* ---------------- 屏幕渲染：选角（pickChar） ---------------- */
function renderDraft() {
  buttons = [];
  hoverCards = [];
  ctx.clearRect(0, 0, W, H);
  pxRect(0, 0, W, H, PAL.draft.a);
  if (!view) return;
  const me = view.seats[mySeat];
  // 抛硬币揭示阵营：拿到 side 后播放一次（全屏动画，不挡 3 选 1 操作）
  if (me && me.side && !sideRevealDone) {
    sideRevealDone = true;
    addFx({ type: 'coinFlip', dur: 2100, side: me.side });
    sfx('coin');
  }
  const draftTitle = me && me.side === 'prosecutor' ? '抽取检察官 · 3 选 1 · 同时亮出'
    : (me && me.side === 'defense' ? '抽取辩护律师 · 3 选 1 · 同时亮出'
      : '抽取律师 · 3 选 1 · 同时亮出');
  drawPixelText(draftTitle, W / 2, 44, 26, PAL.draft.b, { align: 'center' });
  if (me && me.side) {
    const isPro = me.side === 'prosecutor';
    drawPixelText('你代表【' + (isPro ? '检方' : '辩护方') + '】出庭', W / 2, 72, 15, isPro ? '#FF5A4E' : '#2F6FD8', { align: 'center' });
  }
  if (me && !me.char) {
    const cands = view.draftCandidates || [];
    const cw = clamp(Math.min(190, (W - 80) / Math.max(1, cands.length) - 20), 64, 190);   // P0：窄屏下限 64
    const ch = Math.min(250, Math.max(120, H * 0.42));
    const total = cands.length * cw + (cands.length - 1) * 34;
    let cx = (W - total) / 2;
    const cy = H * 0.30;
    const myRole = me.side === 'prosecutor' ? '检察官' : '辩护律师';
    drawPixelText('你的' + myRole + '（点击选择，或按 1/2/3）', W / 2, cy - 48, 18, PAL.draft.b, { align: 'center' });
    cands.forEach(c => {
      const hv = mouse.x >= cx && mouse.x <= cx + cw && mouse.y >= cy && mouse.y <= cy + ch;
      UIKit.drawCharCard(ctx, cx, hv ? cy - 6 : cy, cw, ch, c, campColor(mySeat), false);
      if (hv) pxBorder(cx - 4, cy - 10, cw + 8, ch + 8, '#FFD60A', 4);
      hoverCards.push({ x: cx, y: cy, w: cw, h: ch, kind: 'char', data: c });
      cx += cw + 34;
    });
  } else {
    drawPixelText('律师已全部亮出', W / 2, H * 0.14, 18, PAL.draft.b, { align: 'center' });
    const n = view.seatCount;
    const cw = clamp(Math.min(170, (W - 80) / n - 20), 56, 170);   // P0：窄屏下限 56
    const ch = Math.min(230, Math.max(100, H * 0.42));
    const total = n * cw + (n - 1) * 30;
    let cx = (W - total) / 2;
    view.seats.forEach((s, i) => {
      if (s.char) {
        UIKit.drawCharCard(ctx, cx, H * 0.24, cw, ch, s.char, campColor(i), false);
        drawPixelText(s.name + (i === mySeat ? '（你）' : ''), cx + cw / 2, H * 0.24 + ch + 20, 15, campColor(i), { align: 'center' });
        if (s.side) drawPixelText(s.side === 'prosecutor' ? '【检方】' : '【辩护方】', cx + cw / 2, H * 0.24 + ch + 36, 11, s.side === 'prosecutor' ? '#FF5A4E' : '#2F6FD8', { align: 'center' });
      } else {
        UIKit.drawCardBackAt(ctx, cx, H * 0.24, cw, ch, PAL.ui.b);
        drawPixelText(s.name + ' 正在选择…', cx + cw / 2, H * 0.24 + ch + 20, 14, PAL.draft.b, { align: 'center' });
      }
      cx += cw + 30;
    });
    drawPixelText('即将开始第 1 轮…', W / 2, H * 0.8, 16, PAL.draft.b, { align: 'center' });
  }
  renderFx();   // draft 屏也播放 FX（抛硬币等）
}

/* ---------------- 屏幕渲染：对局 ---------------- */
function renderGame() {
  // 渲染骨架收敛至 shared/render-core.js（renderScene）：清屏+背景+六段+尾部
  const env = renderEnv();
  env.drawBackdrop = () => {
    pxRect(0, 0, W, H, PAL.bg.a);
    // 演播室背景：斜向速度线 + 顶部聚光灯锥（低画质 LOW_Q 跳过装饰，保帧率）
    if (LOW_Q) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const step = 34;
    for (let x = -H; x < W + H; x += step) { ctx.moveTo(x, HUD_H); ctx.lineTo(x + H, H); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.beginPath();
    for (let x = -H; x < W + H; x += step) { ctx.moveTo(x + step / 2, HUD_H); ctx.lineTo(x + step / 2 + H, H); }
    ctx.stroke();
    // 顶部两束聚光灯锥
    ctx.fillStyle = 'rgba(255,244,200,0.05)';
    ctx.beginPath();
    ctx.moveTo(W * 0.18, HUD_H); ctx.lineTo(W * 0.42, HUD_H); ctx.lineTo(W * 0.34, H); ctx.lineTo(W * 0.02, H); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,244,200,0.04)';
    ctx.beginPath();
    ctx.moveTo(W * 0.78, HUD_H); ctx.lineTo(W * 0.62, HUD_H); ctx.lineTo(W * 0.72, H); ctx.lineTo(W * 0.98, H); ctx.closePath(); ctx.fill();
    ctx.restore();
  };
  env.renderRowArea = renderRowArea;
  env.renderLogs = renderLogs;
  env.renderTail = () => renderFx();
  RenderCore.renderScene(env);
}
/* ===== 共享渲染模块接入（shared/render-core.js）：env 组装 + 薄封装 =====
 * 渲染函数本体已收敛至 RenderCore（单一事实源），此处仅注入差异参数。
 * 双端差异：数据源（view/game）、文案（copy）、辅助函数注入。
 * P1-7：renderHud/renderPanels/renderBottom 已并入 RenderCore（renderHudOf/
 *        renderPanelsOf/renderBottomOf），差异经下方 copy 与注入表达。 */
function renderEnv() {
  // env 组装已收口至 RenderCore.renderEnvOf(cfg)（评审二/五：单一工厂+配置表）
  return RenderCore.renderEnvOf({
    ctx, W, H, PAL, screen,
    G: () => view,
    mySeat, HAND_AREA_H, HUD_H,
    actH: portraitMode ? PORTRAIT_ACT_H : 0,   // Task 5 竖屏固定操作栏高：内容区下移让位
    UI, PHASE_STEPS,
    fontBase: _FONT_BASE,
    selected, eventPick, buyMode,
    portraitMode, compact, isMobile,
    eventPage: () => eventPage, setEventPage: (v) => { eventPage = v; },
    handScroll: () => handScroll, setHandScroll: (v) => { handScroll = v; },
    vm: () => vm,
    panelRect: (i) => panelRect(i),
    panelHeight: () => panelHeight(),
    marketSlots: (s) => marketSlotRects(s),
    eventSlots: () => eventSlotRects(),
    canClickHand: (c) => canClickHand(c),
    isEventUsable: (ev) => isEventUsable(ev),
    renderActionButtons: (me) => renderActionButtons(me),
    portraitPerPage: PORTRAIT_PER_PAGE,
    mouse, hoverAnim, hoverCards, buttons,
    keepMax: () => RenderCore.keepMaxOf(renderEnv()),
    campColor,
    tooltipInfo: (h) => tooltipInfo(h),
    rowLayout: () => rowLayout(),
    skillPulse: (card, x, y, w, h) => {
      // 技能闪光（计票时脉冲）：本地 FX 数组逻辑，经注入供 RC.drawRowCardOf 调用（评审五收口）
      if (card.skill && SKILL_FX[card.skill]) {
        const pu = FX.find(f => f.type === 'pulse' && f.uid === card.uid);
        if (pu) {
          ctx.save();
          const on = Math.sin(ttOf(pu) / 90) > 0 ? 0.8 : 0.2;
          ctx.globalAlpha = on;
          pxRect(x - 3, y - 3, w + 6, h + 6, SKILL_FX[card.skill].col);
          ctx.restore();
        }
      }
    },
    drawRowBackdrop: (cy, rh) => {
      // 辩论台底座：深色台面 + 金色边线 + 中央微标（renderRowArea 已收敛至 RenderCore）
      pxRect(8, cy - 24, W - 16, rh + 34, PAL.bg.b);
      pxBorder(8, cy - 24, W - 16, rh + 34, '#FFD60A', 2);
      ctx.save();
      ctx.globalAlpha = 0.5;
      drawPixelText('⚖️ 庭审区 ★', W / 2, cy - 14, 11, '#FFD60A', { align: 'center', shadow: false });
      ctx.restore();
    },
    navBtn: (id, x, y, w, h, text, enabled) => addButton(id, x, y, w, h, text, { disabled: !enabled }),
    rowFolded: () => rowFolded,   // Task 6 竖屏行区折叠状态（renderRowArea 读取）
    copy: {
      buyTip: '调查取证：传唤证物架上的证据', playTip: '暗置举证：从手牌打 1 张',
      // —— renderHudOf：联机差异（默认值为联机侧，显式写出与单机成对）——
      roundTxt: (g) => g.round > 0 ? '第 ' + g.round + ' 轮' : '准备中',
      roundPos: { x: 14, y: HUD_H / 2, size: 20 },
      phaseTxt: (g) => g.phaseLabel || g.phase,
      phasePos: { x: W / 2, y: HUD_H / 2, size: 22 },
      trackElse: (tY, tH) => { pxRect(0, tY, W * 0.5, tH, '#FF3B30'); pxRect(W * 0.5, tY, W * 0.5, tH, '#0A84FF'); },
      isSpectator: () => mySeat < 0,
      startTxt: (g) => g.startingSeat != null && g.seats[g.startingSeat] ? '起始：' + g.seats[g.startingSeat].name : '',
      startPos: { x: W - 14, y: HUD_H / 2, size: 16 },
      countdown: () => {
        // 行动倒计时（我行动时）：最后 5 秒红色呼吸脉冲 + 每秒滴答音效，≤3 秒心跳加速
        if (deadline && deadline > Date.now() && myTurn()) {
          const remain = Math.max(0, Math.round((deadline - Date.now()) / 1000));
          const urgent = remain <= 5;
          const pulse = urgent ? (Math.sin(performance.now() / (remain <= 3 ? 140 : 240)) > 0 ? 1 : 0.55) : 1;
          ctx.save();
          ctx.globalAlpha = pulse;
          drawPixelText('⏱ ' + remain + 's', W - 200, HUD_H / 2, urgent ? 22 : 16, '#FF5A4E', { align: 'right', shadow: false });
          ctx.restore();
          if (urgent && remain !== lastTickSec) {
            lastTickSec = remain;
            sfx(remain <= 3 ? 'tickFast' : 'tick');
          }
        }
      },
      stepBar: {
        maxW: 30, baseW: 320, mobile: isMobile ? 16 : null,
        sx0: () => Math.max(76, isMobile ? 108 : 148), availR: () => W - 88,
        nextSize: () => isMobile ? 10.5 : 12, nextCol: '#DCE6F5', nextDX: 6,
        nextGuard: (sx) => sx + 12 < W
      },
      // —— renderPanelsOf：联机差异（默认值为联机侧）——
      charBrief: (s) => (s.side === 'prosecutor' ? '检方·' : '辩方·') + s.char.name,
      lockShow: (s, isMe, g) => UI.show.locked && s.lockedCount,
      scandalBar: (s, sc) => UI.show.scandalBar,
      // —— renderBottomOf：联机差异（默认值为联机侧）——
      handTitle: (me, from, to, total) => '手牌 ' + me.hand.length + ' 张 · ' + (from + 1) + '-' + to + ' / ' + total
    }
  });
}
function myTurn() { return RenderCore.myTurnOf(renderEnv()); }
function drawGoalGuide() { RenderCore.drawGoalGuide(renderEnv()); }
function updateHoverAnim() { RenderCore.updateHoverAnim(renderEnv()); }
function hoverAlpha() { return RenderCore.hoverAlpha(renderEnv()); }
function drawHoverTooltip() { RenderCore.drawHoverTooltip(renderEnv()); }
function renderRowArea() { RenderCore.renderRowArea(renderEnv()); }
function drawRowCard(it) { RenderCore.drawRowCardOf(renderEnv(), it); }
/* 面板数值流与 renderPanels 已收敛至 RenderCore.renderPanelsOf（P1-7 双端合一），
 * 本地差异经 renderEnv().copy 注入（panelFlow 逻辑在 RC._panelFlowOf）。 */
function currentActSeat() { return RenderCore.currentActSeatOf(renderEnv()); }
function marketSlotRects(s) {
  // 底部大卡牌区市场槽（P1-6：布局唯一源在 UIPresenter.layouts()）
  const L = _layouts();
  return L ? L.marketItems : [];
}
function eventSlotRects() {
  // 底部大卡牌区事件槽：每页 4 张，翻页显示（P1-6：布局唯一源在 UIPresenter.layouts()）
  const L = _layouts();
  return L ? L.eventItems : [];
}
/* 竖屏手牌抽屉：2 列网格（纵向排布），每页 PORTRAIT_PER_PAGE 张（超级更新#37） */
const PORTRAIT_PER_PAGE = 6;
function handGridRects(n, y, h) {
  const out = [];
  if (n <= 0) return out;
  const gap = 8;
  const cols = 2;
  const avail = W - 20 - gap * (cols - 1);
  const cw = clamp((avail - gap * (cols - 1)) / cols, 60, 200);
  const rowsPerPage = Math.ceil(PORTRAIT_PER_PAGE / cols);
  const ch = clamp((h - 8 - (rowsPerPage - 1) * gap) / rowsPerPage, 46, 180);
  for (let i = 0; i < n; i++) {
    const r = i % rowsPerPage;
    const c = Math.floor(i / rowsPerPage);
    out.push({ x: 10 + c * (cw + gap), y: y + 4 + r * (ch + gap), w: cw, h: ch });
  }
  return out;
}
function canClickHand(card) {
  if (!view) return false;
  const g = view;
  if (mySeat < 0) return false;   // 观战者不可点手牌
  if (g.phase === 'play' && g.turn === mySeat && !g.seats[mySeat].playDone) return true;
  if (g.phase === 'discard' && g.discardSeat === mySeat && !g.seats[mySeat].keepDone) {
    return selected.indexOf(card.uid) >= 0 || selected.length < keepMax();
  }
  return false;
}
function keepMax() { return RenderCore.keepMaxOf(renderEnv()); }
function isEventUsable(ev) {
  if (!view || ev.used || ev.hidden) return false;
  if (view.eventTurnSeat !== mySeat) return false;   // M3：非我方事件回合事件牌不可用
  const s = view.seats[mySeat];
  if (!s) return false;   // 观战者无私有事件牌
  if (s.eventPassed || s.eventCount >= 2) return false;
  if ((view.phase === 'preEvent' && ev.timing !== 'pre') || (view.phase === 'postEvent' && ev.timing !== 'post')) return false;
  return ev.lv <= ElectionCore.eventLvMax(view.round);
}
function addActionBtn(bx, bw, by, label, act, enabled, col) {
  const bh = compact ? 38 : (isMobile ? 56 : 46);
  const b = { id: act, x: bx, y: by, w: bw, h: bh, text: label, disabled: enabled === false };
  buttons.push(b);
  // 三态：常态 / 悬停（金色边框+微光+上浮）/ 禁用（灰底+斜纹）
  const hov = !b.disabled && mouse.x >= bx - 3 && mouse.x <= bx + bw + 3 && mouse.y >= by - 3 && mouse.y <= by + bh + 3;
  comicShadow(b.x, b.y, b.w, b.h, hov ? 5 : 3, hov ? 5 : 3);
  pxRect(b.x, b.y, b.w, b.h, b.disabled ? '#e8e0c8' : (col || PAL.accent.a));
  if (b.disabled) {
    // P1：禁用态灰色斜纹
    ctx.save();
    ctx.strokeStyle = 'rgba(120,110,90,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let dx = -b.h; dx < b.w + b.h; dx += 8) { ctx.moveTo(b.x + dx, b.y + b.h); ctx.lineTo(b.x + dx + b.h, b.y); }
    ctx.stroke(); ctx.restore();
  } else if (hov) {
    ctx.save(); ctx.globalAlpha = 0.22; pxRect(b.x, b.y, b.w, b.h, '#FFFFFF'); ctx.restore();
  }
  pxBorder(b.x, b.y, b.w, b.h, hov ? '#FFD60A' : '#111111', hov ? 4 : 2.5);
  // P1：文字自动缩字/截断，避免小按钮溢出
  const f = fitText(b.text, b.w - 14, isMobile ? 17 : 16);
  drawPixelText(f.text, b.x + b.w / 2, b.y + b.h / 2 - (hov ? 1.5 : 0), f.size, b.disabled ? '#9c9278' : contrast(col || PAL.accent.a), { align: 'center', shadow: false });
  // P1：点击闪光反馈
  if (btnFlash[act]) {
    ctx.save(); ctx.globalAlpha = btnFlash[act]; pxRect(b.x, b.y, b.w, b.h, '#FFFFFF'); ctx.restore();
  }
  return b;
}
function addButton(id, x, y, w, h, text, opts) {
  opts = opts || {};
  const b = { id, x, y, w, h, text, disabled: !!opts.disabled };
  buttons.push(b);
  const hov = !b.disabled && mouse.x >= x - 3 && mouse.x <= x + w + 3 && mouse.y >= y - 3 && mouse.y <= y + h + 3;
  comicShadow(x, y, w, h, hov ? 5 : 3, hov ? 5 : 3);
  pxRect(x, y, w, h, b.disabled ? '#e8e0c8' : (opts.primary ? PAL.accent.a : '#ffffff'));
  if (b.disabled) {
    ctx.save();
    ctx.strokeStyle = 'rgba(120,110,90,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let dx = -h; dx < w + h; dx += 8) { ctx.moveTo(x + dx, y + h); ctx.lineTo(x + dx + h, y); }
    ctx.stroke(); ctx.restore();
  } else if (hov) {
    ctx.save(); ctx.globalAlpha = 0.25; pxRect(x, y, w, h, opts.primary ? '#FFFFFF' : '#FFD60A'); ctx.restore();
  }
  pxBorder(x, y, w, h, hov ? '#FFD60A' : '#111111', b.disabled ? 2 : (hov ? 4 : 2.5));
  const f = fitText(text, w - 10, isMobile ? 16 : 15);
  drawPixelText(f.text, x + w / 2, y + h / 2 - (hov ? 1.5 : 0), f.size, b.disabled ? '#9c9278' : (opts.primary ? contrast(PAL.accent.a) : '#1c1c1c'), { align: 'center', shadow: false });
  if (btnFlash[id]) {
    ctx.save(); ctx.globalAlpha = btnFlash[id]; pxRect(x, y, w, h, '#FFFFFF'); ctx.restore();
  }
  return b;
}
function renderActionButtons(me) {
  // 操作按钮：手牌区上方一行横排（贴近手牌，不遮挡卡牌），宽度自适应 + 自动缩字
  const g = view;
  if (!me) return;   // 观战者不渲染行动按钮
  /* Task 5 竖屏重设计：底部固定操作栏（阶段化通栏大按钮）
   * 1~3 个按钮横贯底栏顶部，底栏内容区（手牌/市场/事件网格）下移 PORTRAIT_ACT_H 让位；
   * 提示类文本（政治操盘/揭示/选起始）居中显示于操作条位置。 */
  if (portraitMode) {
    const actH = PORTRAIT_ACT_H, gap = 8;
    const yAct = H - HAND_AREA_H + 8, hBtn = actH - 14;
    const hint = (t, col) => drawPixelText(t, W / 2, yAct + hBtn / 2, 13, col, { align: 'center', shadow: false });
    const items = [];
    const mk = (label, act, enabled, col2) => items.push({ label, act, enabled, col2 });
    switch (g.phase) {
      case 'buy':
        if (!me.buyDone) {
          mk('换证 ⊙' + ElectionCore.refreshCostOf(me), 'refresh', me.money >= ElectionCore.refreshCostOf(me), PAL.accent.a);
          mk(buyMode === 'lock' ? '切到传唤' : '切到留证', 'toggleBuyMode', true, PAL.ui.a);
          mk('结束取证', 'endBuy', true, PAL.ui.a);
        } else {
          hint('已结束取证', '#C9D6EA');
        }
        break;
      case 'play':
        if (g.turn === mySeat && !me.playDone) {
          mk('举证（' + selected.length + '/1）', 'playSel', selected.length > 0, PAL.accent.a);
          mk('结束举证', 'finishPlay', true, PAL.ui.a);
          hint('每回合举证 1 份', '#C9D6EA');
        } else if (g.playLastSeat === mySeat && !me.playDone) {
          mk('结束举证', 'finishPlay', true, PAL.ui.a);
        }
        break;
      case 'preEvent': case 'postEvent':
        if (g.eventTurnSeat === mySeat) {
          mk('打出选中事件', 'playEventSel', eventPick !== null && eventPick.seat === mySeat && eventPick.target >= 0, PAL.accent.a);
          mk('不打出', 'passEvent', true, PAL.ui.a);
          hint('最多连续 2 张 · 点事件牌', '#C9D6EA');
        }
        break;
      case 'discard':
        if (g.discardSeat === mySeat && !me.keepDone) {
          mk('确认保留（' + selected.length + '/' + Math.min(keepMax(), me.hand.length) + '）', 'finishKeep', selected.length >= Math.min(keepMax(), me.hand.length), PAL.accent.a);
          hint('保留最多 ' + keepMax() + ' 张', '#C9D6EA');
        }
        break;
      case 'count':
        if (g.swapPending && g.swapPending.owner === mySeat) hint('政治操盘：点击场上任意其他牌互换', '#C9D6EA');
        break;
      case 'reveal':
        if (g.revealPending && g.revealPending.owner === mySeat) hint('点击对手已亮出的证据', '#FF5A4E');
        break;
      case 'chooseStarter':
        if (g.starterPicker === mySeat && !g.starterChosen) hint('点击选择本轮起始玩家', '#FFD60A');
        break;
    }
    if (items.length) {
      const n = items.length;
      const bw = (W - 20 - (n - 1) * gap) / n;
      items.forEach((A, i) => addActionBtn(10 + i * (bw + gap), bw, yAct, A.label, A.act, A.enabled, A.col2));
    }
    return;
  }
  const btnH = compact ? 38 : (isMobile ? 50 : 46);
  const btnW0 = 126, gap = 8;
  const y = H - HAND_AREA_H - btnH - 8;
  const items = [];
  let tipTxt = '';
  const mk = (label, act, enabled, col2) => items.push({ label, act, enabled, col2 });
  switch (g.phase) {
    case 'buy':
      if (!me.buyDone) {
        mk('换证 ⊙' + ElectionCore.refreshCostOf(me) + ' ［R］', 'refresh', me.money >= ElectionCore.refreshCostOf(me), PAL.accent.a);
        if (view.leaderStreak >= 2 && view.prevFirst === mySeat) tipTxt = '👑 连胜税 +1⊙';
        mk(buyMode === 'lock' ? '切到传唤' : '切到留证', 'toggleBuyMode', true, PAL.ui.a);
        mk('结束取证 ［B］', 'endBuy', true, PAL.ui.a);
      } else {
        tipTxt = '已结束取证';
      }
      break;
    case 'play':
      if (g.turn === mySeat && !me.playDone) {
        mk('举证（' + selected.length + '/1）', 'playSel', selected.length > 0, PAL.accent.a);
        mk('结束举证 ［P］', 'finishPlay', true, PAL.ui.a);
        tipTxt = '点牌选 1 张 · 回车举证';
      } else if (g.playLastSeat === mySeat && !me.playDone) {
        mk('结束举证 ［P］', 'finishPlay', true, PAL.ui.a);
      }
      break;
    case 'preEvent': case 'postEvent':
      if (g.eventTurnSeat === mySeat) {
        mk('打出选中事件', 'playEventSel', eventPick !== null && eventPick.seat === mySeat && eventPick.target >= 0, PAL.accent.a);
        mk('不打出 ［Enter］', 'passEvent', true, PAL.ui.a);
        tipTxt = '最多连续 2 张 · 点事件牌';
      }
      break;
    case 'discard':
      if (g.discardSeat === mySeat && !me.keepDone) {
        mk('确认保留 ［Enter］', 'finishKeep', selected.length >= Math.min(keepMax(), me.hand.length), PAL.accent.a);
        tipTxt = '保留本阵营 ' + keepMax() + ' 张';
      }
      break;
    case 'reveal':
      if (g.revealPending && g.revealPending.owner === mySeat) tipTxt = '点击对手已亮出的证据';
      break;
    case 'chooseStarter':
      if (g.starterPicker === mySeat && !g.starterChosen) tipTxt = '点击选择本轮起始玩家';
      break;
  }
  // 横排布局：从右往左排（贴近右侧），超宽则收缩按钮宽度；提示文本放左侧并限宽
  let bw = btnW0;
  const total = items.length * (bw + gap) - gap;
  const avail = W - 16;
  if (total > avail) bw = Math.max(64, (avail - (items.length - 1) * gap) / items.length);
  let x = W - 12;
  for (let i = items.length - 1; i >= 0; i--) {
    x -= bw;
    addActionBtn(x, bw, y, items[i].label, items[i].act, items[i].enabled, items[i].col2);
    x -= gap;
  }
  if (tipTxt) {
    const tsz = 12.5;
    const maxTip = Math.max(50, avail - items.length * (bw + gap) + gap - 20);
    const f = fitText(tipTxt, maxTip, tsz);
    drawPixelText(f.text, 10, y + btnH / 2, f.size, '#DCE7F7', { shadow: false });
  }
}
let logExpanded = false;   // 日志📜折叠按钮状态（默认收起，点击展开右上角浮动面板）
let logRect = null;        // 展开时日志面板区域（点击外部自动收起）
let rowFolded = true;      // Task 6 竖屏单焦点：行区默认折叠为状态条（点击「▾ 展开」查看完整辩论台）
function renderLogs() {
  const logs = (view && view.logs) || [];
  if (!logs.length) return;
  // P2：右上角可折叠半透明浮动日志面板（不再贴底栏，不挡手牌与操作按钮）
  const panelW = Math.min(300, W - 16);
  const btnW = 34, btnH = 26;
  const bx = W - btnW - 8;
  const by = PANEL_Y + view.seatCount * (panelHeight() + 6) + 6;
  addButton('toggleLog', bx, by, btnW, btnH, logExpanded ? '✕' : '📜', {});
  if (!logExpanded) { logRect = null; return; }
  const nShow = Math.min(6, logs.length);
  const show = logs.slice(-nShow);
  const px0 = W - panelW - 8;
  const py0 = by + btnH + 4;
  const ph2 = nShow * 15 + 20;
  logRect = { x: px0, y: py0, w: panelW, h: ph2 };
  ctx.save();
  ctx.globalAlpha = 0.94;
  pxRect(px0, py0, panelW, ph2, '#101418');
  pxBorder(px0, py0, panelW, ph2, '#3A4258', 2);
  ctx.globalAlpha = 1;
  drawPixelText('📜 庭审记录', px0 + 10, py0 + 10, 12, '#FFD60A', { shadow: false });
  let yy = py0 + 24;
  show.forEach(ln => {
    const f = fitText('· ' + ln, panelW - 20, 13);
    drawPixelText(f.text, px0 + 10, yy, f.size, '#DCE6F5', { shadow: false });
    yy += 15;
  });
  ctx.restore();
}

/* ---------------- 屏幕渲染：结算（gameover） ---------------- */
function drawCourthouse(x, y, s) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#111111'; ctx.lineWidth = 2; ctx.lineJoin = 'miter';
  // 主楼（法院门廊）
  ctx.fillRect(-70, -40, 140, 40); ctx.strokeRect(-70, -40, 140, 40);
  // 中央凸出
  ctx.fillRect(-22, -64, 44, 64); ctx.strokeRect(-22, -64, 44, 64);
  // 三角楣顶（法庭山墙）
  ctx.beginPath(); ctx.moveTo(-30, -64); ctx.lineTo(0, -92); ctx.lineTo(30, -64); ctx.closePath(); ctx.fill(); ctx.stroke();
  // 天平徽（楣顶中央）
  ctx.fillRect(-1, -100, 2, 10); ctx.strokeRect(-1, -100, 2, 10);
  ctx.beginPath(); ctx.moveTo(-12, -100); ctx.lineTo(12, -100); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-12, -100); ctx.lineTo(-9, -106); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(12, -100); ctx.lineTo(9, -106); ctx.stroke();
  // 立柱
  ctx.fillStyle = '#FFFFFF';
  for (let i = -3; i <= 3; i++) { ctx.fillRect(i * 18 - 3, -40, 6, 36); ctx.strokeRect(i * 18 - 3, -40, 6, 36); }
  // 台阶
  ctx.fillStyle = '#0E8A5F';
  ctx.fillRect(-90, 0, 180, 8); ctx.strokeRect(-90, 0, 180, 8);
  ctx.restore();
}
function renderOver() {
  buttons = [];
  hoverCards = [];
  ctx.clearRect(0, 0, W, H);
  pxRect(0, 0, W, H, PAL.draft.a);
  if (!view) return;
  const win = view.winner != null ? view.seats[view.winner] : view.seats.slice().sort((a, b) => b.support - a.support || a.seat - b.seat)[0];
  drawCourthouse(W / 2, H * 0.30, 1.6);
  const winSide = win.side ? (win.side === 'prosecutor' ? '检方' : '辩护方') : '';
  drawPixelText('🏆 ' + win.name + (winSide ? '（' + winSide + '）' : '') + ' 胜诉！', W / 2, H * 0.50, 46, '#FFD400', { align: 'center' });
  // 胜利类型说明（先例胜利 / 陪审团否决 / 常规倾向）
  let winSub = '—— 最终陪审团倾向 ——';
  if (view.winType === 'precedent') winSub = '⚖️ 先例胜利：判例已确立，后世以此为鉴';
  else if (view.winType === 'juryNull') winSub = '🕊️ 陪审团否决：人民拒绝适用恶法';
  drawPixelText(winSub, W / 2, H * 0.50 + 40, 16, winSub === '—— 最终陪审团倾向 ——' ? '#FFFFFF' : '#FFD400', { align: 'center' });
  drawPixelText('—— 最终陪审团倾向 ——', W / 2, H * 0.585, 18, '#FFFFFF', { align: 'center' });
  // #13 种子码（可复现，分享战绩用；显示用户输入原串 seedRaw，留空显示随机数字）
  const seedShow = view.seedRaw != null ? view.seedRaw : view.seed;
  if (seedShow != null) drawPixelText('🌱 种子 ' + seedShow, W - 20, H * 0.585, 13, '#C9D6EA', { align: 'right', shadow: false });
  const order = view.seats.slice().sort((a, b) => b.support - a.support || a.seat - b.seat);
  let y = Math.min(H * 0.635, H - 130 - order.length * 46);   // S4：4 人局整体上移，避免与“返回大厅”按钮重叠
  order.forEach((s, i) => {
    pxRect(W / 2 - 180, y - 16, 360, 40, i === 0 ? campColor(s.seat) : PAL.ui.b);
    pxBorder(W / 2 - 180, y - 16, 360, 40, '#111111', 2);
    pxRect(W / 2 - 170, y - 6, 300, 8, '#DDD5BC');
    pxBorder(W / 2 - 170, y - 6, 300, 8, '#111111', 1);
    pxRect(W / 2 - 168, y - 4, Math.max(3, 296 * Math.min(1, s.support / 14)), 4, campColor(s.seat));
    drawPixelText((i + 1) + '. ' + s.name + '  ' + s.support + ' 倾向', W / 2, y - 16, 16, i === 0 ? contrast(campColor(s.seat)) : '#111111', { align: 'center' });
    y += 46;
  });
  // 窄屏收缩：按钮宽度/间距按 W 自适应，避免出屏（P1 修复）
  let cbx = W / 2 - 340, bbx = W / 2 - 110, cbw = 220;
  if (W < 700) {
    cbw = Math.min(220, (W - 30) / 2);
    const cgap = Math.max(8, (W - cbw * 2 - 20) / 3);
    cbx = Math.max(10, W / 2 - (cbw * 2 + cgap) / 2);
    bbx = cbx + cbw + cgap;
  }
  addButton('copyReport', cbx, H - 104, cbw, 50, '📋 复制战绩', {});
  addButton('backMenu', bbx, H - 104, cbw, 50, '返回大厅', { primary: true });
}

/* #13 战绩文本快照（纯文本，可粘贴分享/复盘） */
function buildReport(seats, seedVal, winType) {
  const win = seats.slice().sort((a, b) => b.support - a.support || a.seat - b.seat)[0];
  const winSide = win.side ? (win.side === 'prosecutor' ? '检方' : '辩护方') : '';
  const wt = winType === 'precedent' ? '⚖️ 先例胜利' : (winType === 'juryNull' ? '🕊️ 陪审团否决' : '最终陪审团倾向');
  const lines = [
    '【合理怀疑 · 世纪审判】战报',
    '胜诉方：' + win.name + (winSide ? '（' + winSide + '）' : ''),
    '胜诉方式：' + wt,
    '种子码：' + (seedVal != null ? seedVal : '随机'),
    '—— 最终陪审团倾向 ——'
  ];
  const order = seats.slice().sort((a, b) => b.support - a.support || a.seat - b.seat);
  order.forEach((s, i) => lines.push((i + 1) + '. ' + s.name + ' — ' + s.support));
  return lines.join('\n');
}
/* #13 复制到剪贴板（clipboard API + execCommand 兜底） */
function copyText(t, okMsg) {
  const done = () => toast(okMsg || '✅ 已复制到剪贴板');
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) done(); else toast('复制失败，请手动复制', true);
    } catch (e) { toast('复制失败，请手动复制', true); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(done).catch(fallback);
  } else fallback();
}

/* ---------------- 新手教程 / 术语百科（新规则 16 步） ---------------- */
const TUTORIAL_PAGES = [
  {
    title: '如何获胜',
    body: [
      { t: 'text', s: '共进行 5 轮庭审。每轮争夺「陪审团倾向」。' },
      { t: 'text', s: '每轮按排名结算倾向：名次越高奖励越多，末位也有保底。' },
      { t: 'text', s: '5 轮结束后，倾向最高者胜诉！' },
      { t: 'term', s: '陪审团倾向', id: 'support' },
      { t: 'term', s: '排名', id: 'rank' }
    ]
  },
  {
    title: '16 步流程',
    body: [
      { t: 'text', s: '① 选律师：3 选 1，同时亮出。' },
      { t: 'text', s: '② 定起始：第 1 轮随机，之后由上轮垫底者选。' },
      { t: 'text', s: '③ 抽事件牌：从起始者起每人 1 张。' },
      { t: 'text', s: '④ 抽证据：每人补满证物架（初始 4 份）。' },
      { t: 'text', s: '⑤ 取证：传唤/留证/换证。' },
      { t: 'text', s: '⑥ 暗置举证：轮流各提交 1 份，可随时放弃，直到无牌。' },
      { t: 'text', s: '⑦ 亮出 → ⑧⑨ 事件与审议 → ⑩⑪ 排名结算 → ⑫ 整理 → ⑬ 酬金' },
      { t: 'term', s: '轮次', id: 'round' }
    ]
  },
  {
    title: '经济与证物架',
    body: [
      { t: 'text', s: '⊙ 是律师费/庭审资源。传唤、换证、打事件都要花 ⊙。' },
      { t: 'text', s: '传唤：点证物架卡牌，付 ⊙ 入手牌。' },
      { t: 'text', s: '留证：每轮 1 张卡下轮保留在证物架，不可连续留同一份。' },
      { t: 'text', s: '换证：花 1⊙ 换掉证物架，成本每次 +1⊙。' },
      { t: 'term', s: '证物架', id: 'market' },
      { t: 'term', s: '留证', id: 'lock' }
    ]
  },
  {
    title: '举证与亮出',
    body: [
      { t: 'text', s: '轮流举证：每回合暗置 1 张，横向一字排列。' },
      { t: 'text', s: '所有人打完后从左到右亮出。' },
      { t: 'text', s: '【证据排除】在亮出时发动：作废对方 1 份已亮证据（进档案）。' },
      { t: 'text', s: '每张证人都带独立技能：有的看左右邻位、行首行尾，有的直接加票，有的换位。' },
      { t: 'text', s: '其他技能在审议时按 ①→②→③ 顺序发动。' },
      { t: 'term', s: '证据排除', id: 'terrorist' },
      { t: 'term', s: '档案', id: 'grave' }
    ]
  },
  {
    title: '事件牌',
    body: [
      { t: 'text', s: '庭审前/庭审后各一轮事件阶段，从起始者起轮流。' },
      { t: 'text', s: '每人最多连续打出 2 张，也可选择不打出。' },
      { t: 'text', s: '事件分 ①②③ 三级：第 1 轮只有①，2-3 轮①②，4 轮起①②③。' },
      { t: 'text', s: '【敌方】类事件需要点击对手头像选择目标。' },
      { t: 'term', s: '事件牌', id: 'event' }
    ]
  },
  {
    title: '结算与排名',
    body: [
      { t: 'text', s: '审议：基础票 + 事件修正 + 技能（①→②→③ 从左到右，站位类按条件发动）。' },
      { t: 'text', s: '站位系看左右：换位、压制邻座、端点/半区加成，2 人局行首尾相邻。' },
      { t: 'text', s: '排名：票数 → ⊙ 总和 → 亮出顺序。' },
      { t: 'text', s: '差额计分：第一名最多，之后每名递减（最低 +1），不白卷。' },
      { t: 'text', s: '整理：保留 2 份。酬金：固定 2⊙（首轮启动 4⊙）；榜首 -1⊙、末位 +1⊙，每轮保底 +1⊙（连胜榜首换证 +1）。' },
      { t: 'term', s: '审议', id: 'count' }
    ]
  },
  {
    title: '封神技（③级）',
    body: [
      { t: 'text', s: '③级技能是传奇律师的招牌战术，发动条件苛刻但效果爆炸。' },
      { t: 'text', s: '合理怀疑：对方证据≥3 → 最高敌 -2。时间线狙击：对方技能证据≥2 → 最高敌 -1。' },
      { t: 'text', s: '翻转叙事：落后≥2 → 本方 +2。职业生涯赌局：+2 票，若未领先则丑闻 +1。' },
      { t: 'text', s: '确立先例：+1 票并记录先例标记——即使落后，判例也可直接胜诉。' },
      { t: 'text', s: '陪审团否决：+1 票并获得 1 名陪审员，集满 3 名立即胜诉。' },
      { t: 'term', s: '先例胜利', id: 'precedent' },
      { t: 'term', s: '陪审团否决', id: 'juryNull' }
    ]
  },
  {
    title: '三种胜诉路径',
    body: [
      { t: 'text', s: '常规：5 轮结束后倾向最高者胜诉。' },
      { t: 'text', s: '先例胜利：比赛中确立先例的一方，即使倾向落后也直接胜诉——判例重于民意。' },
      { t: 'text', s: '陪审团否决：集满 3 名陪审员支持，立即胜诉——人民拒绝适用恶法。' },
      { t: 'text', s: '注意：陪审团否决比先例更优先判定，先例又优先于常规倾向。' }
    ]
  }
];
const GLOSSARY_TAB = { tab: 'terms', page: 0 };
const TERMS = [
  { id: 'support', name: '陪审团倾向', cat: '核心', text: '决定最终胜负的累计分。每轮第一名获得倾向奖励（1-3 轮 +2，4 轮 +3，5 轮 +4），另有「倾向加成」事件可额外增加。' },
  { id: 'rank', name: '排名', cat: '核心', text: '每轮按票数 → ⊙ 总和 → 亮出顺序排名。票数相同比 ⊙ 总和，再相同比座位靠前。' },
  { id: 'round', name: '轮次', cat: '核心', text: '一局共 5 轮。第 1 轮起始玩家随机，之后由上一轮排名最低者指定。' },
  { id: 'market', name: '证物架', cat: '经济', text: '每名律师的私有证物架（初始 4 份，金牌大状 5 份）。每轮保留上轮留证的牌，其余洗回牌堆并补抽。' },
  { id: 'lock', name: '留证', cat: '经济', text: '取证阶段可留证 1 份证物架牌（务实派律师 2 份），下轮保留在证物架。不能连续两轮留证同一份。' },
  { id: 'refresh', name: '换证', cat: '经济', text: '花 1⊙ 重新抽取证物架（成本每次 +1⊙）。留证牌不受换证影响。' },
  { id: 'terrorist', name: '证据排除', cat: '证据', text: '① 级技能牌，亮出阶段发动：从对方已亮出的牌中作废 1 张。被作废的牌进档案，永不洗回牌堆。' },
  { id: 'grave', name: '档案', cat: '核心', text: '被【移除】的牌进入的区域。档案的牌不参与后续任何结算，也不洗回牌堆。' },
  { id: 'event', name: '事件牌', cat: '事件', text: '庭审前/后各一轮的事件阶段使用。每人最多连续打出 2 张。第 1 轮可用①级，2-3 轮①②级，4 轮起①②③级。' },
  { id: 'count', name: '审议', cat: '核心', text: '基础票（每张未移除的牌投其票数）→ 庭审前事件修正 → 角色被动 → 技能按 ①→②→③ 顺序、行内从左到右发动。站位类技能（端点、左右半区、邻位）在审议时按条件判定。' },
  { id: 'draft', name: '律师身份', cat: '核心', text: '开局 3 选 1 的律师身份，提供被动技能：起始 ⊙+2、传唤折扣、换证折扣、证物架 +1 槽、审议 +1 票、留证上限 2 等。' },
  { id: 'income', name: '分发⊙', cat: '经济', text: '每轮结束全体获得固定 2⊙（首轮启动直接发 4⊙；此后榜首 -1⊙、末位 +1⊙，每轮保底 +1⊙）。' },
  { id: 'precedent', name: '先例胜利', cat: '胜利', text: '打出「确立先例」技能牌后记录先例标记。比赛结束时，若该方触发过先例事件则直接胜诉，即使倾向落后。源于英美法系「遵循先例」（stare decisis）原则：判例一旦确立，后世庭审必须遵循。' },
  { id: 'juryNull', name: '陪审团否决', cat: '胜利', text: '打出「陪审团否决」技能牌可获得 1 名陪审员支持，集满 3 名立即胜诉。源于陪审团否决（Jury Nullification）制度：陪审团可以拒绝适用他们认为不正义的法律。历史上 Zenger 案（1735）和 William Penn 案（1670）均是陪审团否决的著名案例。' }
];
function termPopupData(pp) {
  if (!pp) return null;
  if (pp.kind === 'skill') {
    const sk = ElectionCore.data.SKILLS[pp.id];
    if (!sk) return null;
    return { title: sk.name, cat: '技能 · ' + lvMark(sk.lv), body: sk.desc };
  }
  const t = TERMS.find(x => x.id === pp.id);
  if (!t) return null;
  return { title: t.name, cat: t.cat, body: t.text };
}
function drawHelp() {
  ctx.clearRect(0, 0, W, H);
  pxRect(0, 0, W, H, '#0F1B2D');
  const pg = TUTORIAL_PAGES[helpPage || 0];
  drawPixelText('新 手 教 程', W / 2, 36, 28, '#FF3B30', { align: 'center' });
  drawPixelText('第 ' + ((helpPage || 0) + 1) + ' / ' + TUTORIAL_PAGES.length + ' 页 · ← → 翻页', W / 2, 64, 13.5, '#C9D6EA', { align: 'center' });
  const cw = Math.min(660, W * 0.88), chh = Math.min(360, H * 0.56);
  const cx0 = W / 2 - cw / 2, cy0 = H * 0.13;
  pxRect(cx0, cy0, cw, chh, '#ffffff');
  pxBorder(cx0, cy0, cw, chh, '#2b2b2b', 3);
  drawPixelText(pg.title, W / 2, cy0 + 46, 23, '#2e2618', { align: 'center', shadow: false });
  let ty = cy0 + 94;
  for (const it of pg.body) {
    if (it.t === 'term') {
      const tw = Math.round(15 * (it.s.length + 2) * 0.66);
      const tx = W / 2 - tw / 2;
      // 金色高亮块 = 可点击术语（不再是细下划线）
      pxRect(tx - 8, ty - 15, tw + 16, 30, '#ffe9a8');
      pxBorder(tx - 8, ty - 15, tw + 16, 30, '#b8860b', 2);
      drawPixelText(it.s + ' ？', W / 2, ty, 15, '#b34a2c', { align: 'center', shadow: false });
      termHits.push({ x: tx - 8, y: ty - 15, w: tw + 16, h: 30, kind: 'term', id: it.id });
      ty += 34;
    } else {
      drawPixelText(it.s, W / 2, ty, 15, '#2e2618', { align: 'center', shadow: false });
      ty += 28;
    }
  }
  const bwd = 150, bhd = 40, byy = H - 66;
  addButton('helpPrev', W / 2 - bwd - 12, byy, bwd, bhd, '上 一 页', { disabled: (helpPage || 0) === 0 });
  addButton('helpNext', W / 2 + 12, byy, bwd, bhd, '下 一 页', { disabled: (helpPage || 0) >= TUTORIAL_PAGES.length - 1 });
  addButton('glossary', W / 2 - 60, byy - 96, 120, 36, '术语百科');
  addButton('back', W / 2 - 60, byy - 52, 120, 34, '返 回');
}
function drawGlossary() {
  ctx.clearRect(0, 0, W, H);
  pxRect(0, 0, W, H, '#0F1B2D');
  drawPixelText('术 语 百 科', W / 2, 36, 28, '#FF3B30', { align: 'center' });
  drawPixelText('点击术语查看解释 · 技能页可查看全部证人/证据技能 · ← → 翻页', W / 2, 66, 13.5, '#C9D6EA', { align: 'center' });
  const tabs = [['terms', '术 语'], ['skills', '技 能']];
  const tabW = 130, tabH = 40;
  tabs.forEach((t, i) => {
    const x = W / 2 - (tabW * 2 + 12) / 2 + i * (tabW + 12);
    const active = GLOSSARY_TAB.tab === t[0];
    pxRect(x, 86, tabW, tabH, active ? '#FF3B30' : '#ffffff');
    pxBorder(x, 86, tabW, tabH, '#2b2b2b', active ? 3 : 2);
    drawPixelText(t[1], x + tabW / 2, 86 + tabH / 2 + 1, 15, active ? '#ffffff' : '#2b2b2b', { align: 'center', shadow: false });
    addButton('glTab_' + t[0], x, 86, tabW, tabH, '');
  });
  const terms = TERMS;
  const skills = Object.keys(ElectionCore.data.SKILLS);
  const rowH = 66, gap = 10;
  const y0 = 140, availH = H - 140 - 104;
  const maxRows = Math.max(1, Math.floor((availH + gap) / (rowH + gap)));
  const perPage = GLOSSARY_TAB.tab === 'terms' ? Math.min(5, maxRows) : Math.min(9, maxRows);
  const total = GLOSSARY_TAB.tab === 'terms' ? terms.length : skills.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  GLOSSARY_TAB.page = Math.min(GLOSSARY_TAB.page, pages - 1);
  let y = y0;
  if (GLOSSARY_TAB.tab === 'terms') {
    terms.slice(GLOSSARY_TAB.page * perPage, (GLOSSARY_TAB.page + 1) * perPage).forEach(t => {
      const x = W / 2 - 320;
      pxRect(x, y, 640, rowH, '#ffffff');
      pxBorder(x, y, 640, rowH, '#2b2b2b', 2);
      drawPixelText(t.name, x + 18, y + 20, 16, '#FF3B30', { shadow: false });
      drawPixelText(t.cat, x + 18, y + 46, 12, '#a8720f', { shadow: false });
      drawWrapText(t.text, x + 132, y + rowH / 2, 13.5, '#2e2618', 492, 18);
      termHits.push({ x: x + 16, y, w: 110, h: rowH, kind: 'term', id: t.id });
      y += rowH + gap;
    });
  } else {
    skills.slice(GLOSSARY_TAB.page * perPage, (GLOSSARY_TAB.page + 1) * perPage).forEach(k => {
      const x = W / 2 - 320;
      pxRect(x, y, 640, rowH, '#ffffff');
      pxBorder(x, y, 640, rowH, '#2b2b2b', 2);
      const sk = ElectionCore.data.SKILLS[k];
      drawPixelText((sk ? sk.name + ' ' + lvMark(sk.lv) : k), x + 18, y + 20, 14, '#2f6fd8', { shadow: false });
      drawWrapText(sk ? sk.desc : '', x + 18, y + 48, 12.5, '#2e2618', 604, 16);
      termHits.push({ x, y, w: 640, h: rowH, kind: 'skill', id: k });
      y += rowH + gap;
    });
  }
  addButton('glPrev', W / 2 - 210, H - 64, 100, 38, '上 一 页', { disabled: GLOSSARY_TAB.page === 0 });
  addButton('glNext', W / 2 + 110, H - 64, 100, 38, '下 一 页', { disabled: GLOSSARY_TAB.page >= pages - 1 });
  drawPixelText((GLOSSARY_TAB.page + 1) + ' / ' + pages, W / 2, H - 45, 12.5, '#C9D6EA', { align: 'center' });
  addButton('back', W / 2 - 110, H - 100, 220, 36, '返 回');
}
function drawTermPopup() {
  const pp = termPopup;
  if (!pp) return;
  const data = termPopupData(pp);
  if (!data) { termPopup = null; return; }
  const w = Math.min(460, W - 24), pad = 16;
  const lines = data.body.split('\n');
  const lh = 22, bh = pad * 2 + 36 + lines.length * lh;
  const x = clamp(W / 2 - w / 2, 8, W - w - 8);
  const y = clamp(H / 2 - bh / 2, 8, H - bh - 8);
  pxRect(x, y, w, bh, '#ffffff');
  pxBorder(x, y, w, bh, '#2b2b2b', 3);
  pxRect(x, y, w, 36, '#FF3B30');
  drawPixelText((data.cat ? data.cat + ' · ' : '') + data.title, x + w / 2, y + 19, 16, '#ffffff', { align: 'center', shadow: false });
  lines.forEach((ln, i) => drawWrapText(ln, x + pad, y + 50 + i * lh + lh / 2, 14.5, '#2e2618', w - pad * 2, lh));
  addButton('termClose', x + w - 32, y + 5, 28, 26, '✕');
}

/* ---------------- 调试面板 ---------------- */
function drawDebugPanel() {
  const g = view;
  if (!g) return;
  const lines = [
    'phase: ' + (g.phase != null ? g.phase : '-'),
    'turn: ' + (g.turn != null ? g.turn : '-'),
    'seat: ' + (mySeat != null ? mySeat : '-'),
    'version: ' + (g.version != null ? g.version : '-'),
    'round: ' + (g.round != null ? g.round : '-')
  ];
  const pw = 128, lh = 13, pad = 6;
  const ph = lines.length * lh + pad * 2;
  const x = W - pw - 8, y = 8;
  ctx.save();
  ctx.fillStyle = 'rgba(20,20,28,0.72)';
  ctx.fillRect(x, y, pw, ph);
  ctx.strokeStyle = '#3a342a';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.75, y + 0.75, pw - 1.5, ph - 1.5);
  ctx.font = '10px monospace';
  ctx.textBaseline = 'middle';
  lines.forEach((ln, i) => {
    ctx.fillStyle = '#b8e994';
    ctx.fillText(ln, x + pad, y + pad + i * lh + lh / 2);
  });
  ctx.restore();
}

/* ---------------- 悬浮信息卡 Tooltip ---------------- */
// 悬停状态机：dir=1 淡入（hover 命中），dir=0 淡出（鼠标移开）
let hoverAnim = { card: null, t0: 0, dir: 1 };
var hoverRect = null;   // 上一帧放大卡的屏幕矩形（var 挂 window，供 render-core.js 读写）
// updateHoverAnim / hoverAlpha 已收敛至 shared/render-core.js（薄封装见前）
/* 组装悬浮卡说明内容（按 kind 分发） */
function tooltipInfo(h) {
  const k = h.kind;
  if (k === 'char' && h.data) {
    const ch = h.data;
    const sk = ch.skill ? ElectionCore.data.SKILLS[ch.skill] : null;
    const lines = [ch.desc];
    if (sk) lines.push('【' + lvMark(sk.lv) + sk.name + '】' + sk.desc);
    return { title: ch.name, catCol: campColor(mySeat), lines, extra: ['起始资金 ⊙' + (ch.skill && ch.skill.type === 'startMoney' ? 4 + ch.skill.v : 4)] };
  }
  if (k === 'charSkill' && h.data && h.data.ch) {
    const ch = h.data.ch;
    const sk = ch.skill ? ElectionCore.data.SKILLS[ch.skill] : null;
    if (!sk) return null;
    return { title: ch.name + ' · ' + sk.name, catCol: '#c98a1b', lines: [sk.desc], extra: ['技能等级 ' + lvMark(sk.lv)] };
  }
  if (k === 'event' && h.data && h.data.ev) {
    const ev = h.data.ev;
    const effTxt = ev.eff ? (ev.eff.type === 'vote' ? (ev.eff.val > 0 ? '+' : '−') + Math.abs(ev.eff.val) + ' 票' : ev.eff.type === 'money' ? (ev.eff.val > 0 ? '+' : '−') + Math.abs(ev.eff.val) + ' ⊙' : ev.eff.type === 'support' ? '倾向 ' + (ev.eff.val > 0 ? '+' : '') + ev.eff.val : '全体加成') : '';
    return { title: ev.name, catCol: '#7A0E0E', lines: [ev.desc], extra: [(ev.timing === 'pre' ? '庭审前' : '庭审后') + ' · ' + lvMark(ev.lv) + (effTxt ? ' · 效果 ' + effTxt : '')] };
  }
  const card = h.card || (h.data && (h.data.card || h.data.ev));
  if (card && card.votes !== undefined) {
    const sk = card.skill ? ElectionCore.data.SKILLS[card.skill] : null;
    const lines = [];
    if (sk) lines.push('【' + lvMark(sk.lv) + sk.name + '】' + (card.desc || sk.desc));   // 优先用牌面文案
    else lines.push('铁证证词：稳定提供票数');
    const fv = flavorName(card);
    if (fv) lines.push('— ' + fv + ' —');
    return { title: card.name, catCol: '#0E8A5F', lines, extra: ['⚖ ' + card.votes + ' 票' + (card.cost != null ? ' · 传唤 ⊙' + card.cost : '')] };
  }
  if (k === 'eventTarget' || k === 'starter' || k === 'target' || k === 'swapTarget') {
    let seat = -1;
    if (h.data && h.data.targetSeat != null) seat = h.data.targetSeat;
    else if (h.data && h.data.starterSeat != null) seat = h.data.starterSeat;
    else if (h.data && h.data.targetUid != null) {
      const r2 = (view.row || []).find(r => r.card.uid === h.data.targetUid);
      if (r2) seat = r2.seat;
    }
    if (seat < 0 || !view.seats[seat]) return null;
    const s = view.seats[seat];
    const tip = k === 'eventTarget' ? '选择事件的目标玩家' : k === 'starter' ? '选择本轮起始玩家' : k === 'swapTarget' ? '点击与目标互换位置（换位技能）' : '证据排除将作废该玩家的证据';
    return { title: s.name, catCol: campColor(seat), lines: ['倾向 ' + s.support + ' · ⊙' + s.money, tip], extra: [] };
  }
  return null;
}
/* 绘制悬浮信息卡：放大 1.5 倍的卡牌 + 说明文字框（淡入淡出） */
// drawHoverTooltip 已收敛至 shared/render-core.js（薄封装见前）

/* ---------------- 渲染调度 ---------------- */
function render() {
  buttons = [];
  hoverCards = [];
  termHits = [];
  // P1-8：投影 ViewModel（防御性：UIPresenter 加载失败时 vm=null，渲染降级）
  vm = (typeof UIPresenter !== 'undefined' && view) ? UIPresenter.project(view, { mySeat, compact, W, H, deadline }) : null;
  if (screen === 'help') { drawHelp(); if (DEBUG) drawDebugPanel(); return; }
  if (screen === 'glossary') { drawGlossary(); if (DEBUG) drawDebugPanel(); return; }
  if (!view) return;
  if (screen === 'draft') renderDraft();
  else if (screen === 'game') renderGame();
  else if (screen === 'over') renderOver();
  // 对手思考遮罩（AI 行动中，最上层）：半透明深色遮罩 + 金色思考提示
  if (screen === 'game' && thinkSeat >= 0 && thinkSeat !== mySeat && view && !view.gameOver) {
    ctx.save();
    ctx.fillStyle = 'rgba(10,14,24,0.45)';
    ctx.fillRect(0, 0, W, H);
    drawPixelText('🤔 ' + ((view.seats[thinkSeat] && view.seats[thinkSeat].name) || '对手') + ' 思考中…', W / 2, H * 0.42, 22, '#FFD60A', { align: 'center' });
    ctx.restore();
  }
  if (termPopup) drawTermPopup();
  updateHoverAnim();
  drawHoverTooltip();
  if (DEBUG) drawDebugPanel();
}

/* ---------------- 输入 ---------------- */
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * W / r.width;   // S1：命中区用逻辑坐标，勿乘 canvas.width（物理像素=W*DPR）
  mouse.y = (e.clientY - r.top) * H / r.height;
  const pad = isMobile ? 7 : 0;
  const overBtn = buttons.some(b => !b.disabled && mouse.x >= b.x - pad && mouse.x <= b.x + b.w + pad && mouse.y >= b.y - pad && mouse.y <= b.y + b.h + pad);
  const overCard = hoverCards.some(h => mouse.x >= h.x - pad && mouse.x <= h.x + h.w + pad && mouse.y >= h.y - pad && mouse.y <= h.y + h.h + pad);
  const over = overBtn || overCard;
  const nowT = performance.now();
  if (over && !hoverTickOn && nowT - hoverTickT > 180) { hoverTickOn = true; hoverTickT = nowT; sfx('hover'); }  // 悬停滴答（节流防连发）
  if (!over) hoverTickOn = false;
  canvas.style.cursor = over ? 'pointer' : 'default';
});
canvas.addEventListener('click', () => {
  if (Date.now() - lastTouchTime < 600) return;
  onClick();
});
// P1：触控三阶段 —— touchstart 只记录起点，位移>10px 视为滑动取消，touchend 触发点击；长按不触发
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  if (!touch) return;
  const r = canvas.getBoundingClientRect();
  touchStart = { x: touch.clientX, y: touch.clientY, t: Date.now() };
  mouse.x = (touch.clientX - r.left) * W / r.width;
  mouse.y = (touch.clientY - r.top) * H / r.height;
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  if (!touch || !touchStart) return;
  const dy = touch.clientY - touchStart.y;
  const dx = touch.clientX - touchStart.x;
  if (Math.hypot(dx, dy) > 10) {
    // 竖屏手牌抽屉：纵向滑动翻页（超级更新#37）；普通点击流程取消
    if (portraitMode && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 24) {
      const showHand = view && (view.phase === 'play' || view.phase === 'discard') && view.seats[mySeat] && view.seats[mySeat].hand && view.seats[mySeat].hand.length;
      if (showHand) {
        const maxPage = Math.max(0, Math.ceil(view.seats[mySeat].hand.length / PORTRAIT_PER_PAGE) - 1);
        if (dy < 0) handScroll = Math.min(maxPage, handScroll + 1);
        else handScroll = Math.max(0, handScroll - 1);
        touchStart = null;   // 已作为滑动处理，不触发点击
        return;
      }
    }
    touchStart = null;
  }
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  const wasTap = !!touchStart;              // 滑动过（touchmove 已置 null）→ 不算点击
  const dt = wasTap ? Date.now() - touchStart.t : 0;
  touchStart = null;
  lastTouchTime = Date.now();               // P0：滑动后也更新 → 屏蔽系统随后合成的 click（滑动不再误触）
  if (!wasTap) return;
  if (dt > 700) return;                     // 长按：留给系统手势
  onClick();
}, { passive: false });
// P1：长按禁用系统菜单（触屏长按弹选择/缩放）
canvas.addEventListener('contextmenu', e => e.preventDefault());
// iOS 系统手势（双击缩放/捏合）禁用
if ('ongesturestart' in window) {
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('gesturechange', e => e.preventDefault());
}

function onClick() {
  // P1：触屏命中目标最小 44×44（以目标中心扩展——相邻小目标不会因双向扩张而重叠）
  const hit = r => {
    if (isMobile) {
      const tw = Math.max(44, r.w), th = Math.max(44, r.h);
      return mouse.x >= r.x - (tw - r.w) / 2 && mouse.x <= r.x + r.w + (tw - r.w) / 2 &&
             mouse.y >= r.y - (th - r.h) / 2 && mouse.y <= r.y + r.h + (th - r.h) / 2;
    }
    return mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h;
  };
  // 按钮优先于弹窗关闭
  const btn = buttons.find(b => !b.disabled && hit(b));
  if (btn) {
    if (termPopup) termPopup = null;
    btnFlash[btn.id] = 1;   // P1：点击闪光反馈
    haptic(12);             // 移动端震动反馈（桌面无此 API 自动忽略）
    handleButton(btn.id);
    return;
  }
  if (termPopup) { termPopup = null; return; }
  // P1：点击日志面板外部 → 收起（面板内部非按钮区域保持展开）
  if (logExpanded && logRect && !hit(logRect)) { logExpanded = false; return; }
  const th = termHits.find(hit);
  if (th) { termPopup = { kind: th.kind, id: th.id }; return; }
  const hc = hoverCards.find(hit);
  if (hc) handleCard(hc);
}
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'Escape') {
    if (termPopup) { termPopup = null; return; }
    // #109 关于弹窗（HTML overlay）优先关闭
    const aboutEl = $('about');
    if (aboutEl && !aboutEl.classList.contains('hidden')) { hide('about'); return; }
    if (screen === 'help' || screen === 'glossary') { handleButton('back'); return; }
    if (screen === 'game') { selected = []; eventPick = null; toast('已取消选择'); }
    return;
  }
  // 教程 / 术语百科：← → 翻页
  if (screen === 'help') {
    if (e.key === 'ArrowLeft') { handleButton('helpPrev'); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { handleButton('helpNext'); e.preventDefault(); }
    return;
  }
  if (screen === 'glossary') {
    if (e.key === 'ArrowLeft') { handleButton('glPrev'); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { handleButton('glNext'); e.preventDefault(); }
    return;
  }
  const g = view;
  if (!g) return;
  const me = mySeatObj();
  if (!me) return;
  if (screen === 'draft' && g.phase === 'pickChar' && !me.char) {
    if (e.key >= '1' && e.key <= '3') {
      const idx = parseInt(e.key, 10) - 1;
      const cand = (g.draftCandidates || [])[idx];
      if (cand) doAction({ type: 'pickChar', charId: cand.id });
    }
    return;
  }
  if (screen !== 'game') return;
  if (g.phase === 'buy' && !me.buyDone) {
    if (e.key === 'r' || e.key === 'R') { handleButton('refresh'); e.preventDefault(); }
    if (e.key === 'b' || e.key === 'B') { handleButton('endBuy'); e.preventDefault(); }
    if (e.key >= '1' && e.key <= '4') {
      const mi = parseInt(e.key, 10) - 1;
      const m = (me.market || [])[mi];
      if (m) handleCard({ kind: 'market', data: { card: m, uid: m.uid } });
      e.preventDefault();
    }
  } else if (g.phase === 'play' && g.turn === mySeat && !me.playDone) {
    if (e.key === 'Enter' || e.key === ' ') {
      if (selected.length > 0) handleButton('playSel');
      e.preventDefault();
    }
    if (e.key === 'p' || e.key === 'P') { handleButton('finishPlay'); e.preventDefault(); }
  } else if ((g.phase === 'preEvent' || g.phase === 'postEvent') && g.eventTurnSeat === mySeat) {
    if (e.key === 'Enter' || e.key === ' ') { handleButton('passEvent'); e.preventDefault(); }
    if (eventPick && eventPick.seat === mySeat && eventPick.target < 0 && e.key >= '1' && e.key <= '4') {
      const t = parseInt(e.key, 10) - 1;
      if (t !== mySeat && t < g.seatCount) {
        eventPick.target = t;
        toast('已选择目标：' + g.seats[t].name);
        sfx('click');
      }
      e.preventDefault();
    }
  } else if (g.phase === 'reveal' && g.revealPending && g.revealPending.owner === mySeat) {
    if (e.key >= '1' && e.key <= '9') {
      const cands = (g.row || []).filter(r => r.revealed && !r.removed && r.seat !== mySeat);
      const t = cands[parseInt(e.key, 10) - 1];
      if (t) doAction({ type: 'terroristTarget', targetUid: t.card.uid });
      e.preventDefault();
    }
  } else if (g.phase === 'discard' && g.discardSeat === mySeat && !me.keepDone) {
    if (e.key === 'Enter' || e.key === ' ') {
      if (selected.length >= Math.min(keepMax(), me.hand.length)) handleButton('finishKeep');
      e.preventDefault();
    }
  }
});

function handleButton(id) {
  const g = view;
  switch (id) {
    case 'help': screen = 'help'; helpPage = 0; hide('menu'); show('game'); break;
    case 'glossary': screen = 'glossary'; GLOSSARY_TAB.tab = 'terms'; GLOSSARY_TAB.page = 0; hide('menu'); show('game'); break;
    case 'helpPrev': helpPage = Math.max(0, (helpPage || 0) - 1); break;
    case 'helpNext': helpPage = Math.min(TUTORIAL_PAGES.length - 1, (helpPage || 0) + 1); break;
    case 'glTab_terms': GLOSSARY_TAB.tab = 'terms'; GLOSSARY_TAB.page = 0; break;
    case 'glTab_skills': GLOSSARY_TAB.tab = 'skills'; GLOSSARY_TAB.page = 0; break;
    case 'glPrev': GLOSSARY_TAB.page = Math.max(0, GLOSSARY_TAB.page - 1); break;
    case 'glNext': GLOSSARY_TAB.page++; break;
    case 'termClose': termPopup = null; break;
    case 'back':
      if (screen === 'help' || screen === 'glossary') { screen = 'menu'; hide('game'); show('menu'); }
      break;
    case 'refresh': {
      const me2 = mySeatObj();
      if (me2) {
        const slots = marketSlotRects(me2);
        slots.forEach(r => addFx({ type: 'shred', x: r.x, y: r.y, w: r.w, h: r.h, dur: 680, delay: (r.x % 60) }));
        sfx('shatter');
      }
      doAction({ type: 'refreshMarket' });
      break;
    }
    case 'endBuy': sfx('click'); doAction({ type: 'endBuy' }); break;
    case 'toggleBuyMode': {
      buyMode = buyMode === 'buy' ? 'lock' : 'buy';
      toast(buyMode === 'lock' ? '🔒 留证模式：点击证物架牌可留证' : '🛒 传唤模式：点击证物架牌直接传唤');
      sfx('click');
      break;
    }
    case 'toggleLog': logExpanded = !logExpanded; sfx('click'); break;
    case 'toggleRow': rowFolded = !rowFolded; sfx('click'); break;
    case 'playSel':
      if (selected.length > 0) {
        sfx('click');
        doAction({ type: 'playCards', uids: selected.slice(0, 1) }, ack => {
          if (ack && ack.ok) { selected = []; }
        });
      }
      break;
    case 'finishPlay': sfx('click'); doAction({ type: 'finishPlay' }); selected = []; break;
    case 'passEvent': sfx('click'); doAction({ type: 'passEvent' }); eventPick = null; break;
    case 'playEventSel':
      if (eventPick && eventPick.seat === mySeat && eventPick.target >= 0) {
        doAction({ type: 'playEvent', uid: eventPick.ev.uid, targetSeat: eventPick.target }, ack => {
          if (ack && ack.ok) { eventPick = null; sfx('news'); }
        });
      }
      break;
    case 'finishKeep': {
      const g0 = view, me0 = mySeatObj();
      if (!g0 || !me0) break;
      sfx('click');
      const need = Math.min(keepMax(), me0.hand.length);
      const toKeep = selected.slice(0, need);
      const sendNext = i => {
        if (i >= toKeep.length) {
          doAction({ type: 'finishKeep' }, ack => { if (ack && ack.ok) selected = []; });
          return;
        }
        doAction({ type: 'keepCard', uid: toKeep[i] }, ack => {
          if (ack && !ack.ok) return;   // M4：保留失败则中断链，不再发送 finishKeep
          sendNext(i + 1);
        });
      };
      if (toKeep.length) sendNext(0);
      else doAction({ type: 'finishKeep' }, ack => { if (ack && ack.ok) selected = []; });
      break;
    }
    case 'continue': doAction({ type: 'continue' }); break;
    case 'handPrev': handScroll = Math.max(0, handScroll - 1); sfx('click'); break;
    case 'handNext': {
      const me0 = mySeatObj();
      const maxPg = Math.max(0, Math.ceil((me0 && me0.hand ? me0.hand.length : 0) / PORTRAIT_PER_PAGE) - 1);
      handScroll = Math.min(maxPg, handScroll + 1); sfx('click');
      break;
    }
    case 'evPrev': eventPage = Math.max(0, (eventPage || 0) - 1); sfx('click'); break;
    case 'evNext': {
      const me0 = mySeatObj();
      const maxPg = Math.max(0, Math.ceil(((me0 && me0.events) || []).length / 4) - 1);
      eventPage = Math.min(maxPg, (eventPage || 0) + 1); sfx('click');
      break;
    }
    case 'backMenu':
      if (confirm('确定要离开当前对局吗？进度将丢失。')) location.reload();
      break;
    case 'copyReport': {
      // #13 分享战绩：生成纯文本快照并复制到剪贴板（显示用户原串 seedRaw，留空显示随机数字）
      if (view) copyText(buildReport(view.seats, (view.seedRaw != null ? view.seedRaw : view.seed), view.winType), '✅ 战绩已复制，可粘贴分享');
      break;
    }
    case 'wait': break;
  }
}
function handleCard(hc) {
  const g = view;
  switch (hc.kind) {
    case 'char': doAction({ type: 'pickChar', charId: hc.data.id }); break;
    case 'starter': doAction({ type: 'pickStarter', starterSeat: hc.data.starterSeat }); break;
    case 'target': doAction({ type: 'terroristTarget', targetUid: hc.data.targetUid }); break;
    case 'swapTarget': doAction({ type: 'swapTarget', targetUid: hc.data.targetUid }); break;
    case 'market': {
      const me = mySeatObj();
      if (g.phase !== 'buy' || !me || me.buyDone) return;
      const slots = marketSlotRects(me);
      const slot = slots.find(x => x.card.uid === hc.data.uid);
      if (buyMode === 'lock') {
        if (slot) {
          const locked = (me.lockedUids || []).indexOf(hc.data.uid) >= 0;
          if (locked) addFx({ type: 'float', x: slot.x + slot.w / 2, y: slot.y, text: '解锁', col: '#FFD400', size: 16, dur: 700 });
          else addFx({ type: 'chain', x: slot.x, y: slot.y, w: slot.w, h: slot.h, dur: 800 });
        }
        sfx('click');
        doAction({ type: 'lockCard', uid: hc.data.uid });
      } else {
        const hl = handLayout();
        const last = hl[hl.length - 1];
        if (slot && last) addFx({ type: 'flyTo', x0: slot.x, y0: slot.y, w0: slot.w, h0: slot.h, x1: last.x, y1: last.y, w1: last.w, h1: last.h, dur: 520, card: slot.card });
        doAction({ type: 'buyCard', uid: hc.data.uid });
      }
      break;
    }
    case 'hand': onHandClick(hc.data.uid); break;
    case 'event': onEventClick(hc.data.ev); break;
    case 'eventTarget': if (eventPick) eventPick.target = hc.data.targetSeat; break;
  }
}
function onHandClick(uid) {
  const g = view, me = mySeatObj();
  if (!me) return;
  if (g.phase === 'play' && g.turn === mySeat && !me.playDone) {
    const i = selected.indexOf(uid);
    if (i >= 0) selected.splice(i, 1);
    else if (selected.length < 1) selected.push(uid);
  } else if (g.phase === 'discard' && g.discardSeat === mySeat && !me.keepDone) {
    const i = selected.indexOf(uid);
    if (i >= 0) selected.splice(i, 1);
    else if (selected.length < keepMax()) selected.push(uid);
  }
}
function onEventClick(ev) {
  if (ev.target === 'enemy') {
    eventPick = { seat: mySeat, ev, target: -1 };
    toast('点击目标玩家的头像（或按 1~3）');
    sfx('click');
  } else {
    doAction({ type: 'playEvent', uid: ev.uid });
  }
}

/* ---------------- FX 差异检测（diff 触发） ---------------- */
let lastV = 0;
let sideRevealDone = false;   // 抛硬币阵营揭示只播放一次（新对局/重连时复位）
let lastPhase = '';
let lastRowSig = '';
let lastVotesSig = '';
let lastRankSig = '';
let lastMoney = [];
let lastSupport = [];
let lastHandN = [];
let lastEventsN = [];
let lastMarketSig = [];
let lastLogN = 0;
let overFxDone = false;
let lastStarterSeat = null;   // 起始玩家变化检测（轮盘 FX 触发）
let lastHandUids = [];        // 手牌 uid 快照（仅新牌播 cardIn）
let lastFxSig = '';           // 8.3 字段级快速签名：显示字段全未变时跳过全量扫描
function sigOf(arr) { return (arr || []).map((x, i) => (x.card && x.card.uid != null ? x.card.uid : 'H' + x.seat + '_' + i) + (x.removed ? ':R' : '') + (x.revealed ? ':V' : '')).join(','); }
/* 8.3 字段级 diff：覆盖 checkFxDiffs 全部触发字段（阶段/起始者/行/票/排名/财务/手牌/事件/市场/日志/结束）
 * 一次拼接完成比较——版本号变化可能源于无显示影响的内部操作，签名未变则完全跳过全量扫描。 */
function fxSigOf() {
  const seats = view.seats || [];
  let s = view.phase + '|' + view.startingSeat + '|' + view.gameOver + '|' +
    sigOf(view.row) + '|' + (view.votes || []).join(',') + '|' + (view.roundRank || []).join(',') + '|';
  for (let i = 0; i < seats.length; i++) {
    const se = seats[i];
    s += se.money + ',' + se.support + ',' + (se.hand || []).length + ',' + (se.events || []).length + ',' + (se.market || []).map(c => c.uid).join('+') + ';';
  }
  s += '|' + (view.logHead || 0) + ':' + (view.logs || []).length;
  return s;
}
function checkFxDiffs() {
  if (!view) return;
  if (view.version === lastV) return;
  if (view.version < lastV) {
    // 新对局/重连：静默对齐 diff 状态，不重放旧 FX
    lastPhase = view.phase;
    lastRowSig = sigOf(view.row); lastVotesSig = (view.votes || []).join(','); lastRankSig = (view.roundRank || []).join(',');
    lastMoney = view.seats.map(s => s.money); lastSupport = view.seats.map(s => s.support);
    lastHandN = view.seats.map(s => (s.hand || []).length); lastEventsN = view.seats.map(s => (s.events || []).length);
    lastMarketSig = view.seats.map(s => (s.market || []).map(c => c.uid).join(','));
    lastHandUids = view.seats.map(s => (s.hand || []).map(c => c.uid));
    lastLogN = (view.logHead || 0) + view.logs.length;
    overFxDone = view.gameOver;
    sideRevealDone = false;   // 新对局/重连：允许重新播放抛硬币
    lastStarterSeat = view.startingSeat;   // 新对局/重连：静默对齐起始者，不触发轮盘 FX
    lastFxSig = fxSigOf();    // 8.3：签名同步对齐，重连后首帧不触发
  }
  lastV = view.version;
  // 8.3 字段级短路：显示字段全未变（版本变化源于无显示影响操作）→ 跳过全量扫描
  const fxSig = fxSigOf();
  if (fxSig === lastFxSig) return;
  lastFxSig = fxSig;
  const n = view.seatCount;
  // 阶段变化
  if (view.phase !== lastPhase) {
    const prev = lastPhase;
    lastPhase = view.phase;
    if (view.phase === 'buy') { addFx({ type: 'phase', dur: 1100, label: '取证阶段', icon: '📜' }); sfx('swoosh'); }
    else if (view.phase === 'play') { addFx({ type: 'phase', dur: 1100, label: '举证阶段', icon: '📄' }); sfx('swoosh'); }
    else if (view.phase === 'reveal') {
      addFx({ type: 'phase', dur: 1000, label: '亮出证据', icon: '📄' }); sfx('swoosh');
      const lay = rowLayout();
      addFx({ type: 'spotlight', x0: 8, y0: lay.cy - 24, w0: W - 16, h0: lay.rh + 34, dur: 900 });
    }
    else if (view.phase === 'preEvent') { addFx({ type: 'phase', dur: 1100, label: '庭审前 · 事件', icon: '📰' }); sfx('swoosh'); }
    else if (view.phase === 'postEvent') { addFx({ type: 'phase', dur: 1100, label: '庭审后 · 事件', icon: '📰' }); sfx('swoosh'); }
    else if (view.phase === 'discard') {
      addFx({ type: 'phase', dur: 1100, label: '整理阶段', icon: '🗂' }); sfx('swoosh');
      const hl = handLayout();
      hl.forEach((it, i) => addFx({ type: 'recycle', x0: it.x + it.w / 2, y0: it.y + it.h / 2, x1: W - 120 + i * 26, y1: H - 46, w: 40, h: 56, dur: 700, delay: i * 130 }));
    }
    else if (view.phase === 'income') { addFx({ type: 'phase', dur: 1100, label: '发放酬金', icon: '💵' }); sfx('coin'); }
    else if (view.phase === 'chooseStarter') {
      addFx({ type: 'phase', dur: 1200, label: '选择起始玩家', icon: '🎯' });
      sfx('click');
    }
    else if (view.phase === 'gameover') { /* 结算屏 */ }
    else if (prev !== '' && view.phase !== 'drawVoter' && view.phase !== 'drawEvent' && view.phase !== 'count' && view.phase !== 'rank' && view.phase !== 'settle') {   // M6：瞬时自动阶段有专属 FX，避免双播
      addFx({ type: 'phase', dur: 1100, label: view.phaseLabel || view.phase, icon: '📌' });
      sfx('swoosh');
    }
  }
  // 起始玩家确定 → 轮盘（startingSeat 变化时触发，保证 winner 为新值）
  // 首次加载（lastStarterSeat 仍为 null）只对齐不触发，避免开局误播
  if (lastStarterSeat === null) lastStarterSeat = view.startingSeat;
  else if (view.startingSeat !== lastStarterSeat && view.phase !== 'pickChar') {
    lastStarterSeat = view.startingSeat;
    if (view.round >= 1) {
      const seats = view.seats.map(s2 => ({ name: s2.name, col: campColor(s2.seat) }));
      addFx({ type: 'wheel', dur: 2100, cx: W / 2, cy: H * 0.25, r: 70, seats, winner: view.startingSeat });
      sfx('click');
    }
  }
  // 行牌：翻面 / 新增暗置 / 移除
  const rsig = sigOf(view.row);
  if (rsig !== lastRowSig) {
    const prevMap = {};
    if (lastRowSig) lastRowSig.split(',').forEach(s2 => { const p2 = s2.split(':'); prevMap[p2[0]] = s2; });
    const prevRevealed = new Set(lastRowSig ? lastRowSig.split(',').filter(s2 => s2.includes(':V')).map(s2 => s2.split(':')[0]) : []);
    const newRevealed = (view.row || []).filter(r => r.revealed && !r.removed && !prevRevealed.has(String(r.card.uid)));
    if (newRevealed.length) {
      const cnt = (view.row || []).filter(r => r.revealed && !r.removed).length;
      addFx({ type: 'flipSeq', dur: Math.max(1200, cnt * 140 + 300) });
      sfx('flip');
    }
    const rowLay = rowLayout();
    (view.row || []).forEach((r, ri) => {
      const uid = r.card.uid;
      // 对手暗置牌（makeView 隐藏 uid）用 sigOf 的 H 签名匹配
      const ps = uid != null ? prevMap[String(uid)] : prevMap['H' + r.seat + '_' + ri];
      const it = rowLay.items[ri];
      if (!it) return;
      if (!ps && view.phase === 'play') {
        if (uid != null) {
          // 出牌：从手牌抛物线飞向辩论台（0.4s）+ 落台金色高亮
          const hl = handLayout();
          const sit = hl.find(x2 => x2.card.uid === uid);
          if (sit) {
            addFx({ type: 'flyTo', x0: sit.x + sit.w / 2 - 44, y0: sit.y + sit.h / 2 - 30, w0: 88, h0: 60, x1: it.x, y1: it.y, w1: it.w, h1: it.h, card: r.seat === mySeat ? r.card : null, landGlow: true, dur: 430 });
            sfx('swoosh');
          } else {
            addFx({ type: 'cardIn', x: it.x, y: it.y, w: it.w, h: it.h, dur: 380 });
          }
        } else {
          // 对手暗置：背面浮现
          addFx({ type: 'cardIn', x: it.x, y: it.y, w: it.w, h: it.h, dur: 380 });
        }
      }
      if (r.removed && ps && !ps.includes(':R')) {
        addFx({ type: 'boom', x: it.x, y: it.y, w: it.w, h: it.h });
        addFx({ type: 'confetti', x: it.x + it.w / 2, y: it.y, dur: 1300, col: '#E6392F', seed: (uid != null ? uid : ri) % 97 });
        addFx({ type: 'tombstone', x: it.x, y: it.y, w: it.w, h: it.h, dur: 1400, delay: 400 });
        shakeAmp = Math.max(shakeAmp, 12);
        sfx('boom');
      }
    });
    lastRowSig = rsig;
  }
  // 计票结果
  const vsig = (view.votes || []).join(',');
  if (vsig !== lastVotesSig && vsig !== '' && view.round > 0) {
    lastVotesSig = vsig;
    addFx({ type: 'count', dur: 1700, votes: view.votes.slice(), cols: view.seats.map((_, i) => campColor(i)), names: view.seats.map(s => s.name) });
    const skRows = (view.row || []).filter(r => !r.removed && r.card.skill && SKILL_FX[r.card.skill]);
    skRows.sort((a, b) => (SKILLS_LV(a.card.skill) - SKILLS_LV(b.card.skill)) || 0);
    const lay = rowLayout();
    skRows.forEach((r, i) => {
      const it = lay.items.find(x => x.card.uid === r.card.uid);
      if (!it) return;
      const fx = SKILL_FX[r.card.skill];
      addFx({ type: 'pulse', uid: r.card.uid, x: it.x, y: it.y, w: it.w, h: it.h, col: fx.col, dur: 500, delay: i * 220 });
      addFx({ type: 'float', x: it.x + it.w / 2, y: it.y + 6, text: fx.txt, col: fx.col, size: 14, dur: 900, delay: i * 220 });
    });
    if (skRows.length) sfx('star');
  }
  // 排名
  const rs2 = (view.roundRank || []).join(',');
  if (rs2 !== lastRankSig && rs2 !== '') {
    lastRankSig = rs2;
    const order = view.roundRank.map((s2, i) => ({ seat: s2, name: view.seats[s2].name, col: campColor(s2) }));
    addFx({ type: 'podium', dur: 1800, order });
    const pr = panelRect(view.roundRank[0]);
    addFx({ type: 'confetti', x: pr.x + pr.w / 2, y: pr.y + 20, dur: 1600, seed: 5, n: 50 });
    sfx('star');
  }
  // 金币变化
  view.seats.forEach((s, i) => {
    if (lastMoney[i] !== undefined && lastMoney[i] !== s.money) {
      const pr = panelRect(i);
      const d = s.money - lastMoney[i];
      addFx({ type: 'coin', x: pr.x + pr.w * 0.18, y: pr.y + pr.h / 2 - 8, text: (d >= 0 ? '+' : '') + d + '⊙', dur: 900 });
    }
    lastMoney[i] = s.money;
  });
  // 支持度变化
  view.seats.forEach((s, i) => {
    if (lastSupport[i] !== undefined && lastSupport[i] !== s.support) {
      const pr = panelRect(i);
      const d = s.support - lastSupport[i];
      if (d > 0) {
        addFx({ type: 'star', x: pr.x + pr.w * 0.18, y: pr.y + pr.h / 2 + 4, text: '+' + d, size: 22, dur: 1100 });
        addFx({ type: 'flow', x: pr.x + 10, y: pr.y + pr.h - 13, w: pr.w - 20, h: 8, dur: 800, col: campColor(i) });
      }
    }
    lastSupport[i] = s.support;
  });
  // 市场新卡（仅自己的市场可见）
  if (mySeat >= 0) {
    const s = view.seats[mySeat];
    const sig = (s.market || []).map(c => c.uid).join(',');
    if (lastMarketSig[mySeat] !== undefined && sig !== lastMarketSig[mySeat]) {
      const old = new Set(lastMarketSig[mySeat] ? lastMarketSig[mySeat].split(',') : []);
      const slots = marketSlotRects(s);
      (s.market || []).forEach(c => {
        if (!old.has(String(c.uid))) {
          const r = slots.find(x => x.card.uid === c.uid);
          if (r) addFx({ type: 'cardIn', x: r.x, y: r.y, w: r.w, h: r.h, dur: 420 });
        }
      });
    }
    lastMarketSig[mySeat] = sig;
  }
  // 手牌新增（B1：非我方 hand 为 null，仅自己可见手牌变化）
  view.seats.forEach((s, i) => {
    if (i !== mySeat) return;
    const hlen = (s.hand || []).length;
    if (lastHandN[i] !== undefined && hlen > lastHandN[i]) {
      const lay = handLayout();
      const oldUids = lastHandUids[i] || [];
      (s.hand || []).forEach(c => {
        if (oldUids.indexOf(c.uid) >= 0) return;   // M5：仅新入手牌播动画
        const it = lay.find(x => x.card.uid === c.uid);
        if (it) addFx({ type: 'cardIn', x: it.x, y: it.y, w: it.w, h: it.h, dur: 420 });
      });
    }
    lastHandN[i] = hlen;
    lastHandUids[i] = (s.hand || []).map(c => c.uid);
  });
  // 事件牌新增
  view.seats.forEach((s, i) => {
    if (lastEventsN[i] !== undefined && s.events.length > lastEventsN[i] && i === mySeat) {
      eventSlotRects().forEach(r => addFx({ type: 'cardIn', x: r.x, y: r.y, w: r.w, h: r.h, dur: 420 }));
    }
    lastEventsN[i] = s.events.length;
  });
  // 事件打出 → 新闻（服务端环形缓冲：logHead 偏移 + 尾部 40 条，全局序号单调递增，截断不再导致永久失效）
  const logBase = view.logHead || 0;
  if (logBase + view.logs.length !== lastLogN) {
    if (logBase + view.logs.length < lastLogN) lastLogN = logBase + view.logs.length;   // 新对局：静默对齐
    for (let i = Math.max(0, lastLogN - logBase); i < view.logs.length; i++) {
      const lg = view.logs[i] || '';
      const m = lg.match(/打出事件【(.+?)】/);
      if (m) {
        const nm = m[1];
        const evT = (ElectionCore.data.EVENT_TEMPLATES || []).find(t => t.name === nm);
        addFx({ type: 'news', dur: 2000, title: nm, sub: evT ? evT.desc : '' });
        // 法庭高潮：事件生效瞬间全屏 OBJECTION!（法槌音效 + 冲击感）
        addFx({ type: 'objection', dur: 1500, sub: '事件牌生效' });
        shakeAmp = Math.max(shakeAmp, 14);
        sfx('gavel');
      }
    }
    lastLogN = logBase + view.logs.length;
  }
  // 游戏结束
  if (view.gameOver && !overFxDone) {
    overFxDone = true;
    sfx('win');
    const ws = view.seats[view.winner];
    const wside = ws && ws.side ? (ws.side === 'prosecutor' ? '检方' : '辩护方') : '';
    let winTitle = '🏆 胜诉！', winSub = ws.name + (wside ? '（' + wside + '）' : '');
    if (view.winType === 'precedent') winSub = '⚖️ 先例胜利 · ' + ws.name + (wside ? '（' + wside + '）' : '');
    else if (view.winType === 'juryNull') winSub = '🕊️ 陪审团否决 · ' + ws.name + (wside ? '（' + wside + '）' : '');
    addFx({ type: 'news', dur: 2400, title: winTitle, sub: winSub });
    addFx({ type: 'confetti', x: W / 2, y: 60, dur: 2000, seed: 9, n: 90 });
  }
}
function SKILLS_LV(skill) {
  const sk = ElectionCore.data.SKILLS[skill];
  return sk ? (sk.lv || 0) : 0;
}

/* ---------------- 主循环 ---------------- */
let lastT = 0;
/* 渲染错误隔离：连续 ERROR_FREEZE_THRESHOLD 帧抛错则冻结画面并显示错误屏，
 * 避免"每帧都 try-catch 吞掉、画面变黑但 rAF 还在空转"的假活状态（用户 B 类审查）。 */
const ERROR_FREEZE_THRESHOLD = 5;
let renderErrCount = 0;
let renderFrozen = false;
function freezeRender(err) {
  renderFrozen = true;
  if (console && console.error) console.error('[render] 连续异常，已冻结画面：', err);
  const cv = document.querySelector('canvas');
  if (cv) {
    try {
      const c2 = cv.getContext('2d');
      c2.save();
      c2.fillStyle = '#0e1117'; c2.fillRect(0, 0, cv.width, cv.height);
      c2.fillStyle = '#ff5a5a'; c2.font = 'bold 18px sans-serif'; c2.textAlign = 'center';
      c2.fillText('渲染异常，已暂停', cv.width / 2, cv.height / 2 - 18);
      c2.fillStyle = '#e6e6e6'; c2.font = '13px sans-serif';
      c2.fillText(String(err && err.message || err).slice(0, 120), cv.width / 2, cv.height / 2 + 6);
      c2.fillText('请刷新页面重试', cv.width / 2, cv.height / 2 + 26);
      c2.restore();
    } catch (e2) { /* 连错误屏都画不出就算了 */ }
  }
  diagOut('渲染连续异常已冻结，最近事件黑匣子：');
}
function loop(t) {
  if (!lastT) lastT = t;
  const dt = Math.min(50, t - lastT);
  lastT = t;
  try {
    updateFx(dt);
    // 按钮点击闪光衰减
    for (const k in btnFlash) { btnFlash[k] -= dt / 1000 * 3.5; if (btnFlash[k] <= 0) delete btnFlash[k]; }
    if (thinkSeat >= 0 && Date.now() - thinkT > 1200) thinkSeat = -1;   // 思考遮罩兜底（防 end 丢失卡住）
    if (screen === 'game' || screen === 'draft' || screen === 'over') checkFxDiffs();
    render();
    renderErrCount = 0;   // 成功一帧即清零
  } catch (e) {
    renderErrCount++;
    if (renderErrCount >= ERROR_FREEZE_THRESHOLD) { freezeRender(e); return; }   // 冻结：不再 requestAnimationFrame
    if (console && console.error) console.error('[render]', e);   // M1：单帧异常不中断主循环，避免画面永久冻结
    diagOut('渲染异常，最近事件黑匣子：');   // 输出诊断日志快照（程序意见3）
  }
  requestAnimationFrame(loop);
}

/* ---------------- 初始化 ---------------- */
initMenu();
requestAnimationFrame(loop);

/* ---------------- 测试辅助钩子（仅调试用） ---------------- */
window.__game = {
  get view() { return view; },
  get mySeat() { return mySeat; },
  get screen() { return screen; },
  get roomInfo() { return roomInfo; },
  get deadline() { return deadline; },
  get selected() { return selected; },
  get buyMode() { return buyMode; },
  get eventPick() { return eventPick; },
  get helpPage() { return helpPage; },
  get glossaryTab() { return GLOSSARY_TAB.tab; },
  get glossaryPage() { return GLOSSARY_TAB.page; },
  get termPopup() { return termPopup; },
  get isProcessing() { return isProcessing; }
};
