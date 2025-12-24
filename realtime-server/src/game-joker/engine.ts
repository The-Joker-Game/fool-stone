// realtime-server/src/game-joker/engine.ts

import type {
    JokerSnapshot,
    JokerPlayerState,
    JokerPhase,
    JokerRole,
    JokerLocation,
    JokerLifeCodeState,
    JokerRoundState,
    JokerGameResult,
    SelectLocationPayload,
    SubmitLifeCodeActionPayload,
    SubmitVotePayload,
    ActionResult,
} from "./types.js";

const MAX_SEATS = 10;
const INITIAL_OXYGEN = 270;
const OXYGEN_REFILL = 180;
const DUCK_EMERGENCY_OXYGEN = 180;

// Phase durations in milliseconds
export const PHASE_DURATIONS = {
    role_reveal: 10_000,
    green_light: 20_000,
    yellow_light: 10_000,
    red_light: 60_000,
    meeting: 60_000,
    voting: 30_000,
    execution: 5_000,
};

// ============ Initialization ============

export interface InitPlayer {
    name: string;
    seat: number;
    sessionId: string | null;
    isBot?: boolean;
    isHost?: boolean;
}

function createEmptyPlayer(seat: number): JokerPlayerState {
    return {
        seat,
        sessionId: null,
        name: "",
        role: null,
        isAlive: true,
        isReady: false,
        isHost: false,
        isBot: false,
        isDisconnected: false,
        location: null,
        targetLocation: null,
        lifeCode: generateLifeCode(),
        lifeCodeVersion: 1,
        oxygen: INITIAL_OXYGEN,
        oxygenReceivedThisRound: false,
        duckEmergencyUsed: false,
        hasVoted: false,
        voteTarget: null,
    };
}

function createEmptyLifeCodeState(): JokerLifeCodeState {
    return {
        current: {},
        previous: {},
        version: 0,
    };
}

function createEmptyRoundState(): JokerRoundState {
    return {
        roundCount: 0,
        phaseStartAt: Date.now(),
        redLightHalf: "first",
    };
}

export function initJokerRoom(roomCode: string, players: InitPlayer[]): JokerSnapshot {
    const playerStates: JokerPlayerState[] = [];

    for (let seat = 1; seat <= MAX_SEATS; seat++) {
        const init = players.find(p => p.seat === seat);
        if (init) {
            playerStates.push({
                ...createEmptyPlayer(seat),
                sessionId: init.sessionId,
                name: init.name,
                isBot: init.isBot ?? false,
                isHost: init.isHost ?? false,
            });
        } else {
            playerStates.push(createEmptyPlayer(seat));
        }
    }

    return {
        engine: "joker",
        roomCode,
        hostSessionId: players.find(p => p.isHost)?.sessionId ?? null,
        phase: "lobby",
        roundCount: 0,
        players: playerStates,
        activeLocations: [],
        lifeCodes: createEmptyLifeCodeState(),
        round: createEmptyRoundState(),
        logs: [],
        chatMessages: [],
        taskProgress: 0,
        updatedAt: Date.now(),
    };
}

// ============ Role Assignment ============

export function assignJokerRoles(snapshot: JokerSnapshot): ActionResult {
    const alivePlayers = snapshot.players.filter(p => p.sessionId);
    const playerCount = alivePlayers.length;

    if (playerCount < 5) {
        return { ok: false, error: "Need at least 5 players to start" };
    }

    // Duck count = floor(players / 3)
    const duckCount = Math.floor(playerCount / 3);
    const gooseCount = playerCount - duckCount;

    // Shuffle and assign roles
    const shuffled = [...alivePlayers].sort(() => Math.random() - 0.5);

    for (let i = 0; i < shuffled.length; i++) {
        const player = snapshot.players.find(p => p.seat === shuffled[i].seat);
        if (player) {
            player.role = i < duckCount ? "duck" : "goose";
            player.isAlive = true;
            player.oxygen = INITIAL_OXYGEN;
            player.oxygenReceivedThisRound = false;
            player.duckEmergencyUsed = false;
        }
    }

    // Generate initial life codes
    generateAllLifeCodes(snapshot);

    // Compute initial locations
    snapshot.activeLocations = computeLocations(playerCount);

    snapshot.updatedAt = Date.now();

    return { ok: true };
}

// ============ Location System ============

export function computeLocations(aliveCount: number): JokerLocation[] {
    // Location count = ceil(alive / 2), max 5
    const count = Math.min(5, Math.ceil(aliveCount / 2));
    const locations: JokerLocation[] = [];
    for (let i = 1; i <= count; i++) {
        locations.push(`L${i}` as JokerLocation);
    }
    return locations;
}

