/* ============================================================
   合理怀疑：审判之塔 — 独立单人 Roguelike 原型
   设计参考：杀戮尖塔（地图/卡组/能量/敌人意图/遗物）
   + 金铲铲之战的“先选律师再开局”入口感。
   不依赖旧版 index/client，只复用《合理怀疑》的文字与技能名。
   ============================================================ */
'use strict';

const SAVE_KEY = 'heli_tower_save_v2';
const $ = id => document.getElementById(id);
const screenEl = $('screen'), toastEl = $('toast');
let S = null;
let screen = 'menu';
let combat = null;
let overlay = null;
let toastTimer = null;
let rng = Math.random;
let seed = 1;

/* ---------------- 卡牌库 ---------------- */
const CARDS = {
  cross:    { name: '交叉询问', type: '攻击', cost: 1, icon: '⚔', desc: '造成 6 点倾向，施加 1 层破绽。', dmg: 6, vuln: 1 },
  evidence: { name: '证据排除', type: '攻击', cost: 1, icon: '⛓', desc: '造成 8 点倾向；若敌人意图为攻击，额外 3 点。', dmg: 8, antiAttack: 3 },
  fan:      { name: '铁杆粉丝', type: '攻击', cost: 0, icon: '✦', desc: '造成 4 点倾向，抽 1 张牌。', dmg: 4, draw: 1 },
  objection:{ name: '反对!', type: '技能', cost: 1, icon: '✋', desc: '获得 7 点程序防御，抽 1 张牌。', block: 7, draw: 1 },
  counsel:  { name: '攻守同盟', type: '技能', cost: 1, icon: '⚖', desc: '获得 11 点程序防御。', block: 11 },
  procedure:{ name: '程序动议', type: '技能', cost: 0, icon: '↻', desc: '抽 2 张牌，获得 1 点能量。', draw: 2, energy: 1 },
  wave:     { name: '舆论证言', type: '攻击', cost: 1, icon: '≈', desc: '造成 7 点倾向，施加 1 层弱点。', dmg: 7, weak: 1 },
  orator:   { name: '雄辩陈词', type: '攻击', cost: 1, icon: '❝', desc: '造成 9 点倾向。', dmg: 9 },
  idol:     { name: '明星证人', type: '攻击', cost: 2, icon: '★', desc: '造成 12 点倾向。', dmg: 12 },
  mega:     { name: '致命污点', type: '攻击', cost: 2, icon: '☠', desc: '造成 14 点倾向，施加 2 层破绽。', dmg: 14, vuln: 2 },
  reasonable:{ name:'合理怀疑', type: '攻击', cost: 2, icon: '?', desc: '造成 12 点倾向；敌人有破绽时改为 20 点。', dmg: 12, execute: 20 },
  timeline: { name: '时间线狙击', type: '攻击', cost: 2, icon: '⌛', desc: '造成 9 点倾向，施加 2 层弱点。', dmg: 9, weak: 2 },
  flip:     { name: '翻转叙事', type: '技能', cost: 1, icon: '⇄', desc: '获得 8 点防御；生命低于一半时抽 1 张。', block: 8, lowDraw: 1 },
  precedent:{ name: '先例判词', type: '能力', cost: 2, icon: '§', desc: '永久获得 2 点力量（每张攻击 +2）。', power: 2 },
  jury:     { name: '人民之诉', type: '技能', cost: 2, icon: '♟', desc: '获得 1 名陪审员；集满 3 名立即胜诉。', jury: 1 },
  key:      { name: '关键反证', type: '攻击', cost: 1, icon: '◈', desc: '造成 7 点倾向，无视敌人防御。', dmg: 7, pierce: true },
  cred:     { name: '伪证档案', type: '攻击', cost: 1, icon: '✎', desc: '造成 5 点倾向，施加 2 层破绽。', dmg: 5, vuln: 2 },
  whistle:  { name: '吹哨人档案', type: '技能', cost: 1, icon: '☎', desc: '施加 2 层弱点。', weak: 2 },
  hail:     { name: '绝地反击', type: '攻击', cost: 2, icon: '✹', desc: '造成 8 点倾向；生命低于一半时额外 8 点。', dmg: 8, lowBonus: 8 },
  heal:     { name: '休庭治疗', type: '技能', cost: 1, icon: '✚', desc: '恢复 7 点生命，消耗。', heal: 7, exhaust: true },
  heavy:    { name: '铁案陈词', type: '攻击', cost: 2, icon: '▣', desc: '造成 16 点倾向。', dmg: 16 }
};

