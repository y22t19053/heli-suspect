/* ============================================================
 * 合理怀疑 · 联机服务器（Express 静态 + Socket.IO 权威房间）
 * 运行：npm install && node server.js  →  http://localhost:3000
 * ============================================================ */
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Core = require('./shared/game-core.js');
const { writeSnapshotFile, readSnapshotFile, deserializeRooms } = require('./shared/room-snapshot.js');

const PORT = process.env.PORT || 3000;
const SEAT_TIMEOUT_MS = clampInt(Number(process.env.SEAT_TIMEOUT_MS) || 30000, 5000, 120000);   // 单次操作倒计时（可配置，超级更新#69）
const AI_INTERVAL = 900;         // AI 连续行动的最小间隔

/* ---------------- 安全层配置（超级更新：连接/房间/消息限流） ---------------- */
const MAX_ROOMS = 200;               // 全局房间上限（防房间洪水）
const MAX_SOCKETS_PER_IP = 8;        // 单 IP 并发连接上限
const RATE_WINDOW_MS = 2000;         // 限流统计窗口
const RATE_MAX_EVENTS = 40;          // 窗口内事件总数上限
const RATE_MAX_ACTIONS = 10;         // 窗口内 action 次数上限（游戏操作更严格）
const RATE_BAN_MS = 30000;           // 超限冷却时长
const MAX_ACTION_FIELDS = 16;        // action 数组字段长度上限

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
const server = http.createServer(app);
 const io = new Server(server, {
   maxHttpBufferSize: 64e3,
   // 打包版/APK 从 file:// 或远程页面连接自建服务器时需要跨域轮询回退；
   // WebSocket 本身不受 CORS 限制，但 Socket.IO 的 polling 需要这个头。
   cors: { origin: true, methods: ['GET', 'POST'] }
 });   // 单条消息上限 64KB

/* ---------------- 房间管理 ---------------- */
const ROOMS = new Map();          // code -> room
const SOCK_TO_ROOM = new Map();   // socketId -> {code, seat}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (ROOMS.has(code));
  return code;
}

function sanitizePass(raw) {
  const s = String(raw == null ? '' : raw).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 12);
  return s;
}

function createRoom({ mode, maxSeats, hostName, seed, password, roundsLimit, code: givenCode }) {
  // 快照恢复时传入原房间号（普通建房传 null → 随机生成）
  const code = (givenCode && /^[A-Z2-9]{4}$/.test(givenCode)) ? givenCode : genCode();
  const room = {
    code, mode,
    maxSeats: clampInt(maxSeats, 2, 4),
    seed: (typeof seed === 'string' && seed.trim() !== '') ? seed.trim().slice(0, 40) : null,   // 房主种子码（留空=随机，分享战绩用）
    password: sanitizePass(password),   // 房间密码（留空=公开房，加入/快速加入需匹配）
    roundsLimit: clampInt(roundsLimit || 5, 1, 5),   // P1-4 快速模式：1 轮试玩 / 默认 5 轮
    seats: [],
    state: null,
    started: false,
    timers: new Map(),          // seat -> timeout
    deadlines: new Map(),       // seat -> 本次行动的绝对截止时间（广播时复用，防无限重置）
    aiRetries: new Map(),       // seat -> 连续 AI 行动重试次数（防死循环）
    aiBusy: new Set(),          // seat 正在执行 AI 行动
    aiQueue: Promise.resolve(), // 本房间独立的 AI 行动队列（避免跨房间串行阻塞）
    snapshots: new Map(),       // seat -> 断线快照 { state(深拷贝), savedAt }：AI 托管期间保留，重连时恢复私有资源
    hostSeat: 0,
    lastActivity: Date.now(),   // 最后活动时间（空闲清理用）
    notices: [],
    diag: [],                   // 服务端诊断环形缓冲（程序意见3）
    stats: { bought: {}, played: {}, locked: {}, skillTriggers: {} },  // 卡牌埋点（项目意见2）
    statsDone: false            // 局末统计摘要已输出标记
  };
  // 座位骨架
  for (let i = 0; i < room.maxSeats; i++) {
    room.seats.push({ name: null, isAI: false, connected: false });
  }
  // 单机模式：除 0 号外全部 AI（座位 0 由房主占据）——敌方一律为「AI 对手」
  if (mode === 'solo') {
    for (let i = 1; i < room.maxSeats; i++) {
      room.seats[i] = { name: 'AI 对手' + (i > 1 ? ' ' + i : ''), isAI: true, connected: false };
    }
  }
  ROOMS.set(code, room);
  return room;
}

function clampInt(v, a, b) { return Math.max(a, Math.min(b, Math.floor(v) || a)); }

/* ---------------- 安全层：连接/房间/消息限流 + 参数消毒（超级更新） ---------------- */
const ipCounts = new Map();        // ip -> { count, bannedUntil }
const socketRates = new Map();     // socketId -> { windowStart, count, actionCount }