export function selectLocation(
    snapshot: JokerSnapshot,
    payload: SelectLocationPayload
): ActionResult {
    if (snapshot.phase !== "green_light") {
        return { ok: false, error: "Can only select location during green light" };
    }

    const player = snapshot.players.find(p => p.seat === payload.seat);
    if (!player || !player.isAlive) {
        return { ok: false, error: "Invalid player" };
    }

    if (!snapshot.activeLocations.includes(payload.location)) {
        return { ok: false, error: "Invalid location" };
    }

    player.targetLocation = payload.location;
    snapshot.updatedAt = Date.now();

    return { ok: true };
}

export function assignLocations(snapshot: JokerSnapshot): ActionResult {
    const alivePlayers = snapshot.players.filter(p => p.isAlive && p.sessionId);
    const locations = snapshot.activeLocations;

    if (locations.length === 0) {
        return { ok: false, error: "No active locations" };
    }

    // Group players by target location preference
    const preferences: Map<JokerLocation, JokerPlayerState[]> = new Map();
    const noPreference: JokerPlayerState[] = [];

    for (const loc of locations) {
        preferences.set(loc, []);
    }

    for (const player of alivePlayers) {
        if (player.targetLocation && locations.includes(player.targetLocation)) {
            preferences.get(player.targetLocation)!.push(player);
        } else {
            noPreference.push(player);
        }
    }

    // Assign locations respecting constraints:
    // - Each location: min 1, max 3 players
    // - Respect preferences when possible

    const assignments: Map<JokerLocation, JokerPlayerState[]> = new Map();
    for (const loc of locations) {
        assignments.set(loc, []);
    }

    // First pass: assign players with preferences (up to max 3)
    for (const [loc, players] of preferences) {
        const toAssign = players.slice(0, 3);
        for (const p of toAssign) {
            assignments.get(loc)!.push(p);
        }
        // Overflow goes to no preference
        for (let i = 3; i < players.length; i++) {
            noPreference.push(players[i]);
        }
    }

    // Second pass: ensure each location has at least 1 player
    for (const loc of locations) {
        if (assignments.get(loc)!.length === 0 && noPreference.length > 0) {
            const player = noPreference.shift()!;
            assignments.get(loc)!.push(player);
        }
    }

    // Third pass: distribute remaining players
    for (const player of noPreference) {
        // Find location with fewest players (under max)
        let minLoc = locations[0];
        let minCount = assignments.get(minLoc)!.length;

        for (const loc of locations) {
            const count = assignments.get(loc)!.length;
            if (count < minCount && count < 3) {
                minLoc = loc;
                minCount = count;
            }
        }

        assignments.get(minLoc)!.push(player);
    }

    // Apply assignments
    for (const [loc, players] of assignments) {
        for (const player of players) {
            const p = snapshot.players.find(x => x.seat === player.seat);
            if (p) {
                p.location = loc;
            }
        }
    }

    snapshot.updatedAt = Date.now();
    return { ok: true };
}

// ============ Life Code System ============

function generateLifeCode(): string {
    return String(Math.floor(Math.random() * 100)).padStart(2, "0");
}

export function generateAllLifeCodes(snapshot: JokerSnapshot): void {
    // Rotate: current becomes previous
    snapshot.lifeCodes.previous = { ...snapshot.lifeCodes.current };
    snapshot.lifeCodes.current = {};

    for (const player of snapshot.players) {
        if (player.sessionId && player.isAlive) {
            const code = generateLifeCode();
            player.lifeCode = code;
            player.lifeCodeVersion++;
            snapshot.lifeCodes.current[player.sessionId] = code;
        }
    }

    snapshot.lifeCodes.version++;
    snapshot.updatedAt = Date.now();
}

function findPlayerByLifeCode(
    snapshot: JokerSnapshot,
    code: string,
    includeOldCodes: boolean
): JokerPlayerState | null {
    // Check current codes
    for (const player of snapshot.players) {
        if (player.isAlive && player.lifeCode === code) {
            return player;
        }
    }

    // Check previous codes (valid in first half of red light)
    if (includeOldCodes) {
        for (const [sessionId, oldCode] of Object.entries(snapshot.lifeCodes.previous)) {
            if (oldCode === code) {
                const player = snapshot.players.find(
                    p => p.sessionId === sessionId && p.isAlive
                );
                if (player) return player;
            }
        }
    }

    return null;
}

