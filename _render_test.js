/* #77 浏览器渲染测试（超级雷霆大更新#77：P0 Playwright 自动截屏，对比单机和联机）
 * 运行：node --test _render_test.js
 * 前置：① npm i -D playwright-core（免下载浏览器）② localhost:3000 服务器已启动（node server.js）
 * 浏览器：复用系统 Edge/Chrome（无需安装 Playwright 自带浏览器）
 * 产出：_shots/sp_menu.png / sp_game.png / mp_lobby.png / mp_room.png / mp_game.png
 * 断言：两端页面零 JS 错误、canvas 渲染有内容、对局自动推进可达多阶段
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const BASE = 'http://localhost:3000';
const SHOT_DIR = path.join(__dirname, '_shots');

let pw = null;
try { pw = require('playwright-core'); } catch (e) { /* 未安装 → 全部 skip */ }
const edgePath = EDGE_CANDIDATES.find(p => fs.existsSync(p));

function serverUp() {
  return fetch(BASE + '/health').then(r => r.ok).catch(() => false);
}

let browser = null;
test.before(async (t) => {
  if (!pw) return t.skip('缺少 playwright-core（npm i -D playwright-core）');
  if (!edgePath) return t.skip('未找到系统 Edge/Chrome 浏览器');
  if (!(await serverUp())) return t.skip('localhost:3000 未启动（node server.js）');
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  browser = await pw.chromium.launch({ executablePath: edgePath, headless: true });
});
test.after(async () => { if (browser) await browser.close(); });

/* ---------- 帮助函数 ---------- */
/* 顾问评审 6/8.1：newPage 支持移动竖屏（hasTouch→isMobile/portraitMode）
 * 与低配机模拟（initScript 覆盖 deviceMemory/hardwareConcurrency→主动低画质） */
async function newPage(opts) {
  opts = opts || {};
  const page = await browser.newPage({
    viewport: opts.viewport || { width: 1280, height: 800 },
    deviceScaleFactor: opts.deviceScaleFactor || 1,
    hasTouch: !!opts.hasTouch,
    isMobile: !!opts.hasTouch,   // 触屏即移动视口：触发 portraitMode 断点
  });
  if (opts.lowSpec) {
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 2, configurable: true });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2, configurable: true });
      } catch (e) { /* 个别内核只读则跳过 */ }
    });
  }
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') {
      const t = m.text();
      // 忽略资源 404（如 favicon）等无害噪音；JS 异常会走 pageerror 事件
      if (/Failed to load resource|favicon|net::ERR_ABORTED|net::ERR/.test(t)) return;
      errors.push('console: ' + t);
    }
  });
  return { page, errors };
}

/* canvas 渲染内容占比（非深蓝背景像素比例，步进采样） */
async function canvasStats(page) {
  return page.evaluate(() => {
    const cv = document.querySelector('canvas');
    if (!cv) return null;
    const c = cv.getContext('2d');
    const data = c.getImageData(0, 0, cv.width, cv.height).data;
    let nonBg = 0, n = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      n++;
      if (a > 0 && !(Math.abs(r - 15) <= 20 && Math.abs(g - 27) <= 20 && Math.abs(b - 45) <= 20)) nonBg++;
    }
    return { ratio: +(nonBg / n).toFixed(4), w: cv.width, h: cv.height };
  });
}

const shot = name => path.join(SHOT_DIR, name);

/* ---------- 单机 ---------- */
test('单机：菜单渲染无错误 + 截屏', async (t) => {
  if (!browser) return t.skip('前置资源缺失（playwright-core / 浏览器 / 服务器）');
  const { page, errors } = await newPage();
  await page.goto(BASE + '/singleplayer.html');
  await page.waitForTimeout(1500);   // 等 rAF 渲染稳定
  const st = await canvasStats(page);
  assert.ok(st && st.w > 0, 'canvas 应存在且已初始化');
  assert.ok(st.ratio > 0.02, '菜单应渲染出可见内容，实际内容占比 ' + st.ratio);
  await page.screenshot({ path: shot('sp_menu.png') });
  assert.deepEqual(errors, [], '单机菜单不应有 JS 错误：' + errors.join(' | '));
  await page.close();
  console.log('[单机] 菜单 canvas=' + st.w + 'x' + st.h + ' 内容占比 ' + st.ratio);
});

