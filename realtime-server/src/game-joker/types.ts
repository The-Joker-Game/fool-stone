// realtime-server/src/game-joker/types.ts

export type JokerRole = "duck" | "goose";

export type JokerPhase =
    | "lobby"
    | "role_reveal"
    | "green_light"
    | "yellow_light"
    | "red_light"
    | "meeting"
    | "voting"
    | "execution"
    | "game_over";

export type JokerLocation = "厨房" | "医务室" | "发电室" | "监控室" | "仓库";

export interface JokerPlayerState {
    seat: number;
    sessionId: string | null;
    name: string;
    role: JokerRole | null;
    isAlive: boolean;
    isReady: boolean;
    isHost: boolean;
    isBot?: boolean;
    isDisconnected?: boolean;

    // Location
    location: JokerLocation | null; // assigned location for current round
    targetLocation: JokerLocation | null; // desired location (green light selection)

    // Life code
    lifeCode: string; // 2-digit code (e.g., "42")
    lifeCodeVersion: number; // increments when code changes

    // Oxygen system
    oxygen: number; // seconds remaining (default 240)
    oxygenReceivedThisRound: boolean;
    duckEmergencyUsed: boolean; // duck one-time +120 on first death

    // Voting
    hasVoted: boolean;
    voteTarget: string | null; // sessionId of target, or "skip"
}

export interface JokerVoteEntry {
    voterSessionId: string;
    targetSessionId: string | null; // null = skip
    submittedAt: number;
}

export interface JokerMeetingState {
    reporterSessionId?: string;
    bodySessionId?: string; // who was found dead
    discussionEndAt?: number;
}

export interface JokerVotingState {
    votes: JokerVoteEntry[];
    tally: Record<string, number>; // sessionId -> vote count
    skipCount: number;
}

export interface JokerExecutionResult {
    executedSessionId: string | null;
    executedRole: JokerRole | null;
    reason: "vote" | "tie" | "skip" | null;
}

export interface JokerLifeCodeState {
    // Current round codes: sessionId -> code
    current: Record<string, string>;
    // Previous round codes (still valid for first 20s of red light)
    previous: Record<string, string>;
    // Version tracker
    version: number;
}

export interface JokerRoundState {
    roundCount: number;
    phaseStartAt: number;
    // Red light sub-phase: 0-20s = old codes, 20-40s = new codes
    redLightHalf: "first" | "second";
}

export interface JokerGameResult {
    winner: "duck" | "goose";
    reason: string;
}

export interface JokerLogEntry {
    at: number;
    text: string;
    type: "system" | "kill" | "oxygen" | "death" | "vote";
}

export interface JokerChatMessage {
    id: string;
    sessionId: string;
    senderSeat: number;
    senderName: string;
    content: string;
    timestamp: number;
}

export interface JokerSnapshot {
    engine: "joker";
    roomCode: string;
    hostSessionId: string | null;
    phase: JokerPhase;
    roundCount: number;
    players: JokerPlayerState[];

    // Dynamic locations for current round
    activeLocations: JokerLocation[];

    // Life code state
    lifeCodes: JokerLifeCodeState;

    // Phase-specific state
    round: JokerRoundState;
    meeting?: JokerMeetingState;
    voting?: JokerVotingState;
    execution?: JokerExecutionResult;

    // Game result
    gameResult?: JokerGameResult | null;

    // Logs and chat
    logs: JokerLogEntry[];
    chatMessages: JokerChatMessage[];

    // Task progress (0-100, goose wins at 100)
    taskProgress: number;

    // Timing
    deadline?: number;
    updatedAt: number;
}

// Action payloads
export interface SelectLocationPayload {
    seat: number;
    location: JokerLocation;
}

export interface SubmitLifeCodeActionPayload {
    actorSeat: number;
    code: string; // 2-digit code
    action: "kill" | "oxygen";
}

export interface SubmitVotePayload {
    voterSeat: number;
    targetSessionId: string | null; // null = skip
}

export interface ReportPayload {
    reporterSeat: number;
}

// Result types
export type ActionResult = { ok: boolean; error?: string; message?: string };
