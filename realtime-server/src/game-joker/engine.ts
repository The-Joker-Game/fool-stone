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
    JokerSharedTaskType,
    JokerSharedTaskState,
    JokerEmergencyTaskState,
    JokerTaskSystemState,
    SelectLocationPayload,
    SubmitLifeCodeActionPayload,
    SubmitVotePayload,
    ActionResult,
} from "./types.js";

const MAX_SEATS = 16;
const INITIAL_OXYGEN = 270;
const OXYGEN_REFILL = 90;
const WAREHOUSE_OXYGEN_REFILL = 60;
const DUCK_EMERGENCY_OXYGEN = 180;
const HAWK_EMERGENCY_OXYGEN = 180;
const OXYGEN_DRAIN_NORMAL = 1;
const OXYGEN_DRAIN_LEAK = 3;
const GOLDEN_RABBIT_PROGRESS_REWARD = 8;
export const GOLDEN_RABBIT_JOIN_MS = 8_000;

// Phase durations in milliseconds
export const PHASE_DURATIONS = {
    role_reveal: 10_000,
    green_light: 20_000,
    yellow_light: 10_000,
    red_light: 60_000,
    meeting: 60_000,
    voting: 120_000,
    execution: 10_000,
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
        oxygenUpdatedAt: Date.now(),
        duckEmergencyUsed: false,
        hawkEmergencyUsed: false,
        oxygenLeakActive: false,
        oxygenLeakStartedAt: undefined,
        oxygenLeakResolvedAt: undefined,
        oxygenLeakRound: undefined,
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
        oxygenGivenThisRound: {},
        goldenRabbitTriggeredLocations: [],
        powerBoostBySession: {},
        powerBoostActiveBySession: {},
        warehouseUsedBySession: {},
        monitorUsedBySession: {},
        kitchenUsedBySession: {},
        medicalUsedBySession: {},
    };
}

function createEmptyTaskSystem(): JokerTaskSystemState {
    return {};
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
        deaths: [],
        votingHistory: [],
        locationHistory: {},
        taskProgress: 0,
        tasks: createEmptyTaskSystem(),
        paused: false,
        updatedAt: Date.now(),
    };
}

// ============ Role Assignment ============

const ROLE_COUNTS_BY_PLAYERS: Record<number, { goose: number; duck: number; dodo: number; hawk: number }> = {
    5: { goose: 4, duck: 1, dodo: 0, hawk: 0 },
    6: { goose: 4, duck: 1, dodo: 1, hawk: 0 },
    7: { goose: 4, duck: 2, dodo: 1, hawk: 0 },
    8: { goose: 4, duck: 2, dodo: 1, hawk: 1 },
    9: { goose: 5, duck: 2, dodo: 1, hawk: 1 },
    10: { goose: 6, duck: 2, dodo: 1, hawk: 1 },
    11: { goose: 7, duck: 2, dodo: 1, hawk: 1 },
    12: { goose: 8, duck: 3, dodo: 1, hawk: 1 },
    13: { goose: 9, duck: 3, dodo: 1, hawk: 1 },
    14: { goose: 10, duck: 3, dodo: 1, hawk: 1 },
    15: { goose: 11, duck: 4, dodo: 1, hawk: 1 },
    16: { goose: 12, duck: 4, dodo: 1, hawk: 1 },
};

