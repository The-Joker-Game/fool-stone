// realtime-server/src/game-flower/scheduler.ts
import type { Server } from "socket.io";
// import type { Room } from "../types.js"; // Removed to avoid conflict with index.ts local Room type
import {
    submitNightAction,
    submitDayVote,
    passTurn,
    resolveNight,
    resolveDayVote,
    canAutoAdvance
} from "./engine.js";
import {
    getBotNightActionTarget,
    getBotVoteTarget
} from "./bot-logic.js";
import {
    generateBotSpeech,
    generateBotLastWords
} from "./bot-logic-ai.js";
import { initBotMemory, getBotMemory } from "./bot-state.js";
import type { FlowerSnapshot } from "./types.js";

// Keep track of scheduled timeouts to avoid duplicates or memory leaks if room closes
// Map<RoomCode, Set<TimeoutId>>
const roomTimeouts = new Map<string, Set<NodeJS.Timeout>>();
const speakerConfirmTimers = new Map<string, { key: string; timeout: NodeJS.Timeout }>();

function logPendingActionables(snapshot: FlowerSnapshot) {
    if (snapshot.phase === "day_vote") {
        const pending = snapshot.players
            .filter(p => p.isAlive && !p.isMutedToday && !p.hasVotedToday)
            .map(p => p.seat);
        console.log(`[Scheduler][${snapshot.roomCode}] pending day_vote seats=${pending.join(",") || "-"}`);
    } else if (snapshot.phase === "night_actions") {
        const pending = snapshot.players
            .filter(p => p.isAlive && p.role && !p.nightAction)
            .map(p => `${p.seat}:${p.role}`);
        console.log(`[Scheduler][${snapshot.roomCode}] pending night_actions seats=${pending.join(",") || "-"}`);
    }
}

function tryAutoAdvanceIfDeadlinePassed(room: { code: string; snapshot: any }, io: Server): boolean {
    const snap = room.snapshot as FlowerSnapshot;
    if (!snap?.deadline) return false;
    if (Date.now() < snap.deadline) return false;

    if (!canAutoAdvance(snap)) {
        logPendingActionables(snap);
        return false;
    }

    let res;
    if (snap.phase === "night_actions") {
        console.log(`[Scheduler][${room.code}] deadline passed, auto-resolving night`);
        res = resolveNight(snap);
    } else if (snap.phase === "day_vote") {
        console.log(`[Scheduler][${room.code}] deadline passed, auto-resolving day vote`);
        res = resolveDayVote(snap);
    }

    if (res && res.ok) {
        io.to(room.code).emit("state:full", { snapshot: snap, from: "server", at: Date.now() });
        return true;
    }

    return false;
}

function addTimeout(roomCode: string, timeout: NodeJS.Timeout) {
    if (!roomTimeouts.has(roomCode)) {
        roomTimeouts.set(roomCode, new Set());
    }
    roomTimeouts.get(roomCode)!.add(timeout);
}

// Map<RoomCode, DeadlineTimestamp>
const scheduledDeadlines = new Map<string, number>();

export function clearRoomTimeouts(roomCode: string) {
    const timeouts = roomTimeouts.get(roomCode);
    if (timeouts) {
        for (const t of timeouts) clearTimeout(t);
        timeouts.clear();
        roomTimeouts.delete(roomCode);
    }
    const speakerTimeout = speakerConfirmTimers.get(roomCode);
    if (speakerTimeout) {
        clearTimeout(speakerTimeout.timeout);
        speakerConfirmTimers.delete(roomCode);
    }
    scheduledDeadlines.delete(roomCode);
}

