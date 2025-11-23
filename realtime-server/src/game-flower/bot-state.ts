
import type { FlowerRole, FlowerPlayerState } from "./types.js";

export interface BotMemory {
    // The role this bot claims to be (publicly)
    claimedRole: FlowerRole;
    // The bot's actual role (for reference)
    realRole: FlowerRole;
    // Guesses about other players' roles
    guesses: Map<number, FlowerRole>;
    // Suspicion scores for other players (0-100, higher is more suspicious/bad)
    suspicion: Map<number, number>;
    // Known information (e.g. from Police checks)
    knownRoles: Map<number, { role: FlowerRole | "good" | "bad"; source: "police" | "witness" }>;
    // History of actions to avoid repetition (e.g. Doctor saving same person)
    actionHistory: {
        nightActions: Array<{ target: number; turn: number }>;
        votes: Array<{ target: number; turn: number }>;
    };
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
const GOOD_ROLES: FlowerRole[] = ["花蝴蝶", "狙击手", "医生", "警察", "善民"];

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
    allPlayers: FlowerPlayerState[],
    cheatProbability: number = 0.5
) {
    if (!globalBotMemories.has(roomCode)) {
        globalBotMemories.set(roomCode, new Map());
    }
    const roomMemories = globalBotMemories.get(roomCode)!;

    const guesses = new Map<number, FlowerRole>();
    const suspicion = new Map<number, number>();

    // Initialize guesses and suspicion
    allPlayers.forEach(p => {
        if (p.seat === seat) return;

        // Cheat logic: X% chance to know the real role, otherwise random
        let guessedRole: FlowerRole;
        if (Math.random() < cheatProbability && p.role) {
            guessedRole = p.role;
        } else {
            guessedRole = getRandomRole();
        }
        guesses.set(p.seat, guessedRole);

        // Initial suspicion based on guess
        // If I am Good, Bad roles are suspicious (high score)
        // If I am Bad, Good roles are "targets" (but we track suspicion as "enemy")
        // Let's standardize: Suspicion = "How much I want to eliminate them"
        // For Good bot: High suspicion = Bad guy
        // For Bad bot: High suspicion = Good guy (especially strong ones)

        // Actually, let's keep Suspicion as "Likelihood of being Bad" for Good bots,
        // and for Bad bots, we can use it as "Priority to Kill".
        // But to simplify, let's just use "Suspicion" as "Is this player an enemy?"

        const isMeBad = isBadRole(realRole);
        const isGuessBad = isBadRole(guessedRole);

        if (isMeBad) {
            // I am Bad.
            // If guess is Bad -> Ally (Low suspicion)
            // If guess is Good -> Enemy (High suspicion)
            suspicion.set(p.seat, isGuessBad ? 10 : 90);
        } else {
            // I am Good.
            // If guess is Bad -> Enemy (High suspicion)
            // If guess is Good -> Ally (Low suspicion)
            suspicion.set(p.seat, isGuessBad ? 90 : 10);
        }
    });

    // Decide on a Claimed Role
    let claimedRole = realRole;
    if (isBadRole(realRole)) {
        // Bad guys lie.
        // 30% chance to claim real role (e.g. "I am a Civilian" if actually Bad Civilian, or "I am Killer" - wait, Killer never claims Killer)
        // Actually, Bad roles usually claim Good roles.
        // Exception: Maybe "Bad Civilian" claims "Good Civilian".

        const roll = Math.random();
        if (roll < 0.4) {
            // Claim Good Civilian
            claimedRole = "善民";
        } else if (roll < 0.7) {
            // Claim a God role (Police/Doctor/Butterfly) - High risk, high reward
            const godRoles: FlowerRole[] = ["警察", "医生", "花蝴蝶"];
            claimedRole = godRoles[Math.floor(Math.random() * godRoles.length)];
        } else {
            // Claim Good Civilian (Default safe play)
            claimedRole = "善民";
        }
    } else {
        // Good guys usually claim their real role, OR Civilian to hide.
        // 80% claim real, 20% claim Civilian (if special)
        if (realRole !== "善民" && Math.random() < 0.2) {
            claimedRole = "善民";
        }
    }

    const memory: BotMemory = {
        claimedRole,
        realRole,
        guesses,
        suspicion,
        knownRoles: new Map(),
        actionHistory: {
            nightActions: [],
            votes: []
        }
    };

    roomMemories.set(seat, memory);
    return memory;
}

export function updateBotSuspicion(
    roomCode: string,
    seat: number,
    targetSeat: number,
    delta: number
) {
    const mem = getBotMemory(roomCode, seat);
    if (!mem) return;

    const current = mem.suspicion.get(targetSeat) || 50;
    const newVal = Math.max(0, Math.min(100, current + delta));
    mem.suspicion.set(targetSeat, newVal);
}

export function updateBotGuesses(
    roomCode: string,
    dayCount: number,
    allPlayers: FlowerPlayerState[]
) {
    const roomMemories = globalBotMemories.get(roomCode);
    if (!roomMemories) return;

    // Probability increases with days: 10% + (day - 1) * 5%
    // Day 1: 10%, Day 2: 15%, Day 3: 20%, etc.
    const probability = 0.1 + Math.max(0, dayCount - 1) * 0.05;

    roomMemories.forEach((mem, seat) => {
        // Only update for alive bots (or all bots? Memory persists even if dead, but maybe no need to update)
        // Let's update for all to keep state consistent just in case.

        allPlayers.forEach(p => {
            if (p.seat === seat) return; // Don't guess self

            // If we already know the role for sure (e.g. from Police check), don't overwrite with a guess
            // But currently knownRoles only stores "good" or "bad", not exact role.
            // And guesses are exact roles.
            // So we can update guesses.

            // Check if we should "cheat" and know the real role
            let guessedRole: FlowerRole;
            if (Math.random() < probability && p.role) {
                guessedRole = p.role;
            } else {
                // Keep existing guess or make a new random one?
                // If we make a new random one every time, it might be too chaotic.
                // But if probability increases, we should have a chance to switch to the CORRECT one.
                // If we already have the correct guess, keep it.
                const currentGuess = mem.guesses.get(p.seat);
                if (currentGuess === p.role) {
                    guessedRole = p.role;
                } else {
                    // We were wrong or didn't know. Try again with random.
                    guessedRole = getRandomRole();
                }
            }
            mem.guesses.set(p.seat, guessedRole);

            // Update suspicion based on the (potentially new) guess
            const isMeBad = isBadRole(mem.realRole);
            const isGuessBad = isBadRole(guessedRole);

            let newSuspicion = 50;
            if (isMeBad) {
                // I am Bad. Guess Bad -> Ally (10), Guess Good -> Enemy (90)
                newSuspicion = isGuessBad ? 10 : 90;
            } else {
                // I am Good. Guess Bad -> Enemy (90), Guess Good -> Ally (10)
                newSuspicion = isGuessBad ? 90 : 10;
            }

            // Blend with existing suspicion to avoid sudden jumps? 
            // Or just set it? The user wants "gradient ascent", which usually implies gradual improvement.
            // But here we are simulating "realization".
            // Let's just set it for now, as the guess itself is the "realization".
            mem.suspicion.set(p.seat, newSuspicion);
        });
    });
}