export function assignJokerRoles(snapshot: JokerSnapshot): ActionResult {
    const alivePlayers = snapshot.players.filter(p => p.sessionId);
    const playerCount = alivePlayers.length;

    if (playerCount < 5) {
        return { ok: false, error: "Need at least 5 players to start" };
    }

    const roleConfig = ROLE_COUNTS_BY_PLAYERS[playerCount];
    if (!roleConfig) {
        return { ok: false, error: "Unsupported player count" };
    }

    const roles: JokerRole[] = [
        ...Array(roleConfig.duck).fill("duck"),
        ...Array(roleConfig.goose).fill("goose"),
        ...Array(roleConfig.hawk).fill("hawk"),
        ...Array(roleConfig.dodo).fill("dodo"),
    ];
    if (roles.length !== playerCount) {
        return { ok: false, error: "Role count mismatch" };
    }

    const shuffledPlayers = [...alivePlayers].sort(() => Math.random() - 0.5);
    const shuffledRoles = shuffleArray(roles);

    for (let i = 0; i < shuffledPlayers.length; i++) {
        const player = snapshot.players.find(p => p.seat === shuffledPlayers[i].seat);
        if (player) {
            player.role = shuffledRoles[i] ?? "goose";
            player.isAlive = true;
            player.oxygen = INITIAL_OXYGEN;
            player.oxygenUpdatedAt = Date.now();
            player.duckEmergencyUsed = false;
            player.hawkEmergencyUsed = false;
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

const ALL_LOCATIONS: JokerLocation[] = ["厨房", "医务室", "发电室", "监控室", "仓库"];

export function computeLocations(aliveCount: number): JokerLocation[] {
    // Location count = ceil(alive / 2), max 5
    const count = Math.min(5, Math.ceil(aliveCount / 2));
    return ALL_LOCATIONS.slice(0, count);
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

// ============ Location Effects ============

type JokerCamp = "goose" | "duck" | "neutral";

function getCamp(role: JokerRole | null): JokerCamp | null {
    if (role === "goose") return "goose";
    if (role === "duck") return "duck";
    if (role === "hawk" || role === "dodo") return "neutral";
    return null;
}

function getAlivePlayersInLocation(snapshot: JokerSnapshot, location: JokerLocation): JokerPlayerState[] {
    return snapshot.players.filter(p => p.isAlive && p.location === location);
}

function isSoloInLocation(snapshot: JokerSnapshot, sessionId: string, location: JokerLocation): boolean {
    const aliveAtLocation = getAlivePlayersInLocation(snapshot, location);
    return (
        aliveAtLocation.length === 1 &&
        aliveAtLocation[0].sessionId === sessionId
    );
}

function ensureRoundTracking(snapshot: JokerSnapshot): void {
    if (!snapshot.round.powerBoostBySession) snapshot.round.powerBoostBySession = {};
    if (!snapshot.round.powerBoostActiveBySession) snapshot.round.powerBoostActiveBySession = {};
    if (!snapshot.round.warehouseUsedBySession) snapshot.round.warehouseUsedBySession = {};
    if (!snapshot.round.monitorUsedBySession) snapshot.round.monitorUsedBySession = {};
    if (!snapshot.round.kitchenUsedBySession) snapshot.round.kitchenUsedBySession = {};
    if (!snapshot.round.medicalUsedBySession) snapshot.round.medicalUsedBySession = {};
}

// ============ Life Code System ============

function generateLifeCode(): string {
    return String(Math.floor(Math.random() * 100)).padStart(2, "0");
}

function generateUniqueLifeCodes(count: number): string[] {
    const pool: string[] = [];
    for (let i = 0; i < 100; i++) {
        pool.push(String(i).padStart(2, "0"));
    }
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
}

export function generateAllLifeCodes(snapshot: JokerSnapshot): void {
    // Rotate: current becomes previous
    snapshot.lifeCodes.previous = { ...snapshot.lifeCodes.current };
    snapshot.lifeCodes.current = {};

    const alivePlayers = snapshot.players.filter(p => p.sessionId && p.isAlive);
    const uniqueCodes = generateUniqueLifeCodes(alivePlayers.length);

    alivePlayers.forEach((player, idx) => {
        const code = uniqueCodes[idx];
        player.lifeCode = code;
        player.lifeCodeVersion++;
        snapshot.lifeCodes.current[player.sessionId!] = code;
    });

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
        // Duck or hawk loses 30s oxygen for incorrect kill code
        if (payload.action === "kill" && (actor.role === "duck" || actor.role === "hawk")) {
            const KILL_CODE_PENALTY = 30;
            actor.oxygen -= KILL_CODE_PENALTY;
            actor.oxygenUpdatedAt = now;
            snapshot.updatedAt = now;
            return { ok: false, error: "Invalid life code", message: `错误代码，损失${KILL_CODE_PENALTY}秒氧气` };
        }
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
    const now = Date.now();

    // Goose or dodo trying to kill = foul
    if (actor.role === "goose" || actor.role === "dodo") {
        actor.isAlive = false;

        // Create death record for foul
        snapshot.deaths.push({
            sessionId: actor.sessionId!,
            seat: actor.seat,
            name: actor.name,
            role: actor.role,
            reason: "foul",
            location: actor.location ?? undefined,
            round: snapshot.roundCount,
            at: now,
            revealed: false,
        });

        snapshot.logs.push({
            at: now,
            text: `Player ${actor.name} died`,
            type: "death",
        });
        snapshot.updatedAt = now;

        return {
            ok: false,
            error: "foul_death",
            message: "犯规死亡",
        };
    }

    // Duck or hawk kills target (no location check, no same-round check per rules)
    target.isAlive = false;

    // Create death record for kill
    snapshot.deaths.push({
        sessionId: target.sessionId!,
        seat: target.seat,
        name: target.name,
        role: target.role!,
        reason: "kill",
        killerSessionId: actor.sessionId ?? undefined,
        killerSeat: actor.seat,
        killerLocation: actor.location ?? undefined,
        location: target.location ?? undefined,
        round: snapshot.roundCount,
        at: now,
        revealed: false,
    });

    snapshot.logs.push({
        at: now,
        text: `Player ${target.name} was killed`,
        type: "kill",
    });

    snapshot.updatedAt = now;

    return { ok: true, message: "Kill successful" };
}

function handleOxygenAction(
    snapshot: JokerSnapshot,
    actor: JokerPlayerState,
    target: JokerPlayerState
): ActionResult {
    const actorSessionId = actor.sessionId;
    const targetSessionId = target.sessionId;
    if (!actorSessionId || !targetSessionId) {
        return { ok: false, error: "Invalid player" };
    }

    // Cannot give oxygen to self
    if (actorSessionId === targetSessionId) {
        return { ok: false, error: "Cannot give oxygen to yourself" };
    }

    // Check same location
    if (actor.location !== target.location) {
        return { ok: false, error: "Not in same location" };
    }

    // Check if actor already gave oxygen to this target this round
    if (snapshot.round.oxygenGivenThisRound[actorSessionId]?.[targetSessionId]) {
        return { ok: false, error: "Already gave oxygen to this player this round" };
    }

    // Apply oxygen
    target.oxygen += OXYGEN_REFILL;
    target.oxygenUpdatedAt = Date.now();
    if (!snapshot.round.oxygenGivenThisRound[actorSessionId]) {
        snapshot.round.oxygenGivenThisRound[actorSessionId] = {};
    }
    snapshot.round.oxygenGivenThisRound[actorSessionId][targetSessionId] = true;
    if (target.oxygenLeakActive) {
        target.oxygenLeakActive = false;
        target.oxygenLeakResolvedAt = Date.now();
    }

    snapshot.logs.push({
        at: Date.now(),
        text: `Player ${target.name} received +${OXYGEN_REFILL}s oxygen from ${actor.name}`,
        type: "oxygen",
    });

    snapshot.updatedAt = Date.now();

    return { ok: true, message: `Successfully gave ${OXYGEN_REFILL}s oxygen to ${target.name}` };
}

function markOxygenGivenThisRound(
    snapshot: JokerSnapshot,
    actorSessionId: string,
    targetSessionId: string
): void {
    if (!snapshot.round.oxygenGivenThisRound[actorSessionId]) {
        snapshot.round.oxygenGivenThisRound[actorSessionId] = {};
    }
    snapshot.round.oxygenGivenThisRound[actorSessionId][targetSessionId] = true;
}

function applyOxygenWithoutLeakFix(target: JokerPlayerState, amount: number, now: number): void {
    target.oxygen += amount;
    target.oxygenUpdatedAt = now;
}

export function useMonitoringPeek(
    snapshot: JokerSnapshot,
    sessionId: string
): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Location effects only available during red light" };
    }

    const actor = snapshot.players.find(p => p.sessionId === sessionId);
    if (!actor || !actor.isAlive || !actor.location) {
        return { ok: false, error: "Invalid player" };
    }

    if (actor.location !== "监控室") {
        return { ok: false, error: "Not in monitoring room" };
    }

    if (!isSoloInLocation(snapshot, sessionId, actor.location)) {
        return { ok: false, error: "Not alone in location" };
    }

    ensureRoundTracking(snapshot);
    if (snapshot.round.monitorUsedBySession[sessionId]) {
        return { ok: false, error: "Monitoring already used this round" };
    }

    const actorCamp = getCamp(actor.role);
    if (!actorCamp) {
        return { ok: false, error: "Invalid player" };
    }

    const candidates = snapshot.players.filter(p => {
        if (!p.isAlive || !p.sessionId) return false;
        if (p.sessionId === sessionId) return false;
        const camp = getCamp(p.role);
        return camp !== null && camp !== actorCamp;
    });

    if (candidates.length === 0) {
        return { ok: false, error: "No eligible target" };
    }

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    snapshot.round.monitorUsedBySession[sessionId] = true;
    snapshot.updatedAt = Date.now();
    return { ok: true, data: { lifeCode: target.lifeCode } };
}

export function usePowerBoost(
    snapshot: JokerSnapshot,
    sessionId: string
): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Location effects only available during red light" };
    }

    const actor = snapshot.players.find(p => p.sessionId === sessionId);
    if (!actor || !actor.isAlive || !actor.location) {
        return { ok: false, error: "Invalid player" };
    }

    if (actor.location !== "发电室") {
        return { ok: false, error: "Not in power room" };
    }

    if (!isSoloInLocation(snapshot, sessionId, actor.location)) {
        return { ok: false, error: "Not alone in location" };
    }

    ensureRoundTracking(snapshot);
    if (snapshot.round.powerBoostBySession[sessionId]) {
        return { ok: false, error: "Power boost already used this round" };
    }
    snapshot.round.powerBoostBySession[sessionId] = true;
    snapshot.round.powerBoostActiveBySession[sessionId] = true;
    snapshot.updatedAt = Date.now();
    return { ok: true };
}

