// src/realtime/socket.ts
import { io, Socket } from "socket.io-client";
import type { GameSnapshot } from "../types";

/** ===== 类型 ===== */
export type IntentMsg = { action: string; payload?: unknown; from: string; room: string };
export type PresenceUser = {
  id: string;
  name: string;
  sessionId: string;
  seat: number;
  isHost?: boolean;
  ready?: boolean; // ← 新增：准备状态
  isBot?: boolean;
};
export type PresenceState = { roomCode: string | null; users: PresenceUser[] };
export type StateSnapshotMsg = { snapshot: GameSnapshot; from: string; at?: number; target?: string };
export type StateRequestMsg = { room: string; from: string };

type CreateRoomAck = { ok: boolean; code?: string; users?: PresenceUser[]; me?: PresenceUser; msg?: string };
type JoinRoomAck   = { ok: boolean; users?: PresenceUser[]; me?: PresenceUser; msg?: string };
type IntentAck = { ok: boolean; msg?: string };

type RTState = { roomCode: string | null; isHost: boolean };

/** ===== 内部状态 ===== */
let socket: Socket | null = null;
const state: RTState = { roomCode: null, isHost: false };
let presenceState: PresenceState | null = null;

const intentSubs: Array<(msg: IntentMsg) => void> = [];
const presenceSubs: Array<(state: PresenceState | null) => void> = [];
const stateSubs: Array<(msg: StateSnapshotMsg) => void> = [];
const stateRequestSubs: Array<(msg: StateRequestMsg) => void> = [];
const actionSubs: Array<(msg: { action: string; payload?: any; from: string; at?: number }) => void> = [];
const kickSubs: Array<(code: string | null) => void> = [];

// 连接状态
let _connected = false;
const connSubs: Array<(ok: boolean) => void> = [];
function notifyConn(ok: boolean) {
  _connected = ok;
  for (const fn of connSubs) fn(ok);
}
export function onConnection(cb: (ok: boolean) => void) {
  connSubs.push(cb);
  cb(_connected);
  return () => {
    const i = connSubs.indexOf(cb);
    if (i >= 0) connSubs.splice(i, 1);
  };
}
export function isConnected() { return _connected; }

/** ===== 工具：实时服务器 URL 解析 ===== */
function resolveRtUrl() {
  const env = import.meta.env.VITE_RT_URL as string | undefined;
  if (env) return env; // e.g. ws://localhost:8787 或 wss://xxx
  // fallback：与前端同机，固定 8787 端口
  const isHttps = location.protocol === "https:";
  const proto = isHttps ? "wss:" : "ws:";
  const host = location.hostname; // 只取主机名，避免把 5173 也带上
  return `${proto}//${host}:8787`;
}

