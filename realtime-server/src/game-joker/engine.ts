// realtime-server/src/game-joker/engine.ts

import type {
    JokerSnapshot,
    JokerPlayerState,
    JokerPhase,
    JokerRole,
    JokerRoleTemplate,
    JokerLocation,
    JokerLifeCodeState,
    JokerRoundState,
    JokerGameResult,
    JokerSharedTaskType,
    JokerSharedTaskState,
    JokerEmergencyTaskState,
    JokerTaskSystemState,
    JokerOxygenState,
    SelectLocationPayload,
    SubmitLifeCodeActionPayload,
    SubmitVotePayload,
    GhostSelectLocationPayload,
    GhostHauntPayload,
    ActionResult,
} from "./types.js";

const MAX_SEATS = 16;
const INITIAL_OXYGEN = 180;
const OXYGEN_REFILL = 60;
const WAREHOUSE_OXYGEN_REFILL = 40;
const EMERGENCY_OXYGEN = 120;
const OXYGEN_DRAIN_NORMAL = 1;
const OXYGEN_DRAIN_LEAK = 3;
const GOLDEN_RABBIT_PROGRESS_REWARD = 9;
export const GOLDEN_RABBIT_JOIN_MS = 8_000;

// Meeting duration calculation: base + per_player * alive_count
const MEETING_BASE_DURATION = 60_000;
const MEETING_PER_PLAYER_DURATION = 30_000;

// Phase durations in milliseconds
export const PHASE_DURATIONS = {
    role_reveal: 10_000,
    green_light: 15_000,
    yellow_light: 15_000,
    red_light: 60_000,
    voting: 30_000,
    execution: 10_000,
};


// ============ Oxygen State Helpers ============

function createOxygenState(baseOxygen: number, drainRate: number, timestamp?: number): JokerOxygenState {
    return {
        baseOxygen,
        drainRate,
        baseTimestamp: timestamp ?? Date.now(),
    };
}

/** Calculate current oxygen value from oxygen state */
export function getCurrentOxygen(state: JokerOxygenState): number {
    const elapsed = (Date.now() - state.baseTimestamp) / 1000;
    return Math.max(0, Math.floor(state.baseOxygen - state.drainRate * elapsed));
}

/** Add oxygen to a player (e.g., +90s refill) */
function addOxygen(player: JokerPlayerState, amount: number): void {
    const current = getCurrentOxygen(player.oxygenState);
    player.oxygenState = createOxygenState(
        current + amount,
        player.oxygenState.drainRate
    );
}

/** Deduct oxygen from a player (e.g., -10s for task) */
function deductOxygen(player: JokerPlayerState, amount: number): void {
    const current = getCurrentOxygen(player.oxygenState);
    player.oxygenState = createOxygenState(
        Math.max(0, current - amount),
        player.oxygenState.drainRate
    );
}

/** Set oxygen drain rate (1=normal, 3=leak, 0=paused) */
export function setOxygenDrainRate(player: JokerPlayerState, drainRate: number): void {
    const current = getCurrentOxygen(player.oxygenState);
    player.oxygenState = createOxygenState(current, drainRate);
}

/** Reset oxygen to a specific value with drain rate (default=0 for paused) */
function resetOxygen(player: JokerPlayerState, oxygen: number, drainRate: number = 0): void {
    player.oxygenState = createOxygenState(oxygen, drainRate);
}

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
        oxygenState: createOxygenState(INITIAL_OXYGEN, OXYGEN_DRAIN_NORMAL),
        duckEmergencyUsed: false,
        hawkEmergencyUsed: false,
        woodpeckerEmergencyUsed: false,
        poisonerDuckEmergencyUsed: false,
        saboteurDuckEmergencyUsed: false,
        oxygenLeakActive: false,
        oxygenLeakStartedAt: undefined,
        oxygenLeakResolvedAt: undefined,
        oxygenLeakRound: undefined,
        hasVoted: false,
        voteTarget: null,
        // Ghost fields
        ghostTargetLocation: null,
        ghostAssignedLocation: null,
        hauntingTarget: null,
        // Stasis fields
        inStasis: false,
        // Oxygen tracking
        lastOxygenGiverSessionId: null,
    };
}

function createEmptyLifeCodeState(): JokerLifeCodeState {
    return {
        current: {},
        version: 0,
        lastUpdatedAt: Date.now(),
    };
}