test('单机：进入对局自动推进 + 渲染截屏', async (t) => {
  if (!browser) return t.skip('前置资源缺失（playwright-core / 浏览器 / 服务器）');
  const { page, errors } = await newPage();
  await page.goto(BASE + '/singleplayer.html');
  await page.waitForTimeout(800);
  // 点击「开庭审理」按钮（按钮矩形 W/2-170, H*0.68, 340×62；canvas CSS = 内部逻辑坐标）
  const rect = await page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  await page.mouse.click(rect.w / 2, rect.h * 0.68 + 31);
  // 注入自动推进循环：AI 交给 needsAIAction/aiAct，玩家座位 0 直接驱动引擎
  const result = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const t0 = Date.now();
    const phases = [];
    let lastPh = null;
    while (Date.now() - t0 < 45000) {
      const g = eval('game');
      if (!g || g.gameOver) break;
      if (g.phase !== lastPh) { lastPh = g.phase; phases.push(lastPh); }
      const need = ElectionCore.needsAIAction(g);
      if (need.length) { for (const s of need) ElectionCore.aiAct(g, s); await wait(20); continue; }
      const me = g.seats[0];
      switch (g.phase) {
        case 'pickChar':
          if (!me.char && g.draftCandidates && g.draftCandidates[0] && g.draftCandidates[0].length) {
            ElectionCore.apply(g, 0, { type: 'pickChar', charId: g.draftCandidates[0][0].id });
          }
          break;
        case 'chooseStarter':
          if (g.starterPicker === 0 && !g.starterChosen) ElectionCore.apply(g, 0, { type: 'pickStarter', starterSeat: 0 });
          break;
        case 'buy':
          if (!me.buyDone) ElectionCore.apply(g, 0, { type: 'endBuy' });
          break;
        case 'play':
          if (g.turn === 0 && !me.playDone) {
            if (me.hand && me.hand.length) ElectionCore.apply(g, 0, { type: 'playCards', uids: [me.hand[0].uid] });
            else ElectionCore.apply(g, 0, { type: 'finishPlay' });
          }
          break;
        case 'preEvent': case 'postEvent':
          if (g.eventTurnSeat === 0) ElectionCore.apply(g, 0, { type: 'passEvent' });
          break;
        case 'reveal':
          if (g.revealPending && g.revealPending.owner === 0) {
            const cands = g.revealPending.candidates || [];
            if (cands.length) ElectionCore.apply(g, 0, { type: 'terroristTarget', targetUid: cands[0] });
            else ElectionCore.advance(g);
          }
          break;
        case 'count':
          if (g.swapPending && g.swapPending.owner === 0) {
            const cands = g.swapPending.candidates || [];
            if (cands.length) ElectionCore.apply(g, 0, { type: 'swapTarget', targetUid: cands[0] });
            else ElectionCore.advance(g);
          }
          break;
        case 'discard':
          if (g.discardSeat === 0 && !me.keepDone) {
            const keepMax = Math.min(2, me.hand.length);
            for (let k = 0; k < keepMax; k++) ElectionCore.apply(g, 0, { type: 'keepCard', uid: me.hand[k].uid });
            ElectionCore.apply(g, 0, { type: 'finishKeep' });
          }
          break;
        default:
          ElectionCore.advance(g);
      }
      await wait(25);
    }
    const g = eval('game');
    return { phase: g ? g.phase : null, gameOver: g ? g.gameOver : false, round: g ? g.round : null, phases };
  });
  await page.waitForTimeout(1200);   // 等 FX 播放 / 渲染稳定
  const st = await canvasStats(page);
  assert.ok(st && st.ratio > 0.02, '对局 canvas 应有内容，实际 ' + (st && st.ratio));
  await page.screenshot({ path: shot('sp_game.png') });
  assert.deepEqual(errors, [], '单机对局不应有 JS 错误：' + errors.join(' | '));
  assert.ok(result.phases.length >= 2, '对局应推进至少 2 个阶段，实际 ' + JSON.stringify(result.phases));
  console.log('[单机] 阶段轨迹 ' + result.phases.join(' → ')
    + (result.gameOver ? '（终局 轮' + result.round + '）' : '（停在 ' + result.phase + '）')
    + ' canvas=' + st.w + 'x' + st.h + ' 内容占比 ' + st.ratio);
  await page.close();
});

