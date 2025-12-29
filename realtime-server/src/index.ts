// realtime-server/src/index.ts
import { config as loadEnv } from "dotenv";
import express, { Request, Response } from "express";
import cors from "cors";
import http from "http";
import { Server, Socket } from "socket.io";
import type { Snapshot } from "./types.js";
import {
  initFlowerRoom,
  flowerPlayerReady,
  assignFlowerRoles,
  submitNightAction,
  resolveNight,
  submitDayVote,
  resolveDayVote,
  passTurn,
  forcePassTurn,
  updateSpeakerStatus,
  resetFlowerGame,
  canAutoAdvance,
} from "./game-flower/engine.js";
import type { FlowerPlayerState } from "./game-flower/types.js";
import { checkAndScheduleActions } from "./game-flower/scheduler.js";

// Joker Game imports
import {
  initJokerRoom,
  assignJokerRoles,
  selectLocation,
  submitLifeCodeAction,
  submitVote as jokerSubmitVote,
  startMeeting as jokerStartMeeting,
  transitionToVoting,
  transitionToRoleReveal,
  transitionToGreenLight,
  extendMeeting,
  extendVoting,
  resetToLobby as jokerResetToLobby,
  confirmArrival as jokerConfirmArrival,
  checkWinCondition as jokerCheckWin,
  finalizeGame as jokerFinalizeGame,
  startTask as jokerStartTask,
  completeTask as jokerCompleteTask,
  useMonitoringPeek as jokerUseMonitoringPeek,
  usePowerBoost as jokerUsePowerBoost,
  useKitchenOxygen as jokerUseKitchenOxygen,
  useMedicalOxygen as jokerUseMedicalOxygen,
  useWarehouseOxygen as jokerUseWarehouseOxygen,
  failLocationEffect as jokerFailLocationEffect,
  joinSharedTask as jokerJoinSharedTask,
  resolveSharedTask as jokerResolveSharedTask,
  submitSharedTaskChoice as jokerSubmitSharedTaskChoice,
  joinGoldenRabbitTask as jokerJoinGoldenRabbitTask,
  submitGoldenRabbitChoice as jokerSubmitGoldenRabbitChoice,
  setOxygenDrainRate as jokerSetOxygenDrainRate,
} from "./game-joker/engine.js";
import type { ActionResult, JokerPlayerState, JokerSnapshot } from "./game-joker/types.js";
import { checkAndScheduleActions as jokerScheduleActions, clearRoomTimeouts as jokerClearTimeouts, checkAllVoted } from "./game-joker/scheduler.js";

// Load env vars (allow .env.local to override)
loadEnv();
loadEnv({ path: ".env.local", override: true });

/** ===== 简单内存房间状态 ===== */
type PresenceUser = {
  id: string;          // 服务器分配
  name: string;
  sessionId: string;   // 客户端持久化，用于断线重连
  seat: number;
  isHost?: boolean;
  ready?: boolean;     // 准备状态
  isBot?: boolean;
  isDisconnected?: boolean;
  disconnectedAt?: number;
  leftAt?: number;
  kickedAt?: number;
};

type SnapshotWithPlayers = Snapshot & {
  players?: Array<{ sessionId: string; isAlive: boolean }>;
};

type Room = {
  code: string; // 四位数字
  users: Map<string, PresenceUser>; // key = sessionId
  hostSessionId: string;
  createdAt: number;
  lastKeepaliveAt?: number;
  snapshot: any | null; // 服务器权威快照（存储完整快照，不限于特定游戏）
  expectedSnapshotProvider?: string;
  pendingSync?: {
    requester: string;
    candidates: Map<string, number>;
    timer: NodeJS.Timeout;
  };
};

const rooms = new Map<string, Room>();
const cleanupTimers = new Map<string, NodeJS.Timeout>();
const disconnectCleanupTimers = new Map<string, NodeJS.Timeout>();
const JOKER_MAX_SEATS = 16;
const FLOWER_MAX_SEATS = 9;
const ROOM_EMPTY_GRACE_MS = Number(process.env.ROOM_EMPTY_GRACE_MS ?? 5 * 60 * 1000);
const DISCONNECT_GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS ?? 15 * 60 * 1000);

function cancelRoomCleanup(code: string) {
  const timer = cleanupTimers.get(code);
  if (timer) {
    clearTimeout(timer);
    cleanupTimers.delete(code);
  }
}

function scheduleRoomCleanup(room: Room) {
  cancelRoomCleanup(room.code);
  const timer = setTimeout(() => {
    cleanupTimers.delete(room.code);
    const current = rooms.get(room.code);
    if (!current) return;
    if (current.users.size === 0) {
      const lastKeepalive = current.lastKeepaliveAt ?? current.createdAt;
      if (Date.now() - lastKeepalive >= ROOM_EMPTY_GRACE_MS) {
        rooms.delete(current.code);
        return;
      }
      scheduleRoomCleanup(current);
    }
  }, ROOM_EMPTY_GRACE_MS);
  cleanupTimers.set(room.code, timer);
}

function cancelDisconnectCleanup(code: string) {
  const timer = disconnectCleanupTimers.get(code);
  if (timer) {
    clearTimeout(timer);
    disconnectCleanupTimers.delete(code);
  }
}

function scheduleDisconnectCleanup(room: Room) {
  cancelDisconnectCleanup(room.code);
  const timer = setTimeout(() => pruneDisconnectedUsers(room.code), DISCONNECT_GRACE_MS + 1000);
  disconnectCleanupTimers.set(room.code, timer);
}

function getActiveUserCount(room: Room) {
  let count = 0;
  for (const user of room.users.values()) {
    // 只统计真人玩家（排除机器人）
    if (!user.isDisconnected && !user.isBot) count++;
  }
  return count;
}

function handleRoomPopulationChange(room: Room) {
  if (getActiveUserCount(room) === 0) {
    room.lastKeepaliveAt = Date.now();
    scheduleRoomCleanup(room);
  } else {
    cancelRoomCleanup(room.code);
  }
}

function broadcastPresence(room: Room) {
  io.to(room.code).emit("presence:state", { roomCode: room.code, users: listUsers(room) });
}

function markUserDisconnected(room: Room, sessionId: string) {
  const user = room.users.get(sessionId);
  if (!user) return false;
  if (user.isBot) {
    room.users.delete(sessionId);
    return true;
  }
  if (user.isDisconnected) return false;
  room.users.set(sessionId, { ...user, isDisconnected: true, disconnectedAt: Date.now() });
  scheduleDisconnectCleanup(room);
  return true;
}

