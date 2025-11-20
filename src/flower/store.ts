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
} from "./types";
import {
  assignFlowerRoles,
  submitNightAction as engineSubmitNightAction,
  resolveNight as engineResolveNight,
  submitDayVote as engineSubmitDayVote,
  resolveDayVote as engineResolveDayVote,
  type AssignResult,
  type SubmitResult,
  type ResolveResult,
  type SubmitNightActionPayload,
  type SubmitDayVotePayload,
} from "./engine";
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
  hostAssignRoles: () => AssignResult;
  hostSubmitNightAction: (payload: SubmitNightActionPayload) => SubmitResult;
  hostResolveNight: () => ResolveResult;
  submitNightAction: (payload: SubmitNightActionPayload) => Promise<SubmitResult>;
  hostSubmitDayVote: (payload: SubmitDayVotePayload) => SubmitResult;
  hostResolveDayVote: () => ResolveResult;
  submitDayVote: (payload: SubmitDayVotePayload) => Promise<SubmitResult>;
  broadcastSnapshot: (targetSessionId?: string) => Promise<void>;
  addChatMessage: (content: string, mentions: ChatMention[]) => Promise<{ ok: boolean; error?: string }>;
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

        if (!state.snapshot || state.snapshot.roomCode !== presence.roomCode) {
          const hostSessionId = getHostSessionId(presence);
          state.snapshot = loadSnapshotFromCache(presence.roomCode) ?? createEmptySnapshot(presence.roomCode, hostSessionId);
        }

        if (!state.snapshot) return;

        normalizeSnapshot(state.snapshot);
        syncSnapshotWithPresence(state.snapshot, presence);
        state.snapshot.updatedAt = Date.now();
        saveSnapshotToCache(state.snapshot);
      }),
    clearError: () => set((state) => { state.lastError = null; }),
    hostAssignRoles: () => {
      let result: AssignResult = { ok: false, error: "尚未进入房间" };
      set((state) => {
        if (!state.snapshot) {
          result = { ok: false, error: "没有可用快照" };
          state.lastError = result.error ?? null;
          return;
        }
        const res = assignFlowerRoles(state.snapshot);
        result = res;
        state.lastError = res.ok ? null : res.error ?? null;
      });
      return result;
    },
    hostSubmitNightAction: (payload: SubmitNightActionPayload) => {
      let result: SubmitResult = { ok: false, error: "没有可用快照" };
      set((state) => {
        if (!state.snapshot) {
          result = { ok: false, error: "没有可用快照" };
          state.lastError = result.error ?? null;
          return;
        }
        const res = engineSubmitNightAction(state.snapshot, payload);
        result = res;
        state.lastError = res.ok ? null : res.error ?? null;
      });
      return result;
    },
    hostResolveNight: () => {
      let result: ResolveResult = { ok: false, error: "没有可用快照" };
      set((state) => {
        if (!state.snapshot) {
          result = { ok: false, error: "没有可用快照" };
          state.lastError = result.error ?? null;
          return;
        }
        const res = engineResolveNight(state.snapshot);
        result = res;
        state.lastError = res.ok ? null : res.error ?? null;
      });
      return result;
    },
    submitNightAction: async (payload: SubmitNightActionPayload) => {
      const currentSnapshot = get().snapshot;
      if (!currentSnapshot) return { ok: false, error: "没有可用快照" };
      const isHost = currentSnapshot.hostSessionId === getSessionId();
      if (isHost) {
        const res = get().hostSubmitNightAction(payload);
        if (res.ok) {
          await get().broadcastSnapshot();
        }
        return res;
      }
      try {
        const ack = await rt.sendIntent("flower:submit_night_action", payload);
        return ack?.ok ? { ok: true } : { ok: false, error: ack?.msg || "提交失败" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
    hostSubmitDayVote: (payload: SubmitDayVotePayload) => {
      let result: SubmitResult = { ok: false, error: "没有可用快照" };
      set((state) => {
        if (!state.snapshot) {
          result = { ok: false, error: "没有可用快照" };
          state.lastError = result.error ?? null;
          return;
        }
        const res = engineSubmitDayVote(state.snapshot, payload);
        result = res;
        state.lastError = res.ok ? null : res.error ?? null;
      });
      return result;
    },
    hostResolveDayVote: () => {
      let result: ResolveResult = { ok: false, error: "没有可用快照" };
      set((state) => {
        if (!state.snapshot) {
          result = { ok: false, error: "没有可用快照" };
          state.lastError = result.error ?? null;
          return;
        }
        const res = engineResolveDayVote(state.snapshot);
        result = res;
        state.lastError = res.ok ? null : res.error ?? null;
      });
      return result;
    },
    submitDayVote: async (payload: SubmitDayVotePayload) => {
      const currentSnapshot = get().snapshot;
      if (!currentSnapshot) return { ok: false, error: "没有可用快照" };
      const isHost = currentSnapshot.hostSessionId === getSessionId();
      if (isHost) {
        const res = get().hostSubmitDayVote(payload);
        if (res.ok) {
          await get().broadcastSnapshot();
        }
        return res;
      }
      try {
        const ack = await rt.sendIntent("flower:submit_day_vote", payload);
        return ack?.ok ? { ok: true } : { ok: false, error: ack?.msg || "提交失败" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
    broadcastSnapshot: async (targetSessionId?: string) => {
      const snapshot = get().snapshot;
      const roomCode = snapshot?.roomCode ?? rt.getRoom();
      const isHost = snapshot?.hostSessionId === getSessionId();
      if (!snapshot || !roomCode || !isHost) return;
      try {
        await rt.sendState(snapshot as any, targetSessionId);
      } catch (err) {
        console.error("broadcast snapshot failed", err);
      }
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

      // Add to local snapshot
      set((state) => {
        if (!state.snapshot) return;
        if (!state.snapshot.chatMessages) state.snapshot.chatMessages = [];
        state.snapshot.chatMessages.push(message);
        state.snapshot.updatedAt = Date.now();
        saveSnapshotToCache(state.snapshot);
      });

      // Broadcast via intent
      try {
        await rt.sendIntent("flower:chat_message", message);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
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
  return { speechOrder: [], voteOrder: [], votes: [], tally: {}, pendingExecution: null };
}

function normalizeSnapshot(snapshot: FlowerSnapshot) {
  if (!snapshot.night) snapshot.night = createEmptyNightState();
  if (!Array.isArray(snapshot.night.submittedActions)) snapshot.night.submittedActions = [];
  if (!Array.isArray(snapshot.night.lastActions)) snapshot.night.lastActions = [];
  if (!snapshot.day) snapshot.day = createEmptyDayState();
  if (!Array.isArray(snapshot.day.votes)) snapshot.day.votes = [];
  if (!snapshot.day.tally) snapshot.day.tally = {};
}

function createEmptyPlayer(seat: number): FlowerPlayerState {
  return {
    seat,
    sessionId: null,
    name: `座位${seat}`,
    role: null,
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
  if ("pendingAction" in incoming) {
    target.pendingAction = (incoming.pendingAction as FlowerSnapshot["pendingAction"]) ?? null;
  }
  if ("gameResult" in incoming) {
    target.gameResult = (incoming.gameResult as FlowerSnapshot["gameResult"]) ?? null;
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
