/* ============================================================
 * _build_core.js — 把 shared/engine/ 各段拼回 shared/game-core.js
 * ------------------------------------------------------------
 * 用法：node _build_core.js
 * 原理：按固定顺序读取 shared/engine/ 各段（跳过段首注释行），
 *       拼接为单一 game-core.js —— 保持 UMD 外壳 + 闭包共享，
 *       Node require（服务端/测试）与浏览器 <script> 双端兼容。
 * 与 _split_core.js 配对：改 engine/ 各段后运行本脚本重建产物。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = __dirname;
const outPath = path.join(root, 'shared', 'game-core.js');

/* 与 _split_core.js 中一致的固定顺序 */
const segs = [
  '00-head.js',      // UMD 外壳 + 工具函数
  '01-data.js',      // 数据词典
  '02-numeric.js',   // 数值函数
  '03-state.js',     // 状态构建
  '04-advance.js',   // advance 状态机
  '05-phases.js',    // beginStarter + FEATURES + beginRound/beginVoter/beginBuy
  '06-actions.js',   // 购买/出牌
  '07-reveal.js',    // 亮出/换位
  '08-events.js',    // 事件阶段
  '09-count.js',     // 计票
  '10-rank.js',      // 排名结算
  '11-discard.js',   // 整理
  '12-income.js',    // 收入+终局
  '13-apply.js',     // 玩家动作分发
  '14-ai.js',        // AI 决策
  '15-meta.js',      // 服务端/渲染辅助
  '99-tail.js',      // 导出
];

let body = '';
for (const name of segs) {
  const p = path.join(root, 'shared', 'engine', name);
  if (!fs.existsSync(p)) {
    console.error('✗ 缺少 engine 段文件：' + name + '（请先运行 node _split_core.js）');
    process.exit(1);
  }
  const content = fs.readFileSync(p, 'utf8');
  const nl = content.indexOf('\n');
  body += content.slice(nl + 1).replace(/\n+$/, '') + '\n';
}
fs.writeFileSync(outPath, body, 'utf8');

const h = crypto.createHash('md5').update(fs.readFileSync(outPath, 'utf8')).digest('hex');
console.log('✓ 构建完成 shared/game-core.js  MD5=' + h);
console.log('  段数=' + segs.length + '  行数=' + body.split('\n').length);
