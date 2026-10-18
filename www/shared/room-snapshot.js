/* shared/room-snapshot.js — 服务端房间快照持久化（Task 3）
 * 纯函数模块（require 无副作用），供 server.js 在启动恢复 / 定时落盘 / 退出落盘时调用。
 *
 * 设计：
 *  - 序列化只保留可 JSON 化的房间字段；运行时对象（timers/deadlines/aiRetries/
 *    aiBusy/aiQueue）不写入，恢复时由调用方（createRoom）重建空实例。
 *  - seats.connected 强制写 false：服务器重启后所有玩家处于"断线态"，
 *    同名 joinRoom 走重连分支（自动取消 AI 接管 / 恢复快照）。
 *  - 断线快照（snapshots）一并持久化：重启后掉线玩家重连仍能恢复私有资源。
 *  - 写入用 tmp + rename 原子替换，避免写一半损坏文件。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Core = require('./game-core.js');   // 评审 P0-BUG：恢复房间时重建可序列化随机源

const SNAPSHOT_FILE = 'rooms-snapshot.json';

/* 序列化：Map<code, room> → 可 JSON 化的数组 */
function serializeRooms(rooms) {
  const list = [];
  for (const room of rooms.values()) {
    if (!room || typeof room.code !== 'string') continue;
    list.push({
      code: room.code,
      mode: room.mode,
      maxSeats: room.maxSeats,
      password: room.password || '',
      seed: room.seed || null,
      hostSeat: room.hostSeat != null ? room.hostSeat : 0,
      started: !!room.started,
      lastActivity: room.lastActivity || Date.now(),
      seats: (room.seats || []).map(s => (s && s.name)
        ? { name: s.name, isAI: !!s.isAI, connected: false }
        : null),
      state: room.state || null,
      snapshots: [...(room.snapshots || new Map()).entries()]
        .map(([seat, snap]) => ({ seat, state: snap.state, savedAt: snap.savedAt || Date.now() }))
    });
  }
  return list;
}

/* 反序列化：数组 → Map<code, room>。
 * factory(code, opts) 由调用方提供 createRoom（需支持指定 code），负责重建骨架
 * （seats 骨架 / snapshots Map / timers / deadlines / aiRetries / aiBusy / aiQueue）。 */
function deserializeRooms(list, factory) {
  const rooms = new Map();
  if (!Array.isArray(list)) return rooms;
  for (const item of list) {
    if (!item || typeof item.code !== 'string' || !/^[A-Z2-9]{4}$/.test(item.code)) continue;
    try {
      const room = factory(item.code, {
        mode: item.mode === 'solo' ? 'solo' : 'multi',
        maxSeats: item.maxSeats,
        hostName: (item.seats && item.seats[0] && item.seats[0].name) || '玩家',
        seed: item.seed,
        password: item.password
      });
      room.started = !!item.started;
      room.hostSeat = (Number.isInteger(item.hostSeat) && item.hostSeat >= 0 && item.hostSeat < room.maxSeats)
        ? item.hostSeat : 0;
      room.lastActivity = (item.lastActivity && item.lastActivity > 0) ? item.lastActivity : Date.now();
      // 座位表：保留 name/isAI，connected 一律 false（重启后需重连）
      for (let i = 0; i < room.maxSeats; i++) {
        const s = item.seats && item.seats[i];
        if (s && s.name) room.seats[i] = { name: s.name, isAI: !!s.isAI, connected: false };
        else if (s && s.isAI) room.seats[i] = { name: s.name || ('AI 对手' + i), isAI: true, connected: false };
      }
      if (item.state && typeof item.state === 'object') {
        room.state = item.state;
        room.state.hostSeat = room.hostSeat;
        Core.restoreRng(room.state);   // 重建 rng（rngSeed/rngCalls 支撑；恢复后随机源可用且确定性不破）
      }
      if (Array.isArray(item.snapshots)) {
        for (const sn of item.snapshots) {
          if (sn && sn.state && Number.isInteger(sn.seat) && sn.seat >= 0) {
            room.snapshots.set(sn.seat, { state: sn.state, savedAt: sn.savedAt || Date.now() });
          }
        }
      }
      rooms.set(room.code, room);
    } catch (e) {
      console.error('[room-snapshot] 恢复房间失败 ' + item.code + '：' + e.message);
    }
  }
  return rooms;
}

/* 原子写入快照文件（tmp + rename）。file 可选：测试可用独立快照文件，避免与主服务器冲突 */
function writeSnapshotFile(dir, rooms, file) {
  try {
    const name = file || SNAPSHOT_FILE;
    const fp = path.join(dir, name);
    const tmp = fp + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(serializeRooms(rooms), null, 1), 'utf8');
    fs.renameSync(tmp, fp);
    return true;
  } catch (e) {
    console.error('[room-snapshot] 写入失败：' + e.message);
    return false;
  }
}

/* 读取快照文件（文件不存在返回 []，损坏返回 [] 并告警）。file 可选，同 writeSnapshotFile */
function readSnapshotFile(dir, file) {
  const name = file || SNAPSHOT_FILE;
  const fp = path.join(dir, name);
  try {
    if (!fs.existsSync(fp)) return [];
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('[room-snapshot] 读取失败（忽略损坏快照）：' + e.message);
    return [];
  }
}

module.exports = {
  SNAPSHOT_FILE,
  serializeRooms,
  deserializeRooms,
  writeSnapshotFile,
  readSnapshotFile
};
