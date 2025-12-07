import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { PresenceState, PresenceUser } from "../realtime/socket";
import type {
  FlowerSnapshot,
  FlowerPlayerState,
  FlowerNightState,
  FlowerDayState,
  ChatMessage,
  ChatMention,
  SubmitNightActionPayload,
  SubmitDayVotePayload,
  AssignResult,
  SubmitResult,
  ResolveResult,
} from "./types";
import { rt, getSessionId } from "../realtime/socket";

const MAX_SEATS = 9;
const SNAPSHOT_KEY_PREFIX = "flower:snapshot:";

type FlowerSnapshotInput = Partial<FlowerSnapshot> & { engine: "flower";[key: string]: unknown };

export interface FlowerStore {
  snapshot: FlowerSnapshot | null;
  lastError: string | null;
  setSnapshot: (snapshot: FlowerSnapshotInput | null) => void;
  ensureSnapshotFromPresence: (presence: PresenceState | null) => void;
  clearError: () => void;
  assignRoles: () => Promise<AssignResult>;
  resolveNight: () => Promise<ResolveResult>;
  resolveDayVote: () => Promise<ResolveResult>;
  submitNightAction: (payload: SubmitNightActionPayload) => Promise<SubmitResult>;
  submitDayVote: (payload: SubmitDayVotePayload) => Promise<SubmitResult>;
  broadcastSnapshot: (targetSessionId?: string) => Promise<void>;
  addChatMessage: (content: string, mentions: ChatMention[]) => Promise<{ ok: boolean; error?: string }>;

  passTurn: () => Promise<void>;
  forcePassTurn: () => Promise<void>;
  confirmSpeaking: () => Promise<void>;
  resetGame: () => Promise<void>;
}

