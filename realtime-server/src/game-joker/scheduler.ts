// realtime-server/src/game-joker/scheduler.ts

import type { Server } from "socket.io";
import type { JokerSnapshot } from "./types.js";
import {
    PHASE_DURATIONS,
    transitionToGreenLight,
    transitionToYellowLight,
    transitionToRedLight,
    rotateLifeCodesAtHalfRedLight,
    transitionToVoting,
    resolveVotes,
    checkWinCondition,
    finalizeGame,
    tickOxygen,
    checkOxygenDeath,
    startMeeting,
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

    const phaseStart = snapshot.round.phaseStartAt;
    const halfDelay = 30_000; // 30 seconds into red light
    const fullDelay = Math.max(0, snapshot.deadline - Date.now());

    // Schedule life code rotation at 30s mark
    if (snapshot.round.redLightHalf === "first") {
        const rotationDelay = Math.max(0, phaseStart + halfDelay - Date.now());

        const rotationTimer = setTimeout(() => {
            rotateLifeCodesAtHalfRedLight(snapshot);
            broadcastSnapshot(room, io);
        }, rotationDelay);

        addTimeout(room.code, rotationTimer);
    }

    // Schedule end of red light
    const endTimer = setTimeout(() => {
        handleRedLightEnd(room, io);
    }, fullDelay);

    addTimeout(room.code, endTimer);
}

function handleRedLightEnd(
    room: { code: string; snapshot: any },
    io: Server
): void {
    const snapshot = room.snapshot as JokerSnapshot;

    // Check for deaths from kills during red light
    const deadPlayers = snapshot.players.filter(
        p => !p.isAlive && p.sessionId
    );

    // Check win condition
    const result = checkWinCondition(snapshot);
    if (result) {
        finalizeGame(snapshot, result);
        broadcastSnapshot(room, io);
        clearRoomTimeouts(room.code);
        return;
    }

    // If there were any deaths during red light, trigger meeting
    // For simplicity, we check if any player died (isAlive=false with role assigned)
    const recentDeaths = snapshot.logs.filter(
        log => log.type === "kill" || log.type === "death"
    );

    if (recentDeaths.length > 0) {
        // Find a living player to be the "reporter" (system auto-reports)
        const livingPlayer = snapshot.players.find(p => p.isAlive && p.sessionId);
        if (livingPlayer && livingPlayer.sessionId) {
            startMeeting(snapshot, livingPlayer.sessionId);
            broadcastSnapshot(room, io);
            checkAndScheduleActions(room, io);
            return;
        }
    }

    // Clear logs for next round
    snapshot.logs = [];

    // No deaths, continue to next round
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

        // Only tick during light phases
        if (!["green_light", "yellow_light", "red_light"].includes(snapshot.phase)) {
            return;
        }

        tickOxygen(snapshot);
        const deaths = checkOxygenDeath(snapshot);

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
