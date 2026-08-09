/* ============================================================
 * 当庭揭示 · 联机版客户端（2026-08 重构适配 16 步状态机）
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
  s.panelH = compact ? 20 : (portraitMode ? 26 : (ph === 'tiny' ? 24 : (ph === 'narrow' ? 26 : 30)));
  s.fs.name = compact ? (ph === 'tiny' ? 10 : 11) : (ph === 'tiny' ? 11.5 : (ph === 'narrow' ? 12.5 : 14));
  s.fs.num = compact ? (ph === 'tiny' ? 9.5 : 11) : (ph === 'tiny' ? 12 : (ph === 'narrow' ? 13 : 15));
  s.fs.stat = compact ? (ph === 'tiny' ? 8.5 : 9.5) : (ph === 'tiny' ? 10.5 : (ph === 'narrow' ? 11.5 : 12.5));
  s.fs.small = compact ? 9 : (ph === 'tiny' ? 9.5 : 10.5);
  // 窄屏信息降级：tiny 隐藏丑闻条/锁/先例/陪审徽章（hover 或面板仍可查看数值）
  s.show.scandalBar = ph !== 'tiny';
  s.show.handN = ph !== 'tiny';
  s.show.locked = ph !== 'tiny';
  s.show.act = true;
  s.show.prev = ph !== 'tiny';
  s.show.jury = ph !== 'tiny';
  HUD_H = s.hudH; PANEL_Y = s.panelY; HAND_AREA_H = s.handH;
  if (!portraitMode) handScroll = 0;   // 切回横屏/桌面时重置抽屉页
}
/* 安全区：刘海/底部横条（逻辑像素，由 CSS env(safe-area-inset-*) 提供） */
let SAFE = { top: 0, bottom: 0, left: 0, right: 0 };
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
  const w = Math.max(340, vw - SAFE.left - SAFE.right);
  const h = Math.max(480, vh - SAFE.top - SAFE.bottom);
  // P0：画布 CSS 尺寸跟随逻辑尺寸并平移到安全区内（刘海/Home 条不再遮 HUD 与底栏按钮）
  canvas.style.position = 'fixed';
  canvas.style.left = SAFE.left + 'px';
  canvas.style.top = SAFE.top + 'px';
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * DPR);
  canvas.height = Math.round(h * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  W = w; H = h;
  applyUI();
}
window.addEventListener('resize', resize);
resize();
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* 网格布局：在矩形区域 (x,y,w,h) 内均分摆放 count 个卡片槽位（不越界） */
function gridSlots(x, y, w, h, count, gap, aspect, maxW) {
  if (count <= 0) return [];
  gap = Math.max(2, gap || 6);
  aspect = aspect || 0.68;
  maxW = maxW || 96;
  let cols = Math.min(count, Math.max(1, Math.floor((w + gap) / (64 + gap))));
  let cw = Math.min(maxW, (w - (cols - 1) * gap) / cols);
  let ch = cw / aspect;
  const maxRows = Math.ceil(count / cols);
  if (ch * maxRows + (maxRows - 1) * gap > h) {
    ch = (h - (maxRows - 1) * gap) / maxRows;
    cw = Math.max(20, ch * aspect);
    const cols2 = Math.min(count, Math.max(1, Math.floor((w + gap) / (cw + gap))));
    if (cols2 !== cols) {
      cols = cols2;
      cw = Math.min(maxW, (w - (cols - 1) * gap) / cols);
      ch = Math.min(ch, cw / aspect);
    }
  }
  const rows = Math.ceil(count / cols);
  const tw = cols * cw + (cols - 1) * gap;
  const th = rows * ch + (rows - 1) * gap;
  const startX = x + (w - tw) / 2;
  const startY = y + (h - th) / 2;
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    out.push({ x: startX + c * (cw + gap), y: startY + r * (ch + gap), w: cw, h: ch });
  }
  return out;
}
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
    ctx.save(); ctx.font = font;
    v = ctx.measureText(text).width;
    ctx.restore();
    if (_twCache.size > 6000) _twCache.clear();
    _twCache.set(k, v);
  }
  return v;
}
/** 自动缩字/截断：文本超过 maxW 时先降字号，仍超则截断加省略号（P0-4b：下限 9px，放不下就省略号） */
function fitText(text, maxW, size, o) {
  o = o || {};
  let s = Math.max(9, size), t = String(text);
  const bold = o.bold === false ? '' : '700 ';
  const fontFor = ss => bold + ss + 'px ' + _FONT_BASE;
  while (s > 9 && textWidth(t, fontFor(s)) > maxW) s -= 0.5;
  while (t.length > 1 && textWidth(t + '…', fontFor(s)) > maxW) t = t.slice(0, -1);
  if (t !== String(text) && textWidth(t + '…', fontFor(s)) <= maxW) t += '…';
  return { text: t, size: s, w: textWidth(t, fontFor(s)) };
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

/* ============================ FX 动画引擎 ============================ */
/* #60/#61：对象池复用 + 总量上限 + 高负载自动降级（低端机/移动端优化） */
const FX = [];
let shakeAmp = 0;
const FX_MAX = 48;            // FX 总量上限：超出丢弃最旧（防粒子爆炸拖垮低端机）
let fxLowQ = false;           // 低质量模式：降级粒子密度/跳过重特效
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
  // #60：移动端 FX 高负载 → 自动降级粒子密度，保帧率
  fxLowQ = isMobile && FX.length > 24;
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

/* ============================ 风味名池 / 图标 ============================ */
const VOTER_FLAVOR = {
  v01: ['布兰登·米勒', '凯尔西·陈', '马库斯·罗德里格斯', '阿什利·王', '泰勒·贝克', '摩根·席尔瓦', '杰登·帕特尔', '布鲁克·汤普森', '卡梅隆·奥布莱恩', '西德尼·约翰逊', '亨特·布朗', '麦迪逊·加西亚', '莱利·金', '艾娃·马丁内斯', '扎克·威尔逊', '汉娜·安德森', '康纳·李', '奥利维亚·托马斯'],
  v02: ['琳达·福斯特', '沃尔特·汉密尔顿', '多萝西·卡尔森', '厄尔·普雷斯顿', '格蕾丝·麦卡锡', '罗伊·惠特克', '玛格丽特·温特斯', '维克托·斯坦利', '贝蒂·麦克莱恩', '诺曼·皮博迪', '朱迪丝·亨特', '伦纳德·莫斯', '艾琳·比肖普', '塞缪尔·克罗斯', '露丝·兰伯特', '霍华德·布恩', '埃莉诺·帕尔默', '西奥多·凯斯'],
  v03: ['托尼·马兰多', '文尼·卡斯特罗', '德米特里·沃克', '拉希德·侯赛因', '埃迪·科瓦奇', '萨米尔·汗', '弗兰克·卡普拉', '伊戈尔·佩特罗夫', '米格尔·托雷斯', '奥马尔·阿齐兹', '吉米·麦奎尔', '阿米尔·纳赛尔', '路易·迪亚兹', '巴里·奥康纳', '塞缪尔·阿特金斯', '邓肯·麦克雷', '彼得·久科维奇', '安杰洛·曼奇尼'],
  v04: ['卡伦·希克斯', '佩吉·贝内特', '黛比·劳伦斯', '雪莉·坎贝尔', '康妮·麦克斯韦', '芭芭拉·沃尔什', '珍妮特·格里尔', '帕特里夏·福勒', '琳恩·考德威尔', '苏珊·贝利', '黛安·莫里森', '卡罗尔·斯宾塞', '格洛丽亚·罗素', '凯西·丹尼斯', '朱莉·哈蒙', '玛丽·克劳福德', '安妮·皮尔斯', '洛蕾塔·格雷厄姆'],
  v05: ['阿尼尔·夏尔马', '金·黄', '迪帕克·库马尔', '埃米利奥·里维拉', '尤苏夫·艾哈迈德', '卢卡斯·施密特', '阮文雄', '米哈伊尔·索科洛夫', '阿卜杜勒·卡里姆', '尼古拉·伊万诺夫', '拉斐尔·门多萨', '萨钦·帕特尔', '埃斯特万·奥尔特加', '李威廉', '米洛·霍瓦特', '皮特·康斯坦丁', '哈桑·阿里', '马克斯·布劳恩'],
  v06: ['迈克·托雷斯', '比尔·奥尔森', '杰克·科瓦尔斯基', '查理·麦克马洪', '斯坦·诺瓦克', '雷·唐纳利', '加里·布鲁克斯', '弗兰克·穆拉夫斯基', '戴夫·林奇', '乔·斯坦菲尔德', '艾尔·加西亚', '弗雷德·奥康纳', '拉斯·彼得森', '汉克·齐默尔曼', '埃迪·沃兰斯基', '罗恩·科瓦尔', '吉恩·马祖尔', '斯蒂芬·哈洛兰'],
  v07: ['丹尼尔·克雷默', '瑞秋·斯科特', '凯文·奥尼尔', '米歇尔·福斯特', '杰森·阿姆斯特朗', '艾米丽·布鲁克斯', '布莱恩·哈德森', '妮可·米切尔', '埃里克·西尔弗', '莎拉·坎宁安', '亚当·格兰特', '杰西卡·莫顿', '内森·布莱克', '劳拉·普雷斯顿', '克里斯·达林', '梅根·沃克', '斯蒂芬·科尔曼', '凡妮莎·里德'],
  v08: ['詹姆斯·艾肯海德', '海伦·韦斯特伍德', '理查德·帕克曼', '埃莉诺·夏普', '莫里斯·克莱因', '凯瑟琳·莫顿', '艾伦·柯蒂斯', '帕梅拉·道森', '斯蒂芬·哈格雷夫', '玛莎·温特沃斯', '菲利普·巴特勒', '黛博拉·希金斯', '罗杰·康奈尔', '伊丽莎白·芬奇', '托马斯·麦克布莱德', '维维安·洛马克斯', '保罗·斯特林', '卡罗琳·阿什福德'],
  v09: ['布雷登·卡什', '斯隆·沃特金斯', '戴蒙·洛克威尔', '加勒特·斯特林', '艾米·张伯伦', '维克托·阿斯顿', '娜塔莉·普雷斯顿', '达伦·奥克利', '朱丽叶·汉密尔顿', '科尔·惠特莫尔', '斯特拉·卡文迪什', '里德·埃默森', '亚历山德拉·蒙特罗斯', '芬恩·卡明斯', '奥黛丽·洛克', '布伦南·萨默斯', '伊莎贝拉·惠特尼', '凯莉·罗宾逊'],
  v10: ['哈里森·布莱克伍德', '维多利亚·斯通', '以利亚·汉德勒', '玛德琳·霍洛韦', '奥古斯都·派克', '克拉拉·温特伯恩', '所罗门·格雷', '菲奥娜·贝内特', '以西结·克劳利', '罗莎琳·麦克道尔', '迪伦·莫罗', '塞琳娜·卡斯尔', '贾斯珀·休斯', '露西亚·范霍恩', '奥利弗·特伦特', '吉纳维芙·兰德', '马克斯·惠特菲尔德', '阿德莱德·奎因'],
  v11: ['卡尔·多纳休', '罗西·奥马利', '维克·斯坦格', '多莉·普雷斯顿', '厄尼·麦克阿瑟', '洛林·博伊尔', '格斯·哈伯', '艾德娜·维特克', '奥蒂斯·克拉姆', '薇拉·斯莱特', '克莱德·邦纳', '露西尔·帕克', '沃利·欣克尔', '艾达·惠勒', '诺曼·考夫曼', '米妮·斯威特', '厄尔·沃格特', '碧翠丝·朗'],
  v12: ['巴德·麦克基根', '莎伦·杜根', '科克·马奎尔', '莫莉·麦圭尔', '帕迪·芬尼根', '诺拉·伯恩', '希恩·卡拉汉', '布里奇特·穆尼', '康纳·弗林', '梅芙·奥谢', '利亚姆·多纳霍', '科尔姆·麦克纳利', '艾丹·里尔登', '西沃恩·肯尼迪', '德克兰·布雷迪', '菲奥娜·杜利', '巴里·诺兰', '西恩·霍根'],
  v13: ['泽维尔·克罗斯比', '奥黛丽·惠特莫尔', '昆西·范德米尔', '佩内洛普·阿什顿', '凯撒·蒙特内格罗', '伊莎多拉·佩恩', '洛根·惠特菲尔德', '卡罗来纳·里贝罗', '赛勒斯·斯特林', '瓦伦蒂娜·罗西', '帕特里克·奥弗林', '雅丝米娜·哈达德', '罗科·安杰利', '玛丽索尔·维加', '德克斯特·佩顿', '阿玛拉·奥克耶', '贾马尔·华盛顿', '蕾妮·贝克'],
  v14: ['黑曼巴', '幽灵', '杰克·刀锋', '陌生人', '无名氏', '影子', '疾风', '暗哨', '夜枭', '黑旗', '孤狼', '渡鸦', '响尾蛇', '秃鹫', '豺狼', '蝰蛇', '胡狼', '刺客'],
  v15: ['蒂娜·斯塔尔', '巴迪·费耶特', '莎琳·波普', '杜威·克罗威尔', '桃金娘·班克斯', '奥蒂斯·杜根', '薇拉·芬威克', '莱斯特·克林特', '邦妮·麦克斯韦', '哈利·蒂博', '露露·贝拉米', '奇普·多诺万', '格拉迪丝·温菲尔德', '巴斯特·霍根', '波莉·奥哈拉', '温德尔·珀克斯', '朵拉·惠特比', '赫伯·桑顿'],
  v16: ['键盘战神', '匿名喷子', '红眼评论家', '深夜键盘手', '无脑转发者', '弹幕轰炸机', '愤怒的市民', '不存在的表哥', '沙发评论家', '激光键盘', '正义喷火龙', '冷静点老哥', '茶水间杠精', '午夜刷屏王', '自动回复机', '杠精之王', '反方辩手', '跟风小号'],
  v17: ['珀西·惠特利', '哈莉特·斯通', '西奥多·拉德', '玛德琳·富兰克林', '伊莱亚斯·哈蒙', '比阿特丽斯·科温顿', '朱利安·克雷格', '薇罗妮卡·黑尔', '加布里埃尔·埃利斯', '塞西莉亚·沃德', '蒙哥马利·切斯', '伊芙琳·布拉德利', '纳撒尼尔·库克', '克洛伊·惠特克', '西奥菲勒斯·格兰特', '罗克珊·斯特林', '班尼迪克特·肖', '玛丽昂·德兰西'],
  v18: ['晨报调查组', '内幕知情人', '匿名爆料人', '深喉2.0', '小道消息社', '解密文件库', '窃听风云组', '录音带先生', '账本先生', '邮件门线人', '黑料批发商', '真相猎手', '独家猛料王', '爆料小报记者', '税务记录窃取者', '内线记者', '头条制造机', '深夜传真机'],
  v19: ['联邦舆情所', '山麓观察社', '蓝岭旁听团', '中央舆情站', '独立观察社', '大湖庭审社', '金门记录社', '松树街舆情社', '橡树岭庭研社', '星条旗舆情社', '自由钟记录社', '花岗岩庭研社', '常青藤观察团', '红杉卷宗站', '三角洲旁听团', '观景台舆情社', '主街旁听团', '联盟记录社'],
  v20: ['阿波罗·克莱恩', '维纳斯·蒙特罗', '迪伦·海耶斯', '星光·贝拉米', '柯尔特·麦迪逊', '伊娃·拉米雷斯', '杰特·班克斯', '萨布丽娜·洛佩兹', '罗科·瓦伦蒂诺', '梅琳达·福特', '艾斯·乔丹', '布里塔妮·斯隆', '达科塔·里德', '普雷斯利·克劳馥', '斯嘉丽·门罗', '米洛·普雷斯顿', '弗莱明·杜克', '安妮塔·索恩'],
  v21: ['密档卷宗', '庭外线人', '法庭内幕', '蓝皮密档', '证物黑匣', '账目卷宗', '密室录音', '贿赂黑账', '删证记录', '邮件取证', '金主密档', '串供记录', '行贿清单', '影子账本', '午夜密电', '后院档案柜', '录音带65分钟', '匿名证人A'],
  v22: ['科米特·斯莱特', '多诺万·克鲁格', '玛拉·斯通', '维克·朗格利亚', '泰特·马库斯', '赛琳娜·普拉特', '布恩·卡斯特罗', '阿尔玛·里维拉', '特伦特·考德威尔', '尤兰达·沃恩', '罗恩·斯泰尔斯', '奥利维亚·克劳斯', '马库斯·特拉普', '菲比·林格', '桑德罗·科尔特斯', '温妮·贝克', '埃兹拉·皮尔森', '卡门·德尔加多'],
  v23: ['沃伦·埃奇伍德', '普雷斯顿·麦克米伦', '康斯坦丝·洛克', '塞拉斯·惠特尼', '罗兹·卡文迪什', '亚伯拉罕·格罗夫', '薇奥拉·斯托克顿', '杰罗姆·范德沃特', '明妮·麦克白', '霍勒斯·威尔逊', '伊曼纽尔·施特劳斯', '温斯洛·哈灵顿', '阿米莉亚·格兰瑟姆', '乔纳斯·贝克曼', '珀尔·阿什伯里', '弗雷德里克·朗斯代尔', '柯比·戴维斯', '露丝·卡丁顿'],
  v24: ['庭外掮客', '法院常客', '案源掮客', '伪证教父', '收买之王', '证据通道人', '陪审斡旋师', '走廊密使', '合议庭长', '金主操盘手', '倾向分析师', '线人总机', '摇摆证人专员', '证人经纪', '证词经理人', '证据收割者', '酬金捕手', '法官挚友'],
  v25: ['厄尔·杰克逊', '比尔·莫斯利', '克莱德·哈伯', '薇拉·麦克雷', '巴迪·克莱顿', '多莉·兰开斯特', '韦恩·奥克斯', '格蕾丝·惠特', '汉克·博登', '佩吉·康克林', '罗伊·麦卡特尼', '多丽丝·斯泰尔斯', '莱斯特·福勒', '琼·哈丁', '弗农·麦克洛斯基', '阿尔玛·布恩', '奥蒂斯·谢泼德', '洛林·卡弗'],
  v26: ['耶利米·布朗', '以西结·麦克布莱德', '加布里埃尔·休斯', '汉娜·霍普韦尔', '撒迦利亚·韦斯特', '黛博拉·格兰特', '约拿·费尔班克斯', '埃斯特尔·惠特尼', '希律·莫里斯', '普莉希拉·亚当斯', '大卫·罗伯茨', '玛丽·凯瑟琳', '约书亚·布莱克', '露丝·内森', '摩西·哈特', '安娜贝尔·克里斯琴', '但以理·芬奇', '丽贝卡·帕默'],
  v27: ['达里尔·麦圭尔', '斯坦利·科瓦奇', '克莱德·多诺万', '艾尔玛·贝茨', '厄尔·格雷', '洛娜·麦克纳马拉', '吉姆·墨菲', '帕齐·奥马利', '弗兰克·多兰', '希拉·里根', '汤米·伯克', '南希·麦卡锡', '雷蒙德·奥康纳', '弗洛伦斯·道尔', '哈罗德·麦肯纳', '罗斯·卡拉汉', '欧内斯特·卡西迪', '艾琳·康纳斯'],
  v28: ['摩根·惠特莫尔', '兰斯洛特·范德比尔特', '斯宾塞·洛克菲勒', '阿斯特丽德·卡林顿', '塞巴斯蒂安·奥格登', '康斯坦丝·惠特克', '布罗德里克·蔡斯', '薇罗妮卡·洛克威尔', '帕斯卡尔·杜蒙', '约瑟芬·阿斯特', '沃辛顿·普雷斯顿', '塞西莉亚·范霍恩', '阿利斯泰尔·莫顿', '尤金妮亚·斯特林', '雷金纳德·索普', '伊莫金·兰斯伯里', '弗莱彻·卡伯特', '阿德莱德·洛克'],
  v29: ['香农·班尼特', '珍妮弗·米勒', '米歇尔·安德森', '艾米·贝克', '克里斯蒂娜·埃文斯', '斯蒂芬妮·柯林斯', '妮可·哈里斯', '劳伦·克拉克', '阿曼达·罗伯茨', '梅根·刘易斯', '凯莉·沃克', '杰西卡·霍尔', '林赛·扬', '艾莉森·金', '艾比·赖特', '柯尔特·霍顿', '布伦达·辛普森', '麦肯齐·泰勒'],
  v30: ['何塞·拉米雷斯', '玛丽亚·冈萨雷斯', '卡洛斯·门德斯', '卢西亚·费尔南德斯', '迭戈·桑托斯', '卡门·罗德里格斯', '米格尔·奥尔特加', '特蕾莎·莫拉莱斯', '恩里克·卡斯特罗', '罗莎·迪亚斯', '亚历杭德罗·托雷斯', '埃琳娜·巴斯克斯', '豪尔赫·里维拉', '莫妮卡·古铁雷斯', '拉斐尔·阿吉拉尔', '格拉西亚·洛佩斯', '马科斯·伊格莱西亚斯', '伊莎贝拉·克鲁斯'],
  v31: ['以西结·华盛顿', '玛莎·杰斐逊', '摩西·杰克逊', '阿比盖尔·卡特', '纳撒尼尔·布朗', '哈丽雅特·科尔曼', '以西结·约翰逊', '奥利维亚·普雷斯顿', '杰里迈亚·亨利', '贝西·沃德', '阿莫斯·哈珀', '黛利拉·米切尔', '约伯·西姆斯', '娜奥米·贝克', '马纳塞·休斯', '伊斯特·克雷格', '塞缪尔·阿彻', '米里亚姆·邓恩'],
  v32: ['卡莱布·阮', '艾米丽·张', '诺亚·桑切斯', '佐伊·帕特尔', '利亚姆·奥布莱恩', '汉娜·金', '梅森·加西亚', '艾娃·李', '伊桑·马丁内斯', '米娅·陈', '杰克逊·王', '索菲亚·古普塔', '卡特·约翰逊', '莉莉·威廉姆斯', '亨特·戴维斯', '奥利维亚·威尔逊', '加文·布朗', '克洛伊·托马斯'],
  v33: ['弗兰克·鲍尔斯', '诺曼·沃克', '雷·詹宁斯', '维尔玛·博伊德', '厄尔·辛普森', '珀尔·马什', '杜鲁门·沃伦', '琼·巴克利', '巴德·哈蒙', '露丝·汤普金斯', '克利夫·兰登', '海伦·麦克维', '斯坦利·布莱尔', '薇拉·科布', '奥托·斯隆', '玛格丽特·富尔顿', '莫里斯·惠特菲尔德', '伯莎·兰德尔'],
  v34: ['凯尔·麦卡锡', '艾比·汤普森', '罗杰·斯坦利', '佩吉·怀特', '布鲁斯·诺顿', '黛安·卡特', '伦纳德·弗雷泽', '贝蒂·罗宾逊', '霍华德·贝利', '莎伦·墨菲', '艾伯特·库珀', '邦妮·斯宾塞', '西奥多·朗', '乔伊斯·奥布莱恩', '雷蒙德·帕克', '埃莉诺·史蒂文斯', '维克托·莫里斯', '玛格丽特·霍根'],
  v35: ['巴德·杰克逊', '查克·麦克莱恩', '戴尔·惠特曼', '比尔·塔克', '斯坦·奥伯', '杰布·柯林斯', '弗兰克·米切尔', '洛根·贝尔', '杜克·格雷森', '雷·科温', '科里·哈蒙', '本·斯莱特', '迪恩·罗林斯', '卡尔·韦恩', '加布·威尔克斯', '奥托·普拉姆', '杰斯·哈根', '沃利·辛格尔顿'],
  v36: ['亚历山大·斯特林', '康斯坦丁·洛克威尔', '维克多·阿什顿', '塞西莉亚·莫顿', '巴尔萨泽·克雷恩', '杰奎琳·范德堡', '奥古斯都·皮尔斯', '卡桑德拉·惠特菲尔德', '马克西米连·索恩', '伊莎贝尔·坎宁安', '塞巴斯蒂安·梅森', '奥克塔维娅·斯特林', '克里斯托弗·韦德', '梅芙·卡文迪什', '帕西瓦尔·林奇', '埃莉诺·杜邦', '西奥菲勒斯·布恩', '玛德琳·阿斯特'],
  v37: ['埃德温·麦卡锡', '罗丝·奥哈拉', '泰伦斯·多伊尔', '凯瑟琳·布伦南', '帕特里克·弗林', '科莱特·赖利', '利奥·沙利文', '莫琳·奥康纳', '巴里·卡尼', '帕特里斯·沃尔什', '肖恩·多纳利', '格蕾丝·奥利里', '科尔姆·希伊', '布丽奇特·麦克唐纳', '丹尼斯·马奎尔', '西沃恩·布雷迪', '利亚姆·肯尼迪', '菲奥娜·卡西迪'],
  v38: ['H.W. 洛克菲勒三世', '杰德·惠特克', '科尔·约翰逊', '迈尔斯·阿什顿', '钱斯·惠特菲尔德', '马克·斯特林', '巴兹尔·卡灵顿', '兰德·麦克弗森', '埃利斯·杜邦', '伦道夫·塔夫脱', '普雷斯顿·伯克', '德克斯特·莱因哈特', '曼弗雷德·索尔伯格', '安格斯·麦克塔维什', '杰罗姆·范德比尔特', '科尔温·洛克', '巴尼·斯图尔特', '谢尔顿·戴维斯'],
  v39: ['马文·斯旺森', '杰里·科尔曼', '汉克·麦迪逊', '比夫·斯泰尔斯', '厄尔·波顿', '罗伊·巴克斯特', '卢克·威尔克斯', '达里尔·霍根', '巴迪·温特斯', '切特·兰德尔', '韦恩·卡拉汉', '莱斯特·戴克', '吉姆·麦考密克', '薇拉·惠勒', '斯图·皮尔森', '鲍勃·汉纳', '迪克·奥利里', '卡尔·范伯格'],
  v40: ['迈克·希金斯', '艾尔·多诺万', '弗兰克·凯西', '吉米·奥布赖恩', '巴德·科尔曼', '查理·穆兰尼', '埃德·卡罗尔', '杰克·菲茨杰拉德', '斯坦·沃德', '雷·麦卡锡', '丹·奥尼尔', '沃尔特·芬尼根', '文尼·斯科特', '弗兰克·格雷戈里', '萨姆·布伦南', '埃迪·卡拉汉', '吉姆·希基', '蒂姆·奥利里'],
  v41: ['马利克·汤普森', '艾拉·罗宾逊', '泽维尔·威廉姆斯', '苏菲·格林', '凯勒布·布朗', '米娅·约翰逊', '贾马尔·戴维斯', '佐伊·米切尔', '泰瑞斯·杰克逊', '丽贝卡·刘易斯', '奥马尔·威尔逊', '艾玛·加西亚', '德文·哈里斯', '娜奥米·马丁', '贾斯汀·泰勒', '奥利维亚·安德森', '马库斯·琼斯', '艾娃·莫里斯'],
  v42: ['基思·罗杰斯', '丹尼斯·马修斯', '普里西拉·沃德', '拉尔夫·摩尔', '贝弗莉·科尔特斯', '尤金·辛普森', '多洛雷斯·亨特', '克劳德·贝克', '珍妮特·里维拉', '格伦·福斯特', '雪莉·佩里', '诺曼·吉布森', '奥黛丽·弗格森', '维克·奥尔森', '露西尔·钱伯斯', '西奥多·布恩', '伊迪丝·马什', '哈维·肯特'],
  v43: ['杰德·科尔曼', '罗伊·惠特曼', '厄尔·巴克斯特', '贝丝·卡彭特', '克莱德·约翰逊', '多拉·麦克唐纳', '维尔·斯图尔特', '佩吉·汉密尔顿', '埃米特·奥利弗', '伊迪丝·惠特尼', '阿隆·哈里斯', '贝蒂·福斯特', '雷·麦卡利斯特', '格蕾丝·巴恩斯', '韦恩·康拉德', '莫莉·特纳', '赛勒斯·米勒', '埃莉诺·帕默'],
  v44: ['杜克·曼宁', '弗兰克·希勒', '巴德·威利斯', '乔·里德', '查理·霍顿', '厄尔·博伊德', '斯坦利·克拉姆', '罗伊·巴雷特', '威利·钱伯斯', '卡尔·罗林斯', '艾尔·芬顿', '吉姆·麦高恩', '比尔·帕克', '罗恩·科布', '梅尔·哈伯', '杰克·惠勒', '山姆·奥布莱恩', '雷·斯坦利'],
  v45: ['加勒特·科尔曼', '迪伦·巴恩斯', '马库斯·惠特', '阿德里安·沃克', '布伦特·米勒', '库尔特·约翰逊', '洛根·道森', '肖恩·莫里斯', '特雷弗·布恩', '埃里克·桑德斯', '德文·卡特', '泰勒·罗伯茨', '凯尔·史蒂文斯', '加勒特·休斯', '贾斯汀·贝利', '瑞安·库珀', '奥斯汀·格里芬', '扎克·泰勒'],
  v46: ['汉娜·沃德', '凯特·蒙哥马利', '艾米丽·哈特', '艾玛·沃克', '奥利维亚·贝内特', '索菲亚·克拉克', '阿比盖尔·赖特', '格蕾丝·汤普森', '伊莎贝拉·罗西', '夏洛特·金', '莉莉·格兰特', '艾拉·约翰逊', '米娅·库珀', '诺拉·费希尔', '艾娃·休斯', '萨拉·奥布莱恩', '克洛伊·贝利', '露西·特纳'],
  v47: ['邦妮·杰克逊', '布伦达·麦卡蒂', '丹娜·洛根', '谢丽尔·布恩', '特雷西·哈蒙', '瑞秋·惠特克', '莫妮卡·斯隆', '温迪·卡弗', '唐娜·麦克雷', '艾琳·布莱克', '琳达·克拉姆', '黛比·福斯特', '莉迪亚·科布', '帕姆·雷耶斯', '玛西·沃德', '海蒂·格里芬', '安吉·博登', '凯西·麦克法兰'],
  v48: ['DJ 斯莱克', 'DJ 涡轮', 'DJ 高地', '说唱商人', '节拍制造者', 'DJ 街区', 'DJ 宪法', 'DJ 棕榈', 'DJ 数据', '节拍部长', 'DJ 响雷', 'DJ 六四', '麦克风先生', 'DJ 星条', '韵律证人', 'DJ 自由', '节拍之拳', 'DJ 震动'],
  v49: ['真相探秘者', '地堡教授', '调查者X', '自由思想电台', '隐秘知识网', '深度真相', '黑日研究员', '反主流频道', '密码破译人', '预言档案', '地下情报员', '觉醒观察员', '阴影调查组', '自由之声', '揭秘联盟', '地平线研究员', '阴谋图书馆', '午夜信号'],
  v50: ['奥拉尔·惠特克', '塞勒斯·布朗', '耶利米·福克斯', '以法莲·斯通', '奥提斯·坎贝尔', '伊莱贾·克劳利', '约瑟夫·麦克布莱德', '埃斯特·威廉姆斯', '马纳塞·哈特', '黛博拉·克里斯琴', '以西结·西姆斯', '普里西拉·约翰逊', '歌利亚·普雷斯顿', '雷切尔·卡明斯', '希拉·米切尔', '汉娜·霍普金斯', '提摩太·贝内特', '莉迪亚·惠特'],
  v51: ['凯瑟琳·墨菲', '威廉·哈特', '玛格丽特·奥康纳', '詹姆斯·柯林斯', '埃伦·鲍尔斯', '罗伯特·斯坦利', '卡罗尔·麦卡锡', '丹尼尔·亨特', '南希·莱利', '爱德华·福斯特', '伊丽莎白·克拉克', '查尔斯·班尼特', '多萝西·桑德斯', '乔治·惠特利', '芭芭拉·金', '托马斯·莫里斯', '珍妮特·赖特', '约瑟夫·坎宁安'],
  v52: ['莎拉·贝尔', '凯文·斯通', '丽贝卡·泰勒', '克里斯托弗·格林', '艾米丽·阿什福德', '杰森·布恩', '汉娜·惠特莫尔', '马修·刘易斯', '蕾切尔·道森', '布兰登·沃克', '妮可·哈珀', '安德鲁·米切尔', '梅根·卡拉汉', '斯蒂芬·克雷格', '朱莉娅·莫顿', '艾瑞克·波顿', '金伯利·斯隆', '肯尼斯·博伊德'],
  v53: ['塔拉·麦金尼', '艾德·威尔逊', '维罗妮卡·布莱克', '巴德·哈里斯', '谢丽尔·多诺万', '斯坦·福克斯', '帕梅拉·克雷格', '瑞安·科尔曼', '布伦达·麦奎尔', '吉姆·斯泰尔斯', '凯西·格林', '戴尔·奥斯汀', '罗莎琳·巴克', '诺曼·弗莱彻', '格洛丽亚·沃伦', '伦纳德·彼得森', '玛西·威尔科克斯', '哈维·蒙哥马利'],
  v54: ['阿莱克斯·马丁', '杰米·泰勒', '泰勒·格林', '萨姆·约翰逊', '凯西·布朗', '乔丹·米切尔', '罗宾·威廉姆斯', '艾利·戴维斯', '摩根·安德森', '帕克·汤普森', '凯·罗伯茨', '杰西·威尔逊', '德鲁·马丁内斯', '莱利·托马斯', '卡梅隆·怀特', '艾登·杰克逊', '哈珀·李', '斯凯·加西亚'],
  v55: ['马库斯·雷耶斯', '艾莉西亚·哈特', '朱利安·克罗斯', '娜塔莉亚·阿姆斯特朗', '加布里埃尔·莫雷诺', '维多利亚·贝内特', '伊莱·斯特林', '瓦莱丽·帕默', '塞巴斯蒂安·洛克', '安德里亚·奎因', '迈克尔·卡尔森', '凯拉·惠特菲尔德', '亚历克斯·里维拉', '卡罗琳·诺曼', '丹尼尔·阿什', '杰西卡·克雷默', '文森特·佩蒂', '伊芙琳·马歇尔'],
  v56: ['马库斯·黑尔', '塞缪尔·卡丁顿', '莫妮卡·斯通', '乔纳森·惠特', '卡罗尔·麦克雷', '加文·阿什比', '佩内洛普·克拉克', '罗伯托·门德斯', '安东尼娅·斯特林', '卡梅伦·刘易斯', '维多利亚·霍尔', '丹特·罗西', '弗朗西斯卡·洛克', '维克托·莫拉莱斯', '伊莎贝尔·佩蒂特', '洛伦佐·迪亚兹', '玛丽亚·贝克', '雷金纳德·奥哈拉'],
  v57: ['巴迪·哈蒙', '杰克·麦克布莱德', '格斯·科尔特斯', '斯坦利·布恩', '杜克·麦卡锡', '克林特·沃尔什', '雷·道森', '查克·奥康纳', '维尔·贝内特', '弗兰克·穆里根', '埃德·科布', '山姆·里根', '罗恩·威尔克斯', '吉姆·贝茨', '哈维·克莱顿', '沃利·麦奎尔', '奥蒂斯·弗莱明', '布巴·雷诺兹'],
  v58: ['卡尔·霍根', '薇拉·汤普森', '莱斯特·贝内特', '佩吉·麦克阿瑟', '厄尔·哈蒙', '邦妮·斯坦利', '韦恩·克雷格', '多莉·博伊德', '克莱德·威尔斯', '艾琳·奥利里', '斯坦·福斯特', '格蕾丝·贝克', '哈罗德·惠特', '玛莎·道森', '诺曼·麦圭尔', '贝蒂·克劳福德', '罗伊·巴恩斯', '朱迪丝·科文'],
  v59: ['汉克·斯泰尔斯', '巴德·惠特莫尔', '吉姆·奥利弗', '杜克·兰登', '雷·卡彭特', '厄尔·布恩', '斯坦·汉密尔顿', '乔·米切尔', '弗兰克·温特斯', '查理·麦克雷', '维尔·哈蒙', '鲍勃·柯林斯', '埃德·格兰特', '山姆·皮尔森', '杰克·博登', '罗伊·克拉姆', '比尔·惠勒', '奥蒂斯·兰迪'],
  v60: ['格雷戈里·斯坦顿', '玛格丽特·伯顿', '温斯顿·格罗夫', '凯瑟琳·德弗罗', '拉尔夫·惠特科姆', '埃莉诺·帕默斯顿', '艾伦·卡特勒', '薇拉·朗', '珀西瓦尔·斯泰尔斯', '多萝西·惠特菲尔德', '塞缪尔·埃奇沃思', '玛丽昂·福斯特', '霍勒斯·范德米尔', '贝琳达·克罗斯', '埃德蒙·惠特克', '奥黛丽·斯特林', '利奥波德·贝克', '克劳迪娅·温特斯'],
  v61: ['罗莎·桑切斯', '迭戈·拉米雷斯', '阿玛拉·奥克耶', '米格尔·费尔南德斯', '艾米丽·哈丁', '马库斯·格林', '克洛伊·帕特尔', '何塞·门德斯', '朱莉娅·莫拉莱斯', '以利亚·汤普森', '伊莎贝拉·洛佩斯', '诺亚·威廉姆斯', '索菲亚·雷耶斯', '卡特·约翰逊', '艾娃·罗德里格斯', '卢卡斯·马丁', '米娅·加西亚', '阿德里安·布朗'],
  v62: ['德克兰·奥布莱恩', '凯特琳·麦金太尔', '康纳·墨菲', '麦肯齐·柯林斯', '利兰·惠特克', '布伦丹·奥谢', '西沃恩·麦卡锡', '芬恩·奥康纳', '艾登·奥尼尔', '布伦娜·沃尔什', '基兰·多诺万', '格蕾丝·卡拉汉', '科马克·弗林', '梅芙·奥布赖恩', '尼亚姆·希伊', '布莱恩·康纳利', '帕特里克·林奇', '奥拉·卡西迪'],
  v63: ['罗恩·卡明斯', '贝蒂·麦克布赖德', '厄尔·斯泰尔斯', '琼·惠特克', '巴德·麦卡利斯特', '格蕾丝·温特斯', '斯坦·哈蒙', '多莉·福勒', '克劳德·博伊德', '艾达·普雷斯顿', '诺曼·惠特莫尔', '珀尔·麦克雷', '文森特·卡弗', '洛林·哈伯', '哈里·兰多', '玛莎·贝内特', '吉姆·奥利里', '薇拉·麦圭尔'],
  v64: ['阿丽莎·张', '伊桑·蒙特罗', '玛雅·约翰逊', '诺亚·金', '佐伊·帕特尔', '利奥·马丁内斯', '艾米莉·陈', '凯勒布·冈萨雷斯', '索菲亚·李', '贾斯珀·阮', '奥利维亚·克鲁兹', '芬恩·威廉姆斯', '哈珀·洛佩兹', '迈尔斯·戴维斯', '艾娃·桑托斯', '西奥·格林', '米娅·罗德里格斯', '伊莱·汤普森']
};
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
  lastStarterSeat = st.startingSeat;   // 对齐起始者，避免重连/开局误触发轮盘
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
  $('btn-create').onclick = () => doCreate('multi');
  $('btn-solo').onclick = () => doCreate('solo');
  $('btn-join').onclick = () => doJoin();
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
  if (busy) $('menu-msg').textContent = '连接中…';
}
function doCreate(mode) {
  const name = $('inp-name').value.trim() || '玩家';
  localStorage.setItem('elec_name', name);
  const maxSeats = parseInt($('sel-seats').value, 10) || 2;
  localStorage.setItem('elec_seats', String(maxSeats));   // #108 保存座位数
  localStorage.setItem('elec_mode', mode);                // #108 保存模式（solo/multi）
  setBusy(true);
  socket.emit('createRoom', { name, mode, maxSeats }, ack => {
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
  setBusy(true);
  socket.emit('joinRoom', { name, code }, ack => {
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
  $('lobby-msg').textContent = '已就绪 ' + humans + ' / ' + roomInfo.maxSeats + ' 人';
  const isHost = roomInfo.seats[mySeat] && roomInfo.seats[mySeat].host;
  if (isHost) { show('btn-start'); $('btn-start').disabled = humans < 1; }
  else hide('btn-start');
}

/* ---------------- 发送操作（带互斥锁） ---------------- */
let isProcessing = false;
const PROCESS_LOCK_MS = 500;
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
  setTimeout(() => { isProcessing = false; }, PROCESS_LOCK_MS);
}

/* ---------------- 布局函数 ---------------- */
const ROW_H = 150;      // HUD_H / PANEL_Y / HAND_AREA_H 已在顶部声明，resize 按横屏/桌面动态更新
let eventPage = 0;      // 事件牌分批翻页（每页 4 张）
// 回合进程状态条（阶段进度）
/* 阶段进度条常量：唯一源在 shared/game-core.js（超级更新#2），此处仅引用显示版 */
const PHASE_STEPS = (typeof ElectionCore !== 'undefined' && ElectionCore.PHASE_STEPS_VISIBLE) || [
  ['chooseStarter', '起始'], ['buy', '取证'], ['play', '举证'], ['reveal', '亮出'],
  ['preEvent', '前庭审'], ['count', '审议'], ['postEvent', '后庭审'], ['rank', '排名'],
  ['discard', '整理'], ['income', '酬金']
];
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
  buttons = [];
  hoverCards = [];
  ctx.clearRect(0, 0, W, H);
  pxRect(0, 0, W, H, PAL.bg.a);
  // 演播室背景：斜向速度线 + 顶部聚光灯锥
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
  if (!view) return;
  renderHud();
  renderRowArea();
  renderPanels();
  renderBottom();
  renderLogs();
  drawGoalGuide();
  renderFx();
}
function renderHud() {
  pxRect(0, 0, W, HUD_H, '#101418');
  pxBorder(0, 0, W, HUD_H, '#FFD60A', 2.5);
  drawPixelText(view.round > 0 ? '第 ' + view.round + ' 轮' : '准备中', 14, HUD_H / 2, 20, '#FFD60A', { shadow: false });
  const ph = view.phaseLabel || view.phase;
  drawPixelText(ph, W / 2, HUD_H / 2, 22, '#FFFFFF', { align: 'center' });
  const startTxt = view.startingSeat != null && view.seats[view.startingSeat] ? '起始：' + view.seats[view.startingSeat].name : '';
  drawPixelText(startTxt, W - 14, HUD_H / 2, 16, '#FFD60A', { align: 'right', shadow: false });
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
  // 底部：支持度竞逐轨道（按支持度占比着色，实时反映排名）
  if (view.round > 0) {
    const tot = Math.max(1, view.seats.reduce((a, b) => a + b.support, 0));
    let sx = 0;
    view.seats.forEach((s, i) => {
      const w2 = Math.max(2, Math.round(W * (s.support / tot)));
      pxRect(sx, HUD_H - 5, w2, 5, campColor(i));
      sx += w2;
    });
  } else {
    pxRect(0, HUD_H - 5, W * 0.5, 5, '#FF3B30');
    pxRect(W * 0.5, HUD_H - 5, W * 0.5, 5, '#0A84FF');
  }
  // 阶段进度条：当前高亮 + 下一步提示（回合进程状态条）
  const steps = PHASE_STEPS;
  const idx = steps.findIndex(s => s[0] === view.phase);
  if (idx >= 0) {
    // P0：stepW 加 2px 下限（W<350 时 (W-320) 为负），起笔自适应左侧，右侧为倒计时/起始者留 88px
    let stepW = isMobile ? 16 : Math.min(30, (W - 320) / steps.length - 3);
    stepW = clamp(stepW, 2, 30);
    let sx = Math.max(76, isMobile ? 108 : 148);
    const availR = W - 88;
    if (sx + steps.length * (stepW + 3) > availR) {
      stepW = Math.max(2, (availR - sx - (steps.length - 1) * 3) / steps.length);
    }
    steps.forEach((s, i) => {
      const active = i === idx;
      pxRect(sx, HUD_H - 16, stepW, 9, active ? '#FFD60A' : i < idx ? '#4A9A5A' : '#39425A');
      pxBorder(sx, HUD_H - 16, stepW, 9, '#111111', 1);
      sx += stepW + 3;
    });
    if (idx < steps.length - 1 && sx + 12 < W) {
      drawPixelText('下一步：' + steps[idx + 1][1], sx + 6, HUD_H - 11, isMobile ? 10.5 : 12, '#DCE6F5', { shadow: false });
    }
  }
}
/* 阶段目标指引框：呼吸灯边框 + 当前要做的事（按阶段与行动权） */
function drawGoalGuide() {
  if (!view) return;
  const me = view.seats[mySeat];
  if (!me) return;
  const ph = view.phase;
  const n = view.seatCount;
  const handY0 = H - HAND_AREA_H - 40;
  let tip = '', sub = '', bx2 = 0, by2 = 0;
  if (ph === 'buy' && myTurn()) { tip = '调查取证：传唤证物架上的证据'; sub = '点击证物传唤 · 完成后点「结束取证」'; bx2 = 12; by2 = handY0 - 40; }
  else if (ph === 'play' && myTurn()) { tip = '暗置举证：从手牌打 1 张'; sub = '选中后点「举证」· 也可直接点「结束举证」放弃'; bx2 = 12; by2 = handY0 - 40; }
  else if (ph === 'discard' && view.discardSeat === mySeat) { tip = '整理：保留最多 ' + keepMax() + ' 份'; sub = '点击手牌留证要保留的证词，其余归档'; bx2 = 12; by2 = handY0 - 40; }
  else if (ph === 'reveal' && myTurn()) { tip = '技能发动：点击目标卡牌'; sub = '证据排除 / 程序动议等技能需选择目标'; bx2 = W * 0.5; by2 = 38; }
  else if (ph === 'count' && myTurn()) { tip = '换位技能：点击金色高亮牌'; sub = '选择与目标互换位置'; bx2 = W * 0.5; by2 = 38; }
  else if ((ph === 'preEvent' || ph === 'postEvent') && view.eventTurnSeat === mySeat) { tip = ph === 'preEvent' ? '庭审前事件：打出或跳过' : '庭审后事件：打出或跳过'; sub = '点击事件区可用的事件牌'; bx2 = 12; by2 = handY0 - 40; }
  else if (ph === 'chooseStarter' && view.starterPicker === mySeat) { tip = '选择本轮起始玩家'; sub = '点击一位玩家的头像'; bx2 = W * 0.5; by2 = 38; }
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
  if ((view.round || 0) <= 2) {
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
    const btnY = H - HAND_AREA_H + 30;
    if (ph === 'buy' && myTurn()) drawArrow(W - 200, btnY - 16, 'down');
    else if (ph === 'play' && myTurn()) drawArrow(W - 200, btnY - 16, 'down');
    else if ((ph === 'preEvent' || ph === 'postEvent') && view.eventTurnSeat === mySeat) drawArrow(120, H - HAND_AREA_H + 20, 'down');
    else if (ph === 'discard' && view.discardSeat === mySeat) drawArrow(150, H - HAND_AREA_H + 20, 'down');
  }
}
function myTurn() {
  const g = view;
  if (!g) return false;
  switch (g.phase) {
    case 'buy': return !g.seats[mySeat].buyDone;
    case 'play': return g.turn === mySeat && !g.seats[mySeat].playDone;
    case 'reveal': return !!(g.revealPending && g.revealPending.owner === mySeat);
    case 'count': return !!(g.swapPending && g.swapPending.owner === mySeat);
    case 'preEvent': case 'postEvent': return g.eventTurnSeat === mySeat;
    case 'discard': return g.discardSeat === mySeat && !g.seats[mySeat].keepDone;
    case 'chooseStarter': return g.starterPicker === mySeat && !g.starterChosen;
    default: return false;
  }
}
function renderRowArea() {
  const row = view.row || [];
  const lay = rowLayout();
  const cy = lay.cy, rh = lay.rh;
  void row;
  // 辩论台底座：深色台面 + 金色边线 + 中央星条旗微标
  pxRect(8, cy - 24, W - 16, rh + 34, PAL.bg.b);
  pxBorder(8, cy - 24, W - 16, rh + 34, '#FFD60A', 2);
  ctx.save();
  ctx.globalAlpha = 0.5;
  drawPixelText('⚖️ 庭审区 ★', W / 2, cy - 14, 11, '#FFD60A', { align: 'center', shadow: false });
  ctx.restore();
  drawPixelText('证据 · 已亮出', 20, cy - 4, 13, '#9FB3CE', { shadow: false });
  // 审议阶段：行左/右半区分隔线 + 行首/行尾标记（位置博弈技能可读性）
  if (view.phase === 'count') {
    const act = lay.items.filter(it => it.revealed === true && it.removed !== true);
    if (act.length >= 2) {
      const x0 = act[0].x, x1 = act[act.length - 1].x + act[act.length - 1].w;
      const midX = (x0 + x1) / 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,214,10,0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(midX, cy - 24); ctx.lineTo(midX, cy + rh + 10); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.9;
      drawPixelText('◀ 左半区', x0 + 4, cy - 14, 10, '#FFD60A', { shadow: false });
      drawPixelText('右半区 ▶', x1 - 48, cy - 14, 10, '#FFD60A', { shadow: false });
      ctx.restore();
      drawPixelText('👈 行首', act[0].x + act[0].w / 2, act[0].y - 15, 10, '#FFD60A', { align: 'center', shadow: false });
      drawPixelText('行尾 👉', act[act.length - 1].x + act[act.length - 1].w / 2, act[act.length - 1].y - 15, 10, '#FFD60A', { align: 'center', shadow: false });
    }
  }
  lay.items.forEach(it => drawRowCard(it));
  if (!row.length) drawPixelText('（等待暗置举证…）', W / 2, cy + rh / 2, 15, '#7E93B0', { align: 'center', shadow: false });
}
function drawRowCard(it) {
  const { card, x, y, w, h, seat } = it;
  const revealed = it.revealed === true;
  const removed = it.removed === true;
  if (revealed && !removed) {
    UIKit.drawCard(ctx, x, y, w, h, card, { col: seat === mySeat ? campSoft(seat) : '#f6e9c8', seat, noDesc: true });
    const pt = partyOf(seat);
    pxRect(x + w / 2 - 20, y - 9, 40, 18, campColor(seat));
    pxBorder(x + w / 2 - 20, y - 9, 40, 18, '#111111', 1.5);
    drawPixelText(pt.sym, x + w / 2, y, 11, contrast(campColor(seat)), { align: 'center', shadow: false });
    // 技能闪光（计票时）
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
    // 证据排除：暗红脉冲边框（不祥感）
    if (card.skill === 'terrorist') {
      const on = Math.sin(performance.now() / 130) > 0 ? 1 : 0.45;
      ctx.save();
      ctx.globalAlpha = on;
      pxBorder(x - 5, y - 5, w + 10, h + 10, '#FF3B30', 3);
      ctx.restore();
    }
  } else if (removed) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    UIKit.drawCardBackAt(ctx, x, y, w, h, '#555555');
    ctx.restore();
    drawPixelText('✕ 档案', x + w / 2, y + h / 2, 13, '#FF5A4E', { align: 'center' });
  } else {
    UIKit.drawCardBackAt(ctx, x, y, w, h, PAL.ui.b);
    // 暗置中的证据排除：红光闪烁预示危险
    if (card.skill === 'terrorist') {
      const on = Math.sin(performance.now() / 120) > 0 ? 0.85 : 0.2;
      ctx.save();
      ctx.globalAlpha = on;
      pxBorder(x - 3, y - 3, w + 6, h + 6, '#FF3B30', 3);
      ctx.restore();
    }
    drawPixelText('暗置', x + w / 2, y + h / 2, 12, '#D9BE8B', { align: 'center', shadow: false });
  }
  // 证据排除选目标 / 政治操盘换位选目标
  if (view.revealPending && view.revealPending.owner === mySeat && !removed && seat !== mySeat) {
    pxBorder(x - 4, y - 4, w + 8, h + 8, '#FF5A4E', 4);
    hoverCards.push({ x, y, w, h, kind: 'target', data: { targetUid: card.uid } });
  }
  // 已亮出的行卡：悬停查看完整详情（悬浮信息卡）
  if (revealed && !removed && !(view.revealPending && view.revealPending.owner === mySeat && seat !== mySeat)) {
    hoverCards.push({ x, y, w, h, kind: 'row', card });
  }
  if (view.phase === 'count' && view.swapPending && view.swapPending.owner === mySeat && !removed
      && view.swapPending.candidates && view.swapPending.candidates.indexOf(card.uid) >= 0) {
    const on = Math.sin(performance.now() / 120) > 0 ? 1 : 0.4;
    ctx.save();
    ctx.globalAlpha = on;
    pxBorder(x - 5, y - 5, w + 10, h + 10, '#FFD60A', 4);
    ctx.restore();
    hoverCards.push({ x, y, w, h, kind: 'swapTarget', data: { targetUid: card.uid } });
  }
}
/* 面板数值流：从 nx 开始向右排，先测量再绘制，放不下则级联隐藏后续低优先级项（hover 仍可查看） */
function panelFlow(nx, y, size, items) {
  const bold = '700 ';
  const gap = 12;
  for (const it of items) {
    const w2 = textWidth(it.txt, bold + size + 'px ' + _FONT_BASE) + gap;
    if (nx + w2 > W - 14) break;   // 放不下 → 级联隐藏剩余项
    drawPixelText(it.txt, nx, y, size, it.col, { shadow: false });
    nx += w2;
  }
  return nx;
}
function renderPanels() {
  // 顶部紧凑信息条（取代旧中部大横板）：阵营头像 + 名字 + ⊙ + 支持度 + 丑闻 + 行动标志
  // P1-8：数据源 = UIPresenter.project(view) 的 ViewModel；vm 缺失时防御性降级不画
  if (!vm) return;
  const g = vm.meta;
  const seats = vm.seats;
  const n = seats.length;
  const ph = panelHeight();
  const act = currentActSeat();
  for (let i = 0; i < n; i++) {
    const s = seats[i];
    const pr = panelRect(i);
    const { x, y, w } = pr;
    const isMe = i === mySeat;
    const crown = vm.hud.leader === i ? ' 👑' : '';
    // 焦点模式（美术意见2 轻量版）：非我方行动回合时，无关座位面板压暗减少视觉噪音
    const focusPhase = g.phase === 'buy' || g.phase === 'play' || g.phase === 'discard' || g.phase === 'preEvent' || g.phase === 'postEvent';
    const focusDim = screen === 'game' && focusPhase && !myTurn() && !isMe && act !== i;
    if (focusDim) { ctx.save(); ctx.globalAlpha = 0.4; }
    pxRect(x, y, w, ph - 4, isMe ? campSoft(i) : '#F2E9D2');
    pxBorder(x, y, w, ph - 4, '#111111', 2);
    if (compact) {
      // 横屏紧凑：两行布局（行1 头像+名字+side；行2 角色名+数值流），字号有下限防模糊
      const av = 14, avY = y + 3;
      const pt = partyOf(i);
      pxRect(x + 6, avY, av, av, campColor(i));
      pxBorder(x + 6, avY, av, av, '#111111', 2);
      drawPixelText(pt.sym, x + 6 + av / 2, avY + av / 2, 10, contrast(campColor(i)), { align: 'center', shadow: false });
      const nmR1 = drawPixelText(s.name + (isMe ? '（你）' : '') + crown, x + 24, y + 6, 11, '#111111', { shadow: false });
      if (s.side) drawPixelText(s.side === 'prosecutor' ? '·检方' : '·辩护方', x + 24 + nmR1.w + 4, y + 6, 9, s.side === 'prosecutor' ? '#D82E2F' : '#2F6FD8', { shadow: false });
      // 行2：角色名（fitText 限宽）+ 数值流（放不下级联隐藏）
      let nx2 = x + 24;
      if (s.char) {
        const fCh = fitText('·' + s.char.name, Math.max(26, w * 0.20), 10);
        drawPixelText(fCh.text, x + 24, y + 15, fCh.size, '#C0392B', { shadow: false });
        nx2 = x + 24 + fCh.w + 8;
        hoverCards.push({ x: x + 24, y: y + 6, w: Math.min(160, w * 0.32), h: 16, kind: 'charSkill', data: { ch: s.char } });
      }
      const sc = s.scandal || 0;
      const fs2 = UI.fs.num;
      const flow = [];
      flow.push({ txt: '⊙' + s.money, col: '#B8860B' });
      flow.push({ txt: '⚖' + s.support, col: '#111111' });
      flow.push({ txt: '😈' + sc, col: sc > 0 ? '#E04343' : '#8A8A8A' });
      if (UI.show.jury && s.juryTokens > 0) flow.push({ txt: '🕊' + s.juryTokens + '/3', col: '#7B4FC9' });
      if (UI.show.prev && g.precedentSeat === i) flow.push({ txt: '⚖️先例', col: '#7B4FC9' });
      if (UI.show.handN) {
        if (isMe) flow.push({ txt: '手牌' + s.handCount, col: '#333333' });
        else if (act === i && g.phase === 'play') flow.push({ txt: '⚡举证中', col: '#FF5A4E' });
      }
      if (UI.show.locked && s.lockedCount) flow.push({ txt: '🔒' + s.lockedCount, col: '#0A84FF' });
      if (act === i && g.phase !== 'play') flow.push({ txt: '▶行动中', col: '#FF5A4E' });
      panelFlow(nx2, y + ph / 2, fs2, flow);
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
      // 角色名（fitText 限宽）+ 数值流
      let nx2 = x + 34;
      if (s.char) {
        const fCh2 = fitText((s.side === 'prosecutor' ? '检方·' : '辩方·') + s.char.name, Math.max(26, w * 0.22), 10.5);
        drawPixelText(fCh2.text, x + 34, y + 21, fCh2.size, '#C0392B', { shadow: false });
        nx2 = x + 34 + fCh2.w + 10;
        hoverCards.push({ x: x + 34, y: y + 14, w: Math.min(160, w * 0.32), h: 14, kind: 'charSkill', data: { ch: s.char } });
      }
      const sc = s.scandal || 0;
      const fs2 = UI.fs.num;
      const flow = [];
      flow.push({ txt: '⊙ ' + s.money, col: '#B8860B' });
      flow.push({ txt: '⚖ ' + s.support, col: '#111111' });
      flow.push({ txt: '😈' + sc, col: sc > 0 ? '#E04343' : '#8A8A8A' });
      if (UI.show.jury && s.juryTokens > 0) flow.push({ txt: '🕊' + s.juryTokens + '/3', col: '#7B4FC9' });
      if (UI.show.prev && g.precedentSeat === i) flow.push({ txt: '⚖️先例', col: '#7B4FC9' });
      if (UI.show.handN) {
        if (isMe) flow.push({ txt: '手牌 ' + s.handCount, col: '#333333' });
        else if (act === i && g.phase === 'play') flow.push({ txt: '⚡ 举证中', col: '#FF5A4E' });
      }
      if (UI.show.locked && s.lockedCount) flow.push({ txt: '🔒' + s.lockedCount, col: '#0A84FF' });
      if (act === i && g.phase !== 'play') flow.push({ txt: '▶ 行动中', col: '#FF5A4E' });
      panelFlow(nx2, y + ph / 2, fs2, flow);
      // 丑闻条（tiny 档隐藏）
      if (UI.show.scandalBar) {
        pxRect(x + w * 0.52 + 24, y + 6, 40, 6, '#3A2A2A');
        pxBorder(x + w * 0.52 + 24, y + 6, 40, 6, '#111111', 1);
        if (sc > 0) {
          const scCol = sc <= 1 ? '#7DCEA0' : (sc <= 3 ? '#F1C40F' : '#E04343');
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
    // 事件目标选择（enemy 事件）/ 选择起始玩家：点击头像（紧凑与非紧凑共用，用头像矩形）
    const avX = compact ? 6 : 6, avY2 = compact ? y + 3 : y + 4, avSz = compact ? 14 : 22;
    if ((g.phase === 'preEvent' || g.phase === 'postEvent') && eventPick && eventPick.seat === mySeat && i !== mySeat) {
      pxBorder(x + 4, y + 2, avSz + 4, avSz + 4, '#FF5A4E', 4);
      hoverCards.push({ x: x + avX, y: avY2, w: avSz, h: avSz, kind: 'eventTarget', data: { targetSeat: i } });
    }
    if (g.phase === 'chooseStarter' && g.starterPicker === mySeat && !g.starterChosen) {
      pxBorder(x + 4, y + 2, avSz + 4, avSz + 4, '#FFD60A', 4);
      hoverCards.push({ x: x + avX, y: avY2, w: avSz, h: avSz, kind: 'starter', data: { starterSeat: i } });
    }
    if (focusDim) ctx.restore();
  }
}
function currentActSeat() {
  const g = view;
  switch (g.phase) {
    case 'play': return g.turn;
    case 'preEvent': case 'postEvent': return g.eventTurnSeat;
    case 'discard': return g.discardSeat;
    case 'reveal': return g.revealPending ? g.revealPending.owner : -1;
    case 'count': return g.swapPending ? g.swapPending.owner : -1;
    case 'chooseStarter': return g.starterPicker;
    default: return -1;
  }
}
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
function renderMarket(s, x, y, w, h) {
  const k = s.market.length || 1;
  drawPixelText(buyMode === 'lock' ? '🔒 留证模式（点牌留证）' : '证物架 · 点牌传唤（⊙' + s.money + '）', 10, H - HAND_AREA_H + 12, 14, '#FFD60A', { shadow: false });
  marketSlotRects(s).forEach(r => {
    const card = r.card;
    const locked = s.lockedUids.indexOf(card.uid) >= 0;
    const cost = ElectionCore.buyCostOf(s, card);
    const afford = s.money >= cost;
    ctx.save();
    ctx.globalAlpha = locked ? 1 : (afford ? 1 : 0.55);
    UIKit.drawCard(ctx, r.x, r.y, r.w, r.h, card, { col: locked ? '#cfc3f2' : '#f6e9c8' });
    ctx.restore();
    if (locked) drawPixelText('🔒', r.x + r.w / 2, r.y + r.h * 0.4, 18, '#1E4FB5', { align: 'center', shadow: false });
    hoverCards.push({ x: r.x, y: r.y, w: r.w, h: r.h, kind: 'market', data: { card, uid: card.uid } });
  });
  void k;
}
function renderBottom() {
  const me = view.seats[mySeat];
  const y0 = H - HAND_AREA_H;
  // 底部全宽大卡牌区底台（杀戮尖塔式）
  pxRect(6, y0 + 2, W - 12, HAND_AREA_H - 8, 'rgba(16,20,28,0.88)');
  pxBorder(6, y0 + 2, W - 12, HAND_AREA_H - 8, '#3A4258', 2);
  const showEvents = view.phase === 'preEvent' || view.phase === 'postEvent';
  const showHand = view.phase === 'play' || view.phase === 'discard';
  if (view.phase === 'buy') {
    renderMarket(me, 10, y0 + 28, portraitMode ? W - 20 : W - 260, HAND_AREA_H - 40);
  } else if (showEvents) {
    // 事件牌：分批 4 张 + 翻页箭头
    const evs = me.events || [];
    const maxPage = Math.max(0, Math.ceil(evs.length / 4) - 1);
    if (eventPage > maxPage) eventPage = maxPage;
    drawPixelText('事件牌（' + evs.length + '）', 10, y0 + 14, 14, '#FFD60A', { shadow: false });
    if (maxPage > 0) {
      addButton('evPrev', 118, y0 + 3, 40, 26, '◀', { disabled: eventPage <= 0 });
      addButton('evNext', 162, y0 + 3, 40, 26, '▶', { disabled: eventPage >= maxPage });
      drawPixelText((eventPage + 1) + '/' + (maxPage + 1), 210, y0 + 16, 11, '#C9D6EA', { shadow: false });
    }
    eventSlotRects().forEach(r => {
      const usable = isEventUsable(r.ev);
      UIKit.drawEventCard(ctx, r.x, r.y, r.w, r.h, r.ev, { col: usable ? PAL.events.a : '#8a8a9a' });
      if (usable) hoverCards.push({ x: r.x, y: r.y, w: r.w, h: r.h, kind: 'event', data: { ev: r.ev, uid: r.ev.uid } });
      if (r.ev.used) drawPixelText('✓ 已使用', r.x + r.w / 2, r.y + r.h - 12, 11, '#5AC8FA', { align: 'center', shadow: false });
    });
    if (!evs.length) drawPixelText('（暂无事件牌）', 10, y0 + 60, 13, '#7E93B0', { shadow: false });
  } else if (showHand) {
    const handY = y0 + 28;
    const hh = HAND_AREA_H - 40;
    if (hh >= 64 && me.hand.length) {
      if (portraitMode) {
        // 竖屏纵向手牌抽屉（超级更新#37）：2 列网格 + 左右/上下滚动分页
        const rects = handGridRects(me.hand.length, handY, hh);
        const pages = Math.max(1, Math.ceil(rects.length / PORTRAIT_PER_PAGE));
        if (handScroll > pages - 1) handScroll = pages - 1;
        if (handScroll < 0) handScroll = 0;
        const from = handScroll * PORTRAIT_PER_PAGE;
        const to = Math.min(rects.length, from + PORTRAIT_PER_PAGE);
        drawPixelText('手牌 ' + me.hand.length + ' 张 · ' + (from + 1) + '-' + to + ' / ' + rects.length, 12, y0 + 13, 12.5, '#FFD60A', { shadow: false });
        if (pages > 1) {
          drawPixelText((handScroll + 1) + '/' + pages, W / 2, y0 + 13, 12.5, '#C9D6EA', { align: 'center', shadow: false });
          addButton('handPrev', W - 92, y0 + 2, 40, 24, '◀', { disabled: handScroll <= 0 });
          addButton('handNext', W - 48, y0 + 2, 40, 24, '▶', { disabled: handScroll >= pages - 1 });
        }
        for (let i = from; i < to; i++) {
          const r = rects[i];
          const card = me.hand[i];
          const sel = selected.indexOf(card.uid) >= 0;
          const clickable = canClickHand(card);
          UIKit.drawCard(ctx, r.x, r.y, r.w, r.h, card, { col: sel ? PAL.accent.b : '#f6e9c8' });
          if (clickable) hoverCards.push({ x: r.x, y: r.y, w: r.w, h: r.h, kind: 'hand', data: { card, uid: card.uid } });
          if (sel) pxBorder(r.x - 3, r.y - 3, r.w + 6, r.h + 6, '#FFD400', 4);
        }
      } else {
        const rects = flexRects(me.hand.length, handY, hh, 12, 200, 0);
        me.hand.forEach((card, i) => {
          const r = rects[i];
          const sel = selected.indexOf(card.uid) >= 0;
          const clickable = canClickHand(card);
          UIKit.drawCard(ctx, r.x, r.y, r.w, r.h, card, { col: sel ? PAL.accent.b : '#f6e9c8' });
          if (clickable) hoverCards.push({ x: r.x, y: r.y, w: r.w, h: r.h, kind: 'hand', data: { card, uid: card.uid } });
          if (sel) pxBorder(r.x - 3, r.y - 3, r.w + 6, r.h + 6, '#FFD400', 4);
        });
      }
    } else if (me.hand.length) {
      drawPixelText('手牌 ' + me.hand.length + ' 张', 10, y0 + 40, 14.5, '#9FB3CE', { shadow: false });
    }
  }
  renderActionButtons(me);
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
  if (g.phase === 'play' && g.turn === mySeat && !g.seats[mySeat].playDone) return true;
  if (g.phase === 'discard' && g.discardSeat === mySeat && !g.seats[mySeat].keepDone) {
    return selected.indexOf(card.uid) >= 0 || selected.length < keepMax();
  }
  return false;
}
function keepMax() {
  const s = view.seats[mySeat];
  return 1 + (s.char && s.char.skill && s.char.skill.type === 'keepPlus' ? s.char.skill.v : 0);
}
function isEventUsable(ev) {
  if (!view || ev.used || ev.hidden) return false;
  if (view.eventTurnSeat !== mySeat) return false;   // M3：非我方事件回合事件牌不可用
  const s = view.seats[mySeat];
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
  addButton('backMenu', W / 2 - 110, H - 104, 220, 50, '返回大厅', { primary: true });
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
    title: '法庭黑天鹅',
    body: [
      { t: 'text', s: '庭审中会出现 5 种「黑天鹅」乱局，由行为模式触发（不是随机轮次）。' },
      { t: 'text', s: '疲劳轰炸：本轮举证 ≥3 张 → 本轮 -1 票、此后每轮收入 -1⊙。媒体围猎：单轮丑闻 ≥2 → 全员丑闻 +1。' },
      { t: 'text', s: '程序滥用：单轮程序牌 ≥2 → 罚 2⊙。证人疲劳：单轮证人牌 ≥3 → 本轮 -1 票、此后每张证人牌 -1 票。' },
      { t: 'text', s: '树大招风：连续 2 轮领跑 → 陪审团倾向 -1，开启「反超补偿」（此后每轮落后 ≥2 票方 +1 票）。' },
      { t: 'text', s: '若手中有对应克星技能牌（如「合理怀疑」克树大招风），可当场反驳抵消。' }
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
  { id: 'juryNull', name: '陪审团否决', cat: '胜利', text: '打出「陪审团否决」技能牌可获得 1 名陪审员支持，集满 3 名立即胜诉。源于陪审团否决（Jury Nullification）制度：陪审团可以拒绝适用他们认为不正义的法律。历史上 Zenger 案（1735）和 William Penn 案（1670）均是陪审团否决的著名案例。' },
  { id: 'blackSwan', name: '黑天鹅事件', cat: '事件', text: '5 种由行为模式触发的庭审乱局（疲劳轰炸/媒体围猎/程序滥用/证人疲劳/树大招风）。触发后立即生效并可能永久改变规则，若手中有对应克星技能可当场反驳抵消。' }
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
let hoverRect = null;   // 上一帧放大卡的屏幕矩形（兜底：鼠标停在放大卡上时保持悬停）
function updateHoverAnim() {
  if (screen !== 'game' && screen !== 'draft') { hoverAnim.card = null; return; }
  const now = performance.now();
  let hit = null;
  for (let i = 0; i < hoverCards.length; i++) {
    const h = hoverCards[i];
    if (mouse.x >= h.x && mouse.x <= h.x + h.w && mouse.y >= h.y && mouse.y <= h.y + h.h) { hit = h; break; }
  }
  if (hit) {
    const same = hoverAnim.card && hoverAnim.card.kind === hit.kind
      && (hoverAnim.card.data === hit.data) && (hoverAnim.card.card === hit.card);
    hoverAnim.card = hit;
    if (!same) { hoverAnim.t0 = now; hoverAnim.dir = 1; }
    else hoverAnim.t0 = now;   // 持续悬停：淡入保持满值
  } else if (hoverAnim.card) {
    // 兜底：鼠标停在放大卡上（放大卡不参与命中检测）→ 保持悬停，防止闪烁
    const hr = hoverRect;
    const onEnlarged = hr && mouse.x >= hr.bx && mouse.x <= hr.bx + hr.bw
      && mouse.y >= hr.by && mouse.y <= hr.by + hr.bh;
    if (onEnlarged) { hoverAnim.t0 = now; }
    else if (hoverAnim.dir === 1) { hoverAnim.t0 = now; hoverAnim.dir = 0; }
    else if (now - hoverAnim.t0 > 200) hoverAnim.card = null;   // 淡出完成清理
  }
}
function hoverAlpha() {
  if (!hoverAnim.card) return 0;
  const dt = performance.now() - hoverAnim.t0;
  if (hoverAnim.dir === 1) return clamp(dt / 130, 0, 1);
  return clamp(1 - dt / 200, 0, 1);
}
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
function drawHoverTooltip() {
  const h = hoverAnim.card;
  if (!h) return;
  const a = hoverAlpha();
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
  if (h.kind === 'char' && h.data) { UIKit.drawCharCard(ctx, bx, by, bw, bh, h.data, campColor(mySeat), true); drawCardKind = true; }
  else if (h.kind === 'event' && h.data && h.data.ev) { UIKit.drawEventCard(ctx, bx, by, bw, bh, h.data.ev); drawCardKind = true; }
  else if (h.kind === 'charSkill') { /* 只出文字框 */ }
  else if (h.card || (h.data && (h.data.card || h.data.ev))) { UIKit.drawCard(ctx, bx, by, bw, bh, h.card || h.data.card || h.data.ev); drawCardKind = true; }
  const info = tooltipInfo(h);
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
}

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
      const maxPg = Math.max(0, Math.ceil((mySeatObj().events || []).length / 4) - 1);
      eventPage = Math.min(maxPg, (eventPage || 0) + 1); sfx('click');
      break;
    }
    case 'backMenu':
      if (confirm('确定要离开当前对局吗？进度将丢失。')) location.reload();
      break;
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
function sigOf(arr) { return (arr || []).map((x, i) => (x.card && x.card.uid != null ? x.card.uid : 'H' + x.seat + '_' + i) + (x.removed ? ':R' : '') + (x.revealed ? ':V' : '')).join(','); }
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
    lastLogN = view.logs.length;
    overFxDone = view.gameOver;
    sideRevealDone = false;   // 新对局/重连：允许重新播放抛硬币
  }
  lastV = view.version;
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
  if (view.startingSeat !== lastStarterSeat && lastStarterSeat !== null && view.phase !== 'pickChar') {
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
  if (mySeat != null) {
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
  // 事件打出 → 新闻（服务端发送完整日志，length 单调递增；S3：不再因 slice(-12) 截断而失效）
  if (view.logs.length !== lastLogN) {
    if (view.logs.length < lastLogN) lastLogN = view.logs.length;   // 新对局：静默对齐
    for (let i = lastLogN; i < view.logs.length; i++) {
      const lg = view.logs[i] || '';
      const m = lg.match(/打出事件【(.+?)】/);
      const m2 = lg.match(/法庭黑天鹅事件触发：【(.+?)】/);
      if (m || m2) {
        const nm = m ? m[1] : m2[1];
        const evT = (ElectionCore.data.EVENT_TEMPLATES || []).find(t => t.name === nm);
        addFx({ type: 'news', dur: 2000, title: nm, sub: evT ? evT.desc : '' });
        // 法庭高潮：事件生效瞬间全屏 OBJECTION!（法槌音效 + 冲击感）
        addFx({ type: 'objection', dur: 1500, sub: m2 ? '法庭黑天鹅 · 行为触发' : '事件牌生效' });
        shakeAmp = Math.max(shakeAmp, 14);
        sfx('gavel');
      }
    }
    lastLogN = view.logs.length;
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
  } catch (e) {
    if (console && console.error) console.error('[render]', e);   // M1：渲染异常不中断主循环，避免画面永久冻结
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
