/* 任务6 联机竖屏折叠验证（临时诊断，验证后删除） */
const { chromium } = require('playwright-core');
const EXE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 3, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|net::ERR_ABORTED|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE + '/');
  await page.waitForTimeout(1200);
  await page.fill('#inp-seed', 'consistency-1');
  await page.click('#btn-solo');
  await page.waitForSelector('#lobby:not(.hidden)', { timeout: 8000 });
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__game && window.__game.view && window.__game.view.phase, { timeout: 12000 });
  await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const v = window.__game.view;
      if (!v || v.gameOver) break;
      const mySeat = window.__game.mySeat;
      const me = v.seats[mySeat];
      if (v.phase === 'pickChar' && !me.char && v.draftCandidates && v.draftCandidates.length) { window.doAction({ type: 'pickChar', charId: v.draftCandidates[0].id }); await wait(60); continue; }
      if (v.phase === 'chooseStarter' && v.starterPicker === mySeat && !v.starterChosen) { window.doAction({ type: 'pickStarter', starterSeat: mySeat }); await wait(60); continue; }
      if (v.phase === 'buy') break;
      await wait(80);
    }
  });
  await page.waitForTimeout(800);
  const st = await page.evaluate(() => {
    const btns = eval('buttons');
    const btn = btns.find(b => b.id === 'toggleRow');
    return {
      rowFolded: eval('rowFolded'), portraitMode: eval('portraitMode'),
      hasBtn: !!btn, btnRect: btn ? { x: btn.x, y: btn.y, w: btn.w, h: btn.h } : null,
      toggleLogBtn: !!btns.find(b => b.id === 'toggleLog'),
    };
  });
  console.log('[联机竖屏] ' + JSON.stringify(st));
  if (!st.portraitMode) throw new Error('联机竖屏 portraitMode 应为 true');
  if (st.rowFolded !== true) throw new Error('联机 rowFolded 应默认 true');
  if (!st.hasBtn) throw new Error('联机应注册 toggleRow 按钮');
  // 点击展开 → 状态翻转
  await page.mouse.click(st.btnRect.x + st.btnRect.w / 2, st.btnRect.y + st.btnRect.h / 2);
  await page.waitForTimeout(300);
  const st2 = await page.evaluate(() => ({ rowFolded: eval('rowFolded') }));
  console.log('[联机展开] ' + JSON.stringify(st2));
  if (st2.rowFolded !== false) throw new Error('联机点击展开后应为 false');
  const fits = await page.evaluate(() => {
    const cv = document.querySelector('canvas'); const r = cv.getBoundingClientRect();
    return r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
  });
  console.log('[联机] canvasFits=' + fits + ' errors=' + JSON.stringify(errors));
  if (!fits) throw new Error('canvas 溢出');
  if (errors.length) throw new Error('JS 错误: ' + errors.join(' | '));
  console.log('MP_FOLD_OK');
  await browser.close();
})().catch(e => { console.error('FAIL: ' + e.message); process.exit(1); });
