// realtime-server/src/game-joker/scheduler.ts

import type { Server } from "socket.io";
import type { JokerEmergencyTaskState, JokerLocation, JokerSnapshot } from "./types.js";
import {
    PHASE_DURATIONS,
    transitionToGreenLight,
    transitionToYellowLight,
    transitionToRedLight,
    transitionToVoting,
    resolveVotes,
    checkWinCondition,
    finalizeGame,
    tickOxygen,
    checkOxygenDeath,
    startMeeting,
    generateAllLifeCodes,
    SHARED_TASK_DURATIONS_MS,
    initNineGridSharedTask,
    initDigitPuzzleSharedTask,
    resolveSharedTask,
    initGoldenRabbitTask,
    startGoldenRabbitHunt,
    resolveGoldenRabbitTask,
    setOxygenDrainRate,
    // Ghost system
    assignGhostLocations,
    clearAllHauntings,
    resetGhostLocations,
    processHauntingTick,
} from "./engine.js";

// Track active timers per room
const roomTimers = new Map<string, NodeJS.Timeout[]>();
const oxygenIntervals = new Map<string, NodeJS.Timeout>();
const scheduledDeadlines = new Map<string, number>();

export function addTimeout(roomCode: string, timeout: NodeJS.Timeout): void {
    if (!roomTimers.has(roomCode)) {
        roomTimers.set(roomCode, []);
    }
    roomTimers.get(roomCode)!.push(timeout);
}

export function clearRoomTimeouts(roomCode: string): void {
    const timers = roomTimers.get(roomCode);
    if (timers) {
        for (const t of timers) {
            clearTimeout(t);
        }
        roomTimers.delete(roomCode);
    }

    const oxygenInterval = oxygenIntervals.get(roomCode);
    if (oxygenInterval) {
        clearInterval(oxygenInterval);
        oxygenIntervals.delete(roomCode);
    }

    scheduledDeadlines.delete(roomCode);
}

function broadcastSnapshot(room: { code: string; snapshot: any }, io: Server): void {
    io.to(room.code).emit("state:full", {
        snapshot: room.snapshot,
        from: "_server",
        at: Date.now(),
    });
}

export function checkAndScheduleActions(
    room: { code: string; snapshot: any },
    io: Server
): void {
    const snapshot = room.snapshot as JokerSnapshot;
    if (!snapshot || snapshot.engine !== "joker") return;

    if (snapshot.paused) {
        stopOxygenTick(room.code);
        return;
    }

    const { phase, deadline } = snapshot;
    const now = Date.now();

    // Skip if already scheduled for this deadline
    if (deadline && scheduledDeadlines.get(room.code) === deadline) {
        return;
    }

    if (deadline) {
        scheduledDeadlines.set(room.code, deadline);
    }

    // Check win condition first
    const result = checkWinCondition(snapshot);
    if (result && phase !== "lobby" && phase !== "game_over") {
        finalizeGame(snapshot, result);
        broadcastSnapshot(room, io);
        clearRoomTimeouts(room.code);
        return;
    }

    switch (phase) {
        case "lobby":
            // No timers in lobby
            break;

        case "role_reveal":
            scheduleRoleRevealToGreenLight(room, io);
            break;

        case "green_light":
            schedulePhaseTransition(room, io, "yellow_light");
            startOxygenTick(room, io);
            break;

        case "yellow_light":
            schedulePhaseTransition(room, io, "red_light");
            break;

        case "red_light":
            scheduleRedLightActions(room, io);
            break;

        case "meeting":
            scheduleMeetingToVoting(room, io);
            stopOxygenTick(room.code);
            break;

        case "voting":
            scheduleVoteResolution(room, io);
            break;

        case "execution":
            schedulePostExecution(room, io);
            break;

        case "game_over":
            clearRoomTimeouts(room.code);
            break;
    }
}