/* ---------- 联机 ---------- */
test('联机：大厅 + 单人房 + 开局自动推进 + 渲染截屏', async (t) => {
  if (!browser) return t.skip('前置资源缺失（playwright-core / 浏览器 / 服务器）');
  const { page, errors } = await newPage();
  await page.goto(BASE + '/classic.html');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot('mp_lobby.png') });
  // 创建单人房（AI 补位）
  await page.click('#btn-solo');
  await page.waitForSelector('#lobby:not(.hidden)', { timeout: 8000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot('mp_room.png') });
  // 房主开局
  await page.click('#btn-start');
  // 等对局开始（联机选角阶段 screen='draft'，随后进入 'game'；有 view.phase 即已开局）
  await page.waitForFunction(() => {
    const g = window.__game;
    return g && g.view && g.view.phase;
  }, { timeout: 12000 });
  // 注入自动推进：联机状态在服务器，走 doAction/handleButton（client.js 函数均为全局）
  const result = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const t0 = Date.now();
    const phases = [];
    let lastPh = null;
    while (Date.now() - t0 < 45000) {
      const v = window.__game.view;
      if (!v || v.gameOver) break;
      if (v.phase !== lastPh) { lastPh = v.phase; phases.push(lastPh); }
      const mySeat = window.__game.mySeat;
      const me = v.seats[mySeat];
      let acted = false;
      if (v.phase === 'pickChar' && !me.char && v.draftCandidates && v.draftCandidates.length) {
        window.doAction({ type: 'pickChar', charId: v.draftCandidates[0].id }); acted = true;
      } else if (v.phase === 'chooseStarter' && v.starterPicker === mySeat && !v.starterChosen) {
        window.doAction({ type: 'pickStarter', starterSeat: 0 }); acted = true;
      } else if (v.phase === 'buy' && !me.buyDone) {
        const m = me.market || [];
        if (m.length && me.money >= 2 && !window.__game.isProcessing) {
          window.handleCard({ kind: 'market', data: { card: m[0], uid: m[0].uid } }); acted = true;
        } else {
          window.handleButton('endBuy'); acted = true;
        }
      } else if (v.phase === 'play' && v.turn === mySeat && !me.playDone) {
        if (me.hand && me.hand.length && !window.__game.isProcessing) {
          window.doAction({ type: 'playCards', uids: [me.hand[0].uid] });
        } else {
          window.handleButton('finishPlay');
        }
        acted = true;
      } else if ((v.phase === 'preEvent' || v.phase === 'postEvent') && v.eventTurnSeat === mySeat) {
        window.doAction({ type: 'passEvent' }); acted = true;
      } else if (v.phase === 'reveal' && v.revealPending && v.revealPending.owner === mySeat) {
        const cands = v.revealPending.candidates || [];
        if (cands.length) window.doAction({ type: 'terroristTarget', targetUid: cands[0] });
        acted = true;
      } else if (v.phase === 'count' && v.swapPending && v.swapPending.owner === mySeat) {
        const cands = v.swapPending.candidates || [];
        if (cands.length) window.doAction({ type: 'swapTarget', targetUid: cands[0] });
        acted = true;
      } else if (v.phase === 'discard' && v.discardSeat === mySeat && !me.keepDone) {
        const keepMax = Math.min(2, (me.hand || []).length);
        for (let k = 0; k < keepMax; k++) window.doAction({ type: 'keepCard', uid: me.hand[k].uid });
        window.handleButton('finishKeep'); acted = true;
      }
      await wait(acted ? 80 : 150);
    }
    const v = window.__game.view;
    return { phase: v ? v.phase : null, gameOver: v ? v.gameOver : false, round: v ? v.round : null, phases };
  });
  await page.waitForTimeout(1200);
  const st = await canvasStats(page);
  assert.ok(st && st.ratio > 0.02, '联机对局 canvas 应有内容，实际 ' + (st && st.ratio));
  await page.screenshot({ path: shot('mp_game.png') });
  assert.deepEqual(errors, [], '联机对局不应有 JS 错误：' + errors.join(' | '));
  assert.ok(result.phases.length >= 2, '联机对局应推进至少 2 个阶段，实际 ' + JSON.stringify(result.phases));
  console.log('[联机] 阶段轨迹 ' + result.phases.join(' → ')
    + (result.gameOver ? '（终局 轮' + result.round + '）' : '（停在 ' + result.phase + '）')
    + ' canvas=' + st.w + 'x' + st.h + ' 内容占比 ' + st.ratio);
  await page.close();
});