function ipOf(socket) {
  return socket.handshake && socket.handshake.address || (socket.conn && socket.conn.remoteAddress) || '?';
}
function sanitizeName(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 12);
  return s || '玩家';
}
function guardConnection(socket) {
  const ip = ipOf(socket);
  const now = Date.now();
  let c = ipCounts.get(ip);
  if (c && c.bannedUntil > now) {
    try { socket.emit('notice', '连接过于频繁，请稍候再试'); socket.disconnect(true); } catch (e) {}
    return false;
  }
  if (!c) { c = { count: 0, bannedUntil: 0 }; ipCounts.set(ip, c); }
  c.count++;
  if (c.count > MAX_SOCKETS_PER_IP) {
    c.bannedUntil = now + RATE_BAN_MS;
    try { socket.emit('notice', '连接数超限，请稍候再试'); socket.disconnect(true); } catch (e) {}
    return false;
  }
  return true;
}
function releaseConnection(socket) {
  const ip = ipOf(socket);
  const c = ipCounts.get(ip);
  if (c && c.count > 0) { c.count--; if (c.count <= 0) ipCounts.delete(ip); }
  socketRates.delete(socket.id);
}
function rateLimit(socket, isAction) {
  const now = Date.now();
  let r = socketRates.get(socket.id);
  if (!r || now - r.windowStart > RATE_WINDOW_MS) { r = { windowStart: now, count: 0, actionCount: 0 }; socketRates.set(socket.id, r); }
  r.count++;
  if (isAction) r.actionCount++;
  return !(r.count > RATE_MAX_EVENTS || (isAction && r.actionCount > RATE_MAX_ACTIONS));
}
/* action 参数消毒：只保留白名单字段并约束类型/长度 */
function sanitizeAction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const a = {};
  if (typeof raw.type === 'string' && raw.type.length <= 32) a.type = raw.type;
  if (typeof raw.uid === 'string') a.uid = raw.uid.slice(0, 64);
  if (Array.isArray(raw.uids)) a.uids = raw.uids.filter(u => typeof u === 'string').slice(0, MAX_ACTION_FIELDS).map(u => u.slice(0, 64));
  if (typeof raw.charId === 'string') a.charId = raw.charId.slice(0, 64);
  if (raw.starterSeat === undefined || Number.isInteger(raw.starterSeat)) a.starterSeat = raw.starterSeat;
  if (raw.targetSeat === undefined || Number.isInteger(raw.targetSeat)) a.targetSeat = raw.targetSeat;
  if (typeof raw.targetUid === 'string') a.targetUid = raw.targetUid.slice(0, 64);
  return Object.keys(a).length ? a : null;
}
/* 纵深防御（G 类审查）：引擎权威校验（Core.apply）之前的快速失败。
 * 与 game-core 规则同语义，只做"确定非法"的提前拦截，不重复完整规则逻辑；
 * 即使未来引擎校验被改动/绕过，畸形或越权操作也不会抵达内部逻辑。 */
function preflightAction(st, seat, a) {
  const s = st.seats[seat];
  if (!s) return { ok: false, msg: '非法座位' };
  const phaseOf = {
    pickChar: 'pickChar', pickStarter: 'chooseStarter',
    buyCard: 'buy', lockCard: 'buy', refreshMarket: 'buy', endBuy: 'buy',
    playCards: 'play', finishPlay: 'play',
    terroristTarget: 'reveal', swapTarget: 'count',
    playEvent: null, passEvent: null,       // pre/post 均可，引擎精确校验
    keepCard: 'discard', finishKeep: 'discard'
  };
  if (Object.prototype.hasOwnProperty.call(phaseOf, a.type)) {
    const want = phaseOf[a.type];
    if (want && st.phase !== want) return { ok: false, msg: '当前阶段不允许该操作' };
  }
  // 卡牌所有权：uids/uid 必须属于该玩家自己的手牌或取证架
  if (a.type === 'playCards' && Array.isArray(a.uids)) {
    for (const uid of a.uids) {
      if (!s.hand.some(c => c.uid === uid)) return { ok: false, msg: '卡牌不在你的手中' };
    }
  }
  if ((a.type === 'buyCard' || a.type === 'lockCard') && a.uid) {
    if (!s.market.some(c => c.uid === a.uid)) return { ok: false, msg: '卡牌不在你的取证架中' };
  }
  if (a.type === 'keepCard' && a.uid) {
    if (!s.hand.some(c => c.uid === a.uid)) return { ok: false, msg: '卡牌不在你的手中' };
  }
  if (a.type === 'playEvent' && a.uid) {
    if (!s.events.some(e => e.uid === a.uid)) return { ok: false, msg: '事件牌不在你的手中' };
  }
  // 角色选择必须在候选中
  if (a.type === 'pickChar' && a.charId) {
    if (!(st.draftCandidates[seat] || []).some(c => c.id === a.charId)) return { ok: false, msg: '非法角色' };
  }
  // 事件目标不能是自己
  if (a.type === 'playEvent' && a.targetSeat !== undefined && a.targetSeat === seat) {
    return { ok: false, msg: '不能以自己为事件目标' };
  }
  return { ok: true };
}
function ensureRoomLimit(socket) {
  if (ROOMS.size >= MAX_ROOMS) {
    socket.emit('notice', '服务器房间已满，请稍后再试');
    return false;
  }
  return true;
}

function seatSummary(room) {
  return room.seats.map((s, i) => ({
    seat: i, name: s.name, isAI: s.isAI, connected: s.connected, host: i === room.hostSeat
  }));
}

function broadcastRoom(room) {
  const payload = {
    code: room.code, mode: room.mode, maxSeats: room.maxSeats,
    started: room.started, seats: seatSummary(room)
  };
  for (const sock of io.sockets.sockets.values()) {
    const info = SOCK_TO_ROOM.get(sock.id);
    if (!info || info.code !== room.code) continue;
    sock.emit('room', Object.assign({ you: info.seat }, payload));
  }
}

function broadcastState(room) {
  if (!room.state) return;
  room.state.hostSeat = room.hostSeat;
  const st = room.state;
  for (const sock of io.sockets.sockets.values()) {
    const info = SOCK_TO_ROOM.get(sock.id);
    if (!info || info.code !== room.code) continue;
    const seat = info.seat;
    // 每个玩家看到自己（防作弊：不暴露他人手牌内容）
    const view = makeView(st, seat);
    sock.emit('state', view);
  }
  // 行动倒计时（复用已记录的 deadline，避免每次广播都重置 → 人类玩家永不超时）
  const humans = Core.humanActing(st);
  for (const sock of io.sockets.sockets.values()) {
    const info = SOCK_TO_ROOM.get(sock.id);
    if (!info || info.code !== room.code) continue;
    if (humans.includes(info.seat) && !st.seats[info.seat].isAI) {
      let dl = room.deadlines.get(info.seat);
      if (dl == null || dl <= Date.now()) dl = Date.now() + SEAT_TIMEOUT_MS;   // 过期/缺失才重设
      sock.emit('turn', { seat: info.seat, deadline: dl, phase: st.phase });
    }
  }
}

/* 观众视图：隐藏他人手牌/事件/市场，隐藏未使用事件牌与暗置出牌的具体内容
 * （新 16 步状态机：pickChar→chooseStarter→drawEvent→drawVoter→buy→play→reveal
 *  →preEvent→count→postEvent→rank→settle→discard→income→gameover） */