export function useKitchenOxygen(
    snapshot: JokerSnapshot,
    sessionId: string
): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Location effects only available during red light" };
    }

    const actor = snapshot.players.find(p => p.sessionId === sessionId);
    if (!actor || !actor.isAlive || !actor.location) {
        return { ok: false, error: "Invalid player" };
    }

    if (actor.location !== "厨房") {
        return { ok: false, error: "Not in kitchen" };
    }

    if (!isSoloInLocation(snapshot, sessionId, actor.location)) {
        return { ok: false, error: "Not alone in location" };
    }

    ensureRoundTracking(snapshot);
    if (snapshot.round.kitchenUsedBySession[sessionId]) {
        return { ok: false, error: "Kitchen already used this round" };
    }

    if (snapshot.round.oxygenGivenThisRound[sessionId]?.[sessionId]) {
        return { ok: false, error: "Already gave oxygen to this player this round" };
    }

    const now = Date.now();
    applyOxygenWithoutLeakFix(actor, OXYGEN_REFILL, now);
    markOxygenGivenThisRound(snapshot, sessionId, sessionId);
    snapshot.round.kitchenUsedBySession[sessionId] = true;

    snapshot.logs.push({
        at: now,
        text: `Player ${actor.name} used kitchen oxygen +${OXYGEN_REFILL}s`,
        type: "oxygen",
    });

    snapshot.updatedAt = now;
    return { ok: true };
}

export function useMedicalOxygen(
    snapshot: JokerSnapshot,
    sessionId: string,
    targetSessionId?: string
): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Location effects only available during red light" };
    }

    const actor = snapshot.players.find(p => p.sessionId === sessionId);
    if (!actor || !actor.isAlive || !actor.location) {
        return { ok: false, error: "Invalid player" };
    }

    if (actor.location !== "医务室") {
        return { ok: false, error: "Not in medical room" };
    }

    if (!isSoloInLocation(snapshot, sessionId, actor.location)) {
        return { ok: false, error: "Not alone in location" };
    }

    ensureRoundTracking(snapshot);
    if (snapshot.round.medicalUsedBySession[sessionId]) {
        return { ok: false, error: "Medical already used this round" };
    }

    if (!targetSessionId || targetSessionId === sessionId) {
        return { ok: false, error: "Invalid target" };
    }

    const target = snapshot.players.find(p => p.sessionId === targetSessionId);
    if (!target || !target.isAlive) {
        return { ok: false, error: "Invalid target" };
    }

    if (snapshot.round.oxygenGivenThisRound[sessionId]?.[targetSessionId]) {
        return { ok: false, error: "Already gave oxygen to this player this round" };
    }

    const now = Date.now();
    applyOxygenWithoutLeakFix(target, OXYGEN_REFILL, now);
    markOxygenGivenThisRound(snapshot, sessionId, targetSessionId);
    snapshot.round.medicalUsedBySession[sessionId] = true;

    snapshot.logs.push({
        at: now,
        text: `Player ${target.name} received +${OXYGEN_REFILL}s oxygen from ${actor.name}`,
        type: "oxygen",
    });

    snapshot.updatedAt = now;
    return { ok: true };
}

export function useWarehouseOxygen(
    snapshot: JokerSnapshot,
    sessionId: string
): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Location effects only available during red light" };
    }

    const actor = snapshot.players.find(p => p.sessionId === sessionId);
    if (!actor || !actor.isAlive || !actor.location) {
        return { ok: false, error: "Invalid player" };
    }

    if (actor.location !== "仓库") {
        return { ok: false, error: "Not in warehouse" };
    }

    if (!isSoloInLocation(snapshot, sessionId, actor.location)) {
        return { ok: false, error: "Not alone in location" };
    }

    ensureRoundTracking(snapshot);
    if (snapshot.round.warehouseUsedBySession[sessionId]) {
        return { ok: false, error: "Warehouse already used this round" };
    }

    const now = Date.now();
    for (const player of snapshot.players) {
        if (!player.isAlive || !player.sessionId) continue;
        applyOxygenWithoutLeakFix(player, WAREHOUSE_OXYGEN_REFILL, now);
    }

    snapshot.round.warehouseUsedBySession[sessionId] = true;
    snapshot.logs.push({
        at: now,
        text: `Player ${actor.name} used warehouse oxygen +${WAREHOUSE_OXYGEN_REFILL}s`,
        type: "oxygen",
    });

    snapshot.updatedAt = now;
    return { ok: true };
}

