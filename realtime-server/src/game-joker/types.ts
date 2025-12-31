// realtime-server/src/game-joker/types.ts

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
    | "foul"           // 犯规死亡 (鹅/呆呆鸟尝试杀人)
    | "oxygen"         // 氧气耗尽
    | "vote";          // 投票淘汰

export interface JokerDeathRecord {
    sessionId: string;           // 死者 sessionId
    seat: number;                // 死者座位号
    name: string;                // 死者名字
    role: JokerRole;             // 死者角色
    reason: JokerDeathReason;    // 死亡原因
    killerSessionId?: string;    // 凶手 sessionId (仅 kill/foul)
    killerSeat?: number;         // 凶手座位号 (仅 kill/foul)
    killerLocation?: JokerLocation; // 凶手位置 (仅 kill/foul)
    location?: JokerLocation;    // 死亡地点 (仅 kill/oxygen)
    round: number;               // 发生回合
    at: number;                  // 死亡时间戳
    revealed: boolean;           // 是否已公开
    revealedAt?: number;         // 公开时间戳
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

    // Location
    location: JokerLocation | null; // assigned location for current round
    targetLocation: JokerLocation | null; // desired location (green light selection)

    // Life code
    lifeCode: string; // 2-digit code (e.g., "42")
    lifeCodeVersion: number; // increments when code changes

    // Oxygen system
    oxygenState: JokerOxygenState; // oxygen state for client interpolation
    duckEmergencyUsed: boolean; // duck one-time +180 on first death
    hawkEmergencyUsed: boolean;
    oxygenLeakActive: boolean;
    oxygenLeakStartedAt?: number;
    oxygenLeakResolvedAt?: number;
    oxygenLeakRound?: number;

    // Voting
    hasVoted: boolean;
    voteTarget: string | null; // sessionId of target, or "skip"

    // Ghost fields (only used when isAlive === false AND death is revealed)
    ghostTargetLocation: JokerLocation | null;   // 绿灯选择的目标场所
    ghostAssignedLocation: JokerLocation | null; // 黄灯后确定的场所
    hauntingTarget: string | null;               // 作祟目标 sessionId
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
    triggerType: "player" | "system"; // 谁触发的会议
    triggerPlayerName?: string; // 玩家名字（仅当triggerType为player时）
    triggerPlayerSeat?: number; // 玩家座位号（仅当triggerType为player时）
    deathCount: number; // 进入会议时的死亡人数
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

// Voting round history for review
export interface JokerVotingRoundRecord {
    round: number;                          // 轮次
    votes: JokerVoteEntry[];                // 投票记录
    tally: Record<string, number>;          // 票数统计
    skipCount: number;                      // 弃票数
    executedSessionId: string | null;       // 被淘汰玩家
    executedRole: JokerRole | null;         // 被淘汰玩家角色
    reason: "vote" | "tie" | "skip" | null; // 淘汰原因
    at: number;                             // 时间戳
}

export interface JokerLifeCodeState {
    // Current round codes: sessionId -> code
    current: Record<string, string>;
    // Previous round codes (still valid for first 20s of red light)
    previous: Record<string, string>;
    // Version tracker
    version: number;
    // Last time codes were regenerated (ms)
    lastUpdatedAt: number;
}

export interface JokerRoundState {
    roundCount: number;
    phaseStartAt: number;
    // Red light sub-phase: 0-20s = old codes, 20-40s = new codes
    redLightHalf: "first" | "second";
    // Life code refresh timing: seconds after red light starts (dynamically computed)
    lifeCodeRefreshSecond: number;
    // Track oxygen gives per round: actorSessionId -> targetSessionId -> true
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
    participants: string[]; // sessionIds in same location
    joined: string[]; // sessionIds who clicked join
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
    participants: string[]; // sessionIds who joined
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

    // Death records
    deaths: JokerDeathRecord[];

    // Voting history for review
    votingHistory: JokerVotingRoundRecord[];

    // Location history: 记录每回合每个场所有哪些玩家 (seat numbers)
    // 格式: { [round]: { [location]: [seat1, seat2, ...] } }
    locationHistory: Record<number, Record<JokerLocation, number[]>>;

    // Task progress (0-100, goose wins at 100)
    taskProgress: number;
    tasks?: JokerTaskSystemState;

    // Timing
    deadline?: number;
    paused?: boolean;
    pauseRemainingMs?: number;
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

export interface GhostSelectLocationPayload {
    seat: number;
    location: JokerLocation;
}

export interface GhostHauntPayload {
    seat: number;
    targetSessionId: string;
}

// Result types
export type ActionResult = { ok: boolean; error?: string; message?: string; data?: unknown };