function makeView(st, mySeat) {
  const seats = st.seats.map((s, i) => {
    const copy = Object.assign({}, s);
    // B1：非我方手牌彻底隐藏（数量也不暴露，hand=null）
    copy.hand = (i === mySeat) ? s.hand : null;
    copy.market = (i === mySeat) ? s.market : [];          // 市场私有（防作弊）
    copy.events = s.events.map(e => (i === mySeat || e.used) ? e : { hidden: true, timing: e.timing });
    copy.keepUids = (i === mySeat) ? (s.keepUids || []) : null;
    copy.stats = Object.assign({}, s.stats);
    return copy;
  });
  // 中央行：暗置（未亮出）的他人牌以牌背呈现，仅亮出/自己的牌可见内容
  const row = st.row.map(r => {
    if (r.seat === mySeat || r.revealed) return r;
    return { seat: r.seat, card: { hidden: true }, revealed: r.revealed, removed: r.removed };
  });
  const view = {
    version: st.version,
    seatCount: st.seatCount,
    hostSeat: st.hostSeat,
    mySeat,
    phase: st.phase,
    phaseLabel: Core.phaseLabel(st),
    roundsLimit: st.roundsLimit || 5,   // P1-4 快速模式：客户端显示「快速·1轮试玩」
    seats,
    draftCandidates: mySeat >= 0 ? st.draftCandidates[mySeat] : [],
    draftPicked: st.seats.map(s => !!s.char),
    round: st.round,
    startingSeat: st.startingSeat,
    turn: st.turn,
    playTurn: st.playTurn,
    playLastSeat: st.playLastSeat,
    row,
    votes: st.votes,
    voteMod: st.voteMod,
    roundRank: st.roundRank,
    rankInfo: st.rankInfo,
    supportReward: st.supportReward,
    supportBuff: st.supportBuff,
    starterPicker: st.starterPicker,
    starterChosen: st.starterChosen,
    leaderStreak: st.leaderStreak || 0,
    prevFirst: st.prevFirst != null ? st.prevFirst : -1,
    revealPending: st.revealPending,
    revealIndex: st.revealIndex,
    swapPending: st.swapPending,
    crossExTurn: st.crossExTurn != null ? st.crossExTurn : -1,
    crossExUsed: st.crossExUsed || [],
    crossExPassed: st.crossExPassed || [],
    eventTurnSeat: st.eventTurnSeat,
    discardSeat: st.discardSeat,
    precedentSeat: st.precedentSeat != null ? st.precedentSeat : -1,
    juryTokens: st.juryTokens || [],
    winType: st.winType || 'support',
    winner: st.winner,
    gameOver: st.gameOver,
    seed: st.seed,              // 种子码（可复现，分享战绩用）
    seedRaw: st.seedRaw != null ? st.seedRaw : null,   // 用户输入的原始种子码（战报/结算屏显示原串，而非 hash 数字）
    logs: st.logs,          // 环形缓冲（logHead 偏移 + 尾部 MAX_LOG 条）：length 单调递增，客户端按全局序号增量扫描
    logHead: st.logHead || 0  // 已被截断丢弃的头部条数（客户端全局序号 = logHead + index）
  };
  return view;
}

function broadcastThink(room, seat, on) {
  for (const sock of io.sockets.sockets.values()) {
    const info = SOCK_TO_ROOM.get(sock.id);
    if (!info || info.code !== room.code) continue;
    sock.emit('aiThink', { seat, on });
  }
}

/* ---------------- 断线快照（3.4 审查项） ----------------
 * 断线时保存整局状态深拷贝；AI 托管期间该座位走「保守托管」（ghostAct）：
 * 只做流程推进（选角/定起始/结束取证/放弃举证/跳过排除/跳过换位/不打事件），
 * 不消耗玩家的私有资源（不买牌/不锁牌/不刷新/不出牌/不打事件）。
 * 玩家重连时从快照恢复私有资源（hand/market/events/keepUids/lockedUids），
 * 使其手牌/市场与断线时刻一致；与全局的冲突（牌已被流程移走）以当前状态为准。 */
function saveSnapshot(room, seat) {
  if (!room.state) return;
  room.snapshots.set(seat, {
    state: JSON.parse(JSON.stringify(room.state)),
    savedAt: Date.now()
  });
}
/* 冲突检测：快照中的私有卡牌若已出现在全局（行区/他人手牌市场/牌堆/档案），
 * 说明 AI 或流程已将其移走——以当前状态为准，不恢复，避免卡牌复制。 */