function schedulePhaseTransition(
    room: { code: string; snapshot: any },
    io: Server,
    nextPhase: "yellow_light" | "red_light"
): void {
    const snapshot = room.snapshot as JokerSnapshot;
    if (!snapshot.deadline) return;

    const delay = Math.max(0, snapshot.deadline - Date.now());

    const timer = setTimeout(() => {
        if (nextPhase === "yellow_light") {
            transitionToYellowLight(snapshot);
            // Assign ghost locations when entering yellow light
            assignGhostLocations(snapshot);
        } else if (nextPhase === "red_light") {
            transitionToRedLight(snapshot);
        }

        broadcastSnapshot(room, io);
        checkAndScheduleActions(room, io);
    }, delay);

    addTimeout(room.code, timer);
}

function scheduleRoleRevealToGreenLight(
    room: { code: string; snapshot: any },
    io: Server
): void {
    const snapshot = room.snapshot as JokerSnapshot;
    if (!snapshot.deadline) return;

    const delay = Math.max(0, snapshot.deadline - Date.now());

    const timer = setTimeout(() => {
        // Reset ghost locations for new round
        resetGhostLocations(snapshot);
        transitionToGreenLight(snapshot);
        broadcastSnapshot(room, io);
        checkAndScheduleActions(room, io);
    }, delay);

    addTimeout(room.code, timer);
}

function scheduleRedLightActions(
    room: { code: string; snapshot: any },
    io: Server
): void {
    const snapshot = room.snapshot as JokerSnapshot;
    if (!snapshot.deadline) return;

    const fullDelay = Math.max(0, snapshot.deadline - Date.now());

    // Schedule end of red light
    const endTimer = setTimeout(() => {
        handleRedLightEnd(room, io);
    }, fullDelay);

    addTimeout(room.code, endTimer);
    scheduleEmergencyTasks(room, io);
    scheduleLifeCodeRefresh(room, io);
}

function scheduleLifeCodeRefresh(
    room: { code: string; snapshot: any },
    io: Server
): void {
    const snapshot = room.snapshot as JokerSnapshot;
    if (snapshot.phase !== "red_light" || !snapshot.deadline) return;

    const redLightStartMs = snapshot.round.phaseStartAt;
    const refreshSecond = snapshot.round.lifeCodeRefreshSecond;
    const refreshAt = redLightStartMs + refreshSecond * 1000;
    const warningAt = refreshAt - 5000; // 提前5秒警告

    // 5秒前警告（如果刷新时间>=5秒才发警告，否则红灯开始时立即发）
    const warningDelay = Math.max(0, warningAt - Date.now());
    const warningTimer = setTimeout(() => {
        if ((room.snapshot as JokerSnapshot).phase !== "red_light") return;
        io.to(room.code).emit("action", {
            action: "joker:life_code_warning",
            from: "_server",
            at: Date.now(),
        });
    }, warningDelay);
    addTimeout(room.code, warningTimer);

    // 刷新生命代码
    const refreshDelay = Math.max(0, refreshAt - Date.now());
    const refreshTimer = setTimeout(() => {
        const snap = room.snapshot as JokerSnapshot;
        if (snap.phase !== "red_light") return;
        generateAllLifeCodes(snap);
        console.log(`[LifeCode] Round ${snap.roundCount}: refreshed at ${refreshSecond}s`);
        broadcastSnapshot(room, io);
    }, refreshDelay);
    addTimeout(room.code, refreshTimer);
}

const EMERGENCY_REMAINING_MIN_MS = 10_000;
const EMERGENCY_REMAINING_MAX_MS = 50_000;

function pickEmergencyDelayMs(snapshot: JokerSnapshot): number | null {
    if (!snapshot.deadline) return null;
    const remainingMs = snapshot.deadline - Date.now();
    if (remainingMs <= EMERGENCY_REMAINING_MIN_MS) return null;
    const maxRemaining = Math.min(EMERGENCY_REMAINING_MAX_MS, remainingMs);
    const targetRemaining = Math.floor(
        Math.random() * (maxRemaining - EMERGENCY_REMAINING_MIN_MS + 1)
    ) + EMERGENCY_REMAINING_MIN_MS;
    return Math.max(0, remainingMs - targetRemaining);
}

