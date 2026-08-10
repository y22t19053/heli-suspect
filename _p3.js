const pw = require('playwright-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
(async () => {
  const browser = await pw.chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  await page.addInitScript(() => { try { localStorage.setItem('elec_seed', 'consistency-1'); } catch(e){} });
  await page.goto('http://localhost:3000/singleplayer.html');
  await page.waitForTimeout(1200);
  const rect = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { w: r.width, h: r.height }; });
  await page.mouse.click(rect.w / 2, rect.h * 0.68 + 31);
  await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const g = eval('game');
      if (!g || g.gameOver) break;
      const need = ElectionCore.needsAIAction(g);
      if (need.length) { for (const s of need) ElectionCore.aiAct(g, s); await wait(20); continue; }
      const me = g.seats[0];
      if (g.phase === 'pickChar' && !me.char && g.draftCandidates[0] && g.draftCandidates[0].length) { ElectionCore.apply(g, 0, { type: 'pickChar', charId: g.draftCandidates[0][0].id }); continue; }
      if (g.phase === 'chooseStarter' && g.starterPicker === 0 && !g.starterChosen) { ElectionCore.apply(g, 0, { type: 'pickStarter', starterSeat: 0 }); continue; }
      if (g.phase === 'buy') break;
      ElectionCore.advance(g);
    }
    return eval('game').phase;
  });
  await page.waitForTimeout(3200);
  // CSS 逻辑坐标采样：canvas 内部 px / rect 比例 = scale
  const prof = await page.evaluate(() => {
    const cv = document.querySelector('canvas'); const c = cv.getContext('2d');
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    const r = cv.getBoundingClientRect();
    const sx = cv.width / r.width, sy = cv.height / r.height;  // 内部/逻辑比例
    const rows = [];
    for (let ly = 0; ly < Math.round(r.height); ly += 4) {
      const py = Math.round(ly * sy);
      let rr = 0, gg = 0, bb = 0, n = 0, mx = 0;
      for (let lx = 0; lx < Math.round(r.width); lx += 8) {
        const px = Math.round(lx * sx);
        const i = (py * cv.width + px) * 4; rr += d[i]; gg += d[i+1]; bb += d[i+2]; n++;
      }
      const lum = (rr + gg + bb) / 3 / n;
      rows.push({ y: ly, lum: Math.round(lum) });
    }
    return { rows, W: Math.round(r.width), H: Math.round(r.height), sx, sy, cw: cv.width, ch: cv.height };
  });
  console.log('CSS=' + prof.W + 'x' + prof.H + ' canvas=' + prof.cw + 'x' + prof.ch + ' scale=' + prof.sx.toFixed(2));
  let seg = [], prev = null;
  prof.rows.forEach(rw => {
    const cat = rw.lum > 130 ? '#' : rw.lum > 80 ? 'O' : rw.lum > 40 ? 'o' : '.';
    if (!seg.length || seg[seg.length-1].cat !== cat) seg.push({ cat, y0: rw.y, y1: rw.y, max: rw.lum });
    else { seg[seg.length-1].y1 = rw.y; seg[seg.length-1].max = Math.max(seg[seg.length-1].max, rw.lum); }
  });
  seg.forEach(s => console.log('  y ' + String(s.y0).padStart(3) + '-' + String(s.y1).padStart(3) + ' [' + s.cat + ' max=' + s.max + ']'));
  await browser.close();
})();