function cardInGlobal(st, seat, uid) {
  if (Array.isArray(st.row) && st.row.some(r => r.card && r.card.uid === uid)) return true;
  if (Array.isArray(st.used) && st.used.some(c => c.uid === uid)) return true;
  if (Array.isArray(st.grave) && st.grave.some(c => c.uid === uid)) return true;
  for (let i = 0; i < st.seats.length; i++) {
    if (i === seat) continue;
    const s2 = st.seats[i];
    if (s2 && Array.isArray(s2.hand) && s2.hand.some(c => c.uid === uid)) return true;
    if (s2 && Array.isArray(s2.market) && s2.market.some(c => c.uid === uid)) return true;
  }
  return false;
}
/* 重连恢复：把快照中的私有资源覆盖回当前 state（带冲突检测），删除快照 */
function restoreSnapshot(room, seat) {
  const snap = room.snapshots.get(seat);
  if (!snap) return false;
  room.snapshots.delete(seat);
  const st = room.state;
  const cur = st && st.seats[seat];
  const old = snap.state && snap.state.seats && snap.state.seats[seat];
  if (!st || !cur || !old) return false;
  // 私有卡牌集合：仅恢复仍"属于该玩家"的牌（冲突检测），避免复制
  const pick = (arr) => (Array.isArray(arr) ? arr.filter(c => c && !cardInGlobal(st, seat, c.uid)) : []);
  if (Array.isArray(old.hand)) cur.hand = pick(old.hand);
  if (Array.isArray(old.market)) cur.market = pick(old.market);
  if (Array.isArray(old.events)) {
    cur.events = old.events.filter(e => e && !cardInGlobal(st, seat, e.uid));
  }
  cur.keepUids = Array.isArray(old.keepUids) ? old.keepUids.slice() : [];
  cur.lockedUids = Array.isArray(old.lockedUids) ? old.lockedUids.slice() : [];
  cur.lastLockedUids = Array.isArray(old.lastLockedUids) ? old.lastLockedUids.slice() : [];
  // 仅当快照与当前阶段一致（AI 未跨阶段消耗）时恢复流转标志；跨阶段则以当前为准
  if (st.phase === snap.state.phase && st.round === snap.state.round) {
    if (old.buyDone !== undefined) cur.buyDone = old.buyDone;
    if (old.playDone !== undefined) cur.playDone = old.playDone;
    if (old.keepDone !== undefined) cur.keepDone = old.keepDone;
    if (old.eventPassed !== undefined) cur.eventPassed = old.eventPassed;
    if (old.eventCount !== undefined) cur.eventCount = old.eventCount;
  }
  return true;
}
/* 保守托管（断线/超时玩家）：只推进流程，不消耗私有资源 */
function ghostAct(room, seat) {
  const st = room.state;
  const s = st.seats[seat];
  if (!s || st.gameOver) return;
  try {
    switch (st.phase) {
      case 'pickChar':
        if (!s.char) {
          const cands = st.draftCandidates[seat] || [];
          if (cands.length) Core.apply(st, seat, { type: 'pickChar', charId: cands[0].id });
        }
        break;
      case 'chooseStarter':
        if (st.starterPicker === seat && !st.starterChosen) {
          Core.apply(st, seat, { type: 'pickStarter', starterSeat: seat });
        }
        break;
      case 'buy':
        if (!s.buyDone) Core.apply(st, seat, { type: 'endBuy' });   // 不买/不锁/不刷新
        break;
      case 'play':
        if (st.turn === seat && !s.playDone) {
          // ⑩ 每轮必须出牌：但断线托管「保守不消耗私有资源」优先——
          // 放弃本回合举证（规则允许最后一人可放弃，此处机器代弃），
          // 手牌保留供玩家重连后 restoreSnapshot 完整恢复，不出牌不产生全局消耗
          s.playDone = true;
        }
        break;
      case 'reveal':
        if (st.revealPending && st.revealPending.owner === seat) {
          st.revealPending = null;   // 跳过证据排除（不炸对方牌）
          Core.advance(st);
          return;
        }
        break;
      case 'count':
        if (st.swapPending && st.swapPending.owner === seat) {
          st.swapPending = null;     // 跳过政治操盘（不换位）
          Core.advance(st);
          return;
        }
        break;
      case 'preEvent':
      case 'postEvent':
        if (st.eventTurnSeat === seat && !s.eventPassed) Core.apply(st, seat, { type: 'passEvent' });
        break;
      case 'discard':
        if (st.discardSeat === seat && !s.keepDone) {
          // 保留规则必需的最少张数（保持手牌原有顺序取前 N 张），其余归档
          const keepMax = 2 + ((s.char && s.char.skill.type === 'keepPlus') ? s.char.skill.v : 0);
          const n = Math.min(keepMax, (s.hand || []).length);
          s.keepUids = (s.hand || []).slice(0, n).map(c => c.uid);
          Core.apply(st, seat, { type: 'finishKeep' });
        }
        break;
    }
  } catch (e) { console.error('[ghostAct]', room.code, seat, e); }
}

/* ---------------- AI 驱动（每房间独立队列，互不阻塞） ---------------- */
function scheduleAI(room, seat) {
  if (room.aiBusy.has(seat)) return;
  room.aiBusy.add(seat);
  room.aiQueue = room.aiQueue.then(() => new Promise(res => setTimeout(res, AI_INTERVAL))).then(() => {
    try {
      if (!room.state || room.state.gameOver) return;
      // 通知客户端：该 AI 开始行动（思考遮罩）
      broadcastThink(room, seat, true);
      // 断线重连取消 AI 接管：执行前复查该座位是否仍为 AI。
      // 若玩家在排队等待期间已重连（isAI 恢复 false），则跳过本次 AI 行动，
      // 把控制权交还人类玩家，避免「幽灵 AI 行动」抢占玩家的回合。
      const st = room.state;
      if (!st.seats[seat] || !st.seats[seat].isAI) return;
      // AI 决策日志（测试意见2）：行动前快照
      const before = { money: st.seats[seat].money, hand: (st.seats[seat].hand || []).length, lock: (st.seats[seat].lockedUids || []).length, row: st.row.length, phase: st.phase };
      room.diag.push({ t: Date.now(), ev: 'aiStart', seat, name: st.seats[seat].name, phase: st.phase });
      if (room.diag.length > 300) room.diag.splice(0, room.diag.length - 300);
      // 重试上限：连续多次行动后仍需要 AI 行动（状态未推进）→ 强制跳过，防死循环
      const retries = room.aiRetries.get(seat) || 0;
      if (retries >= 3) {
        room.aiRetries.delete(seat);
        pushLogs(room, ['AI ' + (st.seats[seat].name || '对手') + ' 行动异常，强制跳过']);
        forceSkip(st, seat);
        return;
      }
      // 断线托管（3.4）：该座位有快照 → 走保守托管，只推进流程、不消耗私有资源
      const res = room.snapshots.has(seat)
        ? (ghostAct(room, seat), { ok: true })
        : Core.aiAct(st, seat);
      // AI 决策日志（测试意见2）：行动后快照，供事后分析 AI 行为
      const after = { money: st.seats[seat].money, hand: (st.seats[seat].hand || []).length, lock: (st.seats[seat].lockedUids || []).length, row: st.row.length, phase: st.phase };
      room.diag.push({ t: Date.now(), ev: 'aiAct', seat, name: st.seats[seat].name, before, after, msgs: (res && res.msgs) || [] });
      if (room.diag.length > 300) room.diag.splice(0, room.diag.length - 300);
      // aiAct 总是递增 version；改用「行动后该座位是否仍需要行动」判断是否卡死
      const stillNeeds = Core.needsAIAction(st).includes(seat);
      if (stillNeeds) room.aiRetries.set(seat, retries + 1);
      else room.aiRetries.delete(seat);
      if (res && res.ok && res.msgs && res.msgs.length) pushLogs(room, res.msgs);
    } catch (e) {
      console.error('[aiAct]', room.code, seat, e);
      forceSkip(room.state, seat);
    } finally {
      room.aiBusy.delete(seat);
      broadcastThink(room, seat, false);
      afterStateChange(room);
    }
  }).catch(e => console.error('[aiQueue]', room.code, e));  // 兜底：队列链异常不中断后续 AI 调度
}

