/* _layout_probe.js — 验证面板两行与卡面技能效果的坐标不重叠（诊断脚本，临时） */
const fs = require('fs');
const vm = require('vm');

/* 1) 加载 ui-kit.js（UMD 挂 globalThis） */
const src = fs.readFileSync('shared/ui-kit.js', 'utf8');
const sb = { console };
sb.window = sb; sb.self = sb; sb.global = sb; sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(src, sb);
const { planCard } = sb.UIKit;

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '✓ ' : '✗ ') + name + (ok ? '' : '  ← ' + detail));
  if (!ok) fails++;
};

/* 2) 卡面坐标验证：真实卡尺寸 */
const cases = [
  { name: '行卡·桌面2-3人 normal', w: 118, h: 138 },
  { name: '行卡·桌面4人 small',   w: 118, h: 88 },
  { name: '行卡·紧凑 small',      w: 118, h: 92 },
  { name: '手牌卡 desktop',       w: 150, h: 206 },
  { name: '市场卡 desktop',       w: 166, h: 206 },
  { name: '竖屏网格 mini',        w: 60,  h: 66 },
  { name: '竖屏网格 max',         w: 200, h: 190 },
  { name: '竖屏行卡',             w: 84,  h: 88 },
];
for (const c of cases) {
  const lay = planCard(0, 0, c.w, c.h);
  const sn = lay.skillName, se = lay.skillEff, cb = lay.cost;
  const tag = c.name + `(mini=${lay.mini},small=${lay.small})`;
  // 技能名底 ≤ 效果顶（迷你档：名与效果应分离；small/normal 同理）
  check(tag + ' 技能名-效果不重叠', sn.y + sn.h <= se.y + 1, `sn=${sn.y + sn.h} se=${se.y}`);
  // 大徽章下沿 < 技能名上沿（normal 档：中央技能徽章不得压技能名/效果）
  if (!lay.mini && !lay.small) {
    const badgeBot = lay.skillBadge.y + lay.skillBadge.h;
    check(tag + ' 徽章-技能名不重叠', badgeBot <= sn.y + 1, `badge=${badgeBot} sn=${sn.y}`);
  }
  // 效果至少 1 行能放下且不压价格条（normal 动态行数；small/mini 1 行）
  if (lay.mini || lay.small) {
    check(tag + ' 效果1行不压价格条', se.y + se.size <= cb.y + 1, `se底=${se.y + se.size} cb=${cb.y}`);
  } else {
    const lineH = Math.max(9, c.h * 0.075);
    const maxLines = Math.max(1, Math.floor((cb.y - se.y - 3) / lineH));
    check(tag + ' 效果折行≥1行', maxLines >= 1, `maxLines=${maxLines}`);
    check(tag + ' 效果首行不压价格条', se.y + lineH <= cb.y + 1, `se+lineH=${se.y + lineH} cb=${cb.y}`);
  }
  // 迷你档：名字/票数不与技能名重叠（技能名 y+0.36h 与票数徽章 y+0.2h）
  if (lay.mini) {
    check(tag + ' mini 票数-技能名分离', lay.voteBadge.y + lay.voteBadge.h <= sn.y + 1, `vb=${lay.voteBadge.y + lay.voteBadge.h} sn=${sn.y}`);
  }
}

/* 3) 面板两行几何（renderPanelsOf 坐标，按新 ph/字号手算关键值） */
const panelCases = [
  { name: '桌面 ph=42', ph: 42, r1y: 18, r1size: 17, r2y: 34, r2size: 15.5 },
  { name: '竖屏 ph=40', ph: 40, r1y: 18, r1size: 17, r2y: 32, r2size: 15.5 },
  { name: '横屏触屏 ph=34', ph: 34, r1y: 15, r1size: 12.5, r2y: 26, r2size: 11.5 },
];
for (const p of panelCases) {
  const r1Top = p.r1y - p.r1size, r1Bot = p.r1y;
  const r2Top = p.r2y - p.r2size, r2Bot = p.r2y;
  const overlap = Math.min(r1Bot, r2Bot) - Math.max(r1Top, r2Top);
  check(p.name + ' 两行不重叠(≤2px)', overlap <= 2, `重叠=${overlap}px`);
  check(p.name + ' 行2在面板内', r2Bot <= p.ph, `r2Bot=${r2Bot} ph=${p.ph}`);
  // 矩形方框头像垂直居中且不越界（avH compact=18 / 其他=24）
  const avH = p.ph === 34 ? 18 : 24;
  const avY = Math.max(3, (p.ph - 4) / 2 - (avH / 2));
  check(p.name + ' 头像框在面板内', avY >= 1 && avY + avH <= p.ph - 1, `avY=${avY} bot=${avY + avH}`);
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