/* ---------- 对比 ---------- */
test('对比：单机 vs 联机截图健康度', (t) => {
  if (!browser) return t.skip('前置资源缺失（playwright-core / 浏览器 / 服务器）');
  const sp = shot('sp_game.png');
  const mp = shot('mp_game.png');
  assert.ok(fs.existsSync(sp), '缺少单机对局截图');
  assert.ok(fs.existsSync(mp), '缺少联机对局截图');
  const spS = fs.statSync(sp).size;
  const mpS = fs.statSync(mp).size;
  console.log('[对比] 单机对局截图 ' + spS + 'B / 联机对局截图 ' + mpS + 'B'
    + '（截图已保存至 _shots/，可人工比对两端画面）');
  // 渲染健康度粗检：两张截图都应有可观体积（不是纯色空白）
  assert.ok(spS > 5000, '单机截图不应是空白页（实际 ' + spS + 'B）');
  assert.ok(mpS > 5000, '联机截图不应是空白页（实际 ' + mpS + 'B）');
});

/* ---------- 顾问评审 6/8.1：移动竖屏 + 主动低画质 ---------- */
/* canvas 视口溢出检查：CSS 矩形不超出视口且宽高为正 */
async function canvasFitsViewport(page) {
  return page.evaluate(() => {
    const cv = document.querySelector('canvas');
    if (!cv) return { fits: false, reason: 'no canvas' };
    const r = cv.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    if (r.width <= 0 || r.height <= 0) return { fits: false, reason: 'empty canvas rect ' + r.width + 'x' + r.height };
    if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1)
      return { fits: false, reason: 'overflow rect=' + JSON.stringify({ l: r.left, t: r.top, r: r.right, b: r.bottom, w: vw, h: vh }) };
    return { fits: true, rect: { w: r.width, h: r.height }, vw, vh };
  });
}

