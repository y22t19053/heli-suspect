/* _px_probe.js — 探索：同种子同操作序列，单机 vs 联机 buy 阶段像素差异分布
 * 运行：node _px_probe.js（前置：localhost:3000 服务器在线）
 */
'use strict';
const pw = require('playwright-core');
const fs = require('fs');
const path = require('path');
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const BASE = 'http://localhost:3000';
const edgePath = EDGE_CANDIDATES.find(p => fs.existsSync(p));
const SEED = 'consistency-1';

async function grabPixels(page, bands) {
  return page.evaluate((bands) => {
    const cv = document.querySelector('canvas');
    if (!cv) return null;
    const c = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    const img = c.getImageData(0, 0, w, h).data;
    // 每带：步进采样（每 4 像素取 1），统计背景(15,27,45)/非背景，以及该带内非背景像素均值色
    const out = [];
    const step = 4;
    for (const [y0, y1] of bands) {
      let n = 0, nb = 0, rs = 0, gs = 0, bs = 0;
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y += step) {
        for (let x = 0; x < w; x += step) {
          const i = (y * w + x) * 4;
          const r = img[i], g = img[i + 1], b = img[i + 2], a = img[i + 3];
          n++;
          if (a > 0 && !(Math.abs(r - 15) <= 20 && Math.abs(g - 27) <= 20 && Math.abs(b - 45) <= 20)) {
            nb++;
            rs += r; gs += g; bs += b;
          }
        }
      }
      out.push({ y0, y1, ratio: +(nb / n).toFixed(4), mean: nb ? [Math.round(rs / nb), Math.round(gs / nb), Math.round(bs / nb)] : null });
    }
    return { w, h, bands: out };
  }, bands);
}

async function bandDiff(sp, mp) {
  // 逐像素 diff（步进 4）按带统计
  const bands = sp.bands.map((b, i) => {
    const mb = mp.bands[i];
    return { y0: b.y0, y1: b.y1, sp: b.ratio, mp: mb.ratio, spMean: b.mean, mpMean: mb.mean };
  });
  return bands;
}

(async () => {
  const browser = await pw.chromium.launch({ executablePath: edgePath, headless: true });
  const bands = [];
  for (let y = 0; y < 800; y += 40) bands.push([y, y + 40]);

  // ---------- 单机 ----------
  const sp = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const spErr = [];
  sp.on('pageerror', e => spErr.push('pageerror: ' + e.message));
  sp.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) spErr.push('console: ' + m.text()); });
  await sp.addInitScript((s) => { try { localStorage.setItem('elec_seed', s); } catch (e) {} }, SEED);
  await sp.goto(BASE + '/singleplayer.html');
  await sp.waitForTimeout(900);
  const r1 = await sp.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { w: r.width, h: r.height }; });
  await sp.mouse.click(r1.w / 2, r1.h * 0.68 + 31);
  await sp.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const g = eval('game');
      if (!g || g.gameOver) break;
      const need = ElectionCore.needsAIAction(g);
      if (need.length) { for (const s of need) ElectionCore.aiAct(g, s); await wait(20); continue; }
      const me = g.seats[0];
      if (g.phase === 'pickChar' && !me.char && g.draftCandidates[0] && g.draftCandidates[0].length) {
        ElectionCore.apply(g, 0, { type: 'pickChar', charId: g.draftCandidates[0][0].id }); continue;
      }
      if (g.phase === 'chooseStarter' && g.starterPicker === 0 && !g.starterChosen) {
        ElectionCore.apply(g, 0, { type: 'pickStarter', starterSeat: 0 }); continue;
      }
      if (g.phase === 'buy') break;
      ElectionCore.advance(g);
    }
    return { phase: eval('game').phase, seed: eval('game').seed, seedRaw: eval('game').seedRaw };
  });
  await sp.waitForTimeout(1200);
  const spPix = await grabPixels(sp, bands);
  await sp.screenshot({ path: path.join(__dirname, '_shots', 'px_sp.png') });
  console.log('[单机] ' + JSON.stringify(await sp.evaluate(() => ({ ph: eval('game').phase, seed: eval('game').seed, seedRaw: eval('game').seedRaw }))));
  console.log('[单机错误] ' + spErr.join(' | '));

  // ---------- 联机 ----------
  const mp = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const mpErr = [];
  mp.on('pageerror', e => mpErr.push('pageerror: ' + e.message));
  mp.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) mpErr.push('console: ' + m.text()); });
  await mp.goto(BASE + '/');
  await mp.waitForTimeout(1000);
  await mp.fill('#inp-seed', SEED);
  await mp.click('#btn-solo');
  await mp.waitForSelector('#lobby:not(.hidden)', { timeout: 8000 });
  await mp.click('#btn-start');
  await mp.waitForFunction(() => window.__game && window.__game.view && window.__game.view.phase, { timeout: 12000 });
  await mp.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const v = window.__game.view;
      if (!v || v.gameOver) break;
      const mySeat = window.__game.mySeat;
      const me = v.seats[mySeat];
      if (v.phase === 'pickChar' && !me.char && v.draftCandidates && v.draftCandidates.length) {
        window.doAction({ type: 'pickChar', charId: v.draftCandidates[0].id }); await wait(60); continue;
      }
      if (v.phase === 'chooseStarter' && v.starterPicker === mySeat && !v.starterChosen) {
        window.doAction({ type: 'pickStarter', starterSeat: mySeat }); await wait(60); continue;
      }
      if (v.phase === 'buy') break;
      await wait(80);
    }
    return { phase: window.__game.view.phase, seed: window.__game.view.seed, seedRaw: window.__game.view.seedRaw };
  });
  await mp.waitForTimeout(1200);
  const mpPix = await grabPixels(mp, bands);
  await mp.screenshot({ path: path.join(__dirname, '_shots', 'px_mp.png') });
  console.log('[联机] ' + JSON.stringify(await mp.evaluate(() => ({ ph: window.__game.view.phase, seed: window.__game.view.seed, seedRaw: window.__game.view.seedRaw, mySeat: window.__game.mySeat }))));
  console.log('[联机错误] ' + mpErr.join(' | '));

  // ---------- 对比 ----------
  console.log('=== 分带对比（y0-y1 | 单机非背景占比 | 联机非背景占比 | 均值色 单机 vs 联机）===');
  for (let i = 0; i < spPix.bands.length; i++) {
    const s = spPix.bands[i], m = mpPix.bands[i];
    const flag = Math.abs(s.ratio - m.ratio) > 0.01 ? '  <-- 差异' : '';
    console.log(
      String(s.y0).padStart(4) + '-' + String(s.y1).padStart(3)
      + '  sp=' + s.ratio.toFixed(3) + ' mp=' + m.ratio.toFixed(3)
      + '  mean sp=' + JSON.stringify(s.mean) + ' mp=' + JSON.stringify(m.mean) + flag);
  }
  await browser.close();
  console.log('单机错误：' + spErr.join(' | '));
  console.log('联机错误：' + mpErr.join(' | '));
})();
