/* ============================================================
 * shared/draw-primitives.js — 双端统一基础绘制原语（超级更新#6）
 * ------------------------------------------------------------
 * 本文件是以下基础绘制原语的【唯一源】，client.js 与 singleplayer.html
 * 均不再维护副本（singleplayer.html 经 _build_ui.js 内联本文件）。
 *   文本：textWidth / fitText / drawPixelText / drawWrapText
 *   图形：jaggedRectPath / pxRect / pxBorder / comicShadow
 *   字体表：_FONT_BASE（全局 var，供 btnFont / fontBase 等读取）
 * 依赖的全局（均运行时读取，故加载顺序无关）：
 *   ctx   —— 画布上下文（两端均以顶层 var 声明 → window.ctx）
 *   PAL   —— shared/theme.js 挂载的全局配色
 *   clamp —— 两端顶层 function 声明
 * 约定：全部为 function 声明（进 window），const 会漏（评审教训）。
 * ============================================================ */
var _FONT_BASE = '"Noto Sans SC","Microsoft YaHei","PingFang SC","Impact","Arial Black",sans-serif';
const _twCache = new Map();
const _fitCache = new Map();

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
  ctx.fillStyle = col;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.restore();
}

/** 美漫粗墨线边框：miter 尖角 + 外粗内细双线 */
function pxBorder(x, y, w, h, col, t) {
  t = clamp(Math.max(1.5, t || 2), 1.5, 6);
  ctx.save();
  ctx.strokeStyle = col;
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
    ctx.strokeStyle = o.outline || PAL.black;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = color;
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