function createEmptyRoundState(): JokerRoundState {
    return {
        roundCount: 0,
        phaseStartAt: Date.now(),
        oxygenGivenThisRound: {},
        goldenRabbitTriggeredLocations: [],
        arrivedBySession: {},
        powerBoostBySession: {},
        powerBoostActiveBySession: {},
        warehouseUsedBySession: {},
        monitorUsedBySession: {},
        kitchenUsedBySession: {},
        medicalUsedBySession: {},
        // New location effects
        dispatchUsedBySession: {},
        stasisActiveBySession: {},
        randomDispatchNextRound: false,
        randomDispatchInitiatorSessionId: null,
        // Special role tracking
        taskContributionBySession: {},
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

// Simple template: original role configuration (no special roles)
const SIMPLE_ROLE_COUNTS: Record<number, { goose: number; duck: number; dodo: number; hawk: number }> = {
    5: { goose: 4, duck: 1, dodo: 0, hawk: 0 },
    6: { goose: 4, duck: 1, dodo: 1, hawk: 0 },
    7: { goose: 4, duck: 2, dodo: 1, hawk: 0 },
    8: { goose: 4, duck: 2, dodo: 1, hawk: 1 },
    9: { goose: 5, duck: 2, dodo: 1, hawk: 1 },
    10: { goose: 6, duck: 2, dodo: 1, hawk: 1 },
    11: { goose: 6, duck: 3, dodo: 1, hawk: 1 },
    12: { goose: 7, duck: 3, dodo: 1, hawk: 1 },
    13: { goose: 8, duck: 3, dodo: 1, hawk: 1 },
    14: { goose: 8, duck: 4, dodo: 1, hawk: 1 },
    15: { goose: 9, duck: 4, dodo: 1, hawk: 1 },
    16: { goose: 10, duck: 4, dodo: 1, hawk: 1 },
};

// Special template configuration
interface SpecialRoleConfig {
    baseGoose: number;           // 普通鹅数量
    specialGooseKinds: number;   // 随机特殊鹅种类数 (0 = 无特殊鹅)
    baseDuck: number;            // 普通鸭数量
    poisonerDuck: number;        // 毒师鸭数量
    saboteurDuck: number;        // 糊弄鸭数量
    dodo: number;                // 呆呆鸟数量
    neutralBird: "none" | "random" | "both";  // 猎鹰/啄木鸟: none=无, random=随机1个, both=都有
}

const SPECIAL_ROLE_COUNTS: Record<number, SpecialRoleConfig> = {
    5: { baseGoose: 4, specialGooseKinds: 0, baseDuck: 1, poisonerDuck: 0, saboteurDuck: 0, dodo: 0, neutralBird: "none" },
    6: { baseGoose: 4, specialGooseKinds: 0, baseDuck: 1, poisonerDuck: 0, saboteurDuck: 0, dodo: 1, neutralBird: "none" },
    7: { baseGoose: 4, specialGooseKinds: 0, baseDuck: 2, poisonerDuck: 0, saboteurDuck: 0, dodo: 1, neutralBird: "none" },
    8: { baseGoose: 4, specialGooseKinds: 0, baseDuck: 1, poisonerDuck: 1, saboteurDuck: 0, dodo: 1, neutralBird: "random" },
    9: { baseGoose: 3, specialGooseKinds: 2, baseDuck: 1, poisonerDuck: 1, saboteurDuck: 0, dodo: 1, neutralBird: "random" },
    10: { baseGoose: 4, specialGooseKinds: 2, baseDuck: 0, poisonerDuck: 1, saboteurDuck: 1, dodo: 1, neutralBird: "random" },
    11: { baseGoose: 4, specialGooseKinds: 3, baseDuck: 0, poisonerDuck: 1, saboteurDuck: 1, dodo: 1, neutralBird: "random" },
    12: { baseGoose: 4, specialGooseKinds: 3, baseDuck: 1, poisonerDuck: 1, saboteurDuck: 1, dodo: 1, neutralBird: "random" },
    13: { baseGoose: 5, specialGooseKinds: 3, baseDuck: 1, poisonerDuck: 1, saboteurDuck: 1, dodo: 1, neutralBird: "random" },
    14: { baseGoose: 5, specialGooseKinds: 4, baseDuck: 1, poisonerDuck: 1, saboteurDuck: 1, dodo: 1, neutralBird: "random" },
    15: { baseGoose: 5, specialGooseKinds: 4, baseDuck: 1, poisonerDuck: 1, saboteurDuck: 1, dodo: 1, neutralBird: "both" },
    16: { baseGoose: 6, specialGooseKinds: 4, baseDuck: 1, poisonerDuck: 1, saboteurDuck: 1, dodo: 1, neutralBird: "both" },
};

const ALL_SPECIAL_GOOSE_ROLES: JokerRole[] = ["vigilante_goose", "sheriff_goose", "coroner_goose", "overseer_goose"];

/**
 * 生成特殊鹅角色列表
 * @param kinds 需要随机选择的特殊鹅种类数 (2/3/4)
 * @param targetCount 需要填满的特殊鹅总数
 * @returns 特殊鹅角色列表，总数等于 targetCount
 */
function generateSpecialGooseRoles(kinds: number, targetCount: number): JokerRole[] {
    if (kinds === 0 || targetCount === 0) return [];

    // 1. 随机选择 kinds 种特殊鹅类型
    const selectedTypes = shuffleArray([...ALL_SPECIAL_GOOSE_ROLES]).slice(0, Math.min(kinds, ALL_SPECIAL_GOOSE_ROLES.length));

    // 2. 初始化每种类型的数量为0
    const typeCounts: Map<JokerRole, number> = new Map();
    for (const type of selectedTypes) {
        typeCounts.set(type, 0);
    }

    // 3. 随机分配 targetCount 个位置，每种最多2只
    let remaining = targetCount;
    const maxPerType = 2;

    // 先随机分配，确保每种不超过2只
    while (remaining > 0) {
        // 找出还能分配的类型（当前数量 < 2）
        const availableTypes = selectedTypes.filter(t => (typeCounts.get(t) ?? 0) < maxPerType);

        if (availableTypes.length === 0) {
            // 所有类型都已满2只，但还有剩余位置
            // 这种情况不应该发生（kinds * 2 >= targetCount），但以防万一
            console.warn(`[generateSpecialGooseRoles] Cannot fill all ${targetCount} slots with ${kinds} types (max 2 each)`);
            break;
        }

        // 随机选一个类型加1只
        const randomType = availableTypes[Math.floor(Math.random() * availableTypes.length)];
        typeCounts.set(randomType, (typeCounts.get(randomType) ?? 0) + 1);
        remaining--;
    }

    // 4. 生成结果数组
    const result: JokerRole[] = [];
    for (const [type, count] of typeCounts) {
        for (let i = 0; i < count; i++) {
            result.push(type);
        }
    }

    return result;
}

/**
 * 为特殊模版生成角色列表
 */
function generateSpecialTemplateRoles(playerCount: number): JokerRole[] | null {
    const config = SPECIAL_ROLE_COUNTS[playerCount];
    if (!config) return null;

    const roles: JokerRole[] = [];

    // 1. 添加普通鸭
    for (let i = 0; i < config.baseDuck; i++) roles.push("duck");

    // 2. 添加毒师鸭
    for (let i = 0; i < config.poisonerDuck; i++) roles.push("poisoner_duck");

    // 3. 添加糊弄鸭
    for (let i = 0; i < config.saboteurDuck; i++) roles.push("saboteur_duck");

    // 4. 添加呆呆鸟
    for (let i = 0; i < config.dodo; i++) roles.push("dodo");

    // 5. 添加猎鹰/啄木鸟
    if (config.neutralBird === "random") {
        // 随机选择一个
        roles.push(Math.random() < 0.5 ? "hawk" : "woodpecker");
    } else if (config.neutralBird === "both") {
        roles.push("hawk");
        roles.push("woodpecker");
    }
    // "none" 时不添加

    // 6. 添加固定数量的普通鹅
    for (let i = 0; i < config.baseGoose; i++) roles.push("goose");

    // 7. 计算剩余位置（用于特殊鹅）
    const filledCount = roles.length;
    const specialGooseCount = playerCount - filledCount;

    if (specialGooseCount < 0) {
        console.error(`[generateSpecialTemplateRoles] Role count exceeds player count: ${filledCount} > ${playerCount}`);
        return null;
    }

    // 8. 生成特殊鹅（凑满剩余位置）
    if (specialGooseCount > 0 && config.specialGooseKinds > 0) {
        const specialGooseRoles = generateSpecialGooseRoles(config.specialGooseKinds, specialGooseCount);
        roles.push(...specialGooseRoles);
    }

    return roles;
}

export function assignJokerRoles(snapshot: JokerSnapshot, template: JokerRoleTemplate = "simple"): ActionResult {
    const alivePlayers = snapshot.players.filter(p => p.sessionId);
    const playerCount = alivePlayers.length;

    if (playerCount < 5) {
        return { ok: false, error: "Need at least 5 players to start" };
    }

    let roles: JokerRole[];

    if (template === "special") {
        const specialRoles = generateSpecialTemplateRoles(playerCount);
        if (!specialRoles) {
            return { ok: false, error: "Unsupported player count for special template" };
        }
        roles = specialRoles;
    } else {
        // Simple template
        const roleConfig = SIMPLE_ROLE_COUNTS[playerCount];
        if (!roleConfig) {
            return { ok: false, error: "Unsupported player count" };
        }
        roles = [
            ...Array(roleConfig.duck).fill("duck"),
            ...Array(roleConfig.goose).fill("goose"),
            ...Array(roleConfig.hawk).fill("hawk"),
            ...Array(roleConfig.dodo).fill("dodo"),
        ];
    }

    if (roles.length !== playerCount) {
        return { ok: false, error: `Role count mismatch: ${roles.length} roles for ${playerCount} players` };
    }

    // Store the template used
    snapshot.roleTemplate = template;

    const shuffledPlayers = [...alivePlayers].sort(() => Math.random() - 0.5);
    const shuffledRoles = shuffleArray(roles);

    for (let i = 0; i < shuffledPlayers.length; i++) {
        const player = snapshot.players.find(p => p.seat === shuffledPlayers[i].seat);
        if (player) {
            player.role = shuffledRoles[i] ?? "goose";
            player.isAlive = true;
            resetOxygen(player, INITIAL_OXYGEN);
            player.duckEmergencyUsed = false;
            player.hawkEmergencyUsed = false;
            player.woodpeckerEmergencyUsed = false;
            // Reset special role state
            player.vigilanteKillUsed = false;
        }
    }

    // Generate initial life codes
    generateAllLifeCodes(snapshot);

    // Compute initial locations
    snapshot.activeLocations = computeLocations(playerCount);

    snapshot.updatedAt = Date.now();

    // Log role assignment for debugging
    console.log(`[JokerGame] Role assignment complete (template: ${template})`);
    console.log(`[JokerGame] Players: ${playerCount}`);
    const roleDistribution: Record<string, number> = {};
    for (const role of shuffledRoles) {
        roleDistribution[role] = (roleDistribution[role] || 0) + 1;
    }
    console.log(`[JokerGame] Role distribution:`, JSON.stringify(roleDistribution));
    for (const player of snapshot.players.filter(p => p.sessionId)) {
        const isBot = player.sessionId?.startsWith('BOT_') ? ' [BOT]' : '';
        console.log(`[JokerGame]   Seat ${player.seat}: ${player.name}${isBot} -> ${player.role}`);
    }

    return { ok: true };
}

// ============ Location System ============

const ALL_LOCATIONS: JokerLocation[] = ["厨房", "医务室", "发电室", "监控室", "仓库", "调度室", "休眠舱"];

// Player count -> location count mapping
const LOCATION_COUNT_BY_PLAYERS: Record<number, number> = {
    3: 2, 4: 2,
    5: 3, 6: 3,
    7: 4, 8: 4,
    9: 5, 10: 5,
    11: 6, 12: 6, 13: 6,
    14: 7, 15: 7, 16: 7,
};

export function computeLocations(aliveCount: number): JokerLocation[] {
    const count = LOCATION_COUNT_BY_PLAYERS[aliveCount] ?? Math.min(7, Math.ceil(aliveCount / 2));
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

    const assignments: Map<JokerLocation, JokerPlayerState[]> = new Map();
    for (const loc of locations) {
        assignments.set(loc, []);
    }

    // Check if random dispatch is active (from dispatch room effect)
    if (snapshot.round.randomDispatchNextRound) {
        // Random dispatch: ignore preferences for others, but initiator goes to their chosen location
        const initiatorSessionId = snapshot.round.randomDispatchInitiatorSessionId;
        const initiator = initiatorSessionId
            ? alivePlayers.find(p => p.sessionId === initiatorSessionId)
            : null;

        // First: assign initiator to their preferred location (if valid)
        if (initiator && initiator.targetLocation && locations.includes(initiator.targetLocation)) {
            assignments.get(initiator.targetLocation)!.push(initiator);
        }

        // Get other players (excluding initiator if already assigned)
        const otherPlayers = alivePlayers.filter(p => {
            if (initiator && p.sessionId === initiator.sessionId) {
                return !initiator.targetLocation || !locations.includes(initiator.targetLocation);
            }
            return true;
        });
        const shuffledPlayers = shuffleArray([...otherPlayers]);
        let playerIndex = 0;

        // Second pass: ensure each location has at least 1 player
        for (const loc of locations) {
            if (assignments.get(loc)!.length === 0 && playerIndex < shuffledPlayers.length) {
                assignments.get(loc)!.push(shuffledPlayers[playerIndex]);
                playerIndex++;
            }
        }

        // Third pass: distribute remaining players (up to max 3 per location)
        while (playerIndex < shuffledPlayers.length) {
            // Find location with fewest players (under max 3)
            let minLoc = locations[0];
            let minCount = assignments.get(minLoc)!.length;

            for (const loc of locations) {
                const count = assignments.get(loc)!.length;
                if (count < minCount && count < 3) {
                    minLoc = loc;
                    minCount = count;
                }
            }

            assignments.get(minLoc)!.push(shuffledPlayers[playerIndex]);
            playerIndex++;
        }

        // Reset the flags
        snapshot.round.randomDispatchNextRound = false;
        snapshot.round.randomDispatchInitiatorSessionId = null;
    } else {
        // Normal assignment: respect player preferences

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

        // First pass: assign players with preferences (up to max 3)
        // Shuffle each location's players to randomize who gets overflow
        for (const [loc, players] of preferences) {
            const shuffledPlayers = shuffleArray([...players]);
            const toAssign = shuffledPlayers.slice(0, 3);
            for (const p of toAssign) {
                assignments.get(loc)!.push(p);
            }
            // Overflow goes to no preference
            for (let i = 3; i < shuffledPlayers.length; i++) {
                noPreference.push(shuffledPlayers[i]);
            }
        }

        // Shuffle noPreference for random assignment to empty locations
        const shuffledNoPreference = shuffleArray([...noPreference]);
        noPreference.length = 0;
        noPreference.push(...shuffledNoPreference);

        // Second pass: ensure each location has at least 1 player
        for (const loc of locations) {
            if (assignments.get(loc)!.length === 0 && noPreference.length > 0) {
                const player = noPreference.shift()!;
                assignments.get(loc)!.push(player);
            }
        }

        // Third pass: distribute remaining players
        for (const player of noPreference) {
            // Find minimum count among locations not yet full
            let minCount = Infinity;
            for (const loc of locations) {
                const count = assignments.get(loc)!.length;
                if (count < 3 && count < minCount) {
                    minCount = count;
                }
            }
            // Collect all locations with minimum count for random selection
            const candidates = locations.filter(
                loc => assignments.get(loc)!.length === minCount
            );
            // Random select from candidates
            const minLoc = candidates[Math.floor(Math.random() * candidates.length)];

            assignments.get(minLoc)!.push(player);
        }
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

export function confirmArrival(snapshot: JokerSnapshot, sessionId: string): ActionResult {
    if (snapshot.phase !== "yellow_light") {
        return { ok: false, error: "Arrival only available during yellow light" };
    }

    const player = snapshot.players.find(p => p.sessionId === sessionId);
    if (!player || !player.isAlive) {
        return { ok: false, error: "Invalid player" };
    }
    if (!player.location) {
        return { ok: false, error: "Player has no location" };
    }

    ensureRoundTracking(snapshot);
    if (!snapshot.round.arrivedBySession[sessionId]) {
        snapshot.round.arrivedBySession[sessionId] = true;
        snapshot.updatedAt = Date.now();
    }
    return { ok: true };
}

// ============ Location Effects ============

type JokerCamp = "goose" | "duck" | "neutral";

function getCamp(role: JokerRole | null): JokerCamp | null {
    if (!role) return null;
    // 鹅阵营 (Goose faction): base goose or any role ending with _goose
    if (role === "goose" || role.endsWith("_goose")) return "goose";
    // 鸭阵营 (Duck faction): base duck or any role ending with _duck
    if (role === "duck" || role.endsWith("_duck")) return "duck";
    // 中立阵营 (Neutral faction): dodo, hawk, woodpecker
    if (["hawk", "dodo", "woodpecker"].includes(role)) return "neutral";
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
    if (!snapshot.round.arrivedBySession) snapshot.round.arrivedBySession = {};
    if (!snapshot.round.powerBoostBySession) snapshot.round.powerBoostBySession = {};
    if (!snapshot.round.powerBoostActiveBySession) snapshot.round.powerBoostActiveBySession = {};
    if (!snapshot.round.warehouseUsedBySession) snapshot.round.warehouseUsedBySession = {};
    if (!snapshot.round.monitorUsedBySession) snapshot.round.monitorUsedBySession = {};
    if (!snapshot.round.kitchenUsedBySession) snapshot.round.kitchenUsedBySession = {};
    if (!snapshot.round.medicalUsedBySession) snapshot.round.medicalUsedBySession = {};
    // New location effects
    if (!snapshot.round.dispatchUsedBySession) snapshot.round.dispatchUsedBySession = {};
    if (!snapshot.round.stasisActiveBySession) snapshot.round.stasisActiveBySession = {};
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
    const now = Date.now();
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
    snapshot.lifeCodes.lastUpdatedAt = now;
    snapshot.updatedAt = now;
}

function findPlayerByLifeCode(
    snapshot: JokerSnapshot,
    code: string
): JokerPlayerState | null {
    // Check current codes only - old codes are invalid after refresh
    for (const player of snapshot.players) {
        if (player.isAlive && player.lifeCode === code) {
            return player;
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

    const now = Date.now();
    const actorCamp = getCamp(actor.role);

    // === FOUL DEATH CHECK ===
    // Roles that commit foul when attempting to kill:
    // - Basic goose
    // - dodo (neutral but cannot kill)
    // - Goose special roles that can't kill: coroner_goose, overseer_goose
    // - vigilante_goose who has already used their kill
    const foulOnKill = payload.action === "kill" && (
        actor.role === "goose" ||
        actor.role === "dodo" ||
        actor.role === "coroner_goose" ||
        actor.role === "overseer_goose" ||
        (actor.role === "vigilante_goose" && actor.vigilanteKillUsed)
    );

    if (foulOnKill) {
        actor.isAlive = false;

        // Create death record for foul
        snapshot.deaths.push({
            sessionId: actor.sessionId!,
            seat: actor.seat,
            name: actor.name,
            role: actor.role!,
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

    // Find target by life code (only current codes are valid)
    const target = findPlayerByLifeCode(snapshot, payload.code);

    if (!target) {
        // Roles that can kill lose 30s oxygen for incorrect kill code
        // This includes: duck, hawk, vigilante_goose (unused), sheriff_goose, poisoner_duck, woodpecker
        const canKillRoles = [
            "duck", "hawk", "poisoner_duck", "woodpecker",
            "vigilante_goose", "sheriff_goose"
        ];
        if (payload.action === "kill" && actor.role && canKillRoles.includes(actor.role)) {
            const KILL_CODE_PENALTY = 30;
            deductOxygen(actor, KILL_CODE_PENALTY);
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
    const actorRole = actor.role;
    const targetCamp = getCamp(target.role);

    // If target is in stasis, pretend the kill was successful but don't actually kill them
    if (target.inStasis) {
        // Still consume vigilante's one-time chance
        if (actorRole === "vigilante_goose") {
            actor.vigilanteKillUsed = true;
        }
        return { ok: true, message: "Kill successful" };
    }

    // === SPECIAL ROLE KILL HANDLING ===

    // 正义鹅 (vigilante_goose): One-time kill, then mark as used
    if (actorRole === "vigilante_goose") {
        actor.vigilanteKillUsed = true;
        return performKill(snapshot, actor, target, "kill", now);
    }

    // 警长鹅 (sheriff_goose): Kill works, but if target is goose camp, actor commits suicide
    if (actorRole === "sheriff_goose") {
        const killResult = performKill(snapshot, actor, target, "kill", now);

        // If target was goose camp, sheriff commits suicide
        if (targetCamp === "goose") {
            actor.isAlive = false;
            snapshot.deaths.push({
                sessionId: actor.sessionId!,
                seat: actor.seat,
                name: actor.name,
                role: actor.role!,
                reason: "suicide",
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
        }
        snapshot.updatedAt = now;
        return killResult;
    }

    // 毒师鸭 (poisoner_duck): Don't kill immediately, set poison timer
    if (actorRole === "poisoner_duck") {
        // Set poison on target (60 seconds countdown, decremented each tick)
        target.isPoisoned = true;
        target.poisonRemainingSeconds = 60;
        target.poisonedBySessionId = actor.sessionId ?? undefined;

        // Track on actor too for reference
        actor.poisonTargetSessionId = target.sessionId ?? undefined;

        snapshot.updatedAt = now;
        return { ok: true, message: "下毒成功，60秒后生效" };
    }

    // 稠木鸟 (woodpecker): Cause oxygen leak instead of killing
    if (actorRole === "woodpecker") {
        // Trigger oxygen leak on target (same as emergency task effect)
        target.oxygenLeakActive = true;
        target.oxygenLeakStartedAt = now;
        target.oxygenLeakResolvedAt = undefined;
        target.oxygenLeakRound = snapshot.roundCount;
        // Set drain rate to leak rate (3 per second)
        setOxygenDrainRate(target, OXYGEN_DRAIN_LEAK);

        snapshot.updatedAt = now;
        return { ok: true, message: "氧气泄漏触发成功" };
    }

    // duck, hawk, saboteur_duck: Normal kill
    // Only these roles can perform normal kills
    const allowedKillers: JokerRole[] = ["duck", "hawk", "saboteur_duck"];
    if (actorRole && allowedKillers.includes(actorRole)) {
        return performKill(snapshot, actor, target, "kill", now);
    }

    // All other roles (including goose) attempting to kill = foul death
    actor.isAlive = false;
    snapshot.deaths.push({
        sessionId: actor.sessionId!,
        seat: actor.seat,
        name: actor.name,
        role: actor.role!,
        reason: "foul",
        location: actor.location ?? undefined,
        round: snapshot.roundCount,
        at: now,
        revealed: false,
    });
    snapshot.logs.push({
        at: now,
        text: `Player ${actor.name} committed foul`,
        type: "death",
    });
    snapshot.updatedAt = now;
    return { ok: false, error: "Foul death - you cannot kill!" };
}

// Helper function for standard kill execution
function performKill(
    snapshot: JokerSnapshot,
    actor: JokerPlayerState,
    target: JokerPlayerState,
    reason: "kill" | "poison",
    now: number
): ActionResult {
    target.isAlive = false;

    snapshot.deaths.push({
        sessionId: target.sessionId!,
        seat: target.seat,
        name: target.name,
        role: target.role!,
        reason: reason,
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

    // Check if target is in stasis (cannot receive oxygen)
    if (target.inStasis) {
        return { ok: false, error: "Target is in stasis" };
    }

    // Check if same person is trying to give oxygen consecutively (via life code)
    if (target.lastOxygenGiverSessionId === actorSessionId) {
        return { ok: false, error: "Cannot give oxygen consecutively to the same player" };
    }

    // Check if actor already gave oxygen to this target this round
    if (snapshot.round.oxygenGivenThisRound[actorSessionId]?.[targetSessionId]) {
        return { ok: false, error: "Already gave oxygen to this player this round" };
    }

    // Apply oxygen
    addOxygen(target, OXYGEN_REFILL);
    if (!snapshot.round.oxygenGivenThisRound[actorSessionId]) {
        snapshot.round.oxygenGivenThisRound[actorSessionId] = {};
    }
    snapshot.round.oxygenGivenThisRound[actorSessionId][targetSessionId] = true;
    // Update last oxygen giver (only for life code oxygen)
    target.lastOxygenGiverSessionId = actorSessionId;
    if (target.oxygenLeakActive) {
        target.oxygenLeakActive = false;
        target.oxygenLeakResolvedAt = Date.now();
        // Reset drain rate to normal when leak is fixed
        setOxygenDrainRate(target, OXYGEN_DRAIN_NORMAL);
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

function applyOxygenWithoutLeakFix(target: JokerPlayerState, amount: number): void {
    addOxygen(target, amount);
}

// ============ Poison Death Check (毒师鸭) ============

/**
 * Tick-based poison check: decrements remaining seconds, kills at 0
 * - Skips players in stasis (poison paused)
 * - Called every tick alongside oxygen
 */
export function checkPoisonDeath(snapshot: JokerSnapshot): JokerPlayerState[] {
    const now = Date.now();
    const deaths: JokerPlayerState[] = [];

    for (const player of snapshot.players) {
        if (!player.isAlive || !player.isPoisoned) continue;
        if (player.poisonRemainingSeconds === undefined) continue;

        // Skip if in stasis (poison paused)
        if (player.inStasis) continue;

        // Decrement remaining seconds (1 per tick)
        player.poisonRemainingSeconds -= 1;

        // Check if poison kills
        if (player.poisonRemainingSeconds <= 0) {
            player.isAlive = false;

            // Find the poisoner for death record
            const poisoner = snapshot.players.find(p => p.sessionId === player.poisonedBySessionId);

            snapshot.deaths.push({
                sessionId: player.sessionId!,
                seat: player.seat,
                name: player.name,
                role: player.role!,
                reason: "poison",
                killerSessionId: player.poisonedBySessionId,
                killerSeat: poisoner?.seat,
                killerLocation: undefined, // Poison kills remotely
                location: player.location ?? undefined,
                round: snapshot.roundCount,
                at: now,
                revealed: false,
            });

            snapshot.logs.push({
                at: now,
                text: `Player ${player.name} died from poison`,
                type: "death",
            });

            // Clear poison state
            player.isPoisoned = false;
            player.poisonRemainingSeconds = undefined;
            player.poisonedBySessionId = undefined;

            deaths.push(player);
        }
    }

    if (deaths.length > 0) {
        snapshot.updatedAt = now;
    }

    return deaths;
}

export function useMonitoringPeek(
    snapshot: JokerSnapshot,
    sessionId: string,
    targetLocation?: JokerLocation
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

    // Validate target location if provided
    if (!targetLocation) {
        return { ok: false, error: "No target location specified" };
    }

    const actorCamp = getCamp(actor.role);
    if (!actorCamp) {
        return { ok: false, error: "Invalid player" };
    }

    // Filter candidates by target location and different camp (exclude stasis players)
    const candidates = snapshot.players.filter(p => {
        if (!p.isAlive || !p.sessionId) return false;
        if (p.sessionId === sessionId) return false;
        if (p.location !== targetLocation) return false;
        if (p.inStasis) return false;  // Stasis players are immune to monitoring
        const camp = getCamp(p.role);
        return camp !== null && camp !== actorCamp;
    });

    if (candidates.length === 0) {
        return { ok: false, error: "No eligible target at location" };
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
    applyOxygenWithoutLeakFix(actor, OXYGEN_REFILL);
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
    applyOxygenWithoutLeakFix(target, OXYGEN_REFILL);
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
        // Players in stasis don't receive warehouse oxygen
        if (player.inStasis) continue;
        applyOxygenWithoutLeakFix(player, WAREHOUSE_OXYGEN_REFILL);
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

export function useDispatchRoom(
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

    if (actor.location !== "调度室") {
        return { ok: false, error: "Not in dispatch room" };
    }

    if (!isSoloInLocation(snapshot, sessionId, actor.location)) {
        return { ok: false, error: "Not alone in location" };
    }

    ensureRoundTracking(snapshot);
    if (snapshot.round.dispatchUsedBySession[sessionId]) {
        return { ok: false, error: "Dispatch already used this round" };
    }

    snapshot.round.dispatchUsedBySession[sessionId] = true;
    snapshot.round.randomDispatchNextRound = true;
    snapshot.round.randomDispatchInitiatorSessionId = sessionId;

    const now = Date.now();
    snapshot.logs.push({
        at: now,
        text: `Player ${actor.name} activated random dispatch for next round`,
        type: "system",
    });

    snapshot.updatedAt = now;
    return { ok: true };
}

export function useStasisPod(
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

    if (actor.location !== "休眠舱") {
        return { ok: false, error: "Not in stasis pod" };
    }

    if (!isSoloInLocation(snapshot, sessionId, actor.location)) {
        return { ok: false, error: "Not alone in location" };
    }

    ensureRoundTracking(snapshot);
    if (snapshot.round.stasisActiveBySession[sessionId]) {
        return { ok: false, error: "Already in stasis" };
    }

    snapshot.round.stasisActiveBySession[sessionId] = true;
    actor.inStasis = true;
    // Pause oxygen drain
    setOxygenDrainRate(actor, 0);

    const now = Date.now();
    snapshot.logs.push({
        at: now,
        text: `Player ${actor.name} entered stasis pod`,
        type: "system",
    });

    snapshot.updatedAt = now;
    return { ok: true };
}

// ============ Special Role Abilities (验尸鹅 / 监工鹅) ============

/**
 * 验尸鹅 (coroner_goose): Investigate a dead player's death cause
 * Only works when alone at a location during red light
 */
export function coronerInvestigate(
    snapshot: JokerSnapshot,
    sessionId: string,
    deadSessionId: string
): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Investigation only available during red light" };
    }

    const actor = snapshot.players.find(p => p.sessionId === sessionId);
    if (!actor || !actor.isAlive || !actor.location) {
        return { ok: false, error: "Invalid player" };
    }

    // Must be coroner_goose
    if (actor.role !== "coroner_goose") {
        return { ok: false, error: "Only coroner can investigate deaths" };
    }

    // Must be alone
    if (!isSoloInLocation(snapshot, sessionId, actor.location)) {
        return { ok: false, error: "Must be alone to investigate" };
    }

    // Find the death record
    const deathRecord = snapshot.deaths.find(d => d.sessionId === deadSessionId);
    if (!deathRecord) {
        return { ok: false, error: "No death record found" };
    }

    // Initialize investigated list if needed
    if (!actor.investigatedDeaths) {
        actor.investigatedDeaths = [];
    }

    // Check if already investigated
    if (actor.investigatedDeaths.includes(deadSessionId)) {
        return { ok: false, error: "Already investigated this death" };
    }

    // Mark as investigated
    actor.investigatedDeaths.push(deadSessionId);
    snapshot.updatedAt = Date.now();

    // Return the death cause (but not the killer's identity)
    return {
        ok: true,
        data: {
            reason: deathRecord.reason,
            deadName: deathRecord.name,
            deadSeat: deathRecord.seat,
        }
    };
}

/**
 * 监工鹅 (overseer_goose): Check a player's task contribution
 * Only works when alone at a location during red light
 */
export function overseerInvestigate(
    snapshot: JokerSnapshot,
    sessionId: string,
    targetSessionId: string
): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Investigation only available during red light" };
    }

    const actor = snapshot.players.find(p => p.sessionId === sessionId);
    if (!actor || !actor.isAlive || !actor.location) {
        return { ok: false, error: "Invalid player" };
    }

    // Must be overseer_goose
    if (actor.role !== "overseer_goose") {
        return { ok: false, error: "Only overseer can investigate contributions" };
    }

    // Must be alone
    if (!isSoloInLocation(snapshot, sessionId, actor.location)) {
        return { ok: false, error: "Must be alone to investigate" };
    }

    // Find target
    const target = snapshot.players.find(p => p.sessionId === targetSessionId);
    if (!target || !target.sessionId) {
        return { ok: false, error: "Invalid target" };
    }

    // Cannot investigate self
    if (targetSessionId === sessionId) {
        return { ok: false, error: "Cannot investigate yourself" };
    }

    // Get cumulative contribution from player (not round-based)
    const contribution = target.totalTaskContribution ?? 0;

    snapshot.updatedAt = Date.now();

    return {
        ok: true,
        data: {
            targetName: target.name,
            targetSeat: target.seat,
            contribution: contribution,
        }
    };
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
        case "调度室":
            if (snapshot.round.dispatchUsedBySession[sessionId]) {
                return { ok: false, error: "Dispatch already used this round" };
            }
            snapshot.round.dispatchUsedBySession[sessionId] = true;
            break;
        case "休眠舱":
            if (snapshot.round.stasisActiveBySession[sessionId]) {
                return { ok: false, error: "Already in stasis" };
            }
            snapshot.round.stasisActiveBySession[sessionId] = true;
            break;
        default:
            return { ok: false, error: "Invalid location" };
    }

    snapshot.updatedAt = Date.now();
    return { ok: true };
}

// ============ Oxygen Tick ============

// Note: With oxygenState, we no longer need to modify oxygen values each tick.
// The frontend calculates current oxygen from baseOxygen, drainRate, and baseTimestamp.
// This function is kept for compatibility but is now a no-op.
export function tickOxygen(_snapshot: JokerSnapshot): void {
    // No-op: oxygen is now calculated on-demand from oxygenState
}

export function checkOxygenDeath(snapshot: JokerSnapshot): JokerPlayerState[] {
    const deaths: JokerPlayerState[] = [];
    const now = Date.now();

    for (const player of snapshot.players) {
        if (!player.isAlive || !player.sessionId) continue;
        // Players in stasis don't consume oxygen
        if (player.inStasis) continue;

        const currentOxygen = getCurrentOxygen(player.oxygenState);
        if (currentOxygen <= 0) {
            if (player.role === "duck" && !player.duckEmergencyUsed) {
                // Duck gets emergency oxygen (one-time)
                resetOxygen(player, EMERGENCY_OXYGEN, OXYGEN_DRAIN_NORMAL);
                player.duckEmergencyUsed = true;

                snapshot.logs.push({
                    at: now,
                    text: `Player ${player.name} used emergency oxygen`,
                    type: "oxygen",
                });
            } else if (player.role === "hawk" && !player.hawkEmergencyUsed) {
                // Hawk gets emergency oxygen (one-time)
                resetOxygen(player, EMERGENCY_OXYGEN, OXYGEN_DRAIN_NORMAL);
                player.hawkEmergencyUsed = true;

                snapshot.logs.push({
                    at: now,
                    text: `Player ${player.name} used emergency oxygen`,
                    type: "oxygen",
                });
            } else if (player.role === "woodpecker" && !player.woodpeckerEmergencyUsed) {
                // Woodpecker gets emergency oxygen (one-time)
                resetOxygen(player, EMERGENCY_OXYGEN, OXYGEN_DRAIN_NORMAL);
                player.woodpeckerEmergencyUsed = true;

                snapshot.logs.push({
                    at: now,
                    text: `Player ${player.name} used emergency oxygen`,
                    type: "oxygen",
                });
            } else if (player.role === "poisoner_duck" && !player.poisonerDuckEmergencyUsed) {
                // Poisoner Duck gets emergency oxygen (one-time)
                resetOxygen(player, EMERGENCY_OXYGEN, OXYGEN_DRAIN_NORMAL);
                player.poisonerDuckEmergencyUsed = true;

                snapshot.logs.push({
                    at: now,
                    text: `Player ${player.name} used emergency oxygen`,
                    type: "oxygen",
                });
            } else if (player.role === "saboteur_duck" && !player.saboteurDuckEmergencyUsed) {
                // Saboteur Duck gets emergency oxygen (one-time)
                resetOxygen(player, EMERGENCY_OXYGEN, OXYGEN_DRAIN_NORMAL);
                player.saboteurDuckEmergencyUsed = true;

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

    // Penalty for false report: deduct 10s oxygen if no unrevealed deaths
    const FALSE_REPORT_PENALTY = 10;
    if (triggerType === "player" && unrevealedDeathCount === 0) {
        deductOxygen(reporter, FALSE_REPORT_PENALTY);
        snapshot.logs.push({
            at: Date.now(),
            text: `${reporter.name} received penalty for false report`,
            type: "oxygen",
        });
    }

    // Reveal all unrevealed deaths when entering meeting
    const now = Date.now();
    for (const death of snapshot.deaths) {
        if (!death.revealed) {
            death.revealed = true;
            death.revealedAt = now;
        }
    }

    // Calculate meeting duration based on alive player count
    const alivePlayerCount = snapshot.players.filter(p => p.isAlive && p.sessionId).length;
    const meetingDuration = MEETING_BASE_DURATION + MEETING_PER_PLAYER_DURATION * alivePlayerCount;

    snapshot.phase = "meeting";
    snapshot.meeting = {
        reporterSessionId,
        bodySessionId,
        discussionEndAt: now + meetingDuration,
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

    // Reset player vote state and freeze oxygen
    for (const player of snapshot.players) {
        player.hasVoted = false;
        player.voteTarget = null;
        // Freeze oxygen during meeting (drainRate=0)
        if (player.isAlive && player.sessionId) {
            setOxygenDrainRate(player, 0);
        }
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
    // Dodo wins if voted out
    if (snapshot.execution?.executedRole === "dodo" && snapshot.execution.reason === "vote") {
        return { winner: "dodo", reason: "dodo_voted" };
    }

    const alivePlayers = snapshot.players.filter(p => p.isAlive && p.sessionId);

    // Count players by camp using getCamp() for proper special role handling
    const aliveBycamp = {
        goose: alivePlayers.filter(p => getCamp(p.role) === "goose"),
        duck: alivePlayers.filter(p => getCamp(p.role) === "duck"),
        neutral: alivePlayers.filter(p => getCamp(p.role) === "neutral"),
    };

    // Find specific neutral roles
    const aliveHawks = alivePlayers.filter(p => p.role === "hawk");
    const aliveWoodpeckers = alivePlayers.filter(p => p.role === "woodpecker");
    const aliveDodos = alivePlayers.filter(p => p.role === "dodo");

    // Armed neutrals that block victory (Dodo does not block)
    const armedNeutralCount = aliveHawks.length + aliveWoodpeckers.length;

    // === NEUTRAL ROLE VICTORIES ===

    // Hawk (猎鹰) victory: alive alone or with exactly 1 goose-camp player
    if (aliveHawks.length === 1) {
        if (alivePlayers.length === 1) {
            return { winner: "hawk", reason: "hawk_survive" };
        }
        if (alivePlayers.length === 2 && aliveBycamp.goose.length === 1 &&
            aliveBycamp.duck.length === 0) {
            return { winner: "hawk", reason: "hawk_survive" };
        }
    }

    // 啄木鸟 (Woodpecker) victory: alive alone or with exactly 1 goose-camp player
    if (aliveWoodpeckers.length === 1) {
        if (alivePlayers.length === 1) {
            return { winner: "woodpecker", reason: "woodpecker_survive" };
        }
        if (alivePlayers.length === 2 && aliveBycamp.goose.length === 1 &&
            aliveBycamp.duck.length === 0) {
            return { winner: "woodpecker", reason: "woodpecker_survive" };
        }
    }

    // === GOOSE VICTORIES ===

    // Goose win: task progress reaches 100% (absolute victory, ignores armed neutrals)
    if (snapshot.taskProgress >= 100 && aliveBycamp.goose.length > 0) {
        return { winner: "goose", reason: "task_complete" };
    }

    // Goose win: all ducks dead (counting all duck-camp roles, no armed neutrals)
    if (aliveBycamp.duck.length === 0 && aliveBycamp.goose.length > 0 && armedNeutralCount === 0) {
        return { winner: "goose", reason: "all_ducks_eliminated" };
    }

    // === DUCK VICTORIES ===

    // Duck win: all geese dead (counting all goose-camp roles, no armed neutrals)
    if (aliveBycamp.duck.length > 0 && aliveBycamp.goose.length === 0 && armedNeutralCount === 0) {
        return { winner: "duck", reason: "all_geese_eliminated" };
    }

    // Duck win: ducks >= non-ducks (no armed neutrals)
    const nonDuckCount = alivePlayers.length - aliveBycamp.duck.length;
    if (aliveBycamp.duck.length > 0 && aliveBycamp.duck.length >= nonDuckCount && armedNeutralCount === 0) {
        return { winner: "duck", reason: "duck_majority" };
    }

    return null;
}

// ============ Task System ============

const TASK_PROGRESS_PER_COMPLETION = 1.5; // +1.5% per task
const POWER_TASK_PROGRESS_PER_COMPLETION = 3; // +3% per task with power boost (fixed, not multiplier)
const TASK_OXYGEN_COST = 10; // -10s oxygen per task attempt
const SHARED_TASK_PROGRESS_PER_PARTICIPANT = 2.5; // +2.5% per participant
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

    // Players in stasis cannot do tasks
    if (player.inStasis) {
        return { ok: false, error: "Players in stasis cannot do tasks" };
    }

    // Deduct oxygen
    deductOxygen(player, TASK_OXYGEN_COST);
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

    // Track cumulative contribution for overseer_goose investigation (stored on player, not round)
    player.totalTaskContribution = (player.totalTaskContribution ?? 0) + progressGain;

    // Also track in round state for game review display
    snapshot.round.taskContributionBySession[sessionId] = player.totalTaskContribution;

    // 糊弄鸭 (saboteur_duck): Track contribution for explosion calculation
    // Hidden damage = contribution × 2 (deducted when task reaches 100%)
    if (player.role === "saboteur_duck" && !player.saboteurExploded) {
        player.saboteurHiddenDamage = (player.saboteurHiddenDamage ?? 0) + progressGain;
    }

    snapshot.taskProgress = Math.min(100, snapshot.taskProgress + progressGain);

    // 糊弄鸭爆发：当任务进度达到100%时，扣除糊弄鸭贡献 × 2
    if (snapshot.taskProgress >= 100) {
        let totalExplosionDamage = 0;
        for (const p of snapshot.players) {
            if (p.role === "saboteur_duck" && !p.saboteurExploded && p.saboteurHiddenDamage) {
                totalExplosionDamage += p.saboteurHiddenDamage * 2;
                p.saboteurExploded = true;  // 标记已爆发，防止重复扣除
            }
        }
        if (totalExplosionDamage > 0) {
            snapshot.taskProgress = Math.max(0, snapshot.taskProgress - totalExplosionDamage);
            snapshot.logs.push({
                at: Date.now(),
                text: `隐患爆发！任务进度 -${totalExplosionDamage}%`,
                type: "system",
            });
        }
    }

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

    // Players in stasis cannot join shared tasks
    if (player.inStasis) {
        return { ok: false, error: "Players in stasis cannot do tasks" };
    }

    if (!snapshot.tasks) snapshot.tasks = {};
    const sharedByLocation: Partial<Record<JokerLocation, JokerSharedTaskState>> = snapshot.tasks.sharedByLocation ?? {};
    const existing = sharedByLocation[player.location];
    if (existing && existing.status !== "resolved") {
        if (!existing.joined.includes(sessionId)) {
            existing.joined.push(sessionId);
            deductOxygen(player, SHARED_TASK_OXYGEN_COST);
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
    deductOxygen(player, SHARED_TASK_OXYGEN_COST);
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

        // Track contribution for each participant (each gets their share, not the full gain)
        for (const participantId of shared.participants) {
            const participant = snapshot.players.find(p => p.sessionId === participantId);
            if (participant) {
                participant.totalTaskContribution = (participant.totalTaskContribution ?? 0) + SHARED_TASK_PROGRESS_PER_PARTICIPANT;
                snapshot.round.taskContributionBySession[participantId] = participant.totalTaskContribution;
            }
        }
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

        // Track contribution for each participant (split evenly)
        const participantCount = task.participants.length;
        if (participantCount > 0) {
            const contributionPerPlayer = GOLDEN_RABBIT_PROGRESS_REWARD / participantCount;
            for (const participantId of task.participants) {
                const participant = snapshot.players.find(p => p.sessionId === participantId);
                if (participant) {
                    participant.totalTaskContribution = (participant.totalTaskContribution ?? 0) + contributionPerPlayer;
                    snapshot.round.taskContributionBySession[participantId] = participant.totalTaskContribution;
                }
            }
        }
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
    for (const player of snapshot.players) {
        player.targetLocation = null;
        player.location = null;
        // Reset stasis state
        if (player.inStasis) {
            player.inStasis = false;
        }
        // Pause oxygen drain during green/yellow light (will resume in red light)
        if (player.isAlive) {
            setOxygenDrainRate(player, 0);
        }
        player.oxygenLeakActive = false;
        player.oxygenLeakStartedAt = undefined;
        player.oxygenLeakResolvedAt = undefined;
        player.oxygenLeakRound = undefined;
        // Reset ghost state for new round (unified reset point)
        if (!player.isAlive) {
            player.ghostTargetLocation = null;
            player.ghostAssignedLocation = null;
            player.hauntingTarget = null;
        }
    }
    snapshot.round.oxygenGivenThisRound = {};
    snapshot.round.goldenRabbitTriggeredLocations = [];
    snapshot.round.arrivedBySession = {};
    snapshot.round.powerBoostBySession = {};
    snapshot.round.powerBoostActiveBySession = {};
    snapshot.round.warehouseUsedBySession = {};
    snapshot.round.monitorUsedBySession = {};
    snapshot.round.kitchenUsedBySession = {};
    snapshot.round.medicalUsedBySession = {};
    // Reset new location effect states
    snapshot.round.dispatchUsedBySession = {};
    snapshot.round.stasisActiveBySession = {};
    // Note: randomDispatchNextRound is NOT reset here; it's consumed in assignLocations

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

    // Resume normal oxygen drain for all alive players
    for (const player of snapshot.players) {
        if (player.isAlive && !player.inStasis) {
            setOxygenDrainRate(player, OXYGEN_DRAIN_NORMAL);
        }
    }

    snapshot.deadline = Date.now() + PHASE_DURATIONS.red_light;
    snapshot.updatedAt = Date.now();
}

export function rotateLifeCodesAtHalfRedLight(snapshot: JokerSnapshot): void {
    generateAllLifeCodes(snapshot);
    snapshot.updatedAt = Date.now();
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
        resetOxygen(player, INITIAL_OXYGEN);
        player.duckEmergencyUsed = false;
        player.hawkEmergencyUsed = false;
        player.woodpeckerEmergencyUsed = false;
        player.oxygenLeakActive = false;
        player.oxygenLeakStartedAt = undefined;
        player.oxygenLeakResolvedAt = undefined;
        player.oxygenLeakRound = undefined;
        player.hasVoted = false;
        player.voteTarget = null;
        player.lifeCode = resetCodes[idx];
        player.lifeCodeVersion = 1;
        // Reset ghost fields
        player.ghostTargetLocation = null;
        player.ghostAssignedLocation = null;
        player.hauntingTarget = null;
    }

    snapshot.updatedAt = Date.now();
}

// ============ Ghost System ============

const MAX_GHOSTS_PER_TARGET = 3;
const HAUNT_OXYGEN_DEDUCT = 3;

/** 判断玩家是否为可作祟的幽灵（死亡且已公开） */
export function isActiveGhost(player: JokerPlayerState, deaths: JokerDeathRecord[]): boolean {
    if (player.isAlive) return false;
    if (!player.sessionId) return false;
    const death = deaths.find(d => d.sessionId === player.sessionId);
    return death?.revealed === true;
}

/** 获取所有可作祟的幽灵 */
export function getActiveGhosts(snapshot: JokerSnapshot): JokerPlayerState[] {
    return snapshot.players.filter(p => isActiveGhost(p, snapshot.deaths));
}

/** 幽灵选择目标场所（绿灯阶段） */
export function ghostSelectLocation(
    snapshot: JokerSnapshot,
    payload: GhostSelectLocationPayload
): ActionResult {
    if (snapshot.phase !== "green_light") {
        return { ok: false, error: "Can only select location during green light" };
    }

    const player = snapshot.players.find(p => p.seat === payload.seat);
    if (!player || !player.sessionId) {
        return { ok: false, error: "Invalid player" };
    }

    if (!isActiveGhost(player, snapshot.deaths)) {
        return { ok: false, error: "Player is not an active ghost" };
    }

    if (!snapshot.activeLocations.includes(payload.location)) {
        return { ok: false, error: "Invalid location" };
    }

    player.ghostTargetLocation = payload.location;
    snapshot.updatedAt = Date.now();

    return { ok: true };
}

/** 分配幽灵到场所（黄灯阶段开始时调用） */
export function assignGhostLocations(snapshot: JokerSnapshot): void {
    const ghosts = getActiveGhosts(snapshot);

    for (const ghost of ghosts) {
        // 幽灵必定去到所选场所，如果没选则不分配
        ghost.ghostAssignedLocation = ghost.ghostTargetLocation;
    }

    snapshot.updatedAt = Date.now();
}

/** 获取幽灵可作祟的存活玩家列表（同场所） */
export function getHauntablePlayers(
    snapshot: JokerSnapshot,
    ghostSessionId: string
): JokerPlayerState[] {
    const ghost = snapshot.players.find(p => p.sessionId === ghostSessionId);
    if (!ghost || !ghost.ghostAssignedLocation) return [];

    return snapshot.players.filter(p =>
        p.isAlive &&
        p.sessionId &&
        p.location === ghost.ghostAssignedLocation
    );
}

/** 统计某玩家被几个幽灵作祟 */
export function getHauntingCount(
    snapshot: JokerSnapshot,
    playerSessionId: string
): number {
    return snapshot.players.filter(p =>
        !p.isAlive &&
        p.hauntingTarget === playerSessionId
    ).length;
}

/** 幽灵开始作祟（红灯阶段，选定后本回合不可更改） */
export function ghostHaunt(
    snapshot: JokerSnapshot,
    payload: GhostHauntPayload
): ActionResult {
    if (snapshot.phase !== "red_light") {
        return { ok: false, error: "Can only haunt during red light" };
    }

    const ghost = snapshot.players.find(p => p.seat === payload.seat);
    if (!ghost || !ghost.sessionId) {
        return { ok: false, error: "Invalid player" };
    }

    if (!isActiveGhost(ghost, snapshot.deaths)) {
        return { ok: false, error: "Player is not an active ghost" };
    }

    // 已选择作祟目标则不可更改
    if (ghost.hauntingTarget) {
        return { ok: false, error: "Already haunting a target this round" };
    }

    // 检查目标是否在同场所且存活
    const target = snapshot.players.find(p => p.sessionId === payload.targetSessionId);
    if (!target || !target.isAlive) {
        return { ok: false, error: "Invalid target" };
    }

    if (target.location !== ghost.ghostAssignedLocation) {
        return { ok: false, error: "Target not in same location" };
    }

    // Note: Players in stasis CAN be targeted for haunting (to hide their stasis status),
    // but they won't actually lose oxygen (handled in processHauntingTick)

    // 检查作祟上限
    const currentHauntCount = getHauntingCount(snapshot, payload.targetSessionId);
    if (currentHauntCount >= MAX_GHOSTS_PER_TARGET) {
        return { ok: false, error: "Target already has maximum ghosts" };
    }

    ghost.hauntingTarget = payload.targetSessionId;
    snapshot.updatedAt = Date.now();

    return { ok: true };
}

/** 处理作祟 tick - 倒计时整10秒时扣氧（60s, 50s, 40s, 30s, 20s, 10s, 0s） */
export function processHauntingTick(snapshot: JokerSnapshot, deadline?: number): string[] {
    if (snapshot.phase !== "red_light") return [];
    if (!deadline) return [];

    const now = Date.now();
    const remainingMs = deadline - now;
    const remainingSec = Math.ceil(remainingMs / 1000);

    // 只在倒计时整10秒时扣氧
    if (remainingSec < 0 || remainingSec % 10 !== 0) return [];

    // 统计每个被作祟玩家的幽灵数量
    const hauntedPlayers: Map<string, number> = new Map(); // sessionId -> ghost count
    for (const ghost of snapshot.players) {
        if (!ghost.isAlive && ghost.hauntingTarget) {
            const count = hauntedPlayers.get(ghost.hauntingTarget) || 0;
            hauntedPlayers.set(ghost.hauntingTarget, count + 1);
        }
    }

    const deductedPlayers: string[] = [];

    // 对每个被作祟的玩家扣氧
    for (const [targetSessionId, ghostCount] of hauntedPlayers) {
        const target = snapshot.players.find(p => p.sessionId === targetSessionId);
        if (!target || !target.isAlive) continue;

        // Skip oxygen deduction for players in stasis (but they can still be "haunted" visually)
        if (target.inStasis) continue;

        // 扣氧（最多3个幽灵效果）
        const effectiveCount = Math.min(ghostCount, MAX_GHOSTS_PER_TARGET);
        const amount = effectiveCount * HAUNT_OXYGEN_DEDUCT;
        deductOxygen(target, amount);
        deductedPlayers.push(targetSessionId);
    }

    if (deductedPlayers.length > 0) {
        snapshot.updatedAt = now;
    }

    return deductedPlayers;
}

/** 清除所有幽灵的作祟状态（红灯结束时调用，实际重置在 transitionToGreenLight 统一处理） */
export function clearAllHauntings(_snapshot: JokerSnapshot): void {
    // Ghost state is now reset in transitionToGreenLight as the unified reset point
    // This function is kept for API compatibility but does nothing
}

/** 重置幽灵场所选择（已废弃，实际重置在 transitionToGreenLight 统一处理） */
export function resetGhostLocations(_snapshot: JokerSnapshot): void {
    // Ghost state is now reset in transitionToGreenLight as the unified reset point
    // This function is kept for API compatibility but does nothing
}

// Import JokerDeathRecord for ghost type checking
import type { JokerDeathRecord } from "./types.js";