/** ===== 会话 ID（断线重连用） ===== */
export function getSessionId(): string {
  let sid = localStorage.getItem("sessionId");
  if (!sid) {
    const uuid =
      (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : undefined) ??
      `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    sid = uuid;
    localStorage.setItem("sessionId", sid);
  }
  return sid;
}

/** ===== 本地“座位”持久化（断线重连保座） ===== */
const SEAT_KEY = "flower:seat";
function saveMySeat(n: number | null) {
  if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 9) {
    localStorage.setItem(SEAT_KEY, String(n));
  }
}
function loadMySeat(): number | null {
  const raw = localStorage.getItem(SEAT_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n : null;
}

/** ===== 建立（或复用）Socket 连接 ===== */
function ensureSocket(): Socket {
  if (socket) return socket;

  const s: Socket = io(resolveRtUrl(), {
    transports: ["websocket"],
    withCredentials: true,
  });
  socket = s;

  // 连接状态
  s.on("connect", () => {
    console.log("[realtime] connected:", s.id);
    notifyConn(true);
  });
  s.on("disconnect", (reason) => {
    console.log("[realtime] disconnected:", reason);
    notifyConn(false);
  });
  s.on("connect_error", (err) => {
    console.error("[realtime] connect_error:", err.message);
    notifyConn(false);
  });
  s.io.on("reconnect_attempt", () => { notifyConn(false); });

  // 服务器只发给房主的意图
  s.on("intent", (msg: { action: string; data?: unknown; from: string; room: string }) => {
    for (const fn of intentSubs) fn({ action: msg.action, payload: msg.data, from: msg.from, room: msg.room });
  });

  // 完整快照
  s.on("state:full", (msg: { snapshot: GameSnapshot; from: string; at?: number; target?: string }) => {
    for (const fn of stateSubs) fn({ snapshot: msg.snapshot, from: msg.from, at: msg.at, target: msg.target });
  });

  // 主机请求你上传快照
  s.on("state:request", (msg: { room: string; from: string }) => {
    for (const fn of stateRequestSubs) fn({ room: msg.room, from: msg.from });
  });

  // 在场名单更新
  s.on("presence:state", (p: { roomCode: string; users: PresenceUser[] }) => {
    const me = p.users.find(u => u.sessionId === getSessionId());
    state.roomCode = p.roomCode ?? null;
    state.isHost = !!me?.isHost;

    if (me?.seat) saveMySeat(me.seat);

    localStorage.setItem("lastRoomCode", state.roomCode ?? "");
    localStorage.setItem("isHost", state.isHost ? "1" : "0");

    presenceState = {
      roomCode: p.roomCode ?? null,
      users: Array.isArray(p.users) ? [...p.users] : [],
    };
    const snapshot = presenceState
      ? { roomCode: presenceState.roomCode, users: [...presenceState.users] }
      : null;
    for (const fn of presenceSubs) fn(snapshot);
  });

  // 动作总线：房主广播 action，所有人接收
  s.on("action", (msg: { action: string; payload?: any; from: string; at?: number }) => {
    for (const fn of actionSubs) fn(msg);
  });

  s.on("room:kicked", (msg: { code: string }) => {
    state.roomCode = null;
    state.isHost = false;
    presenceState = null;
    localStorage.removeItem("lastRoomCode");
    for (const fn of kickSubs) fn(msg?.code ?? null);
  });

  return s;
}

/** ===== 通用 ACK 发送 ===== */
export function emitAck<T = unknown, R = unknown>(
  event: string,
  data?: T,
  timeoutMs = 3500
): Promise<R> {
  return new Promise((resolve, reject) => {
    const s = ensureSocket();
    const to = setTimeout(() => reject(new Error("Ack timeout")), timeoutMs);
    const payload = (data ?? {}) as T;
    s.emit(event, payload, (resp: R) => {
      clearTimeout(to);
      resolve(resp);
    });
  });
}

/** ===== 业务封装（intent / state / presence / action） ===== */

// 非房主把意图发给房主
function sendIntent(action: string, payload?: unknown) {
  if (!state.roomCode) return;
  return emitAck("intent", {
    room: state.roomCode!,
    action,
    data: payload,
    from: getSessionId(),
  }) as Promise<IntentAck>;
}

function subscribeIntent(handler: (msg: IntentMsg) => void) {
  intentSubs.push(handler);
  return () => {
    const i = intentSubs.indexOf(handler);
    if (i >= 0) intentSubs.splice(i, 1);
  };
}

function subscribeState(handler: (msg: StateSnapshotMsg) => void) {
  stateSubs.push(handler);
  return () => {
    const i = stateSubs.indexOf(handler);
    if (i >= 0) stateSubs.splice(i, 1);
  };
}

function subscribeStateRequest(handler: (msg: StateRequestMsg) => void) {
  stateRequestSubs.push(handler);
  return () => {
    const i = stateRequestSubs.indexOf(handler);
    if (i >= 0) stateRequestSubs.splice(i, 1);
  };
}

function subscribePresence(handler: (state: PresenceState | null) => void) {
  presenceSubs.push(handler);
  return () => {
    const i = presenceSubs.indexOf(handler);
    if (i >= 0) presenceSubs.splice(i, 1);
  };
}

function subscribeAction(handler: (msg: { action: string; payload?: any; from: string; at?: number }) => void) {
  actionSubs.push(handler);
  return () => {
    const i = actionSubs.indexOf(handler);
    if (i >= 0) actionSubs.splice(i, 1);
  };
}

function subscribeKicked(handler: (code: string | null) => void) {
  kickSubs.push(handler);
  return () => {
    const i = kickSubs.indexOf(handler);
    if (i >= 0) kickSubs.splice(i, 1);
  };
}

function getPresence(): PresenceState | null {
  if (!presenceState) return null;
  return { roomCode: presenceState.roomCode, users: [...presenceState.users] };
}

function getRoom() { return state.roomCode as string | null; }
function getIsHost() { return state.isHost; }

function sendState(snapshot: GameSnapshot, targetSessionId?: string) {
  if (!state.roomCode) return;
  return emitAck("state:full", {
    room: state.roomCode!,
    snapshot,
    from: getSessionId(),
    target: targetSessionId,
  });
}

function requestState() {
  if (!state.roomCode) return;
  return emitAck("state:request", {
    room: state.roomCode!,
    from: getSessionId(),
  });
}

function sendAction(action: string, payload?: unknown) {
  if (!state.roomCode) return;
  return emitAck("action", {
    room: state.roomCode!,
    action,
    data: payload,
    from: getSessionId(),
  });
}

function kickPlayer(code: string, targetSessionId: string) {
  return emitAck("room:kick", {
    code,
    sessionId: getSessionId(),
    targetSessionId,
  });
}

function addBotToRoom(code: string, name?: string) {
  return emitAck("room:add_bot", {
    code,
    sessionId: getSessionId(),
    name,
  });
}

/** ===== Flower 便捷：创建 / 加入 / 准备 ===== */
async function createFlowerRoom(name: string): Promise<CreateRoomAck> {
  const ack = await emitAck<{ name: string; sessionId: string }, CreateRoomAck>("room:create", {
    name,
    sessionId: getSessionId(),
  });
  if (ack?.ok && ack.me?.seat) saveMySeat(ack.me.seat);
  return ack;
}

async function joinFlowerRoom(code: string, name: string): Promise<JoinRoomAck> {
  const ack = await emitAck<
    { code: string; name: string; sessionId: string; preferredSeat?: number | null },
    JoinRoomAck
  >("room:join", {
    code,
    name,
    sessionId: getSessionId(),
    preferredSeat: loadMySeat(),
  });
  if (ack?.ok && ack.me?.seat) saveMySeat(ack.me.seat);
  return ack;
}

/** 新增：切换准备状态（对接后端 room:ready） */
async function setReady(code: string, ready: boolean) {
  return emitAck("room:ready", {
    code,
    sessionId: getSessionId(),
    ready,
  });
}

/** ===== 导出 API ===== */
export const rt = {
  // 连接
  getSocket: ensureSocket,
  onConnection,
  isConnected,

  // 发送/订阅
  emitAck,
  sendIntent,
  subscribeIntent,
  subscribeState,
  subscribeStateRequest,
  subscribePresence,
  subscribeAction,
  subscribeKicked,
  sendState,
  requestState,
  sendAction,
  kickPlayer,

  // 房态
  getPresence,
  getRoom,
  isHost: getIsHost,

  // Flower 便捷
  createFlowerRoom,
  joinFlowerRoom,
  setReady,
  addBotToRoom,
};

export default rt;
