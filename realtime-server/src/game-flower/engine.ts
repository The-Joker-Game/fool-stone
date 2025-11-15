// realtime-server/src/game-flower/engine.ts
import type {
  FlowerSnapshot,
  FlowerPlayerState,
  FlowerNightState,
  FlowerDayState,
} from "./types.js";

interface InitPlayer {
  name: string;
  seat: number;
  sessionId: string | null;
}

const MAX_SEATS = 9;

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

function emptyNightState(): FlowerNightState {
  return { submittedActions: [], lastActions: [], result: null };
}

function emptyDayState(): FlowerDayState {
  return { speechOrder: [], voteOrder: [], votes: [], tally: {}, pendingExecution: null };
}

export function initFlowerRoom(roomCode: string, players: InitPlayer[]): FlowerSnapshot {
  const playerStates: FlowerPlayerState[] = Array.from({ length: MAX_SEATS }, (_, idx) =>
    createEmptyPlayer(idx + 1)
  );

  players.forEach((p) => {
    const seatIdx = p.seat - 1;
    if (seatIdx >= 0 && seatIdx < playerStates.length) {
      const ps = playerStates[seatIdx];
      ps.name = p.name;
      ps.sessionId = p.sessionId;
      ps.isAlive = true;
    }
  });

  const now = Date.now();
  return {
    engine: "flower",
    roomCode,
    hostSessionId: null,
    phase: "lobby",
    dayCount: 0,
    players: playerStates,
    night: emptyNightState(),
    day: emptyDayState(),
    logs: [{ at: now, text: "花蝴蝶房间创建，等待开始" }],
    pendingAction: null,
    gameResult: null,
    updatedAt: now,
  };
}

export function startFlowerGame(state: FlowerSnapshot): FlowerSnapshot {
  const now = Date.now();
  return {
    ...state,
    dayCount: 1,
    phase: "night_actions",
    logs: [...state.logs, { at: now, text: "🌙 游戏开始，进入第一夜行动阶段" }],
    updatedAt: now,
  };
}

export function flowerPlayerReady(state: FlowerSnapshot, seat: number): FlowerSnapshot {
  const now = Date.now();
  return {
    ...state,
    logs: [...state.logs, { at: now, text: `✅ 座位 ${seat} 点击了准备` }],
    updatedAt: now,
  };
}