/* ---------------- 律师 ---------------- */
const LAWYERS = [
  {
    id: 'prosecutor', name: '公诉人', title: '检方 · 铁腕', icon: '⚖', color: '#C94A3C',
    desc: '最大生命 74。开局多 1 点能量，第一回合抽 1 张。',
    maxHp: 74, relic: 'gavel',
    deck: ['cross','evidence','fan','objection','orator','cross','heavy','evidence','counsel']
  },
  {
    id: 'defender', name: '辩护人', title: '辩方 · 铁壁', icon: '🛡', color: '#2E5E8C',
    desc: '最大生命 82。开局多 1 张手牌，防御牌效果 +2。',
    maxHp: 82, relic: 'casefile',
    deck: ['cross','objection','counsel','procedure','flip','cross','counsel','wave']
  },
  {
    id: 'public', name: '公益律师', title: '平民 · 陪审', icon: '✊', color: '#3F7D66',
    desc: '最大生命 68。开局带 1 名陪审员，人民之诉更容易触发。',
    maxHp: 68, relic: 'notes',
    deck: ['fan','whistle','heal','cross','objection','procedure','evidence','jury']
  }
];

/* ---------------- 遗物 ---------------- */
const RELICS = {
  gavel:    { name: '法槌', icon: '⚒', desc: '每场战斗第一回合 +1 能量、抽 1 张。' },
  casefile: { name: '案卷', icon: '▤', desc: '每场战斗第一回合多抽 1 张。' },
  notes:    { name: '陪审团笔记', icon: '✎', desc: '开局获得 1 名陪审员。' }
};

/* ---------------- 敌人 ---------------- */
const ENEMIES = {
  clerk:  { id:'clerk', name:'书记官', title:'记录庭', icon:'📜', hp:40, gold:28, moves:[
    { type:'attack', label:'记录在案', value:7 },
    { type:'attack', label:'连续记录', value:5, hits:2 },
    { type:'buff', label:'整理卷宗', strength:1 }
  ]},
  prosecutor: { id:'prosecutor', name:'检察官', title:'公诉席', icon:'⚔', hp:58, gold:36, moves:[
    { type:'attack', label:'提起公诉', value:9 },
    { type:'attack', label:'交叉质证', value:6, hits:2 },
    { type:'debuff', label:'庭外施压', weak:1, vuln:1 }
  ]},
  elite: { id:'elite', name:'首席检察官', title:'精英 · 公诉席', icon:'♜', hp:88, gold:62, moves:[
    { type:'attack', label:'铁证如山', value:14 },
    { type:'attack', label:'三连质证', value:6, hits:3 },
    { type:'buff', label:'结案陈词', strength:2 },
    { type:'debuff', label:'舆论绞杀', weak:2 }
  ]},
  boss: { id:'boss', name:'大法官', title:'最终审判', icon:'⚖', hp:150, gold:120, moves:[
    { type:'attack', label:'一锤定音', value:18 },
    { type:'attack', label:'陪审团裁决', value:9, hits:3 },
    { type:'buff', label:'先例压顶', strength:2 },
    { type:'debuff', label:'禁言令', weak:2, vuln:2 }
  ]}
};

/* ---------------- 工具 ---------------- */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1700);
}
function saveRun() {
  try {
    if (!S) return;
    const copy = Object.assign({}, S);
    if (combat) copy.combat = combat;
    localStorage.setItem(SAVE_KEY, JSON.stringify(copy));
  } catch (e) { /* 忽略 */ }
}
function loadRun() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
function hasSave() { return !!loadRun(); }

/* ---------------- 地图 ---------------- */
function makeMap() {
  return [
    [{ type:'combat', name:'立案质询', sub:'书记官', icon:'⚔' }],
    [{ type:'combat', name:'证据开示', sub:'检察官', icon:'⚔' }, { type:'event', name:'庭外调查', sub:'未知', icon:'?' }],
    [{ type:'combat', name:'交叉询问', sub:'检察官', icon:'⚔' }, { type:'rest', name:'休庭合议', sub:'恢复', icon:'☕' }],
    [{ type:'elite', name:'精英质证', sub:'首席检察官', icon:'♜' }],
    [{ type:'shop', name:'证物室', sub:'商店', icon:'◈' }, { type:'event', name:'匿名举报', sub:'未知', icon:'?' }],
    [{ type:'combat', name:'结案陈词', sub:'检察官', icon:'⚔' }],
    [{ type:'rest', name:'合议庭', sub:'恢复', icon:'☕' }],
    [{ type:'boss', name:'世纪审判', sub:'大法官', icon:'♛' }]
  ];
}
function mapPrefix(row) {
  if (row === 0) return '第一庭';
  if (row < 4) return '第二庭';
  if (row < 7) return '第三庭';
  return '终审';
}