function scheduleEmergencyTasks(
    room: { code: string; snapshot: any },
    io: Server
): void {
    const snapshot = room.snapshot as JokerSnapshot;
    if (snapshot.phase !== "red_light") return;
    scheduleOxygenLeakEvents(room, io);
    scheduleGoldenRabbitEvents(room, io);
}

function scheduleOxygenLeakEvents(
    room: { code: string; snapshot: any },
    io: Server
): void {
    const snapshot = room.snapshot as JokerSnapshot;
    if (snapshot.round.roundCount < 2) return;

    const alivePlayers = snapshot.players.filter(p => p.isAlive && p.sessionId);
    if (alivePlayers.length === 0) return;

    const probability = 1 / alivePlayers.length;
    for (const player of alivePlayers) {
        if (player.oxygenLeakRound === snapshot.round.roundCount) {
            continue;
        }
        if (Math.random() >= probability) {
            continue;
        }
        const delay = pickEmergencyDelayMs(snapshot);
        if (delay === null) continue;
        const sessionId = player.sessionId!;
        const timer = setTimeout(() => {
            const snap = room.snapshot as JokerSnapshot;
            if (snap.phase !== "red_light") return;
            const target = snap.players.find(p => p.sessionId === sessionId);
            if (!target || !target.isAlive || !target.sessionId) return;
            if (target.oxygenLeakRound === snap.round.roundCount) return;
            target.oxygenLeakActive = true;
            target.oxygenLeakStartedAt = Date.now();
            target.oxygenLeakResolvedAt = undefined;
            target.oxygenLeakRound = snap.round.roundCount;
            // Set drain rate to leak rate (3 per second)
            setOxygenDrainRate(target, 3);
            snap.updatedAt = Date.now();
            broadcastSnapshot(room, io);
        }, delay);
        addTimeout(room.code, timer);
    }
}

function scheduleGoldenRabbitEvents(
    room: { code: string; snapshot: any },
    io: Server
): void {
    const snapshot = room.snapshot as JokerSnapshot;
    const locationMap = new Map<JokerLocation, number>();
    for (const player of snapshot.players) {
        if (player.isAlive && player.sessionId && player.location) {
            locationMap.set(player.location, (locationMap.get(player.location) ?? 0) + 1);
        }
    }
    const locations = Array.from(locationMap.keys());
    if (locations.length === 0) return;

    const probability = 1 / locations.length;
    for (const location of locations) {
        if (snapshot.round.goldenRabbitTriggeredLocations.includes(location)) continue;
        if (snapshot.tasks?.emergencyByLocation?.[location]) continue;
        if (Math.random() >= probability) continue;
        const delay = pickEmergencyDelayMs(snapshot);
        if (delay === null) continue;
        const timer = setTimeout(() => {
            const snap = room.snapshot as JokerSnapshot;
            if (snap.phase !== "red_light") return;
            if (snap.round.goldenRabbitTriggeredLocations.includes(location)) return;
            if (snap.tasks?.emergencyByLocation?.[location]) return;
            initGoldenRabbitTask(snap, location, Date.now());
            broadcastSnapshot(room, io);
        }, delay);
        addTimeout(room.code, timer);
    }
}

function handleRedLightEnd(
    room: { code: string; snapshot: any },
    io: Server
): void {
    const snapshot = room.snapshot as JokerSnapshot;

    // Clear ghost haunting state at end of red light
    clearAllHauntings(snapshot);

    // Check win condition
    const result = checkWinCondition(snapshot);
    if (result) {
        finalizeGame(snapshot, result);
        broadcastSnapshot(room, io);
        clearRoomTimeouts(room.code);
        return;
    }

    // Check if there are any unrevealed deaths
    const hasUnrevealedDeaths = snapshot.deaths.some(d => !d.revealed);

    if (hasUnrevealedDeaths) {
        // Enter meeting to reveal deaths
        const livingPlayer = snapshot.players.find(p => p.isAlive && p.sessionId);
        if (livingPlayer && livingPlayer.sessionId) {
            startMeeting(snapshot, livingPlayer.sessionId, undefined, "system");
            broadcastSnapshot(room, io);
            checkAndScheduleActions(room, io);
            return;
        }
    }

    // No deaths: proceed to next round (green light)
    snapshot.meeting = undefined;
    snapshot.voting = undefined;
    snapshot.execution = undefined;
    snapshot.logs = [];
    transitionToGreenLight(snapshot);
    broadcastSnapshot(room, io);
    checkAndScheduleActions(room, io);
}

