/// <reference lib="webworker" />

import { io, Socket } from "socket.io-client";

type StartMessage = {
  type: "start";
  roomCode: string;
  sessionId: string;
  rtUrl: string;
  intervalMs?: number;
};

type StopMessage = { type: "stop" };
type PokeMessage = { type: "poke" };

type WorkerMessage = StartMessage | StopMessage | PokeMessage;
type WorkerEvent = { type: "tick"; at: number };

const DEFAULT_INTERVAL = 20_000;
type SocketMeta = { key: string };

let currentConfig: StartMessage | null = null;
let socket: Socket | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let activeKey: string | null = null;
const socketMeta = new WeakMap<Socket, SocketMeta>();

function cleanupSocket() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (socket) {
    socket.off("connect");
    socket.off("disconnect");
    socket.disconnect();
    socket = null;
  }
  activeKey = null;
}

function emitKeepalive() {
  if (!socket || !socket.connected || !currentConfig) return;
  socket.emit("room:keepalive", {
    roomCode: currentConfig.roomCode,
    sessionId: currentConfig.sessionId,
  });
  const payload: WorkerEvent = { type: "tick", at: Date.now() };
  self.postMessage(payload);
}

function startLoop() {
  if (!currentConfig) return;
  const interval = currentConfig.intervalMs ?? DEFAULT_INTERVAL;
  if (timer) {
    clearInterval(timer);
  }
  timer = setInterval(() => {
    emitKeepalive();
  }, interval);
}

function ensureSocket() {
  if (!currentConfig) return;
  const key = `${currentConfig.rtUrl}|${currentConfig.roomCode}|${currentConfig.sessionId}`;
  if (socket) {
    const meta = socketMeta.get(socket);
    if (meta?.key === key) {
      if (!timer) startLoop();
      emitKeepalive();
      return;
    }
  }
  cleanupSocket();
  activeKey = key;
  socket = io(currentConfig.rtUrl, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 5000,
  });
  socketMeta.set(socket, { key });
  socket.on("connect", () => {
    emitKeepalive();
    startLoop();
  });
  socket.on("disconnect", () => {
    if (!currentConfig) {
      cleanupSocket();
      return;
    }
    // 等待 socket.io 内部重连
  });
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const data = event.data;
  if (!data) return;
  if (data.type === "start") {
    currentConfig = data;
    ensureSocket();
    return;
  }
  if (data.type === "stop") {
    currentConfig = null;
    cleanupSocket();
    return;
  }
  if (data.type === "poke") {
    emitKeepalive();
  }
};

