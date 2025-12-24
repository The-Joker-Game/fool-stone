// src/joker/types.ts

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

export type JokerLocation = "L1" | "L2" | "L3" | "L4" | "L5";

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
    oxygenReceivedThisRound: boolean;
    duckEmergencyUsed: boolean;

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

export interface JokerLifeCodeState {
    current: Record<string, string>;
    previous: Record<string, string>;
    version: number;
}

export interface JokerRoundState {
    roundCount: number;
    phaseStartAt: number;
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
    activeLocations: JokerLocation[];
    lifeCodes: JokerLifeCodeState;
    round: JokerRoundState;
    meeting?: JokerMeetingState;
    voting?: JokerVotingState;
    execution?: JokerExecutionResult;
    gameResult?: JokerGameResult | null;
    logs: JokerLogEntry[];
    chatMessages: JokerChatMessage[];
    taskProgress: number;
    deadline?: number;
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