function scheduleMeetingToVoting(
    room: { code: string; snapshot: any },
    io: Server
): void {
    const snapshot = room.snapshot as JokerSnapshot;
    if (!snapshot.deadline) return;

    const delay = Math.max(0, snapshot.deadline - Date.now());

    const timer = setTimeout(() => {
        transitionToVoting(snapshot);
        broadcastSnapshot(room, io);
        checkAndScheduleActions(room, io);
    }, delay);

    addTimeout(room.code, timer);
}

function scheduleVoteResolution(
    room: { code: string; snapshot: any },
    io: Server
): void {
    const snapshot = room.snapshot as JokerSnapshot;
    if (!snapshot.deadline) return;

    const delay = Math.max(0, snapshot.deadline - Date.now());

    const timer = setTimeout(() => {
        // Check if all alive players voted
        const alivePlayers = snapshot.players.filter(p => p.isAlive && p.sessionId);
        const allVoted = alivePlayers.every(p => p.hasVoted);

        if (!allVoted) {
            // Auto-skip for players who didn't vote
            for (const player of alivePlayers) {
                if (!player.hasVoted) {
                    player.hasVoted = true;
                    player.voteTarget = null;
                    if (snapshot.voting) {
                        snapshot.voting.votes.push({
                            voterSessionId: player.sessionId!,
                            targetSessionId: null,
                            submittedAt: Date.now(),
                        });
                    }
                }
            }
        }

        resolveVotes(snapshot);
        broadcastSnapshot(room, io);
        checkAndScheduleActions(room, io);
    }, delay);

    addTimeout(room.code, timer);
}

function schedulePostExecution(
    room: { code: string; snapshot: any },
    io: Server
): void {
    const snapshot = room.snapshot as JokerSnapshot;
    if (!snapshot.deadline) return;

    const delay = Math.max(0, snapshot.deadline - Date.now());

    const timer = setTimeout(() => {
        // Check win condition
        const result = checkWinCondition(snapshot);
        if (result) {
            finalizeGame(snapshot, result);
            broadcastSnapshot(room, io);
            clearRoomTimeouts(room.code);
            return;
        }

        // Clear meeting/voting state
        snapshot.meeting = undefined;
        snapshot.voting = undefined;
        snapshot.execution = undefined;
        snapshot.logs = [];

        // Continue to next round
        transitionToGreenLight(snapshot);
        broadcastSnapshot(room, io);
        checkAndScheduleActions(room, io);
    }, delay);

    addTimeout(room.code, timer);
}

// ============ Oxygen Tick ============