// ============ Kill & Oxygen Actions ============

export function submitLifeCodeAction(
    snapshot: JokerSnapshot,
    payload: SubmitLifeCodeActionPayload
): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Actions only available during red light" };
    }

    const actor = snapshot.players.find(p => p.seat === payload.actorSeat);
    if (!actor || !actor.isAlive) {
        return { ok: false, error: "Invalid actor" };
    }

    // Determine if old codes are valid (first 30s of red light)
    const now = Date.now();
    const phaseElapsed = now - snapshot.round.phaseStartAt;
    const includeOldCodes = phaseElapsed < 30_000;

    // Find target by life code
    const target = findPlayerByLifeCode(snapshot, payload.code, includeOldCodes);

    if (!target) {
        return { ok: false, error: "Invalid life code", message: "No player with this code" };
    }

    if (payload.action === "kill") {
        return handleKillAction(snapshot, actor, target);
    } else if (payload.action === "oxygen") {
        return handleOxygenAction(snapshot, actor, target);
    }

    return { ok: false, error: "Unknown action" };
}

function handleKillAction(
    snapshot: JokerSnapshot,
    actor: JokerPlayerState,
    target: JokerPlayerState
): ActionResult {
    // Goose trying to kill = foul
    if (actor.role === "goose") {
        snapshot.logs.push({
            at: Date.now(),
            text: `Player ${actor.name} attempted illegal kill (foul)`,
            type: "system",
        });
        snapshot.updatedAt = Date.now();

        return {
            ok: false,
            error: "foul",
            message: "You are a goose and cannot kill. Your foul has been broadcast.",
        };
    }

    // Duck kills target (no location check, no same-round check per rules)
    target.isAlive = false;

    snapshot.logs.push({
        at: Date.now(),
        text: `Player ${target.name} was killed`,
        type: "kill",
    });

    snapshot.updatedAt = Date.now();

    return { ok: true, message: "Kill successful" };
}

function handleOxygenAction(
    snapshot: JokerSnapshot,
    actor: JokerPlayerState,
    target: JokerPlayerState
): ActionResult {
    // Cannot give oxygen to self
    if (actor.sessionId === target.sessionId) {
        return { ok: false, error: "Cannot give oxygen to yourself" };
    }

    // Check same location
    if (actor.location !== target.location) {
        return { ok: false, error: "Not in same location" };
    }

    // Check if target already received oxygen this round
    if (target.oxygenReceivedThisRound) {
        return { ok: false, error: "Target already received oxygen this round" };
    }

    // Apply oxygen
    target.oxygen += OXYGEN_REFILL;
    target.oxygenReceivedThisRound = true;

    snapshot.logs.push({
        at: Date.now(),
        text: `Player ${target.name} received +${OXYGEN_REFILL}s oxygen from ${actor.name}`,
        type: "oxygen",
    });

    snapshot.updatedAt = Date.now();

    return { ok: true, message: `Successfully gave ${OXYGEN_REFILL}s oxygen to ${target.name}` };
}

// ============ Oxygen Tick ============

export function tickOxygen(snapshot: JokerSnapshot): void {
    for (const player of snapshot.players) {
        if (player.isAlive && player.sessionId) {
            player.oxygen -= 1;
        }
    }
    snapshot.updatedAt = Date.now();
}

export function checkOxygenDeath(snapshot: JokerSnapshot): JokerPlayerState[] {
    const deaths: JokerPlayerState[] = [];

    for (const player of snapshot.players) {
        if (!player.isAlive || !player.sessionId) continue;

        if (player.oxygen <= 0) {
            if (player.role === "duck" && !player.duckEmergencyUsed) {
                // Duck gets emergency oxygen (one-time)
                player.oxygen = DUCK_EMERGENCY_OXYGEN;
                player.duckEmergencyUsed = true;

                snapshot.logs.push({
                    at: Date.now(),
                    text: `Player ${player.name} used emergency oxygen`,
                    type: "oxygen",
                });
            } else {
                // Player dies
                player.isAlive = false;
                deaths.push(player);

                snapshot.logs.push({
                    at: Date.now(),
                    text: `Player ${player.name} died from oxygen depletion`,
                    type: "death",
                });
            }
        }
    }

    snapshot.updatedAt = Date.now();
    return deaths;
}

// ============ Meeting & Voting ============