export function checkAndScheduleActions(room: { code: string; snapshot: any }, io: Server) {
    if (!room.snapshot || room.snapshot.engine !== "flower") return;
    const snapshot = room.snapshot as FlowerSnapshot;
    const roomCode = room.code;

    // If deadline已到且所有人已行动，立即结算，避免错过的定时器
    const advanced = tryAutoAdvanceIfDeadlinePassed(room, io);
    if (advanced) {
        return;
    }

    // Schedule Deadline Reminder
    scheduleDeadlineReminder(room, io);
    scheduleSpeakerConfirmation(room, io);

    // 0. Initialize Bot Memory if needed
    snapshot.players.forEach(p => {
        if (p.isBot && p.role && !getBotMemory(roomCode, p.seat)) {
            initBotMemory(roomCode, p.seat, p.role, snapshot.players);
        }
    });

    // 1. Night Actions
    if (snapshot.phase === "night_actions") {
        snapshot.players.forEach(p => {
            if (p.isBot && p.isAlive && p.role && !p.nightAction) {
                // Check if already scheduled? 
                // Simple approach: Random delay, then check again if action still needed.
                const delay = Math.random() * 5000 + 2000; // 2-7s
                const t = setTimeout(() => {
                    // Re-fetch room/snapshot to ensure valid state
                    if (!room.snapshot || room.snapshot.engine !== "flower") return;
                    const currentSnap = room.snapshot as FlowerSnapshot;
                    if (currentSnap.phase !== "night_actions") return;

                    const currentPlayer = currentSnap.players.find(cp => cp.seat === p.seat);
                    if (!currentPlayer || !currentPlayer.isAlive || currentPlayer.nightAction) return;

                    const target = getBotNightActionTarget(currentSnap, p.seat, p.role!);
                    // Even if target is null (e.g. no valid target), we might want to "skip" or do nothing.
                    // But engine.ts submitNightAction handles logic.
                    // If target is null, maybe we don't submit? Or submit empty?
                    // For now, only submit if target found.
                    if (target !== null) {
                        const res = submitNightAction(currentSnap, {
                            role: p.role!,
                            actorSeat: p.seat,
                            targetSeat: target
                        });
                        if (res.ok) {
                            console.log(`[Bot] Seat ${p.seat} (${p.role}) acted on ${target}`);
                            io.to(roomCode).emit("state:full", { snapshot: currentSnap, from: "server", at: Date.now() });

                            // Check if all actions done? Maybe auto-resolve?
                            // For now, let host resolve manually as per original design, 
                            // OR we could auto-resolve if all bots acted? 
                            // Let's stick to manual resolve for now to avoid confusion.
                        }
                    }
                }, delay);
                addTimeout(roomCode, t);
            }
        });
    }

    // 2. Day Discussion (Speaking)
    if (snapshot.phase === "day_discussion") {
        const currentSpeakerSeat = snapshot.day.speechOrder[snapshot.day.currentSpeakerIndex];
        const currentSpeaker = snapshot.players.find(p => p.seat === currentSpeakerSeat);

        if (currentSpeaker && currentSpeaker.isBot && currentSpeaker.isAlive) {
            // Schedule speech
            const delay = Math.random() * 3000 + 2000; // 2-5s
            const t = setTimeout(async () => {
                if (!room.snapshot || room.snapshot.engine !== "flower") return;
                const currentSnap = room.snapshot as FlowerSnapshot;
                if (currentSnap.phase !== "day_discussion") return;

                // Verify it's still this bot's turn
                const freshSpeakerSeat = currentSnap.day.speechOrder[currentSnap.day.currentSpeakerIndex];
                if (freshSpeakerSeat !== currentSpeakerSeat) return;

                // Generate speech (async AI call)
                const speech = await generateBotSpeech(currentSnap, currentSpeakerSeat);

                // Add chat message
                const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                currentSnap.chatMessages.push({
                    id: msgId,
                    sessionId: "bot",
                    senderSeat: currentSpeakerSeat,
                    senderName: currentSpeaker.name,
                    content: speech,
                    mentions: [],
                    timestamp: Date.now()
                });

                // Broadcast speech immediately
                io.to(roomCode).emit("state:full", { snapshot: currentSnap, from: "server", at: Date.now() });

                // Schedule pass turn after a short reading delay
                const passDelay = 2000;
                const t2 = setTimeout(() => {
                    if (!room.snapshot || room.snapshot.engine !== "flower") return;
                    const snapAfterSpeech = room.snapshot as FlowerSnapshot;
                    if (snapAfterSpeech.phase !== "day_discussion") return;
                    // Verify turn again
                    if (snapAfterSpeech.day.speechOrder[snapAfterSpeech.day.currentSpeakerIndex] !== currentSpeakerSeat) return;

                    const res = passTurn(snapAfterSpeech);
                    if (res.ok) {
                        console.log(`[Bot] Seat ${currentSpeakerSeat} passed turn`);
                        io.to(roomCode).emit("state:full", { snapshot: snapAfterSpeech, from: "server", at: Date.now() });
                        // Recursive check for next bot
                        checkAndScheduleActions(room, io);
                    }
                }, passDelay);
                addTimeout(roomCode, t2);

            }, delay);
            addTimeout(roomCode, t);
        }
    }

    // 2.5 Day Last Words
    if (snapshot.phase === "day_last_words") {
        const lastWords = snapshot.day.lastWords;
        if (lastWords && lastWords.queue.length > 0) {
            const currentSpeakerSeat = lastWords.queue[snapshot.day.currentSpeakerIndex];
            const currentSpeaker = snapshot.players.find(p => p.seat === currentSpeakerSeat);

            if (currentSpeaker && currentSpeaker.isBot) { // Removed isAlive check as they are dead
                // Schedule speech
                const delay = Math.random() * 3000 + 2000; // 2-5s
                const t = setTimeout(async () => {
                    if (!room.snapshot || room.snapshot.engine !== "flower") return;
                    const currentSnap = room.snapshot as FlowerSnapshot;
                    if (currentSnap.phase !== "day_last_words") return;

                    // Verify it's still this bot's turn
                    const freshLastWords = currentSnap.day.lastWords;
                    if (!freshLastWords || freshLastWords.queue[currentSnap.day.currentSpeakerIndex] !== currentSpeakerSeat) return;

                    // Generate speech (async AI call)
                    const speech = await generateBotLastWords(currentSnap, currentSpeakerSeat);

                    // Add chat message
                    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                    currentSnap.chatMessages.push({
                        id: msgId,
                        sessionId: "bot",
                        senderSeat: currentSpeakerSeat,
                        senderName: currentSpeaker.name,
                        content: speech,
                        mentions: [],
                        timestamp: Date.now()
                    });

                    // Broadcast speech immediately
                    io.to(roomCode).emit("state:full", { snapshot: currentSnap, from: "server", at: Date.now() });

                    // Schedule pass turn after a short reading delay
                    const passDelay = 2000;
                    const t2 = setTimeout(() => {
                        if (!room.snapshot || room.snapshot.engine !== "flower") return;
                        const snapAfterSpeech = room.snapshot as FlowerSnapshot;
                        if (snapAfterSpeech.phase !== "day_last_words") return;
                        // Verify turn again
                        if (snapAfterSpeech.day.lastWords?.queue[snapAfterSpeech.day.currentSpeakerIndex] !== currentSpeakerSeat) return;

                        const res = passTurn(snapAfterSpeech);
                        if (res.ok) {
                            console.log(`[Bot] Seat ${currentSpeakerSeat} passed last words`);
                            io.to(roomCode).emit("state:full", { snapshot: snapAfterSpeech, from: "server", at: Date.now() });
                            // Recursive check for next bot
                            checkAndScheduleActions(room, io);
                        }
                    }, passDelay);
                    addTimeout(roomCode, t2);

                }, delay);
                addTimeout(roomCode, t);
            }
        }
    }

    // 3. Day Vote
    if (snapshot.phase === "day_vote") {
        snapshot.players.forEach(p => {
            if (p.isBot && p.isAlive && !p.hasVotedToday) {
                const delay = Math.random() * 4000 + 1000; // 1-5s
                const t = setTimeout(() => {
                    if (!room.snapshot || room.snapshot.engine !== "flower") return;
                    const currentSnap = room.snapshot as FlowerSnapshot;
                    if (currentSnap.phase !== "day_vote") return;

                    const currentPlayer = currentSnap.players.find(cp => cp.seat === p.seat);
                    if (!currentPlayer || !currentPlayer.isAlive || currentPlayer.hasVotedToday) return;

                    const target = getBotVoteTarget(currentSnap, p.seat, p.role!);
                    if (target !== null) {
                        const res = submitDayVote(currentSnap, {
                            voterSeat: p.seat,
                            targetSeat: target
                        });
                        if (res.ok) {
                            console.log(`[Bot] Seat ${p.seat} voted for ${target}`);
                            io.to(roomCode).emit("state:full", { snapshot: currentSnap, from: "server", at: Date.now() });
                        }
                    }
                }, delay);
                addTimeout(roomCode, t);
            }
        });
    }
}

