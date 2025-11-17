import { io, Socket } from "socket.io-client";

type InitMessage = {
  type: "INIT";
  url: string;
  sessionId: string;
  roomCode?: string | null;
  keepaliveIntervalMs?: number;
};

type EmitMessage = {
  type: "EMIT";
  event: string;
  payload?: unknown;
  reqId?: string;
};

type RoomMessage = {
  type: "ROOM";
  roomCode: string | null;
};

type ControlMessage =
  | { type: "CONNECT" }
  | { type: "DISCONNECT" }
  | { type: "CLOSE" };

type WorkerInboundMessage = InitMessage | EmitMessage | RoomMessage | ControlMessage;

type EventOutboundMessage = {
  type: "EVENT";
  event: string;
  args: unknown[];
};

type AckOutboundMessage = { type: "ACK"; reqId: string; payload: unknown };
type AckErrorOutboundMessage = { type: "ACK_ERROR"; reqId: string; error: string };
type LogOutboundMessage = { type: "LOG"; level: "info" | "warn" | "error"; message: string };

type WorkerOutboundMessage = EventOutboundMessage | AckOutboundMessage | AckErrorOutboundMessage | LogOutboundMessage;

type WorkerState = {
  url: string | null;
  sessionId: string | null;
  roomCode: string | null;
  keepaliveIntervalMs: number;
};

const KEEPALIVE_DEFAULT_MS = 20_000;
const state: WorkerState = {
  url: null,
  sessionId: null,
  roomCode: null,
  keepaliveIntervalMs: KEEPALIVE_DEFAULT_MS,
};

let socket: Socket | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

function postMessageToMain(msg: WorkerOutboundMessage) {
  self.postMessage(msg);
}

function log(level: LogOutboundMessage["level"], message: string) {
  postMessageToMain({ type: "LOG", level, message });
}

function teardownSocket() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

function emitKeepalive() {
  if (!socket || socket.disconnected) return;
  if (!state.sessionId || !state.roomCode) return;
  socket.emit("room:keepalive", {
    roomCode: state.roomCode,
    sessionId: state.sessionId,
  });
}

function startKeepaliveLoop() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
  if (!state.keepaliveIntervalMs || state.keepaliveIntervalMs <= 0) return;
  if (!state.roomCode) return;
  keepaliveTimer = setInterval(() => {
    emitKeepalive();
  }, state.keepaliveIntervalMs);
}

function forwardEvent(event: string, ...args: unknown[]) {
  postMessageToMain({ type: "EVENT", event, args });
}

function bindSocketEvents(instance: Socket) {
  instance.on("connect", () => {
    emitKeepalive();
    startKeepaliveLoop();
    forwardEvent("connect");
  });
  instance.on("disconnect", (reason) => {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
    forwardEvent("disconnect", reason);
  });
  instance.on("connect_error", (err) => {
    forwardEvent("connect_error", { message: err.message });
  });
  instance.io.on("reconnect_attempt", (attempt) => {
    forwardEvent("reconnect_attempt", attempt);
  });
  instance.onAny((event, ...args) => {
    // 只转发业务事件，连接事件已单独处理，但重复转发也无妨
    forwardEvent(event, ...args);
  });
}

function ensureSocket() {
  if (!state.url) {
    log("warn", "[socket.worker] missing url");
    return null;
  }
  if (socket) return socket;
  const instance = io(state.url, {
    transports: ["websocket"],
    withCredentials: true,
  });
  socket = instance;
  bindSocketEvents(instance);
  return instance;
}

function handleEmit(msg: EmitMessage) {
  const instance = ensureSocket();
  if (!instance) {
    if (msg.reqId) {
      postMessageToMain({ type: "ACK_ERROR", reqId: msg.reqId, error: "Socket not initialized" });
    }
    return;
  }
  const payload = msg.payload ?? {};
  try {
    if (msg.reqId) {
      instance.emit(msg.event, payload, (resp: unknown) => {
        postMessageToMain({ type: "ACK", reqId: msg.reqId!, payload: resp });
      });
    } else {
      instance.emit(msg.event, payload);
    }
  } catch (err) {
    if (msg.reqId) {
      const error = err instanceof Error ? err.message : "Unknown worker emit error";
      postMessageToMain({ type: "ACK_ERROR", reqId: msg.reqId, error });
    } else {
      log("error", `[socket.worker] emit error: ${String(err)}`);
    }
  }
}

function updateRoom(roomCode: string | null) {
  state.roomCode = roomCode;
  if (roomCode) {
    emitKeepalive();
    startKeepaliveLoop();
  } else if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const data = event.data;
  if (!data) return;
  switch (data.type) {
    case "INIT":
      state.url = data.url;
      state.sessionId = data.sessionId;
      state.keepaliveIntervalMs = data.keepaliveIntervalMs ?? KEEPALIVE_DEFAULT_MS;
      updateRoom(data.roomCode ?? null);
      ensureSocket();
      return;
    case "EMIT":
      handleEmit(data);
      return;
    case "ROOM":
      updateRoom(data.roomCode);
      return;
    case "CONNECT":
      ensureSocket()?.connect();
      return;
    case "DISCONNECT":
      socket?.disconnect();
      return;
    case "CLOSE":
      teardownSocket();
      return;
    default:
      return;
  }
};

export {};