test('竖屏：375×667 单机对局（portraitMode 底栏抽屉）+ 无溢出', async (t) => {
  if (!browser) return t.skip('前置资源缺失（playwright-core / 浏览器 / 服务器）');
  const { page, errors } = await newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 3, hasTouch: true });
  await page.goto(BASE + '/singleplayer.html');
  await page.waitForTimeout(1200);
  // 竖屏触屏：portraitMode 应为 true（isMobile=true && vh>vw），底栏切换为纵向手牌抽屉
  const mode = await page.evaluate(() => ({
    portraitMode: window.portraitMode !== undefined ? window.portraitMode : eval('portraitMode'),
    W: eval('W'), H: eval('H'),
  }));
  assert.ok(mode.portraitMode === true, '竖屏视口下 portraitMode 应为 true，实际 ' + JSON.stringify(mode));
  // 菜单渲染 + 溢出检查
  const fitsMenu = await canvasFitsViewport(page);
  assert.ok(fitsMenu.fits, '竖屏菜单 canvas 不应溢出视口：' + fitsMenu.reason);
  // 进对局
  const rect = await page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  await page.mouse.click(rect.w / 2, rect.h * 0.68 + 31);
  const result = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const t0 = Date.now();
    const phases = [];
    let lastPh = null;
    while (Date.now() - t0 < 45000) {
      const g = eval('game');
      if (!g || g.gameOver) break;
      if (g.phase !== lastPh) { lastPh = g.phase; phases.push(lastPh); }
      const need = ElectionCore.needsAIAction(g);
      if (need.length) { for (const s of need) ElectionCore.aiAct(g, s); await wait(20); continue; }
      const me = g.seats[0];
      switch (g.phase) {
        case 'pickChar':
          if (!me.char && g.draftCandidates && g.draftCandidates[0] && g.draftCandidates[0].length)
            ElectionCore.apply(g, 0, { type: 'pickChar', charId: g.draftCandidates[0][0].id });
          break;
        case 'buy':
          if (!me.buyDone) ElectionCore.apply(g, 0, { type: 'endBuy' });
          break;
        case 'play':
          if (g.turn === 0 && !me.playDone) {
            if (me.hand && me.hand.length) ElectionCore.apply(g, 0, { type: 'playCards', uids: [me.hand[0].uid] });
            else ElectionCore.apply(g, 0, { type: 'finishPlay' });
          }
          break;
        case 'preEvent': case 'postEvent':
          if (g.eventTurnSeat === 0) ElectionCore.apply(g, 0, { type: 'passEvent' });
          break;
        case 'reveal':
          if (g.revealPending && g.revealPending.owner === 0) {
            const cands = g.revealPending.candidates || [];
            if (cands.length) ElectionCore.apply(g, 0, { type: 'terroristTarget', targetUid: cands[0] });
            else ElectionCore.advance(g);
          }
          break;
        case 'count':
          if (g.swapPending && g.swapPending.owner === 0) {
            const cands = g.swapPending.candidates || [];
            if (cands.length) ElectionCore.apply(g, 0, { type: 'swapTarget', targetUid: cands[0] });
            else ElectionCore.advance(g);
          }
          break;
        case 'discard':
          if (g.discardSeat === 0 && !me.keepDone) {
            const keepMax = Math.min(2, me.hand.length);
            for (let k = 0; k < keepMax; k++) ElectionCore.apply(g, 0, { type: 'keepCard', uid: me.hand[k].uid });
            ElectionCore.apply(g, 0, { type: 'finishKeep' });
          }
          break;
        default:
          ElectionCore.advance(g);
      }
      await wait(25);
    }
    const g = eval('game');
    return { phase: g ? g.phase : null, round: g ? g.round : null, phases };
  });
  await page.waitForTimeout(1000);
  const st = await canvasStats(page);
  const fits = await canvasFitsViewport(page);
  assert.ok(st && st.ratio > 0.02, '竖屏对局 canvas 应有内容，实际 ' + (st && st.ratio));
  assert.ok(fits.fits, '竖屏对局 canvas 不应溢出视口：' + fits.reason);
  await page.screenshot({ path: shot('sp_portrait.png') });
  assert.deepEqual(errors, [], '竖屏对局不应有 JS 错误：' + errors.join(' | '));
  assert.ok(result.phases.length >= 2, '竖屏对局应推进至少 2 个阶段，实际 ' + JSON.stringify(result.phases));
  console.log('[竖屏] ' + mode.W + 'x' + mode.H + ' 阶段 ' + result.phases.join(' → ')
    + ' canvas=' + st.w + 'x' + st.h + ' 内容占比 ' + st.ratio + ' 视图 ' + JSON.stringify(fits.rect));
  await page.close();
});

test('低画质：低内存低核移动端主动降级（LOW_Q）', async (t) => {
  if (!browser) return t.skip('前置资源缺失（playwright-core / 浏览器 / 服务器）');
  const { page, errors } = await newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 3, hasTouch: true, lowSpec: true });
  await page.goto(BASE + '/singleplayer.html');
  await page.waitForTimeout(1000);
  // 主动低画质判定：deviceMemory<=2 && hardwareConcurrency<=4 且 isMobile → LOW_Q=true、FX_MAX=24、fxLowQ=true
  const q = await page.evaluate(() => ({
    LOW_Q: eval('LOW_Q'),
    FX_MAX: eval('FX_MAX'),
    fxLowQ: eval('fxLowQ'),
    dm: navigator.deviceMemory,
    hc: navigator.hardwareConcurrency,
  }));
  assert.ok(q.dm <= 2 && q.hc <= 4, '低配模拟应生效（deviceMemory/hardwareConcurrency），实际 ' + JSON.stringify({ dm: q.dm, hc: q.hc }));
  assert.ok(q.LOW_Q === true, '低配移动端应触发主动低画质，实际 ' + JSON.stringify(q));
  assert.ok(q.FX_MAX === 24, '低画质下 FX_MAX 应为 24，实际 ' + q.FX_MAX);
  assert.ok(q.fxLowQ === true, '低画质下 fxLowQ 应恒为 true，实际 ' + q.fxLowQ);
  // 低画质下渲染仍应正常（跳过网点/聚光灯装饰但不黑屏）
  const st = await canvasStats(page);
  assert.ok(st && st.ratio > 0.02, '低画质菜单仍应渲染内容，实际 ' + (st && st.ratio));
  const fits = await canvasFitsViewport(page);
  assert.ok(fits.fits, '低画质 canvas 不应溢出视口：' + fits.reason);
  await page.screenshot({ path: shot('sp_lowq.png') });
  assert.deepEqual(errors, [], '低画质不应有 JS 错误：' + errors.join(' | '));
  console.log('[低画质] LOW_Q=' + q.LOW_Q + ' FX_MAX=' + q.FX_MAX + ' fxLowQ=' + q.fxLowQ
    + ' canvas=' + st.w + 'x' + st.h + ' 内容占比 ' + st.ratio);
  await page.close();
});