export function failLocationEffect(
    snapshot: JokerSnapshot,
    sessionId: string
): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Location effects only available during red light" };
    }

    const actor = snapshot.players.find(p => p.sessionId === sessionId);
    if (!actor || !actor.isAlive || !actor.location) {
        return { ok: false, error: "Invalid player" };
    }

    if (!isSoloInLocation(snapshot, sessionId, actor.location)) {
        return { ok: false, error: "Not alone in location" };
    }

    ensureRoundTracking(snapshot);

    switch (actor.location) {
        case "监控室":
            if (snapshot.round.monitorUsedBySession[sessionId]) {
                return { ok: false, error: "Monitoring already used this round" };
            }
            snapshot.round.monitorUsedBySession[sessionId] = true;
            break;
        case "发电室":
            if (snapshot.round.powerBoostBySession[sessionId]) {
                return { ok: false, error: "Power boost already used this round" };
            }
            snapshot.round.powerBoostBySession[sessionId] = true;
            break;
        case "厨房":
            if (snapshot.round.kitchenUsedBySession[sessionId]) {
                return { ok: false, error: "Kitchen already used this round" };
            }
            snapshot.round.kitchenUsedBySession[sessionId] = true;
            break;
        case "医务室":
            if (snapshot.round.medicalUsedBySession[sessionId]) {
                return { ok: false, error: "Medical already used this round" };
            }
            snapshot.round.medicalUsedBySession[sessionId] = true;
            break;
        case "仓库":
            if (snapshot.round.warehouseUsedBySession[sessionId]) {
                return { ok: false, error: "Warehouse already used this round" };
            }
            snapshot.round.warehouseUsedBySession[sessionId] = true;
            break;
        default:
            return { ok: false, error: "Invalid location" };
    }

    snapshot.updatedAt = Date.now();
    return { ok: true };
}

// ============ Oxygen Tick ============

export function tickOxygen(snapshot: JokerSnapshot): void {
    const now = Date.now();
    for (const player of snapshot.players) {
        if (player.isAlive && player.sessionId) {
            const drain = player.oxygenLeakActive ? OXYGEN_DRAIN_LEAK : OXYGEN_DRAIN_NORMAL;
            player.oxygen = Math.max(0, player.oxygen - drain);
            player.oxygenUpdatedAt = now;
        }
    }
    snapshot.updatedAt = now;
}

export function checkOxygenDeath(snapshot: JokerSnapshot): JokerPlayerState[] {
    const deaths: JokerPlayerState[] = [];
    const now = Date.now();

    for (const player of snapshot.players) {
        if (!player.isAlive || !player.sessionId) continue;

        if (player.oxygen <= 0) {
            if (player.role === "duck" && !player.duckEmergencyUsed) {
                // Duck gets emergency oxygen (one-time)
                player.oxygen = DUCK_EMERGENCY_OXYGEN;
                player.oxygenUpdatedAt = now;
                player.duckEmergencyUsed = true;

                snapshot.logs.push({
                    at: now,
                    text: `Player ${player.name} used emergency oxygen`,
                    type: "oxygen",
                });
            } else if (player.role === "hawk" && !player.hawkEmergencyUsed) {
                // Hawk gets emergency oxygen (one-time)
                player.oxygen = HAWK_EMERGENCY_OXYGEN;
                player.oxygenUpdatedAt = now;
                player.hawkEmergencyUsed = true;

                snapshot.logs.push({
                    at: now,
                    text: `Player ${player.name} used emergency oxygen`,
                    type: "oxygen",
                });
            } else {
                // Player dies
                player.isAlive = false;
                player.oxygenLeakActive = false;
                deaths.push(player);

                // Create death record for oxygen death
                snapshot.deaths.push({
                    sessionId: player.sessionId,
                    seat: player.seat,
                    name: player.name,
                    role: player.role!,
                    reason: "oxygen",
                    location: player.location ?? undefined,
                    round: snapshot.roundCount,
                    at: now,
                    revealed: false,
                });

                snapshot.logs.push({
                    at: now,
                    text: `Player ${player.name} died from oxygen depletion`,
                    type: "death",
                });
            }
        }
    }

    snapshot.updatedAt = now;
    return deaths;
}

// ============ Meeting & Voting ============

export function startMeeting(
    snapshot: JokerSnapshot,
    reporterSessionId: string,
    bodySessionId?: string,
    triggerType: "player" | "system" = "player"
): ActionResult {
    const reporter = snapshot.players.find(p => p.sessionId === reporterSessionId);
    if (!reporter || !reporter.isAlive) {
        return { ok: false, error: "Invalid reporter" };
    }

    // Count unrevealed deaths before revealing them
    const unrevealedDeathCount = snapshot.deaths.filter(d => !d.revealed).length;

    // Reveal all unrevealed deaths when entering meeting
    const now = Date.now();
    for (const death of snapshot.deaths) {
        if (!death.revealed) {
            death.revealed = true;
            death.revealedAt = now;
        }
    }

    snapshot.phase = "meeting";
    snapshot.meeting = {
        reporterSessionId,
        bodySessionId,
        discussionEndAt: now + PHASE_DURATIONS.meeting,
        triggerType,
        triggerPlayerName: triggerType === "player" ? reporter.name : undefined,
        triggerPlayerSeat: triggerType === "player" ? reporter.seat : undefined,
        deathCount: unrevealedDeathCount,
    };

    // Reset voting state
    snapshot.voting = {
        votes: [],
        tally: {},
        skipCount: 0,
    };
    if (snapshot.tasks) {
        snapshot.tasks.sharedByLocation = undefined;
        snapshot.tasks.emergencyByLocation = undefined;
    }

    // Reset player vote state
    for (const player of snapshot.players) {
        player.hasVoted = false;
        player.voteTarget = null;
    }

    snapshot.deadline = snapshot.meeting.discussionEndAt;
    snapshot.updatedAt = now;

    return { ok: true };
}