/* AI 连续行动异常时强制跳过当前阶段（防止行动死循环）——按新 16 步状态机适配 */
function forceSkip(st, seat) {
  if (!st || st.gameOver || !st.seats[seat]) return;
  const s = st.seats[seat];
  try {
    switch (st.phase) {
      case 'pickChar':
        if (!s.char) Core.aiAct(st, seat);   // 直接走 AI 决策
        break;
      case 'chooseStarter':
        if (st.starterPicker === seat && !st.starterChosen) {
          st.startingSeat = seat;
          st.starterChosen = true;
        }
        break;
      case 'buy':
        s.buyDone = true;
        break;
      case 'play':
        if (st.turn === seat && !s.playDone) {
          if (st.playLastSeat === seat) s.playDone = true;                 // 最后一人可放弃
          else if (s.hand.length) Core.apply(st, seat, { type: 'playCards', uids: [s.hand[0].uid] });
          else s.playDone = true;
        }
        break;
      case 'reveal':
        if (st.revealPending && st.revealPending.owner === seat) {
          const targets = st.row.filter(r => r.seat !== seat && !r.removed);
          if (targets.length) Core.apply(st, seat, { type: 'terroristTarget', targetUid: targets[0].card.uid });
          else { st.revealPending = null; Core.advance(st); return; }
        }
        break;
      case 'preEvent':
      case 'postEvent':
        if (st.eventTurnSeat === seat && !s.eventPassed) s.eventPassed = true;
        break;
      case 'discard':
        if (st.discardSeat === seat && !s.keepDone) {
          s.keepUids = s.keepUids || [];
          if (s.hand.length && s.keepUids.length === 0) s.keepUids.push(s.hand[0].uid);
          Core.apply(st, seat, { type: 'finishKeep' });
        }
        break;
    }
    Core.advance(st);   // 强制跳过后推进阶段，避免整个游戏卡住
  } catch (e) { /* 兜底失败不继续传播 */ }
}

function maybeRunAI(room) {
  if (!room.state || room.state.gameOver) return;
  const need = Core.needsAIAction(room.state);
  for (const seat of need) scheduleAI(room, seat);
  const humans = Core.humanActing(room.state);
  // 管理人类计时器
  const active = new Set(humans.filter(s => !room.state.seats[s].isAI));
  for (const [seat, t] of room.timers) {
    if (!active.has(seat)) { clearTimeout(t); room.timers.delete(seat); room.deadlines.delete(seat); }
  }
  for (const seat of active) {
    if (room.timers.has(seat)) continue;
    const t = setTimeout(() => onTimeout(room, seat), SEAT_TIMEOUT_MS);
    room.timers.set(seat, t);
    room.deadlines.set(seat, Date.now() + SEAT_TIMEOUT_MS);
  }
}

function onTimeout(room, seat) {
  room.timers.delete(seat);
  room.deadlines.delete(seat);
  if (!room.state || room.state.gameOver) return;
  if (room.state.seats[seat].isAI) return;
  // 守卫：该座位已不再需要行动（阶段已推进/轮次已过）→ 不接管，避免把人类玩家永久变成 AI
  if (!Core.needsAIAction(room.state).includes(seat)) return;
  room.aiRetries.delete(seat);   // 重新计 AI 重试次数
  // 超时接管前保存快照（3.4）：玩家回来后按断线流程恢复私有资源
  saveSnapshot(room, seat);
  pushLogs(room, ['⏰ ' + room.state.seats[seat].name + ' 超时，AI 代为操作']);
  room.state.seats[seat].isAI = true; // 本回合由 AI 接管
  scheduleAI(room, seat);
}

function pushLogs(room, msgs) {
  if (!room.state) return;
  room.state.logs.push(...msgs);
  // 环形缓冲：丢弃头部而非重建数组（slice(-40) 会令 length 回缩，客户端按全局序号增量扫描新闻 FX 会永久错过）
  const MAX_LOG = 40;
  if (room.state.logs.length > MAX_LOG) {
    const drop = room.state.logs.length - MAX_LOG;
    room.state.logs.splice(0, drop);
    room.state.logHead = (room.state.logHead || 0) + drop;
  }
}

/* 按 uid 找卡（行区/市场/手牌/事件牌），用于埋点记录卡名 */
function findCardByUid(st, uid) {
  if (!st || !uid) return null;
  if (Array.isArray(st.row)) { const r = st.row.find(x => x.card && x.card.uid === uid); if (r) return r.card; }
  for (const s of st.seats) {
    if (Array.isArray(s.market)) { const c = s.market.find(c => c && c.uid === uid); if (c) return c; }
    if (Array.isArray(s.hand)) { const c = s.hand.find(c => c && c.uid === uid); if (c) return c; }
  }
  if (st.pendingEvent && st.pendingEvent.card && st.pendingEvent.card.uid === uid) return st.pendingEvent.card;
  if (st.revealPending && st.revealPending.card && st.revealPending.card.uid === uid) return st.revealPending.card;
  return null;
}

/* 自动阶段推进泵：无任何玩家需要行动时（随机起始、抽事件/证据、计票、排名、
   结算、弃牌过渡、发⊙ 等自动阶段），连续调用 advance() 直至到达需要
   人类/AI 输入的决定点或游戏结束。与单机版 pumpAI 的推进策略一致。 */
function pumpAutoAdvance(room) {
  const st = room.state;
  if (!st || st.gameOver) return;
  let guard = 0;
  while (guard++ < 64) {
    if (st.gameOver) break;
    if (Core.needsAIAction(st).length) break;
    if (Core.humanActing(st).length) break;
    Core.advance(st);
  }
}