function scheduleDeadlineReminder(room: { code: string; snapshot: any }, io: Server) {
    const snapshot = room.snapshot as FlowerSnapshot;
    const roomCode = room.code;
    const deadline = snapshot.deadline;

    if (!deadline) return;

    // Check if we already scheduled for this deadline
    if (scheduledDeadlines.get(roomCode) === deadline) return;

    const now = Date.now();
    const delay = deadline - now;

    if (delay <= 0) return; // Deadline already passed

    scheduledDeadlines.set(roomCode, deadline);
    console.log(
        `[Scheduler][${roomCode}] schedule deadline reminder phase=${snapshot.phase} delay=${delay}ms target=${new Date(
            deadline
        ).toISOString()}`
    );

    const t = setTimeout(() => {
        // Re-fetch room/snapshot
        if (!room.snapshot || room.snapshot.engine !== "flower") return;
        const currentSnap = room.snapshot as FlowerSnapshot;

        // Verify deadline is still the same (phase hasn't changed or reset)
        if (currentSnap.deadline !== deadline) return;
        console.log(`[Scheduler][${roomCode}] deadline reached phase=${currentSnap.phase} at=${new Date().toISOString()}`);

        // 1. Check for Auto-Advance (All actionable players have acted AND deadline passed)
        if (canAutoAdvance(currentSnap)) {
            let res;
            if (currentSnap.phase === "night_actions") {
                res = resolveNight(currentSnap);
            } else if (currentSnap.phase === "day_vote") {
                res = resolveDayVote(currentSnap);
            }

            if (res && res.ok) {
                io.to(roomCode).emit("state:full", { snapshot: currentSnap, from: "server", at: Date.now() });
                checkAndScheduleActions(room, io);
                return; // Auto-advanced, no reminder needed
            }
        } else {
            logPendingActionables(currentSnap);
        }

        // 2. If not auto-advanced, send reminder to inactive humans
        let targets: number[] = [];

        if (currentSnap.phase === "night_actions") {
            targets = currentSnap.players
                .filter(p => p.isAlive && p.role && !p.nightAction && !p.isBot)
                .map(p => p.seat);
        } else if (currentSnap.phase === "day_vote") {
            targets = currentSnap.players
                // Only remind alive, unmuted humans who仍有投票权
                .filter(p => p.isAlive && !p.hasVotedToday && !p.isBot && !p.isMutedToday)
                .map(p => p.seat);
        }

        if (targets.length > 0) {
            const mentions = targets.map(seat => {
                const p = currentSnap.players.find(pl => pl.seat === seat);
                return { seat, name: p?.name || `座位${seat}` };
            });

            const mentionText = mentions.map(m => `@${m.name}`).join(" ");

            let actionText = "";
            switch (currentSnap.phase) {
                case "day_vote":
                    actionText = "请尽快投票";
                    break;
                default:
                    actionText = "请尽快行动";
                    break;
            }

            const content = `${mentionText} ${actionText}`;

            const msgId = `sys_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            currentSnap.chatMessages.push({
                id: msgId,
                sessionId: "system",
                senderSeat: 0,
                senderName: "系统",
                content,
                mentions,
                timestamp: Date.now()
            });
            currentSnap.updatedAt = Date.now();

            io.to(roomCode).emit("state:full", { snapshot: currentSnap, from: "server", at: Date.now() });
        }
    }, delay);

    addTimeout(roomCode, t);
}

function scheduleSpeakerConfirmation(room: { code: string; snapshot: any }, io: Server) {
    const snapshot = room.snapshot as FlowerSnapshot;
    const roomCode = room.code;

    if (!snapshot || snapshot.engine !== "flower" || snapshot.phase !== "day_discussion") {
        const pending = speakerConfirmTimers.get(roomCode);
        if (pending) {
            clearTimeout(pending.timeout);
            speakerConfirmTimers.delete(roomCode);
        }
        return;
    }

    const day = snapshot.day;
    const currentSeat = day.speechOrder?.[day.currentSpeakerIndex];
    if (!currentSeat) {
        const pending = speakerConfirmTimers.get(roomCode);
        if (pending) {
            clearTimeout(pending.timeout);
            speakerConfirmTimers.delete(roomCode);
        }
        return;
    }

    const key = `${snapshot.dayCount}-${currentSeat}-${day.currentSpeakerIndex}`;
    const existing = speakerConfirmTimers.get(roomCode);
    if (existing?.key === key) return;
    if (existing) {
        clearTimeout(existing.timeout);
        speakerConfirmTimers.delete(roomCode);
    }

    const timeout = setTimeout(() => {
        speakerConfirmTimers.delete(roomCode);
        if (!room.snapshot || room.snapshot.engine !== "flower") return;
        const currentSnap = room.snapshot as FlowerSnapshot;
        if (currentSnap.phase !== "day_discussion") return;
        const seatNow = currentSnap.day.speechOrder?.[currentSnap.day.currentSpeakerIndex];
        const status = currentSnap.day.speakerStatus;
        const currentKey = `${currentSnap.dayCount}-${seatNow}-${currentSnap.day.currentSpeakerIndex}`;
        if (currentKey !== key) return;
        if (!seatNow) return;
        if (status?.seat === seatNow && status.state === "typing") return;

        const res = passTurn(currentSnap);
        if (res.ok) {
            io.to(roomCode).emit("state:full", { snapshot: currentSnap, from: "server", at: Date.now() });
            checkAndScheduleActions(room, io);
        }
    }, 3 * 60 * 1000);

    speakerConfirmTimers.set(roomCode, { key, timeout });
    addTimeout(roomCode, timeout);
}