/* ============================================================
 * 顾问评审 9.3：单机 vs 联机渲染像素级一致性
 *   —— 同种子 + 同 AI 操作序列 → 双端推进至 buy 阶段 → 稳定后区域像素对比
 * 诊断结论（_px_probe/_s*.txt）：
 *   ① 引擎状态两端一致（seed/round/market uid/money/marketSlots 坐标全部相同）；
 *   ② 卡面 4.4%~5.2% 低一致率根因 = 单机 marketCardAnim 入场动画（cardIn FX，
 *      dur 420ms 缩放淡入；联机无此动画）——等待 ≥3s 后一致率回升至 93~96%；
 *   ③ 已知设计差异（不参与断言，仅说明）：联机 drawRowBackdrop 行卡底座（中部
 *      y150~520 蓝灰块，单机无）、HUD 文案（单机轮次进度条 vs 联机倒计时/观战）。
 * ============================================================ */

/* 单机：点击「开庭审理」→ 自动推进（AI 走 needsAIAction/aiAct，座位0 直驱）→ 停在 buy */
async function driveSpToBuy(page) {
  return page.evaluate(async () => {
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
      if (g.phase === 'buy') break;   // 停在 buy：市场卡已布好
      ElectionCore.advance(g);
    }
    const g = eval('game');
    return g ? { phase: g.phase, round: g.round, money: g.seats[0].money,
      market: g.seats[0].market.map(c => c.uid).join(','), row: g.row.length } : null;
  });
}

/* 联机：大厅填入种子 → 建单人房 → 开局 → 自动推进（doAction）→ 停在 buy */
async function driveMpToBuy(page) {
  await page.fill('#inp-seed', 'consistency-1');
  await page.click('#btn-solo');
  await page.waitForSelector('#lobby:not(.hidden)', { timeout: 8000 });
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__game && window.__game.view && window.__game.view.phase,
    { timeout: 12000 });
  return page.evaluate(async () => {
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
    const v = window.__game.view;
    return v ? { phase: v.phase, round: v.round, money: v.seats[mySeat].money,
      market: v.seats[mySeat].market.map(c => c.uid).join(','), row: v.row.length } : null;
  });
}

/* 区域像素一致率（dr+dg+db < 30 判同，步进 2） */
function regionMatch(a, b, w, x0, x1, y0, y1) {
  let same = 0, n = 0;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const i = (y * w + x) * 4; n++;
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) < 30) same++;
  }
  return same / n;
}

