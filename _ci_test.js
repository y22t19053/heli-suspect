/* ============================================================
 * _ci_test.js — CI 聚合入口
 * 自动完成：启动 server.js 子进程 → 等待 /health 就绪 → 顺序运行
 * 基础测试（技能组合 / 平衡性 / 冒烟）→ 优雅关闭服务器。
 * 渲染测试 _render_test.js 在无浏览器环境自身优雅跳过，不作为 CI 硬门禁。
 *
 * 用法：
 *   node _ci_test.js                 # 完整 CI（启动服务器 + 全量基础测试）
 *   node _ci_test.js --skip-server   # 跳过服务器启动（本地已有服务时）
 * 输出：控制台摘要 + junit.xml（可用 CI 平台直接收集）
 * ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = process.env.CI_PORT || (process.env.PORT || 3000);
const BASE = [
  '_test_skill_combos.js',
  '_test_cross_exam.js',   // 评审 P0-2：质证阶段（翻看/压制/上限/扣票）
  '_balance_test.js',
  '_smoke_game.js',
  '_test_reconnect.js',
  '_test_snapshot.js',
  '_test_restart.js',   // 顾问评审 9：服务器重启恢复集成（独立端口 3198 + 独立快照文件）
  '_test_rng_restore.js',       // 评审 P0-BUG：rng 可序列化恢复
  '_test_uid_unique.js',        // 评审 P1-BUG：uid 每局独立计数器
  '_test_strategy_diversity.js' // 评审 P3：策略多样性无垄断
];
const JUNIT = path.join(__dirname, 'junit.xml');

/* ---------- 工具：等待 /health 就绪 ---------- */
function waitHealth(timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const probe = () => {
      const req = http.get({ host: 'localhost', port: PORT, path: '/health', timeout: 1500 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(probe, 300);
    };
    probe();
  });
}

/* ---------- 运行单个 node:test 文件（子进程，确保隔离） ---------- */
function runTestFile(file) {
  const p = path.join(__dirname, file);
  const out = execFileSync(process.execPath, ['--test', p], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  // node:test 默认输出 TAP；提取统计行（ℹ pass / ℹ fail / ℹ skipped，兼容旧版 # pass）
  const sum = (label) => {
    const re = new RegExp('(?:ℹ|#)\\s*' + label + '\\s+(\\d+)');
    const m = out.match(re);
    return m ? +m[1] : 0;
  };
  const pass = sum('pass');
  const fail = sum('fail');
  const skipped = sum('skipped');
  return { file, pass, fail, skipped, ok: fail === 0 };
}

/* ---------- 生成 JUnit XML ---------- */
function writeJunit(results) {
  const ts = new Date().toISOString();
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<testsuites timestamp="' + ts + '">\n';
  for (const r of results) {
    xml += '  <testsuite name="' + r.file + '" tests="' + (r.pass + r.fail + r.skipped) + '" failures="' + r.fail + '" skipped="' + r.skipped + '">\n';
    for (let i = 0; i < r.fail; i++) xml += '    <testcase name="failure-' + (i + 1) + '"><failure message="failed in ' + r.file + '"/></testcase>\n';
    xml += '  </testsuite>\n';
  }
  xml += '</testsuites>\n';
  fs.writeFileSync(JUNIT, xml);
}

/* ---------- 主流程 ---------- */
async function main() {
  const skipServer = process.argv.includes('--skip-server');
  let server = null;

  /* 布局探针硬门禁：卡面/面板坐标重叠即中止（用户强制要求，任何一次提交/CI 都先过探针） */
  try {
    execFileSync(process.execPath, [path.join(__dirname, '_layout_probe.js')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    console.log('[ci] _layout_probe.js → 布局坐标无重叠');
  } catch (e) {
    console.error('[ci] _layout_probe.js 布局重叠检测失败：\n' + ((e.stdout || '').toString().trim() || e.message));
    process.exit(1);
  }

  if (!skipServer) {
    console.log('[ci] 启动 server.js (PORT=' + PORT + ') …');
    // 干净启动：清掉上次运行残留的快照文件，避免 CI 误恢复旧房间
    try { fs.rmSync(path.join(__dirname, 'rooms-snapshot.json'), { force: true }); } catch (e) {}
    server = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      env: Object.assign({}, process.env, { PORT: String(PORT) }),
      stdio: 'ignore'
    });
    const ok = await waitHealth(15000);
    if (!ok) {
      console.error('[ci] 服务器 15s 内未就绪，中止');
      server.kill();
      process.exit(1);
    }
    console.log('[ci] 服务器就绪');
  }

  const results = [];
  let failed = false;
  for (const f of BASE) {
    try {
      const r = runTestFile(f);
      results.push(r);
      console.log('[ci] ' + f + ' → pass=' + r.pass + ' fail=' + r.fail + ' skipped=' + r.skipped);
      if (!r.ok) failed = true;
    } catch (e) {
      results.push({ file: f, pass: 0, fail: 1, skipped: 0, ok: false });
      console.error('[ci] ' + f + ' 执行异常：' + e.message);
      failed = true;
    }
  }

  writeJunit(results);
  console.log('[ci] JUnit 摘要已写入 ' + JUNIT);

  if (server) {
    console.log('[ci] 优雅关闭服务器…');
    server.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
  }
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('[ci] 致命错误：', e); process.exit(2); });