function afterStateChange(room) {
  touchRoom(room);
  pumpAutoAdvance(room);
  broadcastState(room);
  maybeRunAI(room);
  // 局末摘要（程序意见3 服务端部分）：输出卡牌埋点 + AI 决策日志到控制台，便于复盘调平衡
  if (room.state && room.state.gameOver && !room.statsDone) {
    room.statsDone = true;
    try {
      console.log('\n[局末摘要] 房间 ' + room.code + '  v' + room.state.version);
      console.log('  · 买入: ' + (Object.entries(room.stats.bought).map(([k, v]) => k + '×' + v).join(', ') || '(无)'));
      console.log('  · 锁定: ' + (Object.entries(room.stats.locked).map(([k, v]) => k + '×' + v).join(', ') || '(无)'));
      console.log('  · 打出: ' + (Object.entries(room.stats.played).map(([k, v]) => k + '×' + v).join(', ') || '(无)'));
      const trig = Object.entries(room.stats.skillTriggers).map(([k, v]) => k + '×' + v).join(', ');
      if (trig) console.log('  · 技能/操作: ' + trig);
      const aiActs = room.diag.filter(d => d.ev === 'aiAct');
      if (aiActs.length) {
        console.log('  · AI 决策 ' + aiActs.length + ' 次（最近 5 条）：');
        aiActs.slice(-5).forEach(d => {
          const b = d.before, a = d.after;
          console.log('    seat' + d.seat + ' [' + d.name + '] ' + b.phase + ': ⊙' + b.money + '→' + a.money + ' 手' + b.hand + '→' + a.hand + ' 锁' + b.lock + '→' + a.lock + ' 行' + b.row + '→' + a.row + (d.msgs.length ? ' 日志:' + d.msgs.join('|') : ''));
        });
      }
    } catch (e) { console.error('[summary]', e); }
  }
}

/* 房间活动时间戳（空闲清理） */
function touchRoom(room) { room.lastActivity = Date.now(); }

const CLEANUP_IDLE_MS = 30 * 60 * 1000;   // 空闲清理阈值：30 分钟无操作

/* 空闲清理：30 分钟无任何操作则关闭房间（避免长期驻留内存） */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of ROOMS) {
    if (now - room.lastActivity > CLEANUP_IDLE_MS) {
      try { io.to(code).emit('notice', '房间因长时间无活动已关闭'); } catch (e) {}
      for (const sock of io.sockets.sockets.values()) {
        const info = SOCK_TO_ROOM.get(sock.id);
        if (info && info.code === code) SOCK_TO_ROOM.delete(sock.id);
      }
      ROOMS.delete(code);
      console.log('[cleanup] 关闭空闲房间', code);
    }
  }
}, 5 * 60 * 1000);