export function transitionToVoting(snapshot: JokerSnapshot): void {
    snapshot.phase = "voting";
    snapshot.deadline = Date.now() + PHASE_DURATIONS.voting;
    snapshot.updatedAt = Date.now();
}

export function extendMeeting(snapshot: JokerSnapshot, ms: number): ActionResult {
    if (snapshot.phase !== "meeting" || !snapshot.meeting) {
        return { ok: false, error: "Meeting not active" };
    }
    if (snapshot.meeting.discussionEndAt === undefined) {
        return { ok: false, error: "Discussion end time not set" };
    }
    snapshot.meeting.discussionEndAt += ms;
    snapshot.deadline = snapshot.meeting.discussionEndAt;
    snapshot.updatedAt = Date.now();
    return { ok: true };
}

export function extendVoting(snapshot: JokerSnapshot, ms: number): ActionResult {
    if (snapshot.phase !== "voting") {
        return { ok: false, error: "Voting not active" };
    }
    const base = snapshot.deadline && snapshot.deadline > Date.now()
        ? snapshot.deadline
        : Date.now();
    snapshot.deadline = base + ms;
    snapshot.updatedAt = Date.now();
    return { ok: true };
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
            const now = Date.now();
            executed.isAlive = false;
            executedRole = executed.role;

            // Create death record for vote execution (immediately revealed)
            snapshot.deaths.push({
                sessionId: executedSessionId,
                seat: executed.seat,
                name: executed.name,
                role: executed.role!,
                reason: "vote",
                round: snapshot.roundCount,
                at: now,
                revealed: true,
                revealedAt: now,
            });

            snapshot.logs.push({
                at: now,
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

    // Save voting history for review
    snapshot.votingHistory.push({
        round: snapshot.roundCount,
        votes: [...snapshot.voting.votes],
        tally: { ...tally },
        skipCount,
        executedSessionId,
        executedRole,
        reason,
        at: Date.now(),
    });

    snapshot.phase = "execution";
    snapshot.deadline = Date.now() + PHASE_DURATIONS.execution;
    snapshot.updatedAt = Date.now();

    return { ok: true };
}

// ============ Win Condition ============

export function checkWinCondition(snapshot: JokerSnapshot): JokerGameResult | null {
    if (snapshot.execution?.executedRole === "dodo" && snapshot.execution.reason === "vote") {
        return { winner: "dodo", reason: "呆呆鸟被投票淘汰" };
    }

    const alivePlayers = snapshot.players.filter(p => p.isAlive && p.sessionId);
    const aliveDucks = alivePlayers.filter(p => p.role === "duck");
    const aliveGeese = alivePlayers.filter(p => p.role === "goose");
    const aliveHawks = alivePlayers.filter(p => p.role === "hawk");
    const aliveDodos = alivePlayers.filter(p => p.role === "dodo");

    if (aliveHawks.length === 1) {
        if (alivePlayers.length === 1) {
            return { winner: "hawk", reason: "猎鹰存活到最后" };
        }
        if (
            alivePlayers.length === 2 &&
            aliveGeese.length === 1 &&
            aliveDucks.length === 0 &&
            aliveDodos.length === 0
        ) {
            return { winner: "hawk", reason: "猎鹰存活到最后" };
        }
    }

    // Goose win: task progress reaches 100%
    if (snapshot.taskProgress >= 100 && aliveGeese.length > 0) {
        return { winner: "goose", reason: "任务完成度达到100%" };
    }

    // Goose win: all ducks dead
    if (aliveDucks.length === 0 && aliveGeese.length > 0) {
        return { winner: "goose", reason: "所有鸭子已被淘汰" };
    }

    // Duck win: all geese dead
    if (aliveDucks.length > 0 && aliveGeese.length === 0) {
        return { winner: "duck", reason: "所有鹅已被淘汰" };
    }

    // Duck win: ducks >= non-ducks
    const nonDuckCount = alivePlayers.length - aliveDucks.length;
    if (aliveDucks.length > 0 && aliveDucks.length >= nonDuckCount) {
        return { winner: "duck", reason: "鸭子数量超过或等于非鸭子" };
    }

    return null;
}

// ============ Task System ============

const TASK_PROGRESS_PER_COMPLETION = 2; // +2% per task
const POWER_TASK_PROGRESS_PER_COMPLETION = 3; // +3% per task with power boost (1.5x)
const TASK_OXYGEN_COST = 10; // -10s oxygen per task attempt
const SHARED_TASK_PROGRESS_PER_PARTICIPANT = 3; // +3% per participant
const SHARED_TASK_OXYGEN_COST = 10; // -10s oxygen per shared task join
export const SHARED_TASK_DURATIONS_MS: Record<JokerSharedTaskType, number> = {
    nine_grid: 10_000,
    digit_puzzle: 10_000,
};
const NINE_GRID_ICONS = ["0", "1", "2", "3", "4", "5", "6", "7", "8"];
const DIGIT_SEGMENTS: Record<number, number[]> = {
    0: [0, 1, 2, 3, 4, 5],
    1: [1, 2],
    2: [0, 1, 6, 4, 3],
    3: [0, 1, 6, 2, 3],
    4: [5, 6, 1, 2],
    5: [0, 5, 6, 2, 3],
    6: [0, 5, 6, 4, 2, 3],
    7: [0, 1, 2],
    8: [0, 1, 2, 3, 4, 5, 6],
    9: [0, 1, 2, 3, 5, 6],
};

function shuffleArray<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

export function startTask(snapshot: JokerSnapshot, sessionId: string): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Tasks can only be started during red light" };
    }

    const player = snapshot.players.find(p => p.sessionId === sessionId);
    if (!player) {
        return { ok: false, error: "Player not found" };
    }

    if (!player.isAlive) {
        return { ok: false, error: "Dead players cannot do tasks" };
    }

    // Deduct oxygen
    player.oxygen = Math.max(0, player.oxygen - TASK_OXYGEN_COST);
    player.oxygenUpdatedAt = Date.now();
    snapshot.updatedAt = Date.now();

    return { ok: true, message: `Started task, -${TASK_OXYGEN_COST}s oxygen` };
}

