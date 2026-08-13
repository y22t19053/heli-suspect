/* ============================================================
 * _build_ui.js — 把 shared/ui-kit.js、shared/theme.js 与
 *                public/UIPresenter.js 内联进 singleplayer.html
 * ------------------------------------------------------------
 * 用法：node _build_ui.js
 * 原理：在 singleplayer.html 中查找
 *       THEME_START / THEME_END、UIKIT_START / UIKIT_END、
 *       UIPRESENTER_START / UIPRESENTER_END、RENDERCORE_START / RENDERCORE_END
 *       与 DRAWPRIMS_START / DRAWPRIMS_END 五组成对标记（含星号注释），
 *       把中间内容替换为最新源码（保留标记以便下次构建）。
 * 输出：写回根 singleplayer.html，并复制到 public/singleplayer.html。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const root = __dirname;

const htmlPath = path.join(root, 'singleplayer.html');
const pubPath = path.join(root, 'public', 'singleplayer.html');
const themePath = path.join(root, 'shared', 'theme.js');
const kitPath = path.join(root, 'shared', 'ui-kit.js');
const presPath = path.join(root, 'public', 'UIPresenter.js');
const corePath = path.join(root, 'shared', 'render-core.js');
const drawPrimsPath = path.join(root, 'shared', 'draw-primitives.js');

let html = fs.readFileSync(htmlPath, 'utf8');
const theme = fs.readFileSync(themePath, 'utf8');
const kit = fs.readFileSync(kitPath, 'utf8');
const pres = fs.readFileSync(presPath, 'utf8');
const core = fs.readFileSync(corePath, 'utf8');
const drawPrims = fs.readFileSync(drawPrimsPath, 'utf8');

function inlineBlock(src, start, end, body) {
  const si = src.indexOf(start);
  const ei = src.indexOf(end, si + start.length);
  if (si < 0 || ei < 0) {
    console.error('✗ singleplayer.html 缺少 ' + start + ' 标记，无法内联');
    process.exit(1);
  }
  return src.slice(0, si + start.length) + '\n' + body + '\n' + src.slice(ei);
}

// 依次内联 THEME、DRAWPRIMS、UIKIT、UIPRESENTER 与 RENDERCORE
html = inlineBlock(html, '/*__THEME_START__*/', '/*__THEME_END__*/', theme);
html = inlineBlock(html, '/*__DRAWPRIMS_START__*/', '/*__DRAWPRIMS_END__*/', drawPrims);
html = inlineBlock(html, '/*__UIKIT_START__*/', '/*__UIKIT_END__*/', kit);
html = inlineBlock(html, '/*__UIPRESENTER_START__*/', '/*__UIPRESENTER_END__*/', pres);
html = inlineBlock(html, '/*__RENDERCORE_START__*/', '/*__RENDERCORE_END__*/', core);

fs.writeFileSync(htmlPath, html, 'utf8');
fs.writeFileSync(pubPath, html, 'utf8');

// 校验
const a = fs.readFileSync(htmlPath, 'utf8');
const b = fs.readFileSync(pubPath, 'utf8');
const aH = require('crypto').createHash('md5').update(a).digest('hex');
const bH = require('crypto').createHash('md5').update(b).digest('hex');
console.log((aH === bH ? '✓' : '✗') + ' 内联完成，MD5=' + aH + (aH === bH ? '' : '（不一致！）'));
