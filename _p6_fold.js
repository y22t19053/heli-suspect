/* 任务6 竖屏折叠交互验证（临时诊断，验证后删除）
 * 1) 竖屏进对局 → 检查 rowFolded 默认折叠
 * 2) 检查折叠条按钮注册（buttons 中 act==='toggleRow'）
 * 3) 点击折叠条按钮 → rowFolded 翻转 + 行区展开（rowBackdrop 出现）
 * 4) 再点收起 → 恢复折叠
 * 5) 全程无 JS 错误 + canvas 无溢出 */
const { chromium } = require('playwright-core');
const path = require('path');
const EXE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 3, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|net::ERR_ABORTED|net::ERR/.test(m.text())) errors.push(m.text()); });

  await page.goto(BASE + '/singleplayer.html');
  await page.waitForTimeout(1200);
  const rect = await page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  await page.mouse.click(rect.w / 2, rect.h * 0.68 + 31);   // 开庭审理

  // 推进到 buy 阶段（保持不动）
  await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const g = eval('game');
      if (!g || g.gameOver) break;
      const need = ElectionCore.needsAIAction(g);
      if (need.length) { for (const s of need) ElectionCore.aiAct(g, s); await wait(20); continue; }
      const me = g.seats[0];
      if (g.phase === 'pickChar' && !me.char && g.draftCandidates[0] && g.draftCandidates[0].length)
        ElectionCore.apply(g, 0, { type: 'pickChar', charId: g.draftCandidates[0][0].id });
      if (g.phase === 'chooseStarter' && g.starterPicker === 0 && !g.starterChosen)
        ElectionCore.apply(g, 0, { type: 'pickStarter', starterSeat: 0 });
      if (g.phase === 'buy') break;
      ElectionCore.advance(g);
      await wait(25);
    }
  });
  await page.waitForTimeout(800);

  // 1) 初始状态：rowFolded 默认 true（折叠）
  const st1 = await page.evaluate(() => ({
    rowFolded: eval('rowFolded'),
    portraitMode: eval('portraitMode'),
    actH: eval('portraitMode ? 48 : 0'),
    toggleBtns: eval('buttons').filter(b => b.act === 'toggleRow').length,
    phase: eval('game.phase'),
  }));
  console.log('[1] 初始', JSON.stringify(st1));
  if (!st1.portraitMode) throw new Error('应处于竖屏');
  if (st1.rowFolded !== true) throw new Error('rowFolded 应默认 true，实际 ' + st1.rowFolded);
  if (st1.toggleBtns !== 1) throw new Error('折叠态应注册 1 个 toggleRow 按钮，实际 ' + st1.toggleBtns);

  // 2) 折叠条像素检查：行区标题区应出现深色条（在 rowLayout().cy 附近采样非背景色）
  const strip = await page.evaluate(() => {
    const cv = document.querySelector('canvas');
    const c = cv.getContext('2d');
    const lay = eval('rowLayout()');
    const y0 = Math.round(lay.cy - 4);
    const d = c.getImageData(0, y0, cv.width, 26).data;
    let dark = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) { n++; if (d[i] < 80 && d[i + 1] < 90 && d[i + 2] < 110) dark++; }
    return { cy: lay.cy, darkRatio: dark / n, hasFoldBtn: eval('buttons').some(b => b.act === 'toggleRow') };
  });
  console.log('[2] 折叠条', JSON.stringify(strip));
  if (strip.darkRatio < 0.3) throw new Error('折叠条深色底占比过低 ' + strip.darkRatio);

  // 3) 点击「▾ 展开」按钮 → rowFolded 翻转为 false
  const btn = await page.evaluate(() => {
    const b = eval('buttons').find(b => b.act === 'toggleRow');
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
  });
  await page.mouse.click(btn.x, btn.y);
  await page.waitForTimeout(400);
  const st2 = await page.evaluate(() => ({ rowFolded: eval('rowFolded'), toggleBtns: eval('buttons').filter(b => b.act === 'toggleRow').length }));
  console.log('[3] 展开后', JSON.stringify(st2));
  if (st2.rowFolded !== false) throw new Error('点击展开后 rowFolded 应为 false，实际 ' + st2.rowFolded);

  // 4) 再点击「▲ 收起」→ 恢复折叠
  const btn2 = await page.evaluate(() => {
    const b = eval('buttons').find(b => b.act === 'toggleRow');
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
  });
  await page.mouse.click(btn2.x, btn2.y);
  await page.waitForTimeout(400);
  const st3 = await page.evaluate(() => ({ rowFolded: eval('rowFolded') }));
  console.log('[4] 收起后', JSON.stringify(st3));
  if (st3.rowFolded !== true) throw new Error('点击收起后 rowFolded 应为 true，实际 ' + st3.rowFolded);

  // 5) 无 JS 错误 + canvas 无溢出
  const fits = await page.evaluate(() => {
    const cv = document.querySelector('canvas');
    const r = cv.getBoundingClientRect();
    return r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
  });
  console.log('[5] canvasFits=' + fits + ' errors=' + JSON.stringify(errors));
  if (!fits) throw new Error('canvas 溢出');
  if (errors.length) throw new Error('JS 错误: ' + errors.join(' | '));

  await page.screenshot({ path: '_shots/task6_portrait_fold.png' });
  console.log('TASK6_FOLD_OK');
  await browser.close();
})().catch(e => { console.error('FAIL: ' + e.message); process.exit(1); });