/* ---------------- Socket 事件 ---------------- */
io.on('connection', (socket) => {
  if (!guardConnection(socket)) return;
  socket.on('createRoom', (data, ack) => {
    if (!rateLimit(socket, false)) return ack && ack({ ok: false, msg: '操作过于频繁，请稍候' });
    if (!ensureRoomLimit(socket)) return ack && ack({ ok: false, msg: '服务器房间已满' });
    data = data || {};
    const name = sanitizeName(data.name);
    const mode = data.mode === 'solo' ? 'solo' : 'multi';
    const maxSeats = clampInt(data.maxSeats, 2, 4);
    if (SOCK_TO_ROOM.has(socket.id)) return ack && ack({ ok: false, msg: '你已在房间中' });
    const room = createRoom({ mode, maxSeats, hostName: name, seed: data.seed, password: data.password, roundsLimit: data.roundsLimit });
    // 房主入座 0
    room.seats[0] = { name, isAI: false, connected: true };
    room.hostSeat = 0;
    SOCK_TO_ROOM.set(socket.id, { code: room.code, seat: 0 });
    socket.join(room.code);
    // 单机模式自动补 AI 对手
    if (mode === 'solo') for (let i = 1; i < room.maxSeats; i++) room.seats[i].isAI = true;
    broadcastRoom(room);
    if (ack) ack({ ok: true, code: room.code });
  });

  socket.on('joinRoom', (data, ack) => {
    if (!rateLimit(socket, false)) return ack && ack({ ok: false, msg: '操作过于频繁，请稍候' });
    data = data || {};
    const code = String(data.code || '').trim().toUpperCase();
    if (!/^[A-Z2-9]{4}$/.test(code)) return ack && ack({ ok: false, msg: '房间号格式不正确' });
    const name = sanitizeName(data.name);
    if (SOCK_TO_ROOM.has(socket.id)) return ack && ack({ ok: false, msg: '你已在房间中' });
    const room = ROOMS.get(code);
    if (!room) return ack && ack({ ok: false, msg: '房间不存在' });
    // 房间密码校验（E 类）：加入/重连/观战均需提供正确密码
    if (room.password && sanitizePass(data.password) !== room.password) {
      return ack && ack({ ok: false, msg: '房间密码错误' });
    }
    // 对局已开始：仅允许同名玩家重连（断线重连自动恢复），或观战（spectate 不占座位）
    if (room.started) {
      const re = room.seats.findIndex(s => s.name === name && !s.connected);
      if (re === -1) {
        // 观战模式（E 类）：观看已开始的对局，不占座位、不参与行动判定
        if (data.spectate === true) {
          SOCK_TO_ROOM.set(socket.id, { code, seat: -1 });
          socket.join(code);
          pushLogs(room, [name + ' 开始旁观']);
          broadcastRoom(room);
          if (room.state) afterStateChange(room);   // 观战者立即收到完整 state（含 makeView mySeat=-1 私有信息隐藏）
          if (ack) ack({ ok: true, code, seat: -1, spectate: true });
          return;
        }
        return ack && ack({ ok: false, msg: '对局已开始，无法加入' });
      }
      room.seats[re] = { name, isAI: false, connected: true };
      SOCK_TO_ROOM.set(socket.id, { code, seat: re });
      socket.join(code);
      // 恢复人类状态：取消 AI 接管
      if (room.state && room.state.seats[re]) {
        room.state.seats[re].isAI = false;         // 取消 AI 接管
        room.aiBusy.delete(re);                    // 取消排队中的「幽灵 AI 行动」
        room.aiRetries.delete(re);                 // 清除历史 AI 重试计数，避免误判强制跳过
        const t = room.timers.get(re);
        if (t) { clearTimeout(t); room.timers.delete(re); }   // 清除旧的超时定时器
        // 3.4 快照恢复：AI 托管期间的私有资源（手牌/市场/事件）还原到断线时刻
        if (restoreSnapshot(room, re)) pushLogs(room, ['↩ 已为你恢复掉线前的手牌与市场（座位 ' + re + '）']);
      }
      pushLogs(room, [name + ' 重新连接（座位 ' + re + '）']);
      broadcastRoom(room);
      if (room.state) afterStateChange(room);
      if (ack) ack({ ok: true, code, seat: re, reconnected: true });
      return;
    }
    // 寻找空位（优先匹配同名玩家＝重连）
    let seat = room.seats.findIndex(s => s.name === name && !s.connected);
    if (seat === -1) seat = room.seats.findIndex(s => !s.connected && !s.isAI);
    if (seat === -1) return ack && ack({ ok: false, msg: '房间已满' });
    room.seats[seat] = { name, isAI: false, connected: true };
    SOCK_TO_ROOM.set(socket.id, { code, seat });
    socket.join(code);
    broadcastRoom(room);
    if (ack) ack({ ok: true, code, seat });
  });

  /* 快速加入（E 类）：自动进入第一个未开局、无密码、且有真人空位的公开房 */
  socket.on('quickJoin', (data, ack) => {
    if (!rateLimit(socket, false)) return ack && ack({ ok: false, msg: '操作过于频繁，请稍候' });
    data = data || {};
    const name = sanitizeName(data.name);
    if (SOCK_TO_ROOM.has(socket.id)) return ack && ack({ ok: false, msg: '你已在房间中' });
    let target = null;
    for (const room of ROOMS.values()) {
      if (room.started || room.password) continue;
      if (room.seats.some(s => !s.connected && !s.isAI)) { target = room; break; }
    }
    if (!target) return ack && ack({ ok: false, msg: '暂无开放的公开房间，可创建新房间' });
    const seat = target.seats.findIndex(s => !s.connected && !s.isAI);
    if (seat === -1) return ack && ack({ ok: false, msg: '房间已满' });
    target.seats[seat] = { name, isAI: false, connected: true };
    SOCK_TO_ROOM.set(socket.id, { code: target.code, seat });
    socket.join(target.code);
    broadcastRoom(target);
    if (ack) ack({ ok: true, code: target.code, seat });
  });

  socket.on('startGame', (data, ack) => {
    if (!rateLimit(socket, false)) return ack && ack({ ok: false, msg: '操作过于频繁，请稍候' });
    const info = SOCK_TO_ROOM.get(socket.id);
    if (!info) return ack && ack({ ok: false, msg: '未加入房间' });
    const room = ROOMS.get(info.code);
    if (!room || room.started) return ack && ack({ ok: false, msg: '对局已开始' });
    if (info.seat !== room.hostSeat) return ack && ack({ ok: false, msg: '仅房主可以开始' });
    // 空位补 AI
    for (let i = 0; i < room.maxSeats; i++) {
      if (!room.seats[i].connected && !room.seats[i].isAI) {
        room.seats[i] = { name: 'AI 对手' + i, isAI: true, connected: false };
      }
    }
    if (!room.seats.some(s => s.connected)) return ack && ack({ ok: false, msg: '至少需要 1 名玩家' });
    const names = room.seats.map(s => s.name || ('AI 对手' + s.seat));
    const aiMask = room.seats.map(s => s.isAI);
    room.state = Core.createGame({
      seed: room.seed || Math.floor(Math.random() * 0x7fffffff),   // 房主指定种子可复现（同种子=同一对局）
      seatCount: room.maxSeats,
      names,
      aiMask
    });
    room.state.hostSeat = room.hostSeat;
    if (room.roundsLimit && room.roundsLimit !== 5) room.state.roundsLimit = room.roundsLimit;   // P1-4 快速模式
    room.started = true;
    pushLogs(room, ['对局开始！']);
    broadcastRoom(room);
    afterStateChange(room);
    if (ack) ack({ ok: true });
  });

  socket.on('action', (action, ack) => {
    if (!rateLimit(socket, true)) return ack && ack({ ok: false, msg: '操作过于频繁，请稍候' });
    const info = SOCK_TO_ROOM.get(socket.id);
    if (!info) return ack && ack({ ok: false, msg: '未加入房间' });
    const room = ROOMS.get(info.code);
    if (!room || !room.state || room.state.gameOver) return ack && ack({ ok: false, msg: '对局未进行中' });
    const seat = info.seat;
    const st = room.state;
    if (seat < 0) return ack && ack({ ok: false, msg: '观战中不可操作' });   // 观战者无行动权
    if (st.seats[seat].isAI) return ack && ack({ ok: false, msg: '你已被 AI 接管（等待重连或下局）' });
    const clean = sanitizeAction(action);
    if (!clean) return ack && ack({ ok: false, msg: '非法操作' });
    const pf = preflightAction(st, seat, clean);
    if (!pf.ok) return ack && ack({ ok: false, msg: pf.msg || '操作被拒绝' });
    const res = Core.apply(st, seat, clean);
    if (!res.ok) { if (ack) ack({ ok: false, msg: res.msg || '操作失败' }); return; }
    if (res.msgs && res.msgs.length) pushLogs(room, res.msgs);
    // 卡牌埋点（项目意见2）：统计买/锁/出/技能触发，局末输出摘要供调平衡
    if (clean && clean.type) {
      const bump = (map, key) => { const k = key || clean.type; map[k] = (map[k] || 0) + 1; };
      if (clean.type === 'buyCard' && clean.uid) { const c = findCardByUid(st, clean.uid); bump(room.stats.bought, c ? c.name : clean.uid); }
      else if (clean.type === 'lockCard' && clean.uid) { const c = findCardByUid(st, clean.uid); bump(room.stats.locked, c ? c.name : clean.uid); }
      else if (clean.type === 'playCards' && Array.isArray(clean.uids)) clean.uids.forEach(uid => { const c = findCardByUid(st, uid); bump(room.stats.played, c ? c.name : uid); });
      else if (['playEvent', 'terroristTarget', 'swapTarget', 'refreshMarket', 'keepCard', 'finishKeep'].indexOf(clean.type) >= 0) bump(room.stats.skillTriggers);
    }
    if (ack) ack({ ok: true });
    afterStateChange(room);
  });

  socket.on('disconnect', () => {
    releaseConnection(socket);
    const info = SOCK_TO_ROOM.get(socket.id);
    if (!info) return;
    const room = ROOMS.get(info.code);
    SOCK_TO_ROOM.delete(socket.id);
    if (!room) return;
    const seat = info.seat;
    if (seat < 0) return;   // 观战者离开：不占座位、无房间状态需清理
    if (seat >= 0 && seat < room.seats.length) room.seats[seat].connected = false;
    // 对局中：AI 接管（3.4：先保存快照，玩家重连时恢复私有资源）
    if (room.state && !room.state.gameOver && seat >= 0) {
      saveSnapshot(room, seat);
      room.state.seats[seat].isAI = true;
      pushLogs(room, [(room.seats[seat].name || '玩家') + ' 掉线，AI 已接管（可用同房间号与昵称重连）']);
      // 转移房主
      if (seat === room.hostSeat) {
        const nextHost = room.seats.findIndex((s, i) => i !== seat && s.connected);
        if (nextHost !== -1) room.hostSeat = nextHost;
      }
      afterStateChange(room);
    } else {
      room.seats[seat].name = null;
      room.seats[seat].isAI = false;
      if (seat === room.hostSeat && room.seats.some(s => s.connected)) {
        const nextHost = room.seats.findIndex(s => s.connected);
        room.hostSeat = nextHost;
      }
      broadcastRoom(room);
    }
    if (!room.seats.some(s => s.connected)) {
      // 全部离开：清理计时器并延时删除房间
      for (const t of room.timers.values()) clearTimeout(t);
      room.timers.clear();
      room.deadlines.clear();
      setTimeout(() => { if (ROOMS.get(room.code) === room && !room.seats.some(s => s.connected)) ROOMS.delete(room.code); }, 60000);
    }
  });
});

