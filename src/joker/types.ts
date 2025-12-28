// src/joker/types.ts

export type JokerRole = "duck" | "goose" | "dodo" | "hawk";

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

// Death tracking
export type JokerDeathReason =
    | "kill"           // 被杀
    | "foul"           // 犯规死亡
    | "oxygen"         // 氧气耗尽
    | "vote";          // 投票淘汰

export interface JokerDeathRecord {
    sessionId: string;
    seat: number;
    name: string;
    role: JokerRole;
    reason: JokerDeathReason;
    killerSessionId?: string;
    killerSeat?: number;
    killerLocation?: JokerLocation;
    location?: JokerLocation;
    round: number;
    at: number;
    revealed: boolean;
    revealedAt?: number;
}

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

    location: JokerLocation | null;
    targetLocation: JokerLocation | null;

    lifeCode: string;
    lifeCodeVersion: number;

    oxygen: number;
    oxygenUpdatedAt: number;
    duckEmergencyUsed: boolean;
    hawkEmergencyUsed: boolean;
    oxygenLeakActive: boolean;
    oxygenLeakStartedAt?: number;
    oxygenLeakResolvedAt?: number;
    oxygenLeakRound?: number;

    hasVoted: boolean;
    voteTarget: string | null;
}

export interface JokerVoteEntry {
    voterSessionId: string;
    targetSessionId: string | null;
    submittedAt: number;
}

export interface JokerMeetingState {
    reporterSessionId?: string;
    bodySessionId?: string;
    discussionEndAt?: number;
    triggerType?: "player" | "system";
    triggerPlayerName?: string;
    triggerPlayerSeat?: number;
    deathCount?: number;
}

export interface JokerVotingState {
    votes: JokerVoteEntry[];
    tally: Record<string, number>;
    skipCount: number;
}

export interface JokerExecutionResult {
    executedSessionId: string | null;
    executedRole: JokerRole | null;
    reason: "vote" | "tie" | "skip" | null;
}

// Voting round history for review
export interface JokerVotingRoundRecord {
    round: number;
    votes: JokerVoteEntry[];
    tally: Record<string, number>;
    skipCount: number;
    executedSessionId: string | null;
    executedRole: JokerRole | null;
    reason: "vote" | "tie" | "skip" | null;
    at: number;
}

export interface JokerLifeCodeState {
    current: Record<string, string>;
    previous: Record<string, string>;
    version: number;
    lastUpdatedAt: number;
}

export interface JokerRoundState {
    roundCount: number;
    phaseStartAt: number;
    redLightHalf: "first" | "second";
    oxygenGivenThisRound: Record<string, Record<string, boolean>>;
    goldenRabbitTriggeredLocations: JokerLocation[];
    arrivedBySession: Record<string, boolean>;
    powerBoostBySession: Record<string, boolean>;
    powerBoostActiveBySession: Record<string, boolean>;
    warehouseUsedBySession: Record<string, boolean>;
    monitorUsedBySession: Record<string, boolean>;
    kitchenUsedBySession: Record<string, boolean>;
    medicalUsedBySession: Record<string, boolean>;
}

export type JokerTaskKind = "personal" | "shared" | "emergency";
export type JokerSharedTaskType = "nine_grid" | "digit_puzzle";
export type JokerEmergencyTaskType = "oxygen_leak" | "golden_rabbit";
export type JokerTaskStatus = "idle" | "waiting" | "active" | "resolved";

export interface JokerSharedTaskState {
    kind: "shared";
    type: JokerSharedTaskType;
    location: JokerLocation;
    status: JokerTaskStatus;
    participants: string[];
    joined: string[];
    startedAt?: number;
    deadlineAt?: number;
    remainingMs?: number;
    gridBySession?: Record<string, string[]>;
    commonIndex?: number;
    commonIcon?: string;
    selections?: Record<string, number>;
    digitTarget?: number;
    digitSegmentsBySession?: Record<string, number[]>;
    digitSelections?: Record<string, number>;
    resolvedAt?: number;
    result?: "success" | "fail";
}

export interface JokerEmergencyTaskState {
    kind: "emergency";
    type: JokerEmergencyTaskType;
    location: JokerLocation | "all";
    status: JokerTaskStatus;
    participants: string[];
    startedAt?: number;
    joinDeadlineAt?: number;
    deadlineAt?: number;
    rabbitIndex?: number;
    xBySession?: Record<string, number[]>;
    selections?: Record<string, number>;
    result?: "success" | "fail";
    resolvedAt?: number;
}

export interface JokerTaskSystemState {
    sharedByLocation?: Record<JokerLocation, JokerSharedTaskState>;
    emergencyByLocation?: Partial<Record<JokerLocation, JokerEmergencyTaskState>>;
    lastEmergencyAt?: number;
}

export interface JokerGameResult {
    winner: "duck" | "goose" | "dodo" | "hawk";
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
    activeLocations: JokerLocation[];
    lifeCodes: JokerLifeCodeState;
    round: JokerRoundState;
    meeting?: JokerMeetingState;
    voting?: JokerVotingState;
    execution?: JokerExecutionResult;
    gameResult?: JokerGameResult | null;
    logs: JokerLogEntry[];
    chatMessages: JokerChatMessage[];
    deaths: JokerDeathRecord[];
    votingHistory: JokerVotingRoundRecord[];
    locationHistory: Record<number, Record<JokerLocation, number[]>>;
    taskProgress: number;
    deadline?: number;
    tasks?: JokerTaskSystemState;
    paused?: boolean;
    pauseRemainingMs?: number;
    updatedAt: number;
}

// Payload types
export interface SelectLocationPayload {
    seat: number;
    location: JokerLocation;
}

export interface SubmitLifeCodeActionPayload {
    actorSeat: number;
    code: string;
    action: "kill" | "oxygen";
}

export interface SubmitVotePayload {
    targetSessionId: string | null;
}
