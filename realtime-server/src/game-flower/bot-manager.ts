// realtime-server/src/game-flower/bot-manager.ts
import type { Server } from "socket.io";
// import type { Room } from "../types.js"; // Removed to avoid conflict with index.ts local Room type
import {
    submitNightAction,
    submitDayVote,
    passTurn,
    resolveNight,
    resolveDayVote
} from "./engine.js";
import {
    getBotNightActionTarget,
    getBotVoteTarget,
    generateBotSpeech,
    generateBotLastWords
} from "./bot-logic.js";
import { initBotMemory, getBotMemory } from "./bot-state.js";
import type { FlowerSnapshot } from "./types.js";

// Keep track of scheduled timeouts to avoid duplicates or memory leaks if room closes
// Map<RoomCode, Set<TimeoutId>>
const roomTimeouts = new Map<string, Set<NodeJS.Timeout>>();

function addTimeout(roomCode: string, timeout: NodeJS.Timeout) {
    if (!roomTimeouts.has(roomCode)) {
        roomTimeouts.set(roomCode, new Set());
    }
    roomTimeouts.get(roomCode)!.add(timeout);
}

export function clearRoomTimeouts(roomCode: string) {
    const timeouts = roomTimeouts.get(roomCode);
    if (timeouts) {
        for (const t of timeouts) clearTimeout(t);
        timeouts.clear();
        roomTimeouts.delete(roomCode);
    }
}

export function checkAndScheduleBotActions(room: { code: string; snapshot: any }, io: Server) {
    if (!room.snapshot || room.snapshot.engine !== "flower") return;
    const snapshot = room.snapshot as FlowerSnapshot;
    const roomCode = room.code;

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
            const t = setTimeout(() => {
                if (!room.snapshot || room.snapshot.engine !== "flower") return;
                const currentSnap = room.snapshot as FlowerSnapshot;
                if (currentSnap.phase !== "day_discussion") return;

                // Verify it's still this bot's turn
                const freshSpeakerSeat = currentSnap.day.speechOrder[currentSnap.day.currentSpeakerIndex];
                if (freshSpeakerSeat !== currentSpeakerSeat) return;

                // Generate speech
                const speech = generateBotSpeech(currentSnap, currentSpeakerSeat);

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
                        checkAndScheduleBotActions(room, io);
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
                const t = setTimeout(() => {
                    if (!room.snapshot || room.snapshot.engine !== "flower") return;
                    const currentSnap = room.snapshot as FlowerSnapshot;
                    if (currentSnap.phase !== "day_last_words") return;

                    // Verify it's still this bot's turn
                    const freshLastWords = currentSnap.day.lastWords;
                    if (!freshLastWords || freshLastWords.queue[currentSnap.day.currentSpeakerIndex] !== currentSpeakerSeat) return;

                    // Generate speech
                    const speech = generateBotLastWords(currentSnap, currentSpeakerSeat);

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
                            checkAndScheduleBotActions(room, io);
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
