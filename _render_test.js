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
async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
  await page.goto(BASE + '/');
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