export function completeTask(snapshot: JokerSnapshot, sessionId: string): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Tasks can only be completed during red light" };
    }

    const player = snapshot.players.find(p => p.sessionId === sessionId);
    if (!player || !player.isAlive) {
        return { ok: false, error: "Invalid player" };
    }

    const boostActive = snapshot.round.powerBoostActiveBySession?.[sessionId];
    const inPowerRoom = player.location === "发电室";
    const soloPowerRoom = inPowerRoom && isSoloInLocation(snapshot, sessionId, "发电室");
    const progressGain = boostActive && soloPowerRoom
        ? POWER_TASK_PROGRESS_PER_COMPLETION
        : TASK_PROGRESS_PER_COMPLETION;

    snapshot.taskProgress = Math.min(100, snapshot.taskProgress + progressGain);
    snapshot.updatedAt = Date.now();

    return { ok: true, message: `Task completed! Progress: ${snapshot.taskProgress}%` };
}

// ============ Shared Task System (Scaffold) ============

export function joinSharedTask(
    snapshot: JokerSnapshot,
    sessionId: string,
    type: JokerSharedTaskType
): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Shared tasks only available during red light" };
    }

    const player = snapshot.players.find(p => p.sessionId === sessionId);
    if (!player || !player.isAlive || !player.sessionId) {
        return { ok: false, error: "Invalid player" };
    }
    if (!player.location) {
        return { ok: false, error: "Player has no location" };
    }

    if (!snapshot.tasks) snapshot.tasks = {};
    const sharedByLocation: Partial<Record<JokerLocation, JokerSharedTaskState>> = snapshot.tasks.sharedByLocation ?? {};
    const existing = sharedByLocation[player.location];
    if (existing && existing.status !== "resolved") {
        if (!existing.joined.includes(sessionId)) {
            existing.joined.push(sessionId);
            player.oxygen = Math.max(0, player.oxygen - SHARED_TASK_OXYGEN_COST);
            player.oxygenUpdatedAt = Date.now();
        }
        snapshot.tasks.sharedByLocation = sharedByLocation as Record<JokerLocation, JokerSharedTaskState>;
        snapshot.updatedAt = Date.now();
        return { ok: true };
    }
    if (existing && existing.status === "resolved") {
        delete sharedByLocation[player.location];
    }

    const participants = snapshot.players
        .filter(p => p.isAlive && p.sessionId && p.location === player.location)
        .map(p => p.sessionId!) as string[];

    if (participants.length < 2) {
        return { ok: false, error: "Not enough players for shared task" };
    }

    sharedByLocation[player.location] = {
        kind: "shared",
        type,
        location: player.location,
        status: "waiting",
        participants,
        joined: [sessionId],
    };
    snapshot.tasks.sharedByLocation = sharedByLocation as Record<JokerLocation, JokerSharedTaskState>;
    player.oxygen = Math.max(0, player.oxygen - SHARED_TASK_OXYGEN_COST);
    player.oxygenUpdatedAt = Date.now();
    snapshot.updatedAt = Date.now();

    return { ok: true };
}

export function resolveSharedTask(
    snapshot: JokerSnapshot,
    location: JokerLocation,
    success: boolean
): ActionResult {
    if (!snapshot.tasks?.sharedByLocation) {
        return { ok: false, error: "No shared task" };
    }
    const shared = snapshot.tasks.sharedByLocation[location];
    if (!shared) {
        return { ok: false, error: "No shared task" };
    }
    if (shared.status === "resolved") {
        return { ok: false, error: "Shared task already resolved" };
    }

    shared.status = "resolved";
    shared.result = success ? "success" : "fail";
    shared.resolvedAt = Date.now();

    if (success) {
        const gain = SHARED_TASK_PROGRESS_PER_PARTICIPANT * shared.participants.length;
        snapshot.taskProgress = Math.min(100, snapshot.taskProgress + gain);
    }

    snapshot.updatedAt = Date.now();
    return { ok: true };
}

function pickRandomIcon(exclude?: string): string {
    const pool = exclude ? NINE_GRID_ICONS.filter(i => i !== exclude) : NINE_GRID_ICONS;
    return pool[Math.floor(Math.random() * pool.length)];
}

export function initNineGridSharedTask(shared: JokerSharedTaskState): void {
    const participants = shared.participants;
    if (participants.length === 0) return;

    const commonIndex = Math.floor(Math.random() * 9);
    const commonIcon = pickRandomIcon();
    const gridBySession: Record<string, string[]> = {};

    for (const sessionId of participants) {
        const grid: string[] = [];
        for (let i = 0; i < 9; i++) {
            if (i === commonIndex) {
                grid.push(commonIcon);
            } else {
                grid.push(pickRandomIcon());
            }
        }
        gridBySession[sessionId] = grid;
    }

    for (let i = 0; i < 9; i++) {
        if (i === commonIndex) continue;
        const iconsAt = participants.map(id => gridBySession[id][i]);
        const unique = new Set(iconsAt);
        if (unique.size === 1) {
            const adjustId = participants[Math.floor(Math.random() * participants.length)];
            gridBySession[adjustId][i] = pickRandomIcon(iconsAt[0]);
        }
    }

    shared.commonIndex = commonIndex;
    shared.commonIcon = commonIcon;
    shared.gridBySession = gridBySession;
    shared.selections = {};
}