export const useFlowerStore = create<FlowerStore>()(
  immer((set, get) => ({
    snapshot: null,
    lastError: null,
    setSnapshot: (incoming) =>
      set((state) => {
        if (!incoming) {
          if (state.snapshot?.roomCode) removeSnapshotCache(state.snapshot.roomCode);
          state.snapshot = null;
          return;
        }

        if (!state.snapshot || (incoming.roomCode && incoming.roomCode !== state.snapshot.roomCode)) {
          const roomCode = incoming.roomCode || state.snapshot?.roomCode || "";
          const hostSessionId = typeof incoming.hostSessionId === "string" ? incoming.hostSessionId : state.snapshot?.hostSessionId ?? null;
          state.snapshot = loadSnapshotFromCache(roomCode) ?? createEmptySnapshot(roomCode, hostSessionId);
        }

        if (!state.snapshot) return;

        normalizeSnapshot(state.snapshot);

        mergeIncomingSnapshot(state.snapshot, incoming);
        saveSnapshotToCache(state.snapshot);
      }),
    ensureSnapshotFromPresence: (presence) =>
      set((state) => {
        if (!presence?.roomCode) {
          if (state.snapshot?.roomCode) removeSnapshotCache(state.snapshot.roomCode);
          state.snapshot = null;
          return;
        }

        const isNewSnapshot = !state.snapshot || state.snapshot.roomCode !== presence.roomCode;

        if (isNewSnapshot) {
          const hostSessionId = getHostSessionId(presence);
          state.snapshot = loadSnapshotFromCache(presence.roomCode) ?? createEmptySnapshot(presence.roomCode, hostSessionId);
        }

        if (!state.snapshot) return;

        normalizeSnapshot(state.snapshot);
        syncSnapshotWithPresence(state.snapshot, presence);
        saveSnapshotToCache(state.snapshot);
      }),
    clearError: () => set((state) => { state.lastError = null; }),
    assignRoles: async () => {
      try {
        const ack = await rt.sendIntent("flower:assign_roles", {});
        return ack?.ok ? { ok: true } : { ok: false, error: ack?.msg || "分配失败" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
    resolveNight: async () => {
      try {
        const ack = await rt.sendIntent("flower:resolve_night", {});
        return ack?.ok ? { ok: true } : { ok: false, error: ack?.msg || "结算失败" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
    resolveDayVote: async () => {
      try {
        const ack = await rt.sendIntent("flower:resolve_day_vote", {});
        return ack?.ok ? { ok: true } : { ok: false, error: ack?.msg || "结算失败" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
    submitNightAction: async (payload: SubmitNightActionPayload) => {
      try {
        const ack = await rt.sendIntent("flower:submit_night_action", payload);
        return ack?.ok ? { ok: true } : { ok: false, error: ack?.msg || "提交失败" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
    submitDayVote: async (payload: SubmitDayVotePayload) => {
      try {
        const ack = await rt.sendIntent("flower:submit_day_vote", payload);
        return ack?.ok ? { ok: true } : { ok: false, error: ack?.msg || "提交失败" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
    broadcastSnapshot: async () => {
      // Server handles broadcasting now.
      // This is kept for interface compatibility if needed, or can be removed.
      return;
    },
    addChatMessage: async (content: string, mentions: ChatMention[]) => {
      const currentSnapshot = get().snapshot;
      if (!currentSnapshot) return { ok: false, error: "没有可用快照" };

      const sessionId = getSessionId();
      const myPlayer = currentSnapshot.players.find(p => p.sessionId === sessionId);
      if (!myPlayer) return { ok: false, error: "未找到玩家信息" };

      const message: ChatMessage = {
        id: `${Date.now()}_${sessionId}_${Math.random().toString(36).slice(2)}`,
        sessionId,
        senderSeat: myPlayer.seat,
        senderName: myPlayer.name,
        content,
        mentions,
        timestamp: Date.now(),
      };

      // Optimistic update
      set((state) => {
        if (!state.snapshot) return;
        if (!state.snapshot.chatMessages) state.snapshot.chatMessages = [];
        state.snapshot.chatMessages.push(message);
        state.snapshot.updatedAt = Date.now();
        saveSnapshotToCache(state.snapshot);
      });

      try {
        await rt.sendIntent("flower:chat_message", message);
        return { ok: true };
      } catch (err) {
        return { ok: true };
      }
    },

    passTurn: async () => {
      try {
        await rt.sendIntent("flower:pass_turn", {});
      } catch (err) {
        console.error("pass turn failed", err);
      }
    },
    forcePassTurn: async () => {
      try {
        await rt.sendIntent("flower:force_pass_turn", {});
      } catch (err) {
        console.error("force pass turn failed", err);
      }
    },
    confirmSpeaking: async () => {
      try {
        await rt.sendIntent("flower:speaker_status", { status: "typing" });
      } catch (err) {
        console.error("confirm speaking failed", err);
      }
    },
    resetGame: async () => {
      try {
        await rt.sendIntent("flower:reset_game", {});
      } catch (err) {
        console.error("reset game failed", err);
      }
    },
  }))
);

function getHostSessionId(presence: PresenceState | null): string | null {
  if (!presence) return null;
  const host = presence.users.find((u) => u.isHost);
  return host?.sessionId ?? null;
}

function createEmptyNightState(): FlowerNightState {
  return { submittedActions: [], lastActions: [], result: null };
}

function createEmptyDayState(): FlowerDayState {
  return {
    speechOrder: [],
    currentSpeakerIndex: 0,
    voteOrder: [],
    votes: [],
    tally: {},
    pendingExecution: null,
    speakerStatus: null,
  };
}

function normalizeSnapshot(snapshot: FlowerSnapshot) {
  if (!snapshot.night) snapshot.night = createEmptyNightState();
  if (!Array.isArray(snapshot.night.submittedActions)) snapshot.night.submittedActions = [];
  if (!Array.isArray(snapshot.night.lastActions)) snapshot.night.lastActions = [];
  if (!snapshot.day) snapshot.day = createEmptyDayState();
  if (!Array.isArray(snapshot.day.votes)) snapshot.day.votes = [];
  if (!snapshot.day.tally) snapshot.day.tally = {};
  if (typeof snapshot.day.speakerStatus === "undefined") snapshot.day.speakerStatus = null;
  // 确保 chatMessages 字段存在
  if (!Array.isArray(snapshot.chatMessages)) snapshot.chatMessages = [];
  if (!Array.isArray(snapshot.history)) snapshot.history = [];
}

function createEmptyPlayer(seat: number): FlowerPlayerState {
  return {
    seat,
    sessionId: null,
    name: `座位${seat}`,
    role: null,
    originalRole: null,
    isAlive: false,
    isReady: false,
    isHost: false,
    isBot: false,
    isMutedToday: false,
    hasVotedToday: false,
    voteTargetSeat: null,
    darkVoteTargetSeat: null,
    nightAction: null,
    needleCount: 0,
    totalNeedleCount: 0,
    pendingNeedleDeath: false,
    flags: {},
  };
}

function createEmptySnapshot(roomCode: string, hostSessionId: string | null): FlowerSnapshot {
  const now = Date.now();
  return {
    engine: "flower",
    roomCode: roomCode || "unknown",
    hostSessionId,
    phase: "lobby",
    dayCount: 0,
    players: Array.from({ length: MAX_SEATS }, (_, idx) => createEmptyPlayer(idx + 1)),
    night: createEmptyNightState(),
    day: createEmptyDayState(),
    logs: [{ at: now, text: "花蝴蝶房间已创建，等待开始" }],
    pendingAction: null,
    gameResult: null,
    updatedAt: now,
    // 初始化聊天消息数组
    chatMessages: [],
    history: [],
  };
}

function syncSnapshotWithPresence(snapshot: FlowerSnapshot, presence: PresenceState) {
  const usersBySeat = new Map<number, PresenceUser>();
  presence.users.forEach((u) => usersBySeat.set(u.seat, u));

  snapshot.hostSessionId = getHostSessionId(presence);

  for (let seat = 1; seat <= MAX_SEATS; seat++) {
    const player = ensurePlayerEntry(snapshot, seat);
    const user = usersBySeat.get(seat);

    if (user) {
      player.sessionId = user.sessionId;
      player.name = user.name || `座位${seat}`;
      player.isHost = !!user.isHost;
      player.isReady = !!user.ready;
      player.isBot = !!(user as any).isBot;
      if (snapshot.phase === "lobby") {
        player.isAlive = true;
        player.isMutedToday = false;
        player.hasVotedToday = false;
        player.voteTargetSeat = null;
        player.darkVoteTargetSeat = null;
        player.nightAction = null;
        player.needleCount = 0;
        player.totalNeedleCount = 0;
        player.pendingNeedleDeath = false;
        player.role = null;
      }
    } else if (snapshot.phase === "lobby") {
      const empty = createEmptyPlayer(seat);
      Object.assign(player, empty);
    } else {
      player.sessionId = null;
      player.isHost = false;
      player.isReady = false;
      player.isBot = false;
    }
  }
}

function ensurePlayerEntry(snapshot: FlowerSnapshot, seat: number): FlowerPlayerState {
  let player = snapshot.players.find((p) => p.seat === seat);
  if (!player) {
    player = createEmptyPlayer(seat);
    snapshot.players.push(player);
  }
  return player;
}

function mergeIncomingSnapshot(target: FlowerSnapshot, incoming: FlowerSnapshotInput) {
  if (incoming.roomCode) target.roomCode = incoming.roomCode;
  if (typeof incoming.hostSessionId !== "undefined") {
    target.hostSessionId = (incoming.hostSessionId as string | null) ?? target.hostSessionId ?? null;
  }
  if (typeof incoming.phase === "string") {
    target.phase = incoming.phase as FlowerSnapshot["phase"];
  }
  if (typeof incoming.dayCount === "number") {
    target.dayCount = incoming.dayCount;
  } else if (typeof (incoming as any).night === "number") {
    target.dayCount = (incoming as any).night;
  }
  if (Array.isArray(incoming.players)) {
    target.players = incoming.players as FlowerPlayerState[];
  }
  if (incoming.night && typeof incoming.night === "object") {
    target.night = { ...(target.night ?? createEmptyNightState()), ...incoming.night };
  }
  if (incoming.day && typeof incoming.day === "object") {
    target.day = { ...(target.day ?? createEmptyDayState()), ...incoming.day };
  }
  if (Array.isArray(incoming.logs)) {
    target.logs = incoming.logs as FlowerSnapshot["logs"];
  }
  if (Array.isArray(incoming.chatMessages)) {
    // 合并聊天消息，避免重复并保持顺序
    const existingMessages = target.chatMessages || [];
    const newMessages = incoming.chatMessages as ChatMessage[];

    // 创建一个映射来跟踪已存在的消息ID
    const existingIds = new Set(existingMessages.map(msg => msg.id));

    // 只添加新的消息
    const messagesToAdd = newMessages.filter(msg => !existingIds.has(msg.id));

    // 合并消息并按时间排序
    target.chatMessages = [...existingMessages, ...messagesToAdd].sort((a, b) => a.timestamp - b.timestamp);
  }
  if (Array.isArray(incoming.history)) {
    target.history = incoming.history as FlowerSnapshot["history"];
  }
  if ("pendingAction" in incoming) {
    target.pendingAction = (incoming.pendingAction as FlowerSnapshot["pendingAction"]) ?? null;
  }
  if ("gameResult" in incoming) {
    target.gameResult = (incoming.gameResult as FlowerSnapshot["gameResult"]) ?? null;
  }
  if ("deadline" in incoming) {
    target.deadline = incoming.deadline;
  }
  target.updatedAt = typeof incoming.updatedAt === "number" ? incoming.updatedAt : Date.now();
  saveSnapshotToCache(target);
}

function snapshotCacheKey(roomCode: string) {
  return `${SNAPSHOT_KEY_PREFIX}${roomCode}`;
}

function saveSnapshotToCache(snapshot: FlowerSnapshot | null) {
  if (!snapshot?.roomCode) return;
  try {
    localStorage.setItem(snapshotCacheKey(snapshot.roomCode), JSON.stringify(snapshot));
  } catch (err) {
    console.warn("save snapshot cache failed", err);
  }
}

function loadSnapshotFromCache(roomCode: string): FlowerSnapshot | null {
  if (!roomCode) return null;
  try {
    const raw = localStorage.getItem(snapshotCacheKey(roomCode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FlowerSnapshot | null;
    return parsed ?? null;
  } catch {
    return null;
  }
}

function removeSnapshotCache(roomCode: string) {
  if (!roomCode) return;
  try {
    localStorage.removeItem(snapshotCacheKey(roomCode));
  } catch {
    // ignore
  }
}