export function startMeeting(
    snapshot: JokerSnapshot,
    reporterSessionId: string,
    bodySessionId?: string
): ActionResult {
    const reporter = snapshot.players.find(p => p.sessionId === reporterSessionId);
    if (!reporter || !reporter.isAlive) {
        return { ok: false, error: "Invalid reporter" };
    }

    snapshot.phase = "meeting";
    snapshot.meeting = {
        reporterSessionId,
        bodySessionId,
        discussionEndAt: Date.now() + PHASE_DURATIONS.meeting,
    };

    // Reset voting state
    snapshot.voting = {
        votes: [],
        tally: {},
        skipCount: 0,
    };

    // Reset player vote state
    for (const player of snapshot.players) {
        player.hasVoted = false;
        player.voteTarget = null;
    }

    snapshot.deadline = snapshot.meeting.discussionEndAt;
    snapshot.updatedAt = Date.now();

    return { ok: true };
}

export function transitionToVoting(snapshot: JokerSnapshot): void {
    snapshot.phase = "voting";
    snapshot.deadline = Date.now() + PHASE_DURATIONS.voting;
    snapshot.updatedAt = Date.now();
}

export function submitVote(
    snapshot: JokerSnapshot,
    payload: SubmitVotePayload
): ActionResult {
    if (snapshot.phase !== "voting") {
        return { ok: false, error: "Voting not active" };
    }

    const voter = snapshot.players.find(p => p.seat === payload.voterSeat);
    if (!voter || !voter.isAlive || !voter.sessionId) {
        return { ok: false, error: "Invalid voter" };
    }

    if (voter.hasVoted) {
        return { ok: false, error: "Already voted" };
    }

    // Validate target
    if (payload.targetSessionId !== null) {
        const target = snapshot.players.find(
            p => p.sessionId === payload.targetSessionId && p.isAlive
        );
        if (!target) {
            return { ok: false, error: "Invalid vote target" };
        }
    }

    voter.hasVoted = true;
    voter.voteTarget = payload.targetSessionId;

    if (!snapshot.voting) {
        snapshot.voting = { votes: [], tally: {}, skipCount: 0 };
    }

    snapshot.voting.votes.push({
        voterSessionId: voter.sessionId,
        targetSessionId: payload.targetSessionId,
        submittedAt: Date.now(),
    });

    snapshot.updatedAt = Date.now();
    return { ok: true };
}

export function resolveVotes(snapshot: JokerSnapshot): ActionResult {
    if (!snapshot.voting) {
        return { ok: false, error: "No voting state" };
    }

    // Tally votes
    const tally: Record<string, number> = {};
    let skipCount = 0;

    for (const vote of snapshot.voting.votes) {
        if (vote.targetSessionId === null) {
            skipCount++;
        } else {
            tally[vote.targetSessionId] = (tally[vote.targetSessionId] || 0) + 1;
        }
    }

    snapshot.voting.tally = tally;
    snapshot.voting.skipCount = skipCount;

    // Find highest vote count
    let maxVotes = 0;
    let maxPlayers: string[] = [];

    for (const [sessionId, count] of Object.entries(tally)) {
        if (count > maxVotes) {
            maxVotes = count;
            maxPlayers = [sessionId];
        } else if (count === maxVotes) {
            maxPlayers.push(sessionId);
        }
    }

    // Determine execution
    let executedSessionId: string | null = null;
    let reason: "vote" | "tie" | "skip" | null = null;

    if (maxPlayers.length === 1 && maxVotes > skipCount) {
        // Clear winner with more votes than skips
        executedSessionId = maxPlayers[0];
        reason = "vote";
    } else if (maxPlayers.length > 1) {
        // Tie
        reason = "tie";
    } else if (skipCount >= maxVotes) {
        // Skip wins
        reason = "skip";
    }

    // Apply execution
    let executedRole: JokerRole | null = null;
    if (executedSessionId) {
        const executed = snapshot.players.find(p => p.sessionId === executedSessionId);
        if (executed) {
            executed.isAlive = false;
            executedRole = executed.role;

            snapshot.logs.push({
                at: Date.now(),
                text: `Player ${executed.name} was executed by vote (${executedRole})`,
                type: "vote",
            });
        }
    }

    snapshot.execution = {
        executedSessionId,
        executedRole,
        reason,
    };

    snapshot.phase = "execution";
    snapshot.deadline = Date.now() + PHASE_DURATIONS.execution;
    snapshot.updatedAt = Date.now();

    return { ok: true };
}

// ============ Win Condition ============