export function initDigitPuzzleSharedTask(shared: JokerSharedTaskState): void {
    const participants = shared.participants;
    if (participants.length === 0) return;

    const target = Math.floor(Math.random() * 10);
    const segments = DIGIT_SEGMENTS[target] ?? [];
    const segmentsBySession: Record<string, number[]> = {};
    const shuffledSegments = shuffleArray(segments);
    const shuffledParticipants = shuffleArray(participants);

    for (const id of participants) {
        segmentsBySession[id] = [];
    }

    shuffledSegments.forEach((segment, idx) => {
        const owner = shuffledParticipants[idx % shuffledParticipants.length];
        segmentsBySession[owner].push(segment);
    });

    if (segments.length > 0) {
        for (const id of participants) {
            if (segmentsBySession[id].length === 0) {
                segmentsBySession[id].push(segments[Math.floor(Math.random() * segments.length)]);
            }
        }
    }

    shared.digitTarget = target;
    shared.digitSegmentsBySession = segmentsBySession;
    shared.digitSelections = {};
}

export function submitSharedTaskChoice(
    snapshot: JokerSnapshot,
    sessionId: string,
    index: number
): ActionResult {
    const player = snapshot.players.find(p => p.sessionId === sessionId);
    if (!player || !player.location) {
        return { ok: false, error: "Invalid player" };
    }
    const shared = snapshot.tasks?.sharedByLocation?.[player.location];
    if (!shared || shared.status !== "active") {
        return { ok: false, error: "Shared task not active" };
    }
    if (!shared.participants.includes(sessionId)) {
        return { ok: false, error: "Not a participant" };
    }

    if (shared.type === "nine_grid") {
        if (!shared.gridBySession || shared.commonIndex === undefined || !shared.commonIcon) {
            return { ok: false, error: "Shared task not initialized" };
        }

        if (!shared.selections) shared.selections = {};
        if (shared.selections[sessionId] !== undefined) {
            return { ok: false, error: "Already submitted" };
        }

        shared.selections[sessionId] = index;
        const allDone = shared.participants.every(id => shared.selections?.[id] !== undefined);
        if (allDone) {
            const success = shared.participants.every(id => {
                const grid = shared.gridBySession?.[id];
                const chosen = shared.selections?.[id];
                return (
                    grid &&
                    chosen !== undefined &&
                    shared.commonIndex !== undefined &&
                    shared.commonIcon !== undefined &&
                    chosen === shared.commonIndex &&
                    grid[chosen] === shared.commonIcon
                );
            });
            return resolveSharedTask(snapshot, player.location, success);
        }

        snapshot.updatedAt = Date.now();
        return { ok: true };
    }

    if (shared.type === "digit_puzzle") {
        if (shared.digitTarget === undefined || !shared.digitSegmentsBySession) {
            return { ok: false, error: "Shared task not initialized" };
        }
        if (index < 0 || index > 9) {
            return { ok: false, error: "Invalid digit" };
        }

        if (!shared.digitSelections) shared.digitSelections = {};
        shared.digitSelections[sessionId] = index;

        const allDone = shared.participants.every(id => shared.digitSelections?.[id] !== undefined);
        if (allDone) {
            const success = shared.participants.every(id => shared.digitSelections?.[id] === shared.digitTarget);
            return resolveSharedTask(snapshot, player.location, success);
        }

        snapshot.updatedAt = Date.now();
        return { ok: true };
    }

    return { ok: false, error: "Unsupported shared task" };
}

// ============ Emergency Task System ============

function ensureEmergencyTasks(snapshot: JokerSnapshot): Partial<Record<JokerLocation, JokerEmergencyTaskState>> {
    if (!snapshot.tasks) snapshot.tasks = {};
    if (!snapshot.tasks.emergencyByLocation) {
        snapshot.tasks.emergencyByLocation = {};
    }
    return snapshot.tasks.emergencyByLocation;
}

export function initGoldenRabbitTask(
    snapshot: JokerSnapshot,
    location: JokerLocation,
    now: number
): JokerEmergencyTaskState {
    const tasks = snapshot.tasks ?? (snapshot.tasks = {});
    const emergencyByLocation = tasks.emergencyByLocation ?? (tasks.emergencyByLocation = {});
    if (emergencyByLocation[location]) {
        return emergencyByLocation[location];
    }
    const task: JokerEmergencyTaskState = {
        kind: "emergency",
        type: "golden_rabbit",
        location,
        status: "waiting",
        participants: [],
        startedAt: now,
        joinDeadlineAt: now + GOLDEN_RABBIT_JOIN_MS,
    };
    emergencyByLocation[location] = task;
    tasks.emergencyByLocation = emergencyByLocation;
    tasks.lastEmergencyAt = now;
    if (!snapshot.round.goldenRabbitTriggeredLocations.includes(location)) {
        snapshot.round.goldenRabbitTriggeredLocations.push(location);
    }
    snapshot.updatedAt = now;
    return task;
}

function initGoldenRabbitHunt(task: JokerEmergencyTaskState): void {
    const participants = task.participants;
    if (participants.length === 0) return;
    const rabbitIndex = Math.floor(Math.random() * 9);
    const available = shuffleArray(
        Array.from({ length: 9 }, (_, idx) => idx).filter(idx => idx !== rabbitIndex)
    );
    const xBySession: Record<string, number[]> = {};
    let pool = available;
    let poolIndex = 0;

    for (const id of participants) {
        const picks: number[] = [];
        while (picks.length < 2) {
            if (poolIndex >= pool.length) {
                pool = shuffleArray(available);
                poolIndex = 0;
            }
            const candidate = pool[poolIndex++];
            if (!picks.includes(candidate)) {
                picks.push(candidate);
            }
        }
        xBySession[id] = picks;
    }

    task.rabbitIndex = rabbitIndex;
    task.xBySession = xBySession;
    task.selections = {};
}

export function startGoldenRabbitHunt(task: JokerEmergencyTaskState, now: number): void {
    task.status = "active";
    task.startedAt = now;
    initGoldenRabbitHunt(task);
}

