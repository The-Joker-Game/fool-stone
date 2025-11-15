export type FlowerRole =
  | "花蝴蝶"
  | "狙击手"
  | "医生"
  | "警察"
  | "善民"
  | "杀手"
  | "魔法师"
  | "森林老人"
  | "恶民";

export type FlowerPhase =
  | "lobby"
  | "night_actions"
  | "night_result"
  | "day_discussion"
  | "day_vote"
  | "game_over";

export type FlowerOutcome = "heal" | "emptyNeedle" | "blocked" | "kill" | "cop_bad" | "cop_good" | "cop_unknown";

export interface FlowerNightAction {
  role: FlowerRole;
  actorSeat: number;
  targetSeat?: number | null;
  secondarySeat?: number | null;
  submittedAt: number;
  status: "pending" | "locked" | "resolved";
  outcome?: FlowerOutcome;
}

export interface FlowerVoteEntry {
  voterSeat: number;
  targetSeat: number;
  submittedAt: number;
  source: "day" | "dark";
  viaRole?: "善民" | "恶民";
}

export interface FlowerNightResult {
  deaths: Array<{ seat: number; reason: "sniper" | "killer" | "needles" | "vote" }>;
  mutedSeats: number[];
  butterflyLink?: { butterflySeat: number; targetSeat?: number | null };
  policeReports: Array<{ targetSeat: number; result: "bad_special" | "not_bad_special" | "unknown" }>;
  upgrades: Array<{ seat: number; fromRole: FlowerRole; toRole: "杀手" }>;
}

export interface FlowerDayState {
  speechOrder: number[];
  voteOrder: number[];
  votes: FlowerVoteEntry[];
  tally: Record<number, number>;
  pendingExecution?: { seat: number; isBadSpecial: boolean } | null;
}
export interface FlowerDayVoteResult {
  topSeats: number[];
  executedSeat: number | null;
  reason: "vote" | "tie" | null;
}

export interface FlowerNightState {
  submittedActions: FlowerNightAction[];
  lastActions?: FlowerNightAction[];
  result?: FlowerNightResult | null;
}

export interface FlowerPlayerState {
  seat: number;
  sessionId: string | null;
  name: string;
  role: FlowerRole | null;
  isAlive: boolean;
  isReady: boolean;
  isHost: boolean;
  isBot?: boolean;
  isMutedToday: boolean;
  hasVotedToday: boolean;
  voteTargetSeat?: number | null;
  darkVoteTargetSeat?: number | null;
  nightAction?: FlowerNightAction | null;
  needleCount: number;
  pendingNeedleDeath: boolean;
  flags?: {
    isBadSpecial?: boolean;
  };
}

export interface FlowerLogEntry {
  at: number;
  text: string;
}

export interface FlowerGameResult {
  winner: "good" | "bad" | "draw";
  reason: string;
}

export interface FlowerSnapshot {
  engine: "flower";
  roomCode: string;
  hostSessionId: string | null;
  phase: FlowerPhase;
  dayCount: number;
  players: FlowerPlayerState[];
  night: FlowerNightState;
  day: FlowerDayState;
  logs: FlowerLogEntry[];
  pendingAction?: { role: FlowerRole; seat: number } | null;
  gameResult?: FlowerGameResult | null;
  updatedAt: number;
}