export function checkWinCondition(snapshot: JokerSnapshot): JokerGameResult | null {
    // Goose win: task progress reaches 100%
    if (snapshot.taskProgress >= 100) {
        return { winner: "goose", reason: "任务完成度达到100%" };
    }

    const alivePlayers = snapshot.players.filter(p => p.isAlive && p.sessionId);
    const aliveDucks = alivePlayers.filter(p => p.role === "duck");
    const aliveGeese = alivePlayers.filter(p => p.role === "goose");

    // Goose win: all ducks dead
    if (aliveDucks.length === 0) {
        return { winner: "goose", reason: "所有鸭子已被淘汰" };
    }

    // Duck win: ducks >= geese
    if (aliveDucks.length >= aliveGeese.length) {
        return { winner: "duck", reason: "鸭子数量超过或等于鹅" };
    }

    return null;
}

// ============ Task System ============

const TASK_PROGRESS_PER_COMPLETION = 2; // +2% per task

export function completeTask(snapshot: JokerSnapshot): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Tasks can only be completed during red light" };
    }

    snapshot.taskProgress = Math.min(100, snapshot.taskProgress + TASK_PROGRESS_PER_COMPLETION);
    snapshot.updatedAt = Date.now();

    return { ok: true, message: `Task completed! Progress: ${snapshot.taskProgress}%` };
}

export function finalizeGame(snapshot: JokerSnapshot, result: JokerGameResult): void {
    snapshot.phase = "game_over";
    snapshot.gameResult = result;
    snapshot.deadline = undefined;
    snapshot.updatedAt = Date.now();
}

// ============ Phase Transitions ============

export function transitionToRoleReveal(snapshot: JokerSnapshot): void {
    snapshot.phase = "role_reveal";
    snapshot.round.phaseStartAt = Date.now();
    snapshot.deadline = Date.now() + PHASE_DURATIONS.role_reveal;
    snapshot.updatedAt = Date.now();
}

export function transitionToGreenLight(snapshot: JokerSnapshot): void {
    snapshot.phase = "green_light";
    snapshot.roundCount++;
    snapshot.round.roundCount = snapshot.roundCount;
    snapshot.round.phaseStartAt = Date.now();

    // Update locations based on alive count
    const aliveCount = snapshot.players.filter(p => p.isAlive && p.sessionId).length;
    snapshot.activeLocations = computeLocations(aliveCount);

    // Reset round-specific player state
    for (const player of snapshot.players) {
        player.targetLocation = null;
        player.location = null;
        player.oxygenReceivedThisRound = false;
    }

    snapshot.deadline = Date.now() + PHASE_DURATIONS.green_light;
    snapshot.updatedAt = Date.now();
}

export function transitionToYellowLight(snapshot: JokerSnapshot): void {
    // Assign locations
    assignLocations(snapshot);

    snapshot.phase = "yellow_light";
    snapshot.round.phaseStartAt = Date.now();
    snapshot.deadline = Date.now() + PHASE_DURATIONS.yellow_light;
    snapshot.updatedAt = Date.now();
}

export function transitionToRedLight(snapshot: JokerSnapshot): void {
    snapshot.phase = "red_light";
    snapshot.round.phaseStartAt = Date.now();
    snapshot.round.redLightHalf = "first";

    snapshot.deadline = Date.now() + PHASE_DURATIONS.red_light;
    snapshot.updatedAt = Date.now();
}

export function rotateLifeCodesAtHalfRedLight(snapshot: JokerSnapshot): void {
    if (snapshot.round.redLightHalf === "first") {
        generateAllLifeCodes(snapshot);
        snapshot.round.redLightHalf = "second";
        snapshot.updatedAt = Date.now();
    }
}

// ============ Reset Game ============

export function resetToLobby(snapshot: JokerSnapshot): void {
    snapshot.phase = "lobby";
    snapshot.roundCount = 0;
    snapshot.gameResult = undefined;
    snapshot.meeting = undefined;
    snapshot.voting = undefined;
    snapshot.execution = undefined;
    snapshot.deadline = undefined;
    snapshot.activeLocations = [];
    snapshot.lifeCodes = createEmptyLifeCodeState();
    snapshot.round = createEmptyRoundState();
    snapshot.logs = [];
    snapshot.taskProgress = 0;

    for (const player of snapshot.players) {
        player.role = null;
        player.isAlive = true;
        player.isReady = false;
        player.location = null;
        player.targetLocation = null;
        player.oxygen = INITIAL_OXYGEN;
        player.oxygenReceivedThisRound = false;
        player.duckEmergencyUsed = false;
        player.hasVoted = false;
        player.voteTarget = null;
        player.lifeCode = generateLifeCode();
        player.lifeCodeVersion = 1;
    }

    snapshot.updatedAt = Date.now();
}