function startOxygenTick(
    room: { code: string; snapshot: any },
    io: Server
): void {
    // Don't start if already running
    if (oxygenIntervals.has(room.code)) return;

    const interval = setInterval(() => {
        const snapshot = room.snapshot as JokerSnapshot;
        if (!snapshot || snapshot.engine !== "joker") {
            stopOxygenTick(room.code);
            return;
        }

        if (snapshot.paused) {
            return;
        }

        // Only tick during light phases
        if (!["green_light", "yellow_light", "red_light"].includes(snapshot.phase)) {
            return;
        }

        tickOxygen(snapshot);
        const deaths = checkOxygenDeath(snapshot);

        // Process ghost haunting tick (deduct oxygen every 10s of countdown)
        const hauntDeducted = processHauntingTick(snapshot, snapshot.deadline);
        if (hauntDeducted.length > 0) {
            broadcastSnapshot(room, io);
        }

        if (deaths.length > 0) {
            // Someone died from oxygen
            broadcastSnapshot(room, io);

            // Check win condition
            const result = checkWinCondition(snapshot);
            if (result) {
                finalizeGame(snapshot, result);
                broadcastSnapshot(room, io);
                clearRoomTimeouts(room.code);
            }
        }

        // Shared task state advance (scaffold)
        if (snapshot.phase === "red_light" && snapshot.tasks?.sharedByLocation) {
            const now = Date.now();
            for (const shared of Object.values(snapshot.tasks.sharedByLocation)) {
                if (shared.status === "waiting" && shared.participants.length > 0) {
                    const allJoined = shared.participants.every(id => shared.joined.includes(id));
                    if (allJoined) {
                        shared.status = "active";
                        shared.startedAt = now;
                        const durationMs = SHARED_TASK_DURATIONS_MS[shared.type] ?? 10_000;
                        shared.deadlineAt = now + durationMs;
                        if (shared.type === "nine_grid" && !shared.gridBySession) {
                            initNineGridSharedTask(shared);
                        }
                        if (shared.type === "digit_puzzle" && !shared.digitSegmentsBySession) {
                            initDigitPuzzleSharedTask(shared);
                        }
                        snapshot.updatedAt = now;
                        broadcastSnapshot(room, io);
                    }
                } else if (shared.status === "active" && shared.deadlineAt && now >= shared.deadlineAt) {
                    const res = resolveSharedTask(snapshot, shared.location, false);
                    if (res.ok) {
                        broadcastSnapshot(room, io);
                    }
                }
                if (shared.status === "resolved" && shared.resolvedAt && now - shared.resolvedAt > 2000) {
                    delete snapshot.tasks.sharedByLocation[shared.location];
                    snapshot.updatedAt = now;
                    broadcastSnapshot(room, io);
                }
            }
        }

        if (snapshot.phase === "red_light") {
            const emergencyByLocation = snapshot.tasks?.emergencyByLocation;
            if (!emergencyByLocation) return;
            const now = Date.now();
            const emergencyEntries = Object.entries(emergencyByLocation) as Array<[JokerLocation, JokerEmergencyTaskState]>;
            for (const [location, emergency] of emergencyEntries) {
                if (emergency.type !== "golden_rabbit") continue;
                if (emergency.status === "waiting" && emergency.joinDeadlineAt && now >= emergency.joinDeadlineAt) {
                    if (emergency.participants.length > 0) {
                        startGoldenRabbitHunt(emergency, now);
                        snapshot.updatedAt = now;
                    } else {
                        resolveGoldenRabbitTask(snapshot, emergency, false);
                    }
                    broadcastSnapshot(room, io);
                }
                if (emergency.status === "resolved" && emergency.resolvedAt && now - emergency.resolvedAt > 2000) {
                    delete emergencyByLocation[location];
                    snapshot.updatedAt = now;
                    broadcastSnapshot(room, io);
                }
            }
        }
    }, 1000); // Tick every second

    oxygenIntervals.set(room.code, interval);
}

function stopOxygenTick(roomCode: string): void {
    const interval = oxygenIntervals.get(roomCode);
    if (interval) {
        clearInterval(interval);
        oxygenIntervals.delete(roomCode);
    }
}

// ============ Early Vote Check ============

export function checkAllVoted(
    room: { code: string; snapshot: any },
    io: Server
): void {
    const snapshot = room.snapshot as JokerSnapshot;
    if (!snapshot || snapshot.phase !== "voting") return;

    const alivePlayers = snapshot.players.filter(p => p.isAlive && p.sessionId);
    const allVoted = alivePlayers.every(p => p.hasVoted);

    if (allVoted) {
        // Clear existing timers and resolve immediately
        clearRoomTimeouts(room.code);
        resolveVotes(snapshot);
        broadcastSnapshot(room, io);
        checkAndScheduleActions(room, io);
    }
}