function pruneDisconnectedUsers(roomCode: string) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const now = Date.now();
  let hasPending = false;
  for (const [sid, user] of room.users.entries()) {
    if (user.isDisconnected) {
      const disconnectedAt = user.disconnectedAt ?? now;
      if (now - disconnectedAt >= DISCONNECT_GRACE_MS) {
        room.users.delete(sid);
      } else {
        hasPending = true;
      }
    }
  }
  if (hasPending) {
    scheduleDisconnectCleanup(room);
  } else {
    cancelDisconnectCleanup(room.code);
  }
  ensureHost(room);
  handleRoomPopulationChange(room);
  broadcastPresence(room);
  if (room.users.size === 0) {
    cancelRoomCleanup(room.code);
    cancelDisconnectCleanup(room.code);
    rooms.delete(room.code);
  }
}

/** ===== 工具函数 ===== */
function randCode(): string {
  let c = "";
  while (c.length < 4) c = Math.floor(1000 + Math.random() * 9000).toString();
  return c;
}
function pickRoomCode(): string {
  let code = randCode();
  while (rooms.has(code)) code = randCode();
  return code;
}
function listUsers(r: Room): PresenceUser[] {
  return Array.from(r.users.values()).map(u => ({ ...u }));
}
function nextAvailableSeat(r: Room, preferred?: number | null): number | null {
  const cap = r.snapshot?.engine === "flower" ? FLOWER_MAX_SEATS : JOKER_MAX_SEATS;
  const occupied = new Set<number>();
  for (const u of r.users.values()) occupied.add(u.seat);

  // 尝试满足“期望座位”
  if (
    typeof preferred === "number" &&
    preferred >= 1 &&
    preferred <= cap &&
    !occupied.has(preferred)
  ) {
    return preferred;
  }
  // 否则找最小可用
  for (let i = 1; i <= cap; i++) {
    if (!occupied.has(i)) return i;
  }
  return null;
}
function refreshHostFlags(room: Room) {
  for (const [sid, user] of room.users.entries()) {
    room.users.set(sid, { ...user, isHost: sid === room.hostSessionId });
  }
}

function ensureHost(room: Room) {
  const aliveUsers = Array.from(room.users.values());
  const current = room.hostSessionId ? room.users.get(room.hostSessionId) : null;
  // 只要房主还在房间列表里（哪怕断线、哪怕游戏里死了），就不自动转移
  const currentAlive = current && !current.isBot;
  if (currentAlive) {
    refreshHostFlags(room);
    return;
  }
  const humans = aliveUsers.filter(u => !u.isBot && currentStillAlive(room, u.sessionId));
  const fallback = aliveUsers.filter(u => currentStillAlive(room, u.sessionId));
  const candidate = humans[0] ?? fallback[0] ?? null;
  if (candidate) {
    room.hostSessionId = candidate.sessionId;
  }
  refreshHostFlags(room);
}

function currentStillAlive(room: Room, sessionId: string) {
  const user = room.users.get(sessionId);
  if (user?.isDisconnected) return false;
  // 移除对 snapshot.players 的检查，不再因为游戏内死亡而认为“不活跃”
  return true;
}

/**
 * 在大厅阶段压缩座位号，使座位保持连续(1, 2, 3, ...)
 * 仅在大厅阶段有效，游戏进行中不会改变座位
 */
function compactSeatsIfLobby(room: Room) {
  // 只在大厅阶段压缩座位
  if (room.snapshot && room.snapshot.phase !== "lobby") return;

  // 按当前座位号排序所有用户
  const users = Array.from(room.users.values()).sort((a, b) => a.seat - b.seat);

  // 重新分配座位号 (1, 2, 3, ...)
  let newSeat = 1;
  for (const user of users) {
    if (user.seat !== newSeat) {
      room.users.set(user.sessionId, { ...user, seat: newSeat });
    }
    newSeat++;
  }

  // 同步到 snapshot
  if (room.snapshot) {
    for (const user of room.users.values()) {
      const player = room.snapshot.players[user.seat - 1];
      if (player) {
        player.sessionId = user.sessionId;
        player.name = user.name;
        player.isHost = user.isHost ?? false;
        player.isBot = user.isBot ?? false;
      }
    }
    room.snapshot.updatedAt = Date.now();
  }
}

function genBotSessionId() {
  return `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)} `;
}