export function joinGoldenRabbitTask(
    snapshot: JokerSnapshot,
    sessionId: string
): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Golden rabbit only available during red light" };
    }

    const player = snapshot.players.find(p => p.sessionId === sessionId);
    if (!player || !player.isAlive || !player.location) {
        return { ok: false, error: "Invalid player" };
    }

    const task = snapshot.tasks?.emergencyByLocation?.[player.location];
    if (!task || task.type !== "golden_rabbit") {
        return { ok: false, error: "No golden rabbit" };
    }
    if (task.status !== "waiting") {
        return { ok: false, error: "Golden rabbit closed" };
    }
    if (task.joinDeadlineAt && Date.now() > task.joinDeadlineAt) {
        return { ok: false, error: "Golden rabbit closed" };
    }
    if (!task.participants.includes(sessionId)) {
        task.participants.push(sessionId);
        snapshot.updatedAt = Date.now();
    }
    return { ok: true };
}

export function resolveGoldenRabbitTask(
    snapshot: JokerSnapshot,
    task: JokerEmergencyTaskState,
    success: boolean
): ActionResult {
    task.status = "resolved";
    task.result = success ? "success" : "fail";
    task.resolvedAt = Date.now();
    if (success) {
        snapshot.taskProgress = Math.min(
            100,
            snapshot.taskProgress + GOLDEN_RABBIT_PROGRESS_REWARD
        );
    }
    snapshot.updatedAt = Date.now();
    return { ok: true };
}

export function submitGoldenRabbitChoice(
    snapshot: JokerSnapshot,
    sessionId: string,
    index: number
): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Golden rabbit only available during red light" };
    }
    const player = snapshot.players.find(p => p.sessionId === sessionId);
    if (!player || !player.location) {
        return { ok: false, error: "Invalid player" };
    }
    const task = snapshot.tasks?.emergencyByLocation?.[player.location];
    if (!task || task.type !== "golden_rabbit") {
        return { ok: false, error: "No golden rabbit" };
    }
    if (task.status !== "active") {
        return { ok: false, error: "Golden rabbit not active" };
    }
    if (task.rabbitIndex === undefined || !task.xBySession) {
        return { ok: false, error: "Golden rabbit not initialized" };
    }
    if (!task.participants.includes(sessionId)) {
        return { ok: false, error: "Not a participant" };
    }
    if (index < 0 || index > 8) {
        return { ok: false, error: "Invalid index" };
    }
    if (!task.selections) task.selections = {};
    if (task.selections[sessionId] !== undefined) {
        return { ok: false, error: "Already submitted" };
    }
    const blocked = task.xBySession?.[sessionId] ?? [];
    if (blocked.includes(index)) {
        return { ok: false, error: "Blocked cell" };
    }

    task.selections[sessionId] = index;
    const allDone = task.participants.every(id => task.selections?.[id] !== undefined);
    if (allDone) {
        const success = Object.values(task.selections).some(sel => sel === task.rabbitIndex);
        return resolveGoldenRabbitTask(snapshot, task, success);
    }

    snapshot.updatedAt = Date.now();
    return { ok: true };
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

    if (snapshot.tasks) {
        snapshot.tasks.sharedByLocation = undefined;
        snapshot.tasks.emergencyByLocation = undefined;
    }

    // Update locations based on alive count
    const aliveCount = snapshot.players.filter(p => p.isAlive && p.sessionId).length;
    snapshot.activeLocations = computeLocations(aliveCount);

    // Reset round-specific player state
    const now = Date.now();
    for (const player of snapshot.players) {
        player.targetLocation = null;
        player.location = null;
        // Reset oxygen timestamp so frontend calculates from green light start
        player.oxygenUpdatedAt = now;
        player.oxygenLeakActive = false;
        player.oxygenLeakStartedAt = undefined;
        player.oxygenLeakResolvedAt = undefined;
        player.oxygenLeakRound = undefined;
    }
    snapshot.round.oxygenGivenThisRound = {};
    snapshot.round.goldenRabbitTriggeredLocations = [];
    snapshot.round.powerBoostBySession = {};
    snapshot.round.powerBoostActiveBySession = {};
    snapshot.round.warehouseUsedBySession = {};
    snapshot.round.monitorUsedBySession = {};
    snapshot.round.kitchenUsedBySession = {};
    snapshot.round.medicalUsedBySession = {};

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

    // 记录当前回合每个场所的玩家座位号
    const roundLocations: Record<string, number[]> = {};
    for (const loc of snapshot.activeLocations) {
        roundLocations[loc] = [];
    }
    for (const player of snapshot.players) {
        if (player.isAlive && player.location) {
            if (!roundLocations[player.location]) {
                roundLocations[player.location] = [];
            }
            roundLocations[player.location].push(player.seat);
        }
    }
    // 按座位号排序
    for (const loc of Object.keys(roundLocations)) {
        roundLocations[loc].sort((a, b) => a - b);
    }
    snapshot.locationHistory[snapshot.roundCount] = roundLocations as Record<JokerLocation, number[]>;

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
    snapshot.deaths = [];
    snapshot.taskProgress = 0;
    snapshot.tasks = createEmptyTaskSystem();
    snapshot.paused = false;
    snapshot.pauseRemainingMs = undefined;

    const resetCodes = generateUniqueLifeCodes(snapshot.players.length);
    for (const [idx, player] of snapshot.players.entries()) {
        player.role = null;
        player.isAlive = true;
        player.isReady = false;
        player.location = null;
        player.targetLocation = null;
        player.oxygen = INITIAL_OXYGEN;
        player.oxygenUpdatedAt = Date.now();
        player.duckEmergencyUsed = false;
        player.hawkEmergencyUsed = false;
        player.oxygenLeakActive = false;
        player.oxygenLeakStartedAt = undefined;
        player.oxygenLeakResolvedAt = undefined;
        player.oxygenLeakRound = undefined;
        player.hasVoted = false;
        player.voteTarget = null;
        player.lifeCode = resetCodes[idx];
        player.lifeCodeVersion = 1;
    }

    snapshot.updatedAt = Date.now();
}