/* 启动 */
server.listen(PORT, () => {
  console.log('=============================================');
  console.log('  合理怀疑 · 联机服务器已启动');
  console.log('  浏览器打开: http://localhost:' + PORT);
  console.log('  SEAT_TIMEOUT_MS=' + SEAT_TIMEOUT_MS + ' MAX_ROOMS=' + MAX_ROOMS);
  console.log('=============================================');
  restoreRooms();
});

/* ---------------- 房间快照持久化（Task 3） ----------------
 * 每 10 分钟把活跃房间写入 rooms-snapshot.json（原子替换），进程退出时再写一次；
 * 启动时恢复快照中的房间（含对局状态与断线快照），玩家凭原房间号+昵称直接重连。 */
// 落盘间隔：默认 10 分钟；可用环境变量覆盖（测试/运维场景，如 SNAP_INTERVAL_MS=1500）
const SNAP_INTERVAL_MS = (Number(process.env.SNAP_INTERVAL_MS) > 0)
  ? Number(process.env.SNAP_INTERVAL_MS) : 10 * 60 * 1000;
// 快照文件名：默认 rooms-snapshot.json；测试可用 SNAP_FILE 指向独立文件（_test_restart.js 隔离重启验证）
const SNAP_FILE = process.env.SNAP_FILE || null;
// 快照目录：默认项目目录；打包版（asar 只读）用 SNAPSHOT_DIR 指到用户数据目录
const SNAP_DIR = process.env.SNAPSHOT_DIR || __dirname;

function snapshotRooms() { writeSnapshotFile(SNAP_DIR, ROOMS, SNAP_FILE); }

function restoreRooms() {
  const list = readSnapshotFile(SNAP_DIR, SNAP_FILE);
  if (!list.length) return;
  const now = Date.now();
  const restored = deserializeRooms(list, (code, opts) => createRoom(Object.assign({}, opts, { code })));
  let n = 0;
  for (const [code, room] of restored) {
    if (ROOMS.size >= MAX_ROOMS) break;
    if (now - room.lastActivity > CLEANUP_IDLE_MS) continue;   // 过期房间不恢复（与空闲清理语义一致）
    ROOMS.set(code, room);
    // 重新驱动 AI 调度：人类座位无 socket（connected=false），
    // maybeRunAI 会为其设超时兜底（30s 内重连取消接管）
    if (room.started && room.state && !room.state.gameOver) maybeRunAI(room);
    n++;
  }
  if (n) console.log('[snapshot] 已恢复 ' + n + ' 个房间（from rooms-snapshot.json）');
}

setInterval(snapshotRooms, SNAP_INTERVAL_MS).unref();
process.on('SIGINT', () => { snapshotRooms(); process.exit(0); });
process.on('SIGTERM', () => { snapshotRooms(); process.exit(0); });
process.on('exit', () => { try { snapshotRooms(); } catch (e) { /* 退出落盘失败不阻塞 */ } });

/* ---------------- 运维：/health 健康检查 + JSON 事件日志（超级更新） ---------------- */
const startedAt = Date.now();
function jsonLog(ev, extra) {
  try {
    console.log(JSON.stringify(Object.assign({ t: new Date().toISOString(), ev }, extra || {})));
  } catch (e) { /* 日志失败不阻塞 */ }
}
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    rooms: ROOMS.size,
    sockets: io.engine.clientsCount,
    memMB: Math.round(process.memoryUsage().rss / 1048576)
  });
});
/* 房间列表 API（E 类审查）：只读概览，供运维/大厅页面使用 */
app.get('/api/rooms', (req, res) => {
  const list = [];
  for (const room of ROOMS.values()) {
    list.push({
      code: room.code,
      mode: room.mode,
      maxSeats: room.maxSeats,
      players: room.seats.filter(s => s.connected || s.isAI).length,
      started: !!room.started,
      gameOver: !!(room.state && room.state.gameOver)
    });
  }
  res.json({ ok: true, count: list.length, rooms: list });
});
// ipCounts 定时清理（E 类审查）：冷却期过期的条目不常驻内存
setInterval(() => {
  const now = Date.now();
  for (const [ip, c] of ipCounts) {
    if (c.bannedUntil <= now && c.count <= 0) ipCounts.delete(ip);
  }
}, 60000).unref();
// 关键事件 JSON 日志：房间创建 / 关闭 / 局末
const _origCreateRoom = createRoom;
createRoom = function (opts) {
  const room = _origCreateRoom(opts);
  jsonLog('roomCreate', { code: room.code, mode: room.mode, maxSeats: room.maxSeats });
  return room;
};
const _origDel = ROOMS.delete.bind(ROOMS);
ROOMS.delete = function (code) {
  const room = ROOMS.get(code);
  if (room) jsonLog('roomClose', { code, phase: room.state ? room.state.phase : 'lobby', gameOver: !!(room.state && room.state.gameOver) });
  return _origDel(code);
};
// 局末摘要同时输出 JSON 行
void startedAt;