test('评审9.3：同种子同操作序列 → 双端 buy 阶段像素级一致', async (t) => {
  if (!browser) return t.skip('前置资源缺失（playwright-core / 浏览器 / 服务器）');
  // —— 单机 ——
  const sp = await newPage();
  await sp.page.addInitScript(() => {
    try { localStorage.setItem('elec_seed', 'consistency-1'); } catch (e) { /* 忽略 */ }
  });
  await sp.page.goto(BASE + '/singleplayer.html');
  await sp.page.waitForTimeout(900);
  const r1 = await sp.page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  await sp.page.mouse.click(r1.w / 2, r1.h * 0.68 + 31);   // 「开庭审理」按钮
  const spState = await driveSpToBuy(sp.page);
  await sp.page.waitForTimeout(3200);   // 等单机 cardIn 入场动画（dur 420ms）完全结束
  const spPix = await sp.page.evaluate(() => {
    const cv = document.querySelector('canvas');
    const c = cv.getContext('2d');
    return { w: cv.width, h: cv.height, d: Array.from(c.getImageData(0, 0, cv.width, cv.height).data) };
  });
  assert.deepEqual(sp.errors, [], '单机一致性路径不应有 JS 错误：' + sp.errors.join(' | '));

  // —— 联机 ——
  const mp = await newPage();
  await mp.page.addInitScript(() => {
    // 跳过联机新手教程横幅（renderTutorialBanner 只联机端有、覆盖顶部中央，单机无 → 排除此设计差异）
    try { localStorage.setItem('elec_tut_done', '1'); } catch (e) { /* 忽略 */ }
  });
  await mp.page.goto(BASE + '/classic.html');
  await mp.page.waitForTimeout(1200);
  const mpState = await driveMpToBuy(mp.page);
  await mp.page.waitForTimeout(3200);
  const mpPix = await mp.page.evaluate(() => {
    const cv = document.querySelector('canvas');
    const c = cv.getContext('2d');
    return { w: cv.width, h: cv.height, d: Array.from(c.getImageData(0, 0, cv.width, cv.height).data) };
  });
  assert.deepEqual(mp.errors, [], '联机一致性路径不应有 JS 错误：' + mp.errors.join(' | '));

  // —— 引擎状态一致（测试前提）——
  assert.equal(spState.phase, 'buy', '单机应停在 buy，实际 ' + JSON.stringify(spState));
  assert.equal(mpState.phase, 'buy', '联机应停在 buy，实际 ' + JSON.stringify(mpState));
  assert.equal(spState.market, mpState.market, '双端市场卡 uid 应一致：单机[' + spState.market + '] 联机[' + mpState.market + ']');
  assert.equal(spState.round, mpState.round, '双端轮次应一致：' + spState.round + ' vs ' + mpState.round);
  assert.equal(spState.money, mpState.money, '双端金钱应一致：' + spState.money + ' vs ' + mpState.money);
  assert.equal(spPix.w, mpPix.w, '双端 canvas 宽度应一致');
  assert.equal(spPix.h, mpPix.h, '双端 canvas 高度应一致');

  // —— 区域像素对比（排除已知设计差异区：行卡底座 y150~520、HUD 文案）——
  const w = spPix.w, a = spPix.d, b = mpPix.d;
  const regions = [
    // 市场卡区（y598~788：证物架卡面；联机 buy 也走 RC._renderMarketOf 单事实源）
    { name: '市场卡区', x0: 0, x1: 860, y0: 598, y1: 788, min: 0.85 },
    // 四张市场卡内部（避开边框/标题/按钮）
    { name: '卡1内部', x0: 20, x1: 190, y0: 622, y1: 770, min: 0.85 },
    { name: '卡2内部', x0: 232, x1: 402, y0: 622, y1: 770, min: 0.85 },
    { name: '卡3内部', x0: 444, x1: 614, y0: 622, y1: 770, min: 0.85 },
    { name: '卡4内部', x0: 656, x1: 826, y0: 622, y1: 770, min: 0.85 },
    // 顶部中央（阶段标题/支持度轨道区域，非 HUD 文案区）
    { name: '顶部中央', x0: 400, x1: 880, y0: 56, y1: 120, min: 0.80 },
  ];
  let worst = 1;
  for (const rg of regions) {
    const rate = regionMatch(a, b, w, rg.x0, rg.x1, rg.y0, rg.y1);
    worst = Math.min(worst, rate);
    console.log('[一致性] ' + rg.name + ' 一致率 ' + (rate * 100).toFixed(1) + '%' + (rate < rg.min ? ' ← 低于阈值 ' + rg.min : ''));
    assert.ok(rate >= rg.min, '[' + rg.name + '] 一致率 ' + (rate * 100).toFixed(1) + '% 应 ≥ ' + (rg.min * 100) + '%（同种子同操作序列，画面应逐像素一致）');
  }
  console.log('[一致性] 引擎 单机{' + JSON.stringify(spState) + '} 联机{' + JSON.stringify(mpState) + '} canvas '
    + w + 'x' + spPix.h + ' 最差区域一致率 ' + (worst * 100).toFixed(1) + '%');
  await sp.page.close();
  await mp.page.close();
});
