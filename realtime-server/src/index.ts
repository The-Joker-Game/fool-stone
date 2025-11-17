// realtime-server/src/index.ts
import express, { Request, Response } from "express";
import cors from "cors";
import http from "http";
import { Server, Socket } from "socket.io";
import type { Snapshot } from "./types.js";

/** ===== 简单内存房间状态 ===== */
type PresenceUser = {
  id: string;          // 服务器分配
  name: string;
  sessionId: string;   // 客户端持久化，用于断线重连
  seat: number;
  isHost?: boolean;
  ready?: boolean;     // 准备状态
  isBot?: boolean;
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
  snapshot: SnapshotWithPlayers | null;
};

const rooms = new Map<string, Room>();
const cleanupTimers = new Map<string, NodeJS.Timeout>();
const MAX_SEATS = 9;
const ROOM_EMPTY_GRACE_MS = Number(process.env.ROOM_EMPTY_GRACE_MS ?? 5 * 60 * 1000);

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

function handleRoomPopulationChange(room: Room) {
  if (room.users.size === 0) {
    room.lastKeepaliveAt = room.lastKeepaliveAt ?? Date.now();
    scheduleRoomCleanup(room);
  } else {
    cancelRoomCleanup(room.code);
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
  const occupied = new Set<number>();
  for (const u of r.users.values()) occupied.add(u.seat);

  // 尝试满足“期望座位”
  if (
    typeof preferred === "number" &&
    preferred >= 1 &&
    preferred <= MAX_SEATS &&
    !occupied.has(preferred)
  ) {
    return preferred;
  }
  // 否则找最小可用
  for (let i = 1; i <= MAX_SEATS; i++) {
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
  const currentAlive = current && !current.isBot && currentStillAlive(room, current.sessionId);
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
  const snapshotPlayers = room.snapshot?.players;
  if (!snapshotPlayers) return true;
  const p = snapshotPlayers.find(player => player.sessionId === sessionId);
  if (!p) return true;
  return p.isAlive;
}

function genBotSessionId() {
  return `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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
        const room: Room = {
          code,
          users: new Map(),
          hostSessionId: sessionId,
          createdAt: Date.now(),
          lastKeepaliveAt: Date.now(),
          snapshot: null,
        };

        const seat = nextAvailableSeat(room) ?? 1;
        const me: PresenceUser = {
          id: `U_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
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

        io.to(code).emit("presence:state", { roomCode: code, users: listUsers(room) });
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
        const seat = existed?.seat ?? nextAvailableSeat(room, preferredSeat ?? null);
        if (!seat) return cb({ ok: false, msg: "房间已满" });

        const me: PresenceUser = existed
          ? { ...existed, name, seat, isHost: sessionId === room.hostSessionId }
          : {
              id: `U_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
              name,
              sessionId,
              seat,
              isHost: sessionId === room.hostSessionId,
              ready: false,
            };
        room.users.set(sessionId, me);
        ensureHost(room);

        socket.join(code);
        socket.data.roomCode = code;
        socket.data.sessionId = sessionId;

        io.to(code).emit("presence:state", { roomCode: code, users: listUsers(room) });
        cb({ ok: true, users: listUsers(room), me });
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
        const seat = existed?.seat ?? nextAvailableSeat(room, preferredSeat ?? null);
        if (!seat) return cb({ ok: false, msg: "房间已满" });

        const base: PresenceUser = existed
          ? { ...existed, name: name?.trim() || existed.name, seat }
          : {
              id: `U_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
              name: name?.trim() || `玩家${seat}`,
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

        io.to(code).emit("presence:state", { roomCode: code, users: listUsers(room) });
        cb({ ok: true, users: listUsers(room), me });
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
        io.to(code).emit("presence:state", { roomCode: code, users: listUsers(room) });
        cb({ ok: true });
      } catch {
        cb({ ok: false, msg: "room:ready 失败" });
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
        io.to(code).emit("presence:state", { roomCode: code, users: listUsers(room) });

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
          id: `BOT_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
          name: name?.trim() || `机器人-${seat}`,
          sessionId: botSessionId,
          seat,
          isHost: false,
          ready: true,
          isBot: true,
        };
        room.users.set(botSessionId, bot);
        ensureHost(room);
        io.to(code).emit("presence:state", { roomCode: code, users: listUsers(room) });
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

        socket.leave(code);
        if (room.users.size === 0) {
          rooms.delete(code);
        } else {
          io.to(code).emit("presence:state", { roomCode: code, users: listUsers(room) });
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
  // 非房主 -> 房主
  socket.on(
    "intent",
    (
      payload: { room: string; action: string; data?: unknown; from: string },
      cb: (resp: { ok: boolean; msg?: string }) => void
    ) => {
      const { room, action, data, from } = payload || {};
      const r = room ? rooms.get(room) : undefined;
      if (!r) return cb({ ok: false, msg: "房间不存在" });

      const hostSessionId = r.hostSessionId;
      const roomSet = io.sockets.adapter.rooms.get(room);
      if (roomSet) {
        for (const sid of roomSet) {
          const s = io.sockets.sockets.get(sid);
          if (s?.data?.sessionId === hostSessionId) {
            s.emit("intent", { action, data, from, room });
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

  // 请求最新快照 -> 转给房主
  socket.on(
    "state:request",
    (
      payload: { room: string; from: string },
      cb: (resp: { ok: boolean }) => void
    ) => {
      const { room, from } = payload || {};
      const r = room ? rooms.get(room) : undefined;
      if (!r) return cb({ ok: false });

      const hostSessionId = r.hostSessionId;
      const roomSet = io.sockets.adapter.rooms.get(room);
      if (roomSet) {
        for (const sid of roomSet) {
          const s = io.sockets.sockets.get(sid);
          if (s?.data?.sessionId === hostSessionId) {
            s.emit("state:request", { room, from: from ?? socket.data.sessionId });
          }
        }
      }
      cb({ ok: true });
    }
  );

  // 房主广播快照
  socket.on(
    "state:full",
    (
      payload: { room: string; snapshot: Snapshot; from: string; target?: string },
      cb: (resp: { ok: boolean }) => void
    ) => {
      const { room, snapshot, from, target } = payload || {};
      const r = room ? rooms.get(room) : undefined;
      if (!r) return cb({ ok: false });
      if (socket.data.sessionId !== r.hostSessionId) return cb({ ok: false });

      r.snapshot = snapshot as SnapshotWithPlayers;

      if (target) {
        for (const sid of io.sockets.adapter.rooms.get(room) || []) {
          const s = io.sockets.sockets.get(sid);
          if (s?.data?.sessionId === target) {
            s.emit("state:full", { snapshot, from, at: Date.now(), target });
          }
        }
      } else {
        io.to(room).emit("state:full", { snapshot, from, at: Date.now() });
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

    room.users.delete(sessionId);

    ensureHost(room);
    handleRoomPopulationChange(room);
    io.to(code).emit("presence:state", { roomCode: code, users: listUsers(room) });
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
  console.log(`Realtime server listening on ${PORT}`);
});