/** ===== 基础服务 ===== */
const app = express();
app.use(cors());
app.get("/", (_: Request, res: Response) => {
  res.type("text/plain").send("Fool-Stone Realtime OK");
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

/** ===== socket 连接 ===== */
io.on("connection", (socket: Socket) => {
  socket.data.roomCode = null as string | null;
  socket.data.sessionId = null as string | null;

  /** 创建房间 */
  socket.on(
    "room:create",
    (
      payload: { name: string; sessionId: string },
      cb: (resp: { ok: boolean; code?: string; users?: PresenceUser[]; me?: PresenceUser; msg?: string }) => void
    ) => {
      try {
        const { name, sessionId } = payload || {};
        if (!name || !sessionId) return cb({ ok: false, msg: "缺少 name 或 sessionId" });

        const code = pickRoomCode();
        const seat = 1;
        const room: Room = {
          code,
          users: new Map(),
          hostSessionId: sessionId,
          createdAt: Date.now(),
          lastKeepaliveAt: Date.now(),
          snapshot: initFlowerRoom(code, [{ name, seat, sessionId }]),
        };

        // const seat = nextAvailableSeat(room) ?? 1;
        const me: PresenceUser = {
          id: `U_${Date.now()}_${Math.random().toString(16).slice(2, 6)} `,
          name,
          sessionId,
          seat,
          isHost: true,
          ready: false,
        };
        room.users.set(sessionId, me);
        ensureHost(room);
        rooms.set(code, room);

        socket.join(code);
        socket.data.roomCode = code;
        socket.data.sessionId = sessionId;

        broadcastPresence(room);
        cb({ ok: true, code, users: listUsers(room), me });
      } catch {
        cb({ ok: false, msg: "room:create 失败" });
      }
    }
  );

  /** 加入房间（支持 preferredSeat） */
  socket.on(
    "room:join",
    (
      payload: { code: string; name: string; sessionId: string; preferredSeat?: number | null },
      cb: (resp: { ok: boolean; users?: PresenceUser[]; me?: PresenceUser; msg?: string }) => void
    ) => {
      try {
        const { code, name, sessionId, preferredSeat } = payload || {};
        const room = code ? rooms.get(code) : undefined;
        if (!room) return cb({ ok: false, msg: "房间不存在" });
        if (!name || !sessionId) return cb({ ok: false, msg: "缺少 name 或 sessionId" });

        const existed = room.users.get(sessionId);
        if (room.snapshot && room.snapshot.phase !== "lobby" && !existed) {
          return cb({ ok: false, msg: "游戏已经开始，无法加入" });
        }
        // 大厅阶段：忽略preferredSeat，按先来后到分配座位
        // 游戏进行中：使用原座位或preferredSeat
        const isLobby = !room.snapshot || room.snapshot.phase === "lobby";
        const seat = existed?.seat ?? nextAvailableSeat(room, isLobby ? null : (preferredSeat ?? null));
        if (!seat) return cb({ ok: false, msg: "房间已满" });

        const me: PresenceUser = existed
          ? {
            ...existed,
            name,
            seat,
            isHost: sessionId === room.hostSessionId,
            isDisconnected: false,
            disconnectedAt: undefined,
          }
          : {
            id: `U_${Date.now()}_${Math.random().toString(16).slice(2, 6)} `,
            name,
            sessionId,
            seat,
            isHost: sessionId === room.hostSessionId,
            ready: false,
          };
        room.users.set(sessionId, me);
        ensureHost(room);

        // Sync to snapshot
        if (room.snapshot && room.snapshot.engine === "flower") {
          const players = room.snapshot.players;
          if (players[seat - 1]) {
            players[seat - 1].name = me.name;
            players[seat - 1].sessionId = me.sessionId;
            // 修复：只有在大厅阶段才重置存活状态，避免游戏进行中重连导致“复活”
            if (room.snapshot.phase === "lobby") {
              players[seat - 1].isAlive = true;
            }
            room.snapshot.updatedAt = Date.now();
          }
        }

        socket.join(code);
        socket.data.roomCode = code;
        socket.data.sessionId = sessionId;

        handleRoomPopulationChange(room);
        broadcastPresence(room);
        cb({ ok: true, users: listUsers(room), me });

        // 如果服务器有权威快照，立即下发给新加入的客户端
        if (room.snapshot) {
          socket.emit("state:full", { snapshot: room.snapshot, from: "server", at: Date.now() });
        }
      } catch {
        cb({ ok: false, msg: "room:join 失败" });
      }
    }
  );

  /** 断线重连：保持原会话信息并广播 */
  socket.on(
    "room:resume",
    (
      payload: { code: string; name?: string; sessionId: string; preferredSeat?: number | null },
      cb: (resp: { ok: boolean; users?: PresenceUser[]; me?: PresenceUser; msg?: string }) => void
    ) => {
      try {
        const { code, sessionId, name, preferredSeat } = payload || {};
        const room = code ? rooms.get(code) : undefined;
        if (!room) return cb({ ok: false, msg: "房间不存在" });
        if (!sessionId) return cb({ ok: false, msg: "缺少 sessionId" });

        const existed = room.users.get(sessionId);
        // 大厅阶段：忽略preferredSeat，按先来后到分配座位
        // 游戏进行中：使用原座位或preferredSeat
        const isLobby = !room.snapshot || room.snapshot.phase === "lobby";
        const seat = existed?.seat ?? nextAvailableSeat(room, isLobby ? null : (preferredSeat ?? null));
        if (!seat) return cb({ ok: false, msg: "房间已满" });

        const base: PresenceUser = existed
          ? {
            ...existed,
            name: name?.trim() || existed.name,
            seat,
            isDisconnected: false,
            disconnectedAt: undefined,
          }
          : {
            id: `U_${Date.now()}_${Math.random().toString(16).slice(2, 6)} `,
            name: name?.trim() || `玩家${seat} `,
            sessionId,
            seat,
            ready: false,
          };
        const me: PresenceUser = {
          ...base,
          sessionId,
          isHost: sessionId === room.hostSessionId,
        };
        room.users.set(sessionId, me);
        ensureHost(room);

        socket.join(code);
        socket.data.roomCode = code;
        socket.data.sessionId = sessionId;

        handleRoomPopulationChange(room);
        broadcastPresence(room);
        cb({ ok: true, users: listUsers(room), me });

        // 如果服务器有权威快照，立即下发给重连的客户端
        if (room.snapshot) {
          socket.emit("state:full", { snapshot: room.snapshot, from: "server", at: Date.now() });
        }
      } catch (err) {
        console.error("room:resume 失败", err);
        cb({ ok: false, msg: "room:resume 失败" });
      }
    }
  );

  /** 仅返回在场名单 */
  socket.on(
    "presence:list",
    (payload: { code: string }, cb: (resp: { ok: boolean; users?: PresenceUser[]; msg?: string }) => void) => {
      const { code } = payload || {};
      const room = code ? rooms.get(code) : undefined;
      if (!room) return cb({ ok: false, msg: "房间不存在" });
      cb({ ok: true, users: listUsers(room) });
    }
  );

  /** 切换准备状态 */
  socket.on(
    "room:ready",
    (
      payload: { code: string; sessionId: string; ready: boolean },
      cb: (resp: { ok: boolean; msg?: string }) => void
    ) => {
      try {
        const { code, sessionId, ready } = payload || {};
        const room = code ? rooms.get(code) : undefined;
        if (!room) return cb({ ok: false, msg: "房间不存在" });
        const u = sessionId ? room.users.get(sessionId) : undefined;
        if (!u) return cb({ ok: false, msg: "玩家不存在" });

        room.users.set(sessionId, { ...u, ready: !!ready });

        // Sync to snapshot
        if (room.snapshot && room.snapshot.engine === "flower") {
          const players = room.snapshot.players;
          const p = players.find((p: FlowerPlayerState) => p.sessionId === sessionId);
          if (p) {
            p.isReady = !!ready;
            if (ready) {
              const newSnap = flowerPlayerReady(room.snapshot, p.seat);
              room.snapshot = newSnap;
              io.to(code).emit("state:full", { snapshot: room.snapshot, from: "server", at: Date.now() });
            } else {
              // Just update timestamp if unready
              room.snapshot.updatedAt = Date.now();
              io.to(code).emit("state:full", { snapshot: room.snapshot, from: "server", at: Date.now() });
              checkAndScheduleActions(room, io);
            }
          }
        }

        broadcastPresence(room);
        cb({ ok: true });
      } catch {
        cb({ ok: false, msg: "room:ready 失败" });
      }
    }
  );

  /** 更新玩家昵称 */
  socket.on(
    "room:update_name",
    (
      payload: { code: string; sessionId: string; name: string },
      cb: (resp: { ok: boolean; msg?: string }) => void
    ) => {
      try {
        const { code, sessionId, name } = payload || {};
        const room = code ? rooms.get(code) : undefined;
        if (!room) return cb({ ok: false, msg: "房间不存在" });
        const u = sessionId ? room.users.get(sessionId) : undefined;
        if (!u) return cb({ ok: false, msg: "玩家不存在" });

        // Update presence
        const newName = name?.trim() || u.name;
        room.users.set(sessionId, { ...u, name: newName });
        broadcastPresence(room);

        // Update snapshot if exists
        if (room.snapshot && room.snapshot.players) {
          const players = room.snapshot.players as any[];
          const playerIndex = players.findIndex((p: any) => p.sessionId === sessionId);
          if (playerIndex !== -1) {
            players[playerIndex].name = newName;
            // Force update timestamp to make it authoritative
            room.snapshot.updatedAt = Date.now();
            io.to(code).emit("state:full", { snapshot: room.snapshot, from: "server", at: Date.now() });
          }
        }

        cb({ ok: true });
      } catch {
        cb({ ok: false, msg: "room:update_name 失败" });
      }
    }
  );

  /** 房主主动交接房主身份 */
  socket.on(
    "room:transfer_host",
    (
      payload: { code: string; sessionId: string; targetSessionId: string },
      cb: (resp: { ok: boolean; msg?: string }) => void
    ) => {
      try {
        const { code, sessionId, targetSessionId } = payload || {};
        const room = code ? rooms.get(code) : undefined;
        if (!room) return cb({ ok: false, msg: "房间不存在" });
        if (!sessionId || sessionId !== room.hostSessionId) {
          return cb({ ok: false, msg: "只有房主可以交接" });
        }
        const target = targetSessionId ? room.users.get(targetSessionId) : undefined;
        if (!target) return cb({ ok: false, msg: "目标玩家不存在" });
        if (target.isBot) return cb({ ok: false, msg: "无法交接给机器人" });
        if (target.isDisconnected) return cb({ ok: false, msg: "无法交接给暂离玩家" });

        room.hostSessionId = targetSessionId;
        refreshHostFlags(room);
        broadcastPresence(room);
        cb({ ok: true });
      } catch (err) {
        console.error("room:transfer_host 失败", err);
        cb({ ok: false, msg: "room:transfer_host 失败" });
      }
    }
  );

  /** 房主踢出玩家 */
  socket.on(
    "room:kick",
    (
      payload: { code: string; sessionId: string; targetSessionId: string },
      cb: (resp: { ok: boolean; msg?: string }) => void
    ) => {
      try {
        const { code, sessionId, targetSessionId } = payload || {};
        const room = code ? rooms.get(code) : undefined;
        if (!room) return cb({ ok: false, msg: "房间不存在" });
        if (!sessionId || sessionId !== room.hostSessionId) {
          return cb({ ok: false, msg: "只有房主可以踢人" });
        }
        if (!targetSessionId || !room.users.has(targetSessionId)) {
          return cb({ ok: false, msg: "玩家不存在" });
        }
        if (targetSessionId === room.hostSessionId) {
          return cb({ ok: false, msg: "不能踢出房主" });
        }

        room.users.delete(targetSessionId);
        ensureHost(room);
        compactSeatsIfLobby(room); // 大厅阶段压缩座位
        handleRoomPopulationChange(room);
        broadcastPresence(room);

        for (const sid of io.sockets.adapter.rooms.get(code) || []) {
          const s = io.sockets.sockets.get(sid);
          if (s?.data?.sessionId === targetSessionId) {
            s.leave(code);
            s.emit("room:kicked", { code });
          }
        }

        if (room.users.size === 0) {
          rooms.delete(code);
        }

        cb({ ok: true });
      } catch (err) {
        console.error("room:kick 失败", err);
        cb({ ok: false, msg: "room:kick 失败" });
      }
    }
  );

  /** 房主添加机器人占位 */
  socket.on(
    "room:add_bot",
    (
      payload: { code: string; sessionId: string; name?: string },
      cb: (resp: { ok: boolean; msg?: string }) => void
    ) => {
      try {
        const { code, sessionId, name } = payload || {};
        const room = code ? rooms.get(code) : undefined;
        if (!room) return cb({ ok: false, msg: "房间不存在" });
        if (!sessionId || sessionId !== room.hostSessionId) {
          return cb({ ok: false, msg: "只有房主可以添加机器人" });
        }
        const seat = nextAvailableSeat(room);
        if (!seat) return cb({ ok: false, msg: "房间已满" });

        const botSessionId = genBotSessionId();
        const bot: PresenceUser = {
          id: `BOT_${Date.now()}_${Math.random().toString(16).slice(2, 6)} `,
          name: name?.trim() || `机器人 - ${seat} `,
          sessionId: botSessionId,
          seat,
          isHost: false,
          ready: true,
          isBot: true,
        };
        room.users.set(botSessionId, bot);
        ensureHost(room);

        // Sync to snapshot
        if (room.snapshot && room.snapshot.engine === "flower") {
          const players = room.snapshot.players;
          if (players[seat - 1]) {
            players[seat - 1].name = bot.name;
            players[seat - 1].sessionId = bot.sessionId;
            players[seat - 1].isAlive = true;
            players[seat - 1].isReady = true;
            players[seat - 1].isBot = true;
            room.snapshot.updatedAt = Date.now();
            io.to(code).emit("state:full", { snapshot: room.snapshot, from: "server", at: Date.now() });
          }
        }

        broadcastPresence(room);
        cb({ ok: true });
      } catch (err) {
        console.error("room:add_bot 失败", err);
        cb({ ok: false, msg: "room:add_bot 失败" });
      }
    }
  );

  /** 主动离开房间 */
  socket.on(
    "room:leave",
    (
      payload: { code: string; sessionId?: string },
      cb: (resp: { ok: boolean; msg?: string }) => void
    ) => {
      try {
        const { code, sessionId } = payload || {};
        const room = code ? rooms.get(code) : undefined;
        if (!room) return cb({ ok: false, msg: "房间不存在" });
        const targetSessionId = sessionId || socket.data.sessionId;
        if (!targetSessionId || !room.users.has(targetSessionId)) {
          return cb({ ok: false, msg: "玩家不存在" });
        }

        room.users.delete(targetSessionId);
        ensureHost(room);
        compactSeatsIfLobby(room); // 大厅阶段压缩座位

        socket.leave(code);
        handleRoomPopulationChange(room);
        if (room.users.size === 0) {
          rooms.delete(code);
        } else {
          broadcastPresence(room);
        }
        cb({ ok: true });
      } catch {
        cb({ ok: false, msg: "room:leave 失败" });
      }
    }
  );

  /**
   * ===== Phase 1：动作总线（房主权威） =====
   */
  // 非房主 -> 房主 (Legacy) / Client -> Server (New)
  socket.on(
    "intent",
    (
      payload: { room: string; action: string; data?: any; from: string },
      cb: (resp: { ok: boolean; msg?: string }) => void
    ) => {
      const { room: roomCode, action, data, from } = payload || {};
      const r = roomCode ? rooms.get(roomCode) : undefined;
      if (!r) return cb({ ok: false, msg: "房间不存在" });

      // 特殊处理聊天消息
      if (action === "flower:chat_message") {
        if (r.snapshot && r.snapshot.engine === "flower") {
          const msg = {
            id: data.id || `msg_${Date.now()}_${Math.random()} `,
            sessionId: socket.data.sessionId || "unknown",
            senderSeat: data.senderSeat,
            senderName: data.senderName,
            content: data.content,
            mentions: data.mentions || [],
            timestamp: Date.now(),
          };
          if (!r.snapshot.chatMessages) r.snapshot.chatMessages = [];
          r.snapshot.chatMessages.push(msg);
          r.snapshot.updatedAt = Date.now();
          io.to(roomCode).emit("state:full", { snapshot: r.snapshot, from: "server", at: Date.now() });
          checkAndScheduleActions(r, io);
        }
        // io.to(roomCode).emit("action", { action, payload: data, from, at: Date.now() }); // Removed to avoid duplicate
        return cb({ ok: true });
      }

      // Check if it's a flower game action
      if (action.startsWith("flower:")) {
        if (!r.snapshot || r.snapshot.engine !== "flower") {
          return cb({ ok: false, msg: "游戏未初始化" });
        }

        let res: { ok: boolean; error?: string } = { ok: false, error: "未知指令" };
        let shouldBroadcast = false;

        switch (action) {
          case "flower:assign_roles":
            if (socket.data.sessionId !== r.hostSessionId) return cb({ ok: false, msg: "只有房主可以开始游戏" });
            res = assignFlowerRoles(r.snapshot);
            shouldBroadcast = true;
            break;
          case "flower:submit_night_action":
            res = submitNightAction(r.snapshot, data);
            shouldBroadcast = true;
            break;
          case "flower:resolve_night":
            if (socket.data.sessionId !== r.hostSessionId) return cb({ ok: false, msg: "只有房主可以结算" });
            res = resolveNight(r.snapshot);
            shouldBroadcast = true;
            break;
          case "flower:submit_day_vote":
            res = submitDayVote(r.snapshot, data);
            shouldBroadcast = true;
            break;
          case "flower:resolve_day_vote":
            if (socket.data.sessionId !== r.hostSessionId) return cb({ ok: false, msg: "只有房主可以结算" });
            res = resolveDayVote(r.snapshot);
            shouldBroadcast = true;
            break;
          case "flower:pass_turn":
            res = passTurn(r.snapshot);
            shouldBroadcast = true;
            break;
          case "flower:force_pass_turn": {
            if (socket.data.sessionId !== r.hostSessionId) return cb({ ok: false, msg: "只有房主可以强制过麦" });
            const hostPlayer = r.snapshot.players.find((p: FlowerPlayerState) => p.sessionId === socket.data.sessionId) || null;
            res = forcePassTurn(r.snapshot, hostPlayer?.seat ?? null);
            shouldBroadcast = true;
            break;
          }
          case "flower:speaker_status": {
            const status = data?.status;
            if (status !== "typing" && status !== "awaiting") return cb({ ok: false, msg: "非法发言状态" });
            const player = r.snapshot.players.find((p: FlowerPlayerState) => p.sessionId === socket.data.sessionId);
            if (!player) return cb({ ok: false, msg: "未找到玩家" });
            res = updateSpeakerStatus(r.snapshot, player.seat, status);
            shouldBroadcast = true;
            break;
          }
          case "flower:reset_game":
            if (socket.data.sessionId !== r.hostSessionId) return cb({ ok: false, msg: "只有房主可以重置" });
            res = resetFlowerGame(r.snapshot);
            shouldBroadcast = true;
            break;
          default:
            return cb({ ok: false, msg: "未知的游戏指令" });
        }

        if (res.ok) {
          if (shouldBroadcast) {
            io.to(roomCode).emit("state:full", { snapshot: r.snapshot, from: "server", at: Date.now() });

            // Check for Auto-Advance
            if (canAutoAdvance(r.snapshot)) {
              let autoRes;
              if (r.snapshot.phase === "night_actions") {
                autoRes = resolveNight(r.snapshot);
              } else if (r.snapshot.phase === "day_vote") {
                autoRes = resolveDayVote(r.snapshot);
              }

              if (autoRes && autoRes.ok) {
                io.to(roomCode).emit("state:full", { snapshot: r.snapshot, from: "server", at: Date.now() });
              }
            }

            checkAndScheduleActions(r, io);
          }
          cb({ ok: true });
        } else {
          cb({ ok: false, msg: res.error });
        }
        return;
      }

      // Check if it's a joker game action
      if (action.startsWith("joker:")) {
        // Initialize joker snapshot if needed
        if (!r.snapshot || r.snapshot.engine !== "joker") {
          // Only allow creating joker room if no snapshot exists
          if (action === "joker:create_room") {
            const players = Array.from(r.users.values()).map((u, i) => ({
              name: u.name,
              seat: u.seat,
              sessionId: u.sessionId,
              isBot: u.isBot,
              isHost: u.sessionId === r.hostSessionId,
            }));
            r.snapshot = initJokerRoom(roomCode, players);
            io.to(roomCode).emit("state:full", { snapshot: r.snapshot, from: "server", at: Date.now() });
            return cb({ ok: true });
          }
          return cb({ ok: false, msg: "Joker game not initialized" });
        }

        let res: ActionResult = { ok: false, error: "Unknown action" };
        let shouldBroadcast = false;
        const jokerSnapshot = r.snapshot as JokerSnapshot;
        if (jokerSnapshot.paused && action !== "joker:toggle_pause" && action !== "joker:reset_game") {
          return cb({ ok: false, msg: "Game paused" });
        }

        switch (action) {
          case "joker:start_game":
            if (socket.data.sessionId !== r.hostSessionId) {
              return cb({ ok: false, msg: "Only host can start game" });
            }
            {
              const activeUsers = Array.from(r.users.values()).filter(u => !u.leftAt && !u.kickedAt);
              const disconnected = activeUsers.filter(u => u.isDisconnected);
              if (disconnected.length > 0) {
                const seats = disconnected
                  .map(u => u.seat)
                  .sort((a, b) => a - b)
                  .join("、");
                return cb({ ok: false, msg: `座位${seats}玩家已断开连接` });
              }
              const allReady = activeUsers.length > 0 && activeUsers.every(u => u.ready);
              if (!allReady) {
                return cb({ ok: false, msg: "All players must be ready to start" });
              }
            }
            // Sync users to snapshot before starting
            for (const u of r.users.values()) {
              if (u.seat >= 1 && u.seat <= 16) {
                const p = jokerSnapshot.players[u.seat - 1];
                if (p) {
                  p.sessionId = u.sessionId;
                  p.name = u.name;
                  p.isHost = u.sessionId === r.hostSessionId;
                  p.isBot = u.isBot ?? false;
                }
              }
            }
            res = assignJokerRoles(jokerSnapshot);
            if (res.ok) {
              transitionToRoleReveal(jokerSnapshot);
            }
            shouldBroadcast = true;
            break;

          case "joker:select_location":
            res = selectLocation(jokerSnapshot, data);
            shouldBroadcast = true;
            break;

          case "joker:confirm_arrival":
            res = jokerConfirmArrival(jokerSnapshot, socket.data.sessionId);
            shouldBroadcast = true;
            break;

          case "joker:submit_action":
            res = submitLifeCodeAction(jokerSnapshot, data);
            shouldBroadcast = true;
            // Check for deaths and trigger meeting if needed
            if (res.ok || res.error === "foul_death") {
              const winResult = jokerCheckWin(jokerSnapshot);
              if (winResult) {
                jokerFinalizeGame(jokerSnapshot, winResult);
                jokerClearTimeouts(roomCode);
              }
            }
            // Also broadcast when duck loses oxygen for incorrect kill code
            if (res.error === "Invalid life code" && data?.action === "kill") {
              // Force broadcast even on error so oxygen penalty is synced
              io.to(roomCode).emit("state:full", { snapshot: r.snapshot, from: "server", at: Date.now() });
            }
            break;

          case "joker:report": {
            const reporter = jokerSnapshot.players.find(
              (p: JokerPlayerState) => p.sessionId === socket.data.sessionId
            );
            if (reporter && reporter.isAlive && reporter.sessionId) {
              res = jokerStartMeeting(jokerSnapshot, reporter.sessionId);
              shouldBroadcast = true;
            } else {
              res = { ok: false, error: "Invalid reporter" };
            }
            break;
          }

          case "joker:meeting_start_vote": {
            if (socket.data.sessionId !== r.hostSessionId) {
              return cb({ ok: false, msg: "Only host can start voting" });
            }
            if (jokerSnapshot.phase !== "meeting") {
              res = { ok: false, error: "Meeting not active" };
              break;
            }
            jokerClearTimeouts(roomCode);
            transitionToVoting(jokerSnapshot);
            res = { ok: true };
            shouldBroadcast = true;
            break;
          }

          case "joker:meeting_extend": {
            if (socket.data.sessionId !== r.hostSessionId) {
              return cb({ ok: false, msg: "Only host can extend meeting" });
            }
            jokerClearTimeouts(roomCode);
            res = extendMeeting(jokerSnapshot, 30_000);
            shouldBroadcast = true;
            break;
          }

          case "joker:toggle_pause": {
            if (socket.data.sessionId !== r.hostSessionId) {
              return cb({ ok: false, msg: "Only host can pause game" });
            }
            const now = Date.now();
            if (!jokerSnapshot.paused) {
              // Pause: freeze oxygen for all alive players
              const remaining = jokerSnapshot.deadline ? Math.max(0, jokerSnapshot.deadline - now) : 0;
              jokerSnapshot.paused = true;
              jokerSnapshot.pauseRemainingMs = remaining;
              jokerSnapshot.deadline = undefined;
              if (jokerSnapshot.phase === "meeting" && jokerSnapshot.meeting) {
                jokerSnapshot.meeting.discussionEndAt = undefined;
              }
              // Freeze oxygen (drainRate=0)
              for (const player of jokerSnapshot.players) {
                if (player.isAlive && player.sessionId) {
                  jokerSetOxygenDrainRate(player, 0);
                }
              }
              jokerClearTimeouts(roomCode);
            } else {
              // Resume: restore oxygen drain rate based on leak status
              jokerSnapshot.paused = false;
              const remaining = jokerSnapshot.pauseRemainingMs ?? 0;
              jokerSnapshot.deadline = Date.now() + remaining;
              jokerSnapshot.pauseRemainingMs = undefined;
              if (jokerSnapshot.phase === "meeting" && jokerSnapshot.meeting) {
                jokerSnapshot.meeting.discussionEndAt = jokerSnapshot.deadline;
              }
              // Restore oxygen drain rate (1 for normal, 3 for leak)
              for (const player of jokerSnapshot.players) {
                if (player.isAlive && player.sessionId) {
                  const drainRate = player.oxygenLeakActive ? 3 : 1;
                  jokerSetOxygenDrainRate(player, drainRate);
                }
              }
            }
            jokerSnapshot.updatedAt = Date.now();
            res = { ok: true };
            shouldBroadcast = true;
            break;
          }

          case "joker:voting_extend": {
            if (socket.data.sessionId !== r.hostSessionId) {
              return cb({ ok: false, msg: "Only host can extend voting" });
            }
            jokerClearTimeouts(roomCode);
            res = extendVoting(jokerSnapshot, 30_000);
            shouldBroadcast = true;
            break;
          }

          case "joker:vote": {
            const voter = jokerSnapshot.players.find(
              (p: JokerPlayerState) => p.sessionId === socket.data.sessionId
            );
            if (!voter) {
              return cb({ ok: false, msg: "Player not found" });
            }
            res = jokerSubmitVote(jokerSnapshot, {
              voterSeat: voter.seat,
              targetSessionId: data?.targetSessionId ?? null,
            });
            shouldBroadcast = true;
            // Check if all voted
            if (res.ok) {
              checkAllVoted(r, io);
            }
            break;
          }

          case "joker:start_task":
            res = jokerStartTask(jokerSnapshot, socket.data.sessionId);
            shouldBroadcast = true;
            break;

          case "joker:complete_task":
            res = jokerCompleteTask(jokerSnapshot, socket.data.sessionId);
            shouldBroadcast = true;
            // Check win condition after task completion
            if (res.ok) {
              const winResult = jokerCheckWin(jokerSnapshot);
              if (winResult) {
                jokerFinalizeGame(jokerSnapshot, winResult);
                jokerClearTimeouts(roomCode);
              }
            }
            break;

          case "joker:location_monitor":
            res = jokerUseMonitoringPeek(jokerSnapshot, socket.data.sessionId);
            shouldBroadcast = res.ok;
            break;

          case "joker:location_power":
            res = jokerUsePowerBoost(jokerSnapshot, socket.data.sessionId);
            shouldBroadcast = true;
            break;

          case "joker:location_kitchen":
            res = jokerUseKitchenOxygen(jokerSnapshot, socket.data.sessionId);
            shouldBroadcast = true;
            break;

          case "joker:location_medical":
            res = jokerUseMedicalOxygen(jokerSnapshot, socket.data.sessionId, data?.targetSessionId);
            shouldBroadcast = true;
            break;

          case "joker:location_warehouse":
            res = jokerUseWarehouseOxygen(jokerSnapshot, socket.data.sessionId);
            shouldBroadcast = true;
            break;

          case "joker:location_effect_fail":
            res = jokerFailLocationEffect(jokerSnapshot, socket.data.sessionId);
            shouldBroadcast = true;
            break;

          case "joker:shared_task_join":
            res = jokerJoinSharedTask(jokerSnapshot, socket.data.sessionId, data?.type);
            shouldBroadcast = true;
            break;

          case "joker:shared_task_resolve":
            {
              const actor = jokerSnapshot.players.find(
                (p: JokerPlayerState) => p.sessionId === socket.data.sessionId
              );
              if (!actor || !actor.location) {
                res = { ok: false, error: "Invalid player" };
                break;
              }
              res = jokerResolveSharedTask(jokerSnapshot, actor.location, !!data?.success);
            }
            shouldBroadcast = true;
            if (res.ok) {
              const winResult = jokerCheckWin(jokerSnapshot);
              if (winResult) {
                jokerFinalizeGame(jokerSnapshot, winResult);
                jokerClearTimeouts(roomCode);
              }
            }
            break;

          case "joker:shared_task_submit":
            res = jokerSubmitSharedTaskChoice(jokerSnapshot, socket.data.sessionId, data?.index);
            shouldBroadcast = true;
            if (res.ok) {
              const winResult = jokerCheckWin(jokerSnapshot);
              if (winResult) {
                jokerFinalizeGame(jokerSnapshot, winResult);
                jokerClearTimeouts(roomCode);
              }
            }
            break;

          case "joker:golden_rabbit_join":
            res = jokerJoinGoldenRabbitTask(jokerSnapshot, socket.data.sessionId);
            shouldBroadcast = true;
            break;

          case "joker:golden_rabbit_submit":
            res = jokerSubmitGoldenRabbitChoice(jokerSnapshot, socket.data.sessionId, data?.index);
            shouldBroadcast = true;
            if (res.ok) {
              const winResult = jokerCheckWin(jokerSnapshot);
              if (winResult) {
                jokerFinalizeGame(jokerSnapshot, winResult);
                jokerClearTimeouts(roomCode);
              }
            }
            break;

          case "joker:reset_game":
            if (socket.data.sessionId !== r.hostSessionId) {
              return cb({ ok: false, msg: "Only host can reset game" });
            }
            jokerResetToLobby(jokerSnapshot);
            jokerClearTimeouts(roomCode);
            shouldBroadcast = true;
            res = { ok: true };
            break;

          default:
            return cb({ ok: false, msg: "Unknown joker action" });
        }

        if (res.ok || res.error === "foul_death") {
          if (shouldBroadcast) {
            io.to(roomCode).emit("state:full", { snapshot: r.snapshot, from: "server", at: Date.now() });
            jokerScheduleActions(r, io);
          }
        }
        if (res.ok) {
          const payload = res.data ? { ok: true, data: res.data } : { ok: true };
          cb(payload);
        } else {
          cb({ ok: false, msg: res.error });
        }
        return;
      }

      // Legacy forwarding for other games or unknown intents
      const hostSessionId = r.hostSessionId;
      const roomSet = io.sockets.adapter.rooms.get(roomCode);
      if (roomSet) {
        for (const sid of roomSet) {
          const s = io.sockets.sockets.get(sid);
          if (s?.data?.sessionId === hostSessionId) {
            s.emit("intent", { action, data, from, room: roomCode });
          }
        }
      }
      cb({ ok: true });
    }
  );

  // 房主 -> 广播
  socket.on(
    "action",
    (
      payload: { room: string; action: string; data?: unknown; from: string },
      cb: (resp: { ok: boolean }) => void
    ) => {
      const { room, action, data, from } = payload || {};
      if (!room || !rooms.has(room)) return cb({ ok: false });
      io.to(room).emit("action", { action, payload: data, from, at: Date.now() });
      cb({ ok: true });
    }
  );

  // 请求最新快照 -> 广播查询时间戳
  socket.on(
    "state:request",
    (
      payload: { room: string; from: string },
      cb: (resp: { ok: boolean }) => void
    ) => {
      const { room: roomCode, from } = payload || {};
      const r = roomCode ? rooms.get(roomCode) : undefined;
      if (!r) return cb({ ok: false });

      // 如果已有同步正在进行，简单起见先覆盖（或者忽略）
      if (r.pendingSync) {
        clearTimeout(r.pendingSync.timer);
      }

      const timer = setTimeout(() => {
        finishSync(r);
      }, 1000); // 1秒收集窗口

      r.pendingSync = {
        requester: from ?? socket.data.sessionId ?? "",
        candidates: new Map(),
        timer,
      };

      io.to(roomCode).emit("state:query_timestamp", { room: roomCode });
      cb({ ok: true });
    }
  );

  // 汇报快照时间戳
  socket.on(
    "state:report_timestamp",
    (
      payload: { room: string; updatedAt: number },
      cb?: (resp: { ok: boolean }) => void
    ) => {
      const { room: roomCode, updatedAt } = payload || {};
      const r = roomCode ? rooms.get(roomCode) : undefined;
      if (!r || !r.pendingSync) return cb?.({ ok: false });

      const sessionId = socket.data.sessionId;
      if (sessionId && typeof updatedAt === "number") {
        r.pendingSync.candidates.set(sessionId, updatedAt);
      }

      // 检查是否所有活跃人类玩家都已上报
      let activeHumans = 0;
      for (const u of r.users.values()) {
        if (!u.isBot && !u.isDisconnected) {
          activeHumans++;
        }
      }

      // 只要收到的唯一上报数 >= 活跃人数，就可以提前结束
      if (r.pendingSync.candidates.size >= activeHumans) {
        clearTimeout(r.pendingSync.timer);
        finishSync(r);
      }

      cb?.({ ok: true });
    }
  );

  function finishSync(room: Room) {
    if (!room.pendingSync) return;
    const { requester, candidates } = room.pendingSync;
    room.pendingSync = undefined;

    let bestId: string | null = null;
    let maxTime = -1;

    // 不再检查服务器缓存，只使用客户端数据
    // if (room.snapshot?.updatedAt) {
    //   maxTime = room.snapshot.updatedAt;
    //   bestId = "SERVER";
    // }

    // 检查玩家汇报
    for (const [sid, time] of candidates) {
      if (time > maxTime) {
        maxTime = time;
        bestId = sid;
      }
    }

    if (!bestId) {
      // 无人有快照，通知请求者失败
      const roomSet = io.sockets.adapter.rooms.get(room.code);
      if (roomSet) {
        for (const sid of roomSet) {
          const s = io.sockets.sockets.get(sid);
          if (s?.data?.sessionId === requester) {
            s.emit("state:sync_failed", { room: room.code, reason: "no_candidates" });
            break;
          }
        }
      }
      return;
    }

    // 服务器不再保存快照，bestId 永远不会是 "SERVER"
    // if (bestId === "SERVER") {
    //   const roomSet = io.sockets.adapter.rooms.get(room.code);
    //   if (roomSet) {
    //     for (const sid of roomSet) {
    //       const s = io.sockets.sockets.get(sid);
    //       if (s?.data?.sessionId === requester) {
    //         s.emit("state:full", { snapshot: room.snapshot!, from: "server", at: Date.now() });
    //         break;
    //       }
    //     }
    //   }
    // } else {
    // 指定玩家发送
    // 如果最佳持有者就是请求者自己，说明请求者的数据是最新的 -> 让请求者广播给所有人
    const isRequesterSelf = bestId === requester;
    const target = isRequesterSelf ? undefined : requester;

    room.expectedSnapshotProvider = bestId;
    const roomSet = io.sockets.adapter.rooms.get(room.code);
    if (roomSet) {
      for (const sid of roomSet) {
        const s = io.sockets.sockets.get(sid);
        if (s?.data?.sessionId === bestId) {
          s.emit("state:provide_snapshot", { target, room: room.code });
          break;
        }
      }
    }
    // }
  }

  // 接收并保存快照（允许任何房间成员更新）
  socket.on(
    "state:full",
    (
      payload: { room: string; snapshot: Snapshot; from: string; target?: string },
      cb: (resp: { ok: boolean }) => void
    ) => {
      const { room, snapshot, from, target } = payload || {};
      const r = room ? rooms.get(room) : undefined;
      if (!r) return cb({ ok: false });

      // 验证发送者是否在房间内
      const senderSessionId = socket.data.sessionId;
      if (!senderSessionId || !r.users.has(senderSessionId)) {
        return cb({ ok: false });
      }

      // 清除 expectedSnapshotProvider（如果发送者是被指定的提供者）
      if (senderSessionId === r.expectedSnapshotProvider) {
        r.expectedSnapshotProvider = undefined;
      }

      // 服务器作为时间戳权威，强制更新 updatedAt
      const serverTime = Date.now();
      snapshot.updatedAt = serverTime;

      // 服务器保存权威快照（接受任何房间成员的更新）
      r.snapshot = snapshot;

      if (target) {
        for (const sid of io.sockets.adapter.rooms.get(room) || []) {
          const s = io.sockets.sockets.get(sid);
          if (s?.data?.sessionId === target) {
            s.emit("state:full", { snapshot, from, at: serverTime, target });
          }
        }
      } else {
        io.to(room).emit("state:full", { snapshot, from, at: serverTime });
      }
      cb({ ok: true });
    }
  );

  /** ===== 开始第一夜（房主） ===== */
  const startEvents = ["room:start", "flower:start", "flower:start_night", "flower:begin"] as const;

  function broadcastFlowerSnapshot(roomCode: string, fromSessionId: string, phase = "night", night = 1) {
    const snapshot = {
      engine: "flower",
      phase,
      night,
      startedAt: Date.now(),
      chatMessages: [],
    };
    io.to(roomCode).emit("state:full", { snapshot, from: fromSessionId, at: Date.now() });
  }

  for (const evt of startEvents) {
    socket.on(
      evt,
      (payload: { room: string; sessionId?: string }, cb: (resp: { ok: boolean; msg?: string }) => void) => {
        try {
          const roomCode = payload?.room;
          const room = roomCode ? rooms.get(roomCode) : undefined;
          if (!room) return cb({ ok: false, msg: "房间不存在" });

          // 仅房主可开始
          if (socket.data.sessionId !== room.hostSessionId) {
            return cb({ ok: false, msg: "只有房主可以开始" });
          }

          // 开始时重置 ready
          for (const [sid, u] of room.users.entries()) {
            room.users.set(sid, { ...u, ready: false });
          }
          io.to(roomCode).emit("presence:state", { roomCode, users: listUsers(room) });

          // 广播“花蝴蝶”快照（第一夜）
          broadcastFlowerSnapshot(roomCode, socket.data.sessionId!, "night", 1);

          cb({ ok: true });
        } catch {
          cb({ ok: false, msg: `${evt} 失败` });
        }
      }
    );
  }

  /** 关闭房间（仅房主） */
  socket.on(
    "room:close",
    (payload: { code: string }, cb: (resp: { ok: boolean }) => void) => {
      const { code } = payload || {};
      const room = code ? rooms.get(code) : undefined;
      if (!room) return cb({ ok: false });
      if (socket.data.sessionId !== room.hostSessionId) return cb({ ok: false });

      io.to(code).emit("room:closed", { code });
      io.socketsLeave(code);
      cancelRoomCleanup(code);
      rooms.delete(code);
      cb({ ok: true });
    }
  );

  /** 断开清理 */
  socket.on("disconnect", () => {
    const code: string | null = socket.data.roomCode;
    const sessionId: string | null = socket.data.sessionId;
    if (!code || !sessionId) return;

    const room = rooms.get(code);
    if (!room) return;

    const removed = markUserDisconnected(room, sessionId);
    if (!removed && !room.users.has(sessionId)) return;
    ensureHost(room);
    handleRoomPopulationChange(room);
    broadcastPresence(room);
  });

  socket.on(
    "room:keepalive",
    (
      payload: { roomCode?: string; sessionId?: string },
      cb?: (resp: { ok: boolean; msg?: string }) => void
    ) => {
      try {
        const { roomCode, sessionId } = payload || {};
        const room = roomCode ? rooms.get(roomCode) : undefined;
        if (!room) return cb?.({ ok: false, msg: "房间不存在" });
        if (!sessionId) return cb?.({ ok: false, msg: "缺少 sessionId" });
        if (sessionId !== room.hostSessionId && !room.users.has(sessionId)) {
          return cb?.({ ok: false, msg: "玩家不存在" });
        }
        room.lastKeepaliveAt = Date.now();
        if (room.users.size === 0) {
          scheduleRoomCleanup(room);
        } else {
          cancelRoomCleanup(room.code);
        }
        cb?.({ ok: true });
      } catch {
        cb?.({ ok: false, msg: "room:keepalive 失败" });
      }
    }
  );
});

/** ===== 启动 ===== */
const PORT = Number(process.env.PORT || 8787);
server.listen(PORT, () => {
  console.log(`Realtime server listening on ${PORT} `);
});
