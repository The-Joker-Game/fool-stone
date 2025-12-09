
import type { FlowerRole, FlowerPlayerState } from "./types.js";
import type { PlayerAssessment } from "./ai-protocol.js";

export interface BotMemory {
    // The role this bot claims to be (publicly)
    claimedRole: FlowerRole;
    // The bot's actual role (for reference)
    realRole: FlowerRole;
    // Detailed assessments of other players
    assessments: Map<number, PlayerAssessment>;

    // known information (e.g. from Police checks or absolute logic)
    knownRoles: Map<number, { role: FlowerRole | "good" | "bad"; source: "police" | "witness" }>;

    // Short-term memory for the current round/action chain
    roundMemory: {
        // Plan generated during speech phase, to be executed in vote/skill phase
        planToAlly: number[]; // Seats we want to protect/ally with
        analysisSummary: string; // "Thought Chain" summary
    };

    // History of actions to avoid repetition
    actionHistory: {
        nightActions: Array<{ target: number; turn: number }>;
        votes: Array<{ target: number; turn: number }>;
    };

    // Comprehensive Log of Self Actions with reasoning
    selfActionLog: Array<{
        day: number;
        phase: string;
        action: string;
        target?: number;
        content?: string;
        reason: string;
        result?: string;
    }>;

    // Dynamic Long-Term Strategy (e.g. "Gain trust of #3, then backstab")
    longTermStrategy: string;

    // Incremental context history for LLM (Chat & Events)
    contextHistory: string[];

    // Timestamp of the last chat message processed into contextHistory
    lastSeenChatTime: number;

    // --- New: Historical Event Cursor ---
    // Record the number of days that have been fully "digested" (summarized and stored in memory)
    lastSummarizedDay: number;
    // Record whether the night information of the current day has been summarized (to prevent repeated memory of last night)
    hasSummarizedNight: boolean;
}

// Global storage for bot memories: Map<RoomCode, Map<Seat, BotMemory>>
const globalBotMemories = new Map<string, Map<number, BotMemory>>();

export function getBotMemory(roomCode: string, seat: number): BotMemory | undefined {
    return globalBotMemories.get(roomCode)?.get(seat);
}

export function clearRoomBotMemories(roomCode: string) {
    globalBotMemories.delete(roomCode);
}

const ALL_ROLES: FlowerRole[] = [
    "花蝴蝶", "狙击手", "医生", "警察", "善民",
    "杀手", "魔法师", "森林老人", "恶民"
];

const BAD_ROLES: FlowerRole[] = ["杀手", "魔法师", "森林老人", "恶民"];

function isBadRole(role: FlowerRole): boolean {
    return BAD_ROLES.includes(role);
}

function getRandomRole(): FlowerRole {
    return ALL_ROLES[Math.floor(Math.random() * ALL_ROLES.length)];
}

export function initBotMemory(
    roomCode: string,
    seat: number,
    realRole: FlowerRole,
    allPlayers: FlowerPlayerState[]
) {
    if (!globalBotMemories.has(roomCode)) {
        globalBotMemories.set(roomCode, new Map());
    }
    const roomMemories = globalBotMemories.get(roomCode)!;

    const assessments = new Map<number, PlayerAssessment>();

    // Initialize suspicion to Neutral (50) for everyone
    allPlayers.forEach(p => {
        if (p.seat === seat) return;
        assessments.set(p.seat, {
            seat: p.seat,
            roleGuess: "Unknown",
            intentGuess: "Initial state",
            reasoning: "Game just started"
        });
    });

    // Decide on a Claimed Role Strategy (Initial thought)
    // This can still be random-ish or heuristic based, as it's "pre-game strategy"
    let claimedRole = realRole;
    if (isBadRole(realRole)) {
        // Bad guys lie.
        const roll = Math.random();
        if (roll < 0.4) {
            claimedRole = "善民";
        } else if (roll < 0.7) {
            const godRoles: FlowerRole[] = ["警察", "医生", "花蝴蝶"];
            claimedRole = godRoles[Math.floor(Math.random() * godRoles.length)];
        } else {
            claimedRole = "善民";
        }
    } else {
        // Good guys usually claim real, or hide as civilian
        if (realRole !== "善民" && Math.random() < 0.2) {
            claimedRole = "善民";
        }
    }

    const memory: BotMemory = {
        claimedRole,
        realRole,
        assessments,
        knownRoles: new Map(),
        roundMemory: {
            planToAlly: [],
            analysisSummary: "Game started. I am " + realRole + "."
        },
        actionHistory: {
            nightActions: [],
            votes: []
        },
        selfActionLog: [],
        longTermStrategy: isBadRole(realRole) ? "潜伏，寻找机会除掉神职。" : "观察局势，找出坏人。",
        contextHistory: [],
        lastSeenChatTime: 0,
        lastSummarizedDay: 0,
        hasSummarizedNight: false
    };

    roomMemories.set(seat, memory);
    return memory;
}

/**
 * Append new context to the bot's history for LLM inputs.
 */
export function appendBotContext(roomCode: string, seat: number, contextLine: string) {
    const mem = getBotMemory(roomCode, seat);
    if (!mem) return;
    mem.contextHistory.push(contextLine);
}

/**
 * Update memory based on AI's latest assessment.
 * This replaces the old "updateBotGuesses" cheat function.
 */
export function updateBotMemoryFromAssessment(
    roomCode: string,
    seat: number,
    assessments: PlayerAssessment[],
    strategicNote: string,
    claimedRole: FlowerRole, // New argument
    strategicPlan?: string
) {
    const mem = getBotMemory(roomCode, seat);
    if (!mem) return;

    // Update Persistent Identity Persona
    mem.claimedRole = claimedRole;

    // Update Round Memory
    mem.roundMemory.analysisSummary = strategicNote;
    mem.roundMemory.planToAlly = []; // Needs new logic if we want to determine allies from Reasoning, or just drop this field eventually.

    if (strategicPlan) {
        mem.longTermStrategy = strategicPlan;
    }

    // Update Persistent Beliefs
    assessments.forEach(a => {
        mem.assessments.set(a.seat, a);
    });
}
