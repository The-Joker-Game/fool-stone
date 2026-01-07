// src/joker/types.ts

// Base roles
export type JokerBaseRole = "duck" | "goose" | "dodo" | "hawk";

// Special roles
export type JokerSpecialRole =
    // 🪢 鹅阵营特殊角色 (Goose faction special roles)
    | "vigilante_goose"    // 正义鹅：仅一次击杀机会
    | "sheriff_goose"      // 警长鹅：杀鹅自杀
    | "coroner_goose"      // 验尸鹅：调查死因
    | "overseer_goose"     // 监工鹅：调查任务贡献度
    // 🦆 鸭阵营特殊角色 (Duck faction special roles)
    | "poisoner_duck"      // 毒师鸭：60秒毒杀
    | "saboteur_duck"      // 糊弄鸭：埋隐患
    // 🐦 中立阵营特殊角色 (Neutral faction special roles)
    | "woodpecker";        // 啄木鸟：击杀导致氧气泄漏

export type JokerRole = JokerBaseRole | JokerSpecialRole;

// Role template: simple uses original config, special enables special roles
export type JokerRoleTemplate = "simple" | "special";

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

export type JokerLocation = "厨房" | "医务室" | "发电室" | "监控室" | "仓库" | "调度室" | "休眠舱";

// Death tracking
export type JokerDeathReason =
    | "kill"           // 被杀
    | "foul"           // 犯规死亡
    | "oxygen"         // 氧气耗尽
    | "vote"           // 投票淘汰
    | "poison"         // 毒杀 (毒师鸭)
    | "suicide";       // 自杀 (警长鹅杀鹅后)

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

// Oxygen state for client-side interpolation
export interface JokerOxygenState {
    baseOxygen: number;      // base oxygen value (seconds)
    drainRate: number;       // drain rate (1=normal, 3=leak, 0=paused)
    baseTimestamp: number;   // server timestamp when state was set (ms)
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

    oxygenState: JokerOxygenState;
    duckEmergencyUsed: boolean;
    hawkEmergencyUsed: boolean;
    woodpeckerEmergencyUsed: boolean;
    poisonerDuckEmergencyUsed: boolean;
    saboteurDuckEmergencyUsed: boolean;
    oxygenLeakActive: boolean;
    oxygenLeakStartedAt?: number;
    oxygenLeakResolvedAt?: number;
    oxygenLeakRound?: number;

    hasVoted: boolean;
    voteTarget: string | null;

    // Ghost fields (only used when isAlive === false AND death is revealed)
    ghostTargetLocation: JokerLocation | null;
    ghostAssignedLocation: JokerLocation | null;
    hauntingTarget: string | null;

    // Stasis fields (休眠舱)
    inStasis: boolean;
    stasisEnteredAt?: number;  // 进入休眠舱的时间戳（用于暂停毒杀计时）

    // === Special Role States 特殊角色状态 ===
    // 正义鹅 (vigilante_goose)
    vigilanteKillUsed?: boolean;

    // 毒师鸭 (poisoner_duck)
    poisonTargetSessionId?: string;
    isPoisoned?: boolean;
    poisonRemainingSeconds?: number;
    poisonedBySessionId?: string;

    // 糊弄鸭 (saboteur_duck)
    saboteurHiddenDamage?: number;
    saboteurExploded?: boolean;

    // 验尸鹅 (coroner_goose)
    investigatedDeaths?: string[];

    // Oxygen tracking (生命代码补氧追踪)
    lastOxygenGiverSessionId?: string | null;

    // 监工鹅 (overseer_goose)
    totalTaskContribution?: number;     // 累计任务贡献度 (跨轮次)
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
    version: number;
    lastUpdatedAt: number;
}

export interface JokerRoundState {
    roundCount: number;
    phaseStartAt: number;
    lifeCodeRefreshSecond: number;
    oxygenGivenThisRound: Record<string, Record<string, boolean>>;
    goldenRabbitTriggeredLocations: JokerLocation[];
    arrivedBySession: Record<string, boolean>;
    powerBoostBySession: Record<string, boolean>;
    powerBoostActiveBySession: Record<string, boolean>;
    warehouseUsedBySession: Record<string, boolean>;
    monitorUsedBySession: Record<string, boolean>;
    kitchenUsedBySession: Record<string, boolean>;
    medicalUsedBySession: Record<string, boolean>;
    // New location effects (新场所)
    dispatchUsedBySession: Record<string, boolean>;
    stasisActiveBySession: Record<string, boolean>;
    randomDispatchNextRound: boolean;
    randomDispatchInitiatorSessionId: string | null;
    // === Special Role Tracking 特殊角色追踪 ===
    taskContributionBySession: Record<string, number>;
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
    winner: "duck" | "goose" | "dodo" | "hawk" | "woodpecker";
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
    roleTemplate?: JokerRoleTemplate;
    enableSoloEffects?: boolean;
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