/* ---------------- 开局 ---------------- */
function newRun(lawyerId) {
  const law = LAWYERS.find(l => l.id === lawyerId) || LAWYERS[0];
  seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  rng = (() => { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  S = {
    lawyer: law.id, maxHp: law.maxHp, hp: law.maxHp, gold: 80,
    deck: law.deck.slice(), relics: [law.relic], map: makeMap(), row: 0,
    node: null, act: 1, seed, jury: law.relic === 'notes' ? 1 : 0,
    floors: 0, startedAt: Date.now()
  };
  combat = null;
  screen = 'map';
  saveRun();
  render();
}
function continueRun() {
  const data = loadRun();
  if (!data) { toast('没有可继续的审判'); return; }
  S = data;
  if (S.combat) {
    combat = S.combat;
    screen = combat.enemy && combat.enemy.hp > 0 ? 'combat' : 'map';
  } else {
    combat = null;
    screen = 'map';
  }
  render();
}

/* ---------------- 顶栏 ---------------- */
function updateTopbar() {
  const bar = $('topbar');
  if (!S || screen === 'menu') { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('stat-hp').textContent = S.hp + '/' + S.maxHp;
  $('stat-gold').textContent = S.gold;
  $('stat-floor').textContent = S.floors + '/8';
}

/* ---------------- 渲染入口 ---------------- */
function render() {
  updateTopbar();
  screenEl.innerHTML = '';
  if (screen === 'menu') renderMenu();
  else if (screen === 'map') renderMap();
  else if (screen === 'combat') renderCombat();
  else if (screen === 'reward') renderReward();
  else if (screen === 'rest') renderRest();
  else if (screen === 'shop') renderShop();
  else if (screen === 'event') renderEvent();
  else if (screen === 'victory') renderVictory();
  else if (screen === 'gameover') renderGameOver();
  bindCommon();
}

/* ---------------- 主菜单 ---------------- */
function renderMenu() {
  const save = loadRun();
  screenEl.innerHTML = `
    <div class="menu-screen">
      <div class="menu-kicker">THE INK COURT · A ROGUELIKE TRIAL</div>
      <h1 class="menu-title">审判之塔</h1>
      <div class="menu-sub">每一层都是一场庭审 · 每一张证词都会改变判决</div>
      <div class="menu-rule">选择你的律师</div>
      <div class="lawyer-grid">
        ${LAWYERS.map(l => `
          <div class="lawyer-card" data-lawyer="${l.id}">
            <div class="lawyer-icon">${l.icon}</div>
            <div class="lawyer-name">${esc(l.name)}</div>
            <div class="lawyer-title">${esc(l.title)}</div>
            <div class="lawyer-desc">${esc(l.desc)}</div>
            <span class="lawyer-tag">${esc(RELICS[l.relic].name)}</span>
          </div>`).join('')}
      </div>
      <div class="menu-actions">
        ${save ? '<button class="btn primary" data-act="continue">继 续 审 判</button>' : ''}
        <button class="btn" data-act="classic">联 机 经 典 版</button>
      </div>
      <div class="menu-foot">单人 Roguelike · 8 层庭审 · 3 位律师 · 20 张证词<br>不连服务器也能玩；朋友联机请走「联机经典版」</div>
    </div>`;
  screenEl.querySelectorAll('[data-lawyer]').forEach(el => {
    el.addEventListener('click', () => newRun(el.dataset.lawyer));
  });
}

/* ---------------- 地图 ---------------- */
function renderMap() {
  const side = `
    <aside class="map-side">
      <div class="panel-frame">
        <div class="panel-label">律师 / COUNSEL</div>
        <div style="font:700 16px var(--serif);color:var(--paper-2)">${esc(lawyerName())}</div>
        <div style="color:var(--muted);font-size:10px;margin:4px 0 10px">${esc(RELICS[S.relics[0]].name)} · ${esc(RELICS[S.relics[0]].desc)}</div>
        <div class="hp-line"><span>❤</span><div class="hp-bar"><div class="hp-fill" style="width:${Math.round(S.hp / S.maxHp * 100)}%"></div></div><b>${S.hp}/${S.maxHp}</b></div>
        <div class="relic"><i>◈</i><span>${S.gold} 金币 · 陪审 ${S.jury}/3</span></div>
      </div>
      <div class="panel-frame" style="margin-top:12px">
        <div class="panel-label">牌组 / DECK · ${S.deck.length}</div>
        <div class="deck-list">${countDeck().map(([id, n]) => `<div class="deck-row"><span>${esc(CARDS[id].name)}</span><b>×${n}</b></div>`).join('')}</div>
      </div>
    </aside>`;
  const center = `
    <section class="map-center">
      <div class="map-head"><h2>${mapPrefix(S.row)}</h2><p>${S.row >= S.map.length ? '审判结束' : '选择下一场庭审'}</p></div>
      <div class="map-path">
        ${S.map.map((nodes, ri) => `
          <div class="map-row">
            ${nodes.map((n, ni) => {
              const done = ri < S.row;
              const cur = ri === S.row;
              const locked = ri > S.row;
              const branch = nodes.length > 1 ? (ni === 0 ? 'node-branch-left' : 'node-branch-right') : '';
              return `<button class="map-node node-${n.type} ${done ? 'done' : ''} ${cur ? 'current' : ''} ${locked ? 'locked' : ''} ${branch}" ${locked || done ? 'disabled' : ''} data-node="${ri}:${ni}">
                <span class="node-icon">${n.icon}</span>
                <span class="node-name">${esc(n.name)}</span>
                <span class="node-sub">${esc(n.sub)}</span>
              </button>`;
            }).join('')}
          </div>`).join('')}
      </div>
      <div class="map-hint">${S.row === 0 ? '点击当前节点进入第一庭' : '已完成节点会标记「已审」'}</div>
    </section>`;
  const right = `
    <aside class="map-side">
      <div class="panel-frame">
        <div class="panel-label">本局规则 / RUN</div>
        <div class="relic"><i>⚖</i><span>每层结束可三选一证词。</span></div>
        <div class="relic"><i>☕</i><span>休整恢复 30% 生命，或最大生命 +4。</span></div>
        <div class="relic"><i>◈</i><span>证物室用金币购买证词。</span></div>
      </div>
      <div class="panel-frame" style="margin-top:12px">
        <div class="panel-label">操作 / CONTROLS</div>
        <div class="relic"><i>▤</i><span>顶栏「牌组」随时查看。</span></div>
        <div class="relic"><i>⚒</i><span>菜单可回到标题或重开。</span></div>
      </div>
    </aside>`;
  screenEl.innerHTML = `<div class="map-screen">${side}${center}${right}</div>`;
  screenEl.querySelectorAll('[data-node]').forEach(el => {
    el.addEventListener('click', () => enterNode(el.dataset.node));
  });
}

function lawyerName() {
  const l = LAWYERS.find(x => x.id === S.lawyer);
  return l ? l.name : '律师';
}
function countDeck() {
  const m = new Map();
  S.deck.forEach(id => m.set(id, (m.get(id) || 0) + 1));
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/* ---------------- 节点入口 ---------------- */
function enterNode(key) {
  const [ri, ni] = key.split(':').map(Number);
  if (ri !== S.row) return;
  const node = S.map[ri][ni];
  S.node = node;
  if (node.type === 'combat') return startCombat('clerk');
  if (node.type === 'elite') return startCombat('elite');
  if (node.type === 'boss') return startCombat('boss');
  if (node.type === 'rest') { screen = 'rest'; return render(); }
  if (node.type === 'shop') { screen = 'shop'; return render(); }
  if (node.type === 'event') { screen = 'event'; return render(); }
}

/* ---------------- 战斗初始化 ---------------- */
function startCombat(enemyId) {
  const tpl = ENEMIES[enemyId];
  const e = JSON.parse(JSON.stringify(tpl));
  e.maxHp = e.hp; e.block = 0; e.strength = 0; e.weak = 0; e.vuln = 0;
  combat = {
    enemy: e,
    player: { hp: S.hp, maxHp: S.maxHp, block: 0, energy: 3, maxEnergy: 3, strength: 0, weak: 0, vuln: 0 },
    drawPile: shuffle(S.deck.slice()),
    hand: [], discard: [], exhaust: [],
    turn: 1, log: '开庭。' + e.name + ' 走进法庭。',
    jury: S.jury || 0, pending: null, result: null
  };
  draw(5);
  if (S.relics.includes('gavel')) { combat.player.energy += 1; draw(1); }
  if (S.relics.includes('casefile')) draw(1);
  chooseIntent();
  screen = 'combat';
  render();
}

function draw(n) {
  for (let i = 0; i < n; i++) {
    if (combat.drawPile.length === 0) {
      if (combat.discard.length === 0) break;
      combat.drawPile = shuffle(combat.discard);
      combat.discard = [];
    }
    combat.hand.push(combat.drawPile.pop());
  }
}

function chooseIntent() {
  const e = combat.enemy;
  if (e.hp <= 0) return;
  const moves = e.moves.filter(m => m.type !== 'buff' || e.strength < 3);
  const m = pick(moves);
  combat.pending = JSON.parse(JSON.stringify(m));
  combat.pending.value = m.value || 0;
  combat.pending.hits = m.hits || 1;
}

function intentText() {
  const p = combat.pending;
  if (!p) return '……';
  if (p.type === 'attack') return `${p.label}：${p.value}${p.hits > 1 ? ' × ' + p.hits : ''} 点倾向`;
  if (p.type === 'buff') return `${p.label}：力量 +${p.strength || 1}`;
  if (p.type === 'debuff') return `${p.label}：弱点 / 破绽`;
  return p.label;
}
function intentIcon() {
  const p = combat.pending;
  if (!p) return '·';
  return p.type === 'attack' ? '⚔' : p.type === 'buff' ? '▲' : '▼';
}

/* ---------------- 战斗渲染 ---------------- */
function renderCombat() {
  const c = combat;
  const e = c.enemy, p = c.player;
  const hpPct = Math.max(0, Math.round(e.hp / e.maxHp * 100));
  const playerPct = Math.max(0, Math.round(p.hp / p.maxHp * 100));
  screenEl.innerHTML = `
    <div class="combat-screen">
      <div class="combat-header">
        <div><div class="encounter-label">第 ${S.row + 1} / 8 层 · 庭审</div><div class="encounter-name">${esc(e.title)} · ${esc(e.name)}</div></div>
        <div class="turn-pill">第 ${c.turn} 回合 · 你的行动</div>
      </div>
      <div class="enemy-zone">
        <div class="enemy-card">
          <div class="enemy-portrait" id="enemyPortrait">${e.icon || '⚖'}</div>
          <div class="enemy-name">${esc(e.name)}</div>
          <div class="enemy-hpbar"><div class="enemy-hpfill" style="width:${hpPct}%"></div></div>
          <div class="enemy-hptext">${Math.max(0, e.hp)} / ${e.maxHp}${e.block ? ' · 防御 ' + e.block : ''}</div>
          <div class="intent"><span class="intent-icon">${intentIcon()}</span><span>${intentText()}</span></div>
          <div class="status-row">
            ${e.strength ? `<span class="status">力量 ${e.strength}</span>` : ''}
            ${e.vuln ? `<span class="status vuln">破绽 ${e.vuln}</span>` : ''}
            ${e.weak ? `<span class="status weak">弱点 ${e.weak}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="arena">
        <div class="arena-msg">${esc(c.log)}</div>
        <div class="arena-sub">${c.pending && c.pending.type === 'attack' ? '检察官正在组织下一轮质证' : '注意敌人意图，决定进攻还是防御'}</div>
      </div>
      <div class="player-zone">
        <div class="player-stats">
          <div class="orb"><b>${p.energy}</b><small>能量</small></div>
          <div class="player-hp">
            <div class="player-hp-label"><span>你的生命</span><b>${p.hp}/${p.maxHp}</b></div>
            <div class="hp-bar"><div class="hp-fill" style="width:${playerPct}%"></div></div>
          </div>
          ${p.block ? `<span class="block-chip">防御 ${p.block}</span>` : ''}
          <span class="block-chip" style="border-color:rgba(216,168,78,.25);color:var(--gold)">陪审 ${c.jury}/3</span>
          <div class="relics-mini">${S.relics.map(r => `<span class="relic-mini" title="${esc(RELICS[r].desc)}">${RELICS[r].icon}</span>`).join('')}</div>
        </div>
        <div class="piles">
          <div class="pile" data-act="piledraw"><b>${c.drawPile.length}</b>抽牌</div>
          <div class="pile" data-act="pilediscard"><b>${c.discard.length}</b>弃牌</div>
        </div>
      </div>
      <div class="hand-wrap">
        <div class="hand">
          ${c.hand.map((id, i) => cardHTML(id, i, true)).join('')}
        </div>
      </div>
      <div class="combat-actions">
        <button class="btn end-btn" data-act="endturn">结 束 回 合</button>
        <span class="turn-hint">${c.hand.length} 张手牌 · 点击卡牌打出</span>
      </div>
    </div>`;
  screenEl.querySelectorAll('.card[data-hand]').forEach(el => {
    el.addEventListener('click', () => playCard(Number(el.dataset.hand)));
  });
  bindCommon();
}

function cardHTML(id, index, inHand) {
  const c = CARDS[id];
  if (!c) return '';
  const cls = 'type-' + (c.type === '攻击' ? 'attack' : c.type === '技能' ? 'skill' : 'power');
  const playable = !inHand || (combat && combat.player.energy >= c.cost);
  return `<div class="card ${cls} ${playable ? '' : 'unplayable'}" ${inHand ? `data-hand="${index}"` : ''}>
    <div class="card-cost">${c.cost}</div>
    <div class="card-title">${esc(c.name)}</div>
    <div class="card-art">${c.icon}</div>
    <div class="card-desc">${esc(c.desc)}</div>
    <div class="card-type">${esc(c.type)}</div>
    <span class="wax">证</span>
  </div>`;
}

/* ---------------- 出牌与战斗逻辑 ---------------- */
function playCard(index) {
  if (!combat || combat.result) return;
  const id = combat.hand[index];
  if (!id) return;
  const c = CARDS[id];
  if (combat.player.energy < c.cost) { toast('能量不足'); return; }
  combat.player.energy -= c.cost;
  combat.hand.splice(index, 1);
  let log = `打出「${c.name}」。`;
  const p = combat.player, e = combat.enemy;
  if (c.dmg) {
    let dmg = c.dmg + p.strength;
    if (c.execute && e.vuln > 0) dmg = c.execute + p.strength;
    if (c.antiAttack && combat.pending && combat.pending.type === 'attack') dmg += c.antiAttack;
    if (c.lowBonus && p.hp < p.maxHp / 2) dmg += c.lowBonus;
    const real = hitEnemy(dmg, c.pierce);
    log += ` 造成 ${real} 点倾向。`;
  }
  if (c.block) {
    const b = c.block + ((S.relics.includes('casefile') && c.type === '技能') ? 2 : 0);
    p.block += b; log += ` 获得 ${b} 点防御。`;
  }
  if (c.heal) { const h = Math.min(c.heal, p.maxHp - p.hp); p.hp += h; log += ` 恢复 ${h} 点生命。`; }
  if (c.draw) { draw(c.draw); log += ` 抽 ${c.draw} 张牌。`; }
  if (c.energy) p.energy += c.energy;
  if (c.vuln) { e.vuln += c.vuln; log += ` 破绽 +${c.vuln}。`; }
  if (c.weak) { e.weak += c.weak; log += ` 弱点 +${c.weak}。`; }
  if (c.power) { p.strength += c.power; log += ` 力量 +${c.power}。`; }
  if (c.jury) {
    combat.jury += c.jury;
    log += ` 陪审员 +1（${combat.jury}/3）。`;
    if (combat.jury >= 3) { log += ' 陪审团否决！'; combat.result = 'win'; }
  }
  if (c.exhaust) combat.exhaust.push(id); else combat.discard.push(id);
  combat.log = log;
  S.hp = p.hp; S.jury = combat.jury;
  if (combat.result === 'win' || e.hp <= 0) return winCombat();
  saveRun();
  render();
}
function hitEnemy(amount, pierce) {
  const e = combat.enemy;
  let dmg = amount;
  if (combat.player.weak > 0) dmg = Math.floor(dmg * 0.75);
  if (e.vuln > 0) dmg = Math.floor(dmg * 1.5);
  if (!pierce) {
    const absorbed = Math.min(e.block, dmg);
    e.block -= absorbed; dmg -= absorbed;
  }
  e.hp -= dmg;
  const el = $('enemyPortrait');
  if (el) { el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 340); }
  return dmg;
}

function endTurn() {
  if (!combat || combat.result) return;
  const p = combat.player, e = combat.enemy;
  // 玩家回合结束：弃手牌
  combat.discard.push(...combat.hand);
  combat.hand = [];
  // 敌人行动
  let log = '';
  const it = combat.pending;
  if (it) {
    if (it.type === 'attack') {
      for (let i = 0; i < (it.hits || 1); i++) {
        let dmg = (it.value || 0) + e.strength;
        if (p.vuln > 0) dmg = Math.floor(dmg * 1.5);
        const absorbed = Math.min(p.block, dmg);
        p.block -= absorbed; dmg -= absorbed;
        p.hp -= dmg;
        log += `${e.name}「${it.label}」造成 ${dmg} 点伤害。`;
        if (p.hp <= 0) break;
      }
    } else if (it.type === 'buff') {
      e.strength += it.strength || 1; log += `${e.name}「${it.label}」，力量提升。`;
    } else if (it.type === 'debuff') {
      if (it.weak) p.weak += it.weak;
      if (it.vuln) p.vuln += it.vuln;
      log += `${e.name}「${it.label}」，你被施加弱点/破绽。`;
    }
  }
  // 状态衰减：原型阶段保持整场，避免出现“刚施加就消失”的体感问题
  p.block = 0;
  e.block = 0;
  if (p.hp <= 0) { combat.result = 'lose'; S.hp = 0; return loseCombat(); }
  // 新回合
  combat.turn++;
  combat.player.energy = 3;
  draw(5);
  chooseIntent();
  combat.log = log || `${e.name} 没有行动。`;
  S.hp = p.hp;
  saveRun();
  render();
}

function winCombat() {
  const e = combat.enemy;
  S.hp = Math.max(0, combat.player.hp);
  S.gold += e.gold || 0;
  S.jury = combat.jury || 0;
  S.floors = Math.max(S.floors, S.row + 1);
  const isBoss = e.id === 'boss';
  if (isBoss) { screen = 'victory'; saveRun(); return render(); }
  combat.result = 'win';
  // 生成奖励
  const pool = Object.keys(CARDS);
  const rewards = [];
  while (rewards.length < 3) {
    const id = pick(pool);
    if (!rewards.includes(id)) rewards.push(id);
  }
  S._rewards = rewards;
  screen = 'reward';
  saveRun();
  render();
}
function loseCombat() {
  clearSave();
  screen = 'gameover';
  render();
}

/* ---------------- 奖励 ---------------- */
function renderReward() {
  const e = combat ? combat.enemy : null;
  screenEl.innerHTML = `
    <div class="center-screen">
      <h2 class="center-title">胜 诉</h2>
      <div class="center-sub">${esc(e ? e.name : '')} 退庭 · 获得 ${e ? e.gold : 0} 金币 · 选择一张证词加入牌组</div>
      <div class="reward-grid">${(S._rewards || []).map(id => cardHTML(id, -1, false)).join('')}</div>
      <div class="reward-actions">
        <button class="btn" data-act="skipreward">跳 过</button>
      </div>
      <div class="reward-note">点击卡牌加入牌组；牌组越精简，抽到关键证词越稳定。</div>
    </div>`;
  screenEl.querySelectorAll('.reward-grid .card').forEach((el, i) => {
    el.addEventListener('click', () => chooseReward(i));
  });
}
function chooseReward(i) {
  const id = S._rewards[i];
  S.deck.push(id);
  S._rewards = [];
  advanceMap();
}
function advanceMap() {
  S.row++;
  S.node = null;
  combat = null;
  screen = 'map';
  saveRun();
  render();
}

/* ---------------- 休整 ---------------- */
function renderRest() {
  screenEl.innerHTML = `
    <div class="center-screen">
      <h2 class="center-title">休 庭</h2>
      <div class="center-sub">合议庭熄灯，只有卷宗和一杯冷茶</div>
      <div class="choice-list">
        <button class="choice" data-choice="heal"><b>整理卷宗</b><small>恢复 30% 最大生命</small></button>
        <button class="choice" data-choice="maxhp"><b>追加陈词</b><small>最大生命 +4（并恢复 4 点）</small></button>
      </div>
    </div>`;
  screenEl.querySelectorAll('[data-choice]').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.choice === 'heal') {
        S.hp = Math.min(S.maxHp, S.hp + Math.ceil(S.maxHp * 0.3));
      } else {
        S.maxHp += 4; S.hp += 4;
      }
      advanceMap();
    });
  });
}

/* ---------------- 商店 ---------------- */
function renderShop() {
  const stock = S._shop || (S._shop = (() => {
    const ids = shuffle(Object.keys(CARDS)).slice(0, 3);
    return ids.map(id => ({ id, price: 45 + Math.floor(rng() * 30) }));
  })());
  screenEl.innerHTML = `
    <div class="center-screen">
      <h2 class="center-title">证 物 室</h2>
      <div class="center-sub">金币 ${S.gold} · 挑选一份证词</div>
      <div class="shop-grid">
        ${stock.map((it, i) => `<div class="shop-item">${cardHTML(it.id, -1, false)}<div class="price ${S.gold < it.price ? 'cant' : ''}">◈ ${it.price}</div><button class="btn ghost" data-buy="${i}" ${S.gold < it.price || it.bought ? 'disabled' : ''}>${it.bought ? '已售' : '购 买'}</button></div>`).join('')}
      </div>
      <button class="btn" data-act="leaveshop">离 开 证 物 室</button>
    </div>`;
  screenEl.querySelectorAll('[data-buy]').forEach(el => {
    el.addEventListener('click', () => {
      const it = stock[Number(el.dataset.buy)];
      if (!it || it.bought || S.gold < it.price) return;
      S.gold -= it.price; S.deck.push(it.id); it.bought = true;
      saveRun(); render();
    });
  });
  screenEl.querySelector('[data-act="leaveshop"]').addEventListener('click', () => { S._shop = null; advanceMap(); });
}

/* ---------------- 事件 ---------------- */
function renderEvent() {
  const ev = S._event || (S._event = pick([
    { title:'匿名举报信', sub:'一封没有署名的信，夹着一张旧照片。', choices:[
      { label:'收下证据', desc:'获得 60 金币，失去 6 点生命。', act:'gold' },
      { label:'退回信封', desc:'恢复 12 点生命。', act:'heal' }
    ]},
    { title:'庭外和解', sub:'对方律师提出一个不太干净的交易。', choices:[
      { label:'接受交易', desc:'获得 90 金币，最大生命 -4。', act:'deal' },
      { label:'拒绝', desc:'什么也不发生。', act:'none' }
    ]},
    { title:'深夜档案室', sub:'你在一排落灰的卷宗里找到了一页手写判词。', choices:[
      { label:'带走判词', desc:'随机获得一张能力/技能牌。', act:'card' },
      { label:'留在原处', desc:'恢复 8 点生命。', act:'heal8' }
    ]}
  ]));
  screenEl.innerHTML = `
    <div class="center-screen">
      <h2 class="center-title">${esc(ev.title)}</h2>
      <div class="center-sub">${esc(ev.sub)}</div>
      <div class="choice-list">${ev.choices.map((c, i) => `<button class="choice" data-choice="${i}"><b>${esc(c.label)}</b><small>${esc(c.desc)}</small></button>`).join('')}</div>
    </div>`;
  screenEl.querySelectorAll('[data-choice]').forEach(el => {
    el.addEventListener('click', () => {
      const c = ev.choices[Number(el.dataset.choice)];
      if (c.act === 'gold') { S.gold += 60; S.hp = Math.max(1, S.hp - 6); }
      if (c.act === 'heal') S.hp = Math.min(S.maxHp, S.hp + 12);
      if (c.act === 'deal') { S.gold += 90; S.maxHp = Math.max(20, S.maxHp - 4); S.hp = Math.min(S.hp, S.maxHp); }
      if (c.act === 'heal8') S.hp = Math.min(S.maxHp, S.hp + 8);
      if (c.act === 'card') {
        const pool = Object.keys(CARDS).filter(id => CARDS[id].type !== '攻击');
        S.deck.push(pick(pool));
      }
      S._event = null; advanceMap();
    });
  });
}

/* ---------------- 结算 ---------------- */
function renderVictory() {
  screenEl.innerHTML = `
    <div class="center-screen">
      <div class="menu-kicker">THE VERDICT IS YOURS</div>
      <h2 class="center-title">终 审 胜 诉</h2>
      <div class="center-sub">你走完了审判之塔的 8 层庭审</div>
      <div class="panel-frame" style="max-width:520px;margin:20px auto;text-align:left">
        <div class="relic"><i>⚖</i><span>律师：${esc(lawyerName())}</span></div>
        <div class="relic"><i>❤</i><span>生命：${S.hp}/${S.maxHp}</span></div>
        <div class="relic"><i>◈</i><span>金币：${S.gold}</span></div>
        <div class="relic"><i>▤</i><span>最终牌组：${S.deck.length} 张</span></div>
      </div>
      <button class="btn primary" data-act="newrun">再 审 一 次</button>
      <div style="margin-top:10px"><button class="btn ghost" data-act="tomenu">回 到 标 题</button></div>
    </div>`;
}
function renderGameOver() {
  screenEl.innerHTML = `
    <div class="center-screen">
      <div class="menu-kicker">THE COURT HAS RULED</div>
      <h2 class="center-title" style="color:#D14B3E">败 诉</h2>
      <div class="center-sub">你在第 ${S ? S.row + 1 : 1} 层倒下了</div>
      <div class="panel-frame" style="max-width:480px;margin:20px auto;text-align:left">
        <div class="relic"><i>⚖</i><span>律师：${S ? esc(lawyerName()) : '—'}</span></div>
        <div class="relic"><i>▤</i><span>审理层数：${S ? S.row : 0}/8</span></div>
      </div>
      <button class="btn primary" data-act="newrun">重 新 开 始</button>
      <div style="margin-top:10px"><button class="btn ghost" data-act="tomenu">回 到 标 题</button></div>
    </div>`;
}

/* ---------------- 通用事件 ---------------- */
function bindCommon() {
  screenEl.querySelectorAll('[data-act]').forEach(el => {
    if (el._bound) return;
    el._bound = true;
    el.addEventListener('click', () => {
      const a = el.dataset.act;
      if (a === 'continue') return continueRun();
      if (a === 'classic') { location.href = window.Capacitor ? 'index.html' : '/classic.html'; return; }
      if (a === 'endturn') return endTurn();
      if (a === 'skipreward') { S._rewards = []; return advanceMap(); }
      if (a === 'newrun') { clearSave(); screen = 'menu'; render(); return; }
      if (a === 'tomenu') { screen = 'menu'; render(); return; }
      if (a === 'deck') return showDeck();
      if (a === 'menu') return showMenuOverlay();
      if (a === 'piledraw' || a === 'pilediscard') return toast(a === 'piledraw' ? '抽牌堆：' + combat.drawPile.length : '弃牌堆：' + combat.discard.length);
      if (a === 'closeoverlay') return closeOverlay();
      if (a === 'forcerestart') { if (confirm('放弃当前审判，回到标题？')) { clearSave(); screen = 'menu'; render(); } return; }
    });
  });
}

function showDeck() {
  if (!S) return;
  const cards = S.deck.map(id => cardHTML(id, -1, false)).join('');
  overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="overlay-card"><div class="overlay-head"><h3>牌组 · ${S.deck.length} 张</h3><button class="btn ghost" data-act="closeoverlay">关 闭</button></div><div class="deck-grid">${cards}</div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-act="closeoverlay"]').addEventListener('click', closeOverlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });
}
function showMenuOverlay() {
  overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="overlay-card" style="max-width:420px"><div class="overlay-head"><h3>菜单</h3><button class="btn ghost" data-act="closeoverlay">关 闭</button></div>
    <div class="choice-list">
      <button class="choice" data-act="deck"><b>查看牌组</b><small>${S ? S.deck.length + ' 张证词' : ''}</small></button>
      <button class="choice" data-act="forcerestart"><b>放弃审判</b><small>回到标题，清空本局存档</small></button>
      <button class="choice" data-act="classic"><b>联机经典版</b><small>回到原来的联机大厅</small></button>
    </div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => {
    const a = el.dataset.act;
    if (a === 'closeoverlay') return closeOverlay();
    if (a === 'deck') { closeOverlay(); return showDeck(); }
    if (a === 'classic') { location.href = window.Capacitor ? 'index.html' : '/classic.html'; return; }
    if (a === 'forcerestart') { closeOverlay(); if (confirm('放弃当前审判，回到标题？')) { clearSave(); screen = 'menu'; render(); } }
  }));
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });
}
function closeOverlay() {
  if (overlay) { overlay.remove(); overlay = null; }
}

/* ---------------- 启动 ---------------- */
function bindTopbar() {
  const deck = document.querySelector('[data-act="deck"]');
  const menu = document.querySelector('[data-act="menu"]');
  if (deck) deck.addEventListener('click', showDeck);
  if (menu) menu.addEventListener('click', showMenuOverlay);
}
bindTopbar();
screen = 'menu';
render();
