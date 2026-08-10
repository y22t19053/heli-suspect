/* ============================================================
 * _split_core.js — 把 shared/game-core.js 切分为 shared/engine/ 多段
 * ------------------------------------------------------------
 * 用法：node _split_core.js
 * 原理：按行号把引擎按功能段切分（不丢任何字节），每段写入
 *       shared/engine/NN-name.js，段首加来源注释。切分后自动
 *       验证"原样拼接 === 原文件"，保证无损。
 * 与 _build_core.js 配对：改 engine/ 各段后运行 node _build_core.js
 * 拼回单一 game-core.js（Node require + 浏览器静态服务双端兼容）。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const root = __dirname;
const srcPath = path.join(root, 'shared', 'game-core.js');
const outDir = path.join(root, 'shared', 'engine');

const src = fs.readFileSync(srcPath, 'utf8');
const lines = src.split('\n');
const total = lines.length; // 末行若带 \n 则 split 后有尾部空串

/* 每段：[文件名, 起始行号(1-based)]；段 = [start, 下段start-1] */
const segs = [
  ['00-head.js', 1],      // UMD 外壳 + 工具函数
  ['01-data.js', 40],     // CAMPS/CHARACTERS/SKILLS/SK_VAL/VOTER_TEMPLATES/AI_PERSONALITIES/EVENT_TEMPLATES
  ['02-numeric.js', 341], // 数值函数（eventLvMax…lockMax）
  ['03-state.js', 364],   // makeSeat/makeVoter/makeEvent/buildDeck/buildEventDeck/createGame
  ['04-advance.js', 491], // advance（阶段推进状态机）
  ['05-phases.js', 587],  // beginStarter + beginRound/beginVoter/beginBuy
  ['06-actions.js', 655], // buyCard/lockCard/refreshMarket/reshuffle + beginPlay/nextPlaySeat/playCards/finishPlay
  ['07-reveal.js', 762],  // beginReveal/revealNext/resolveTerrorist + rowNeighbor/swapRow/applyMoves/resolveSwap
  ['08-events.js', 865],  // 事件阶段全套
  ['09-count.js', 999],   // doCount/doCountContinue/applyScandalEffects/highestEnemy
  ['10-rank.js', 1295],   // doRank/doSettle
  ['11-discard.js', 1357],// beginDiscard/keepMaxOf/nextKeepSeat/keepCard/finishKeep
  ['12-income.js', 1412], // beginIncome + finishGame
  ['13-apply.js', 1495],  // apply（玩家动作分发）
  ['14-ai.js', 1592],     // aiAct/aiCardScore/aiBuy/aiPlay/aiAutoValue/aiEvents
  ['15-meta.js', 1768],   // needsAIAction/humanActing/PHASE_STEPS/PHASE_STEPS_VISIBLE/phaseLabel/myClickable
  ['99-tail.js', 1872],   // return 导出
];

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

segs.forEach(([name, start], i) => {
  const end = i + 1 < segs.length ? segs[i + 1][1] - 1 : total;
  const slice = lines.slice(start - 1, end).join('\n');
  // CRLF 文件：行尾保留 \r；这里统一把段尾多余换行收成一个 \n，保证拼接可逐字节还原
  const body = slice.replace(/\n+$/, '') + '\n';
  const header = '/* ===== engine/' + name + '（game-core.js 行 ' + start + '-' + end + '）===== */\n';
  fs.writeFileSync(path.join(outDir, name), header + body, 'utf8');
  console.log('✓ ' + name + '  行 ' + start + '-' + end);
});

/* 验证：按段拼接（跳过每段首行注释，去掉段尾多余换行）应逐字节还原原文件 */
const rebuilt = segs.map(([name]) => {
  const content = fs.readFileSync(path.join(outDir, name), 'utf8');
  const nl = content.indexOf('\n');
  return content.slice(nl + 1).replace(/\n+$/, '') + '\n';
}).join('');
console.log('拼接还原 === 原文件：' + (rebuilt === src ? '✓' : '✗ 不一致！'));
if (rebuilt !== src) process.exit(1);
