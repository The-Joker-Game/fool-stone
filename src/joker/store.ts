// src/joker/store.ts
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { PresenceState } from "../realtime/socket";
import type {
    JokerSnapshot,
    JokerPlayerState,
    JokerLocation,
    SelectLocationPayload,
    SubmitLifeCodeActionPayload,
    SubmitVotePayload,
} from "./types";
import { rt, getSessionId } from "../realtime/socket";

const MAX_SEATS = 16;

type JokerSnapshotInput = Partial<JokerSnapshot> & { engine: "joker" };

export interface JokerStore {
    snapshot: JokerSnapshot | null;
    lastError: string | null;
    setSnapshot: (snapshot: JokerSnapshotInput | null) => void;
    ensureSnapshotFromPresence: (presence: PresenceState | null) => void;
    clearError: () => void;

    // Game actions
    startGame: () => Promise<{ ok: boolean; error?: string }>;
    selectLocation: (location: JokerLocation) => Promise<{ ok: boolean; error?: string }>;
    submitAction: (code: string, action: "kill" | "oxygen") => Promise<{ ok: boolean; error?: string }>;
    report: () => Promise<{ ok: boolean; error?: string }>;
    vote: (targetSessionId: string | null) => Promise<{ ok: boolean; error?: string }>;
    resetGame: () => Promise<{ ok: boolean; error?: string }>;
    // Ghost actions
    ghostSelectLocation: (location: JokerLocation) => Promise<{ ok: boolean; error?: string }>;
    ghostHaunt: (targetSessionId: string) => Promise<{ ok: boolean; error?: string }>;
}

export const useJokerStore = create<JokerStore>()(
    immer((set, get) => ({
        snapshot: null,
        lastError: null,

        setSnapshot(incoming) {
            if (incoming === null) {
                set({ snapshot: null });
                return;
            }
            set(state => {
                if (!state.snapshot) {
                    state.snapshot = incoming as JokerSnapshot;
                } else {
                    mergeIncomingSnapshot(state.snapshot, incoming);
                }
            });
        },

        ensureSnapshotFromPresence(presence) {
            if (!presence?.roomCode) return;
            set(state => {
                if (!state.snapshot) {
                    // Don't create snapshot from presence alone - wait for server
                    return;
                }
                syncSnapshotWithPresence(state.snapshot, presence);
            });
        },

        clearError() {
            set({ lastError: null });
        },

        async startGame() {
            const snapshot = get().snapshot;
            if (!snapshot) return { ok: false, error: "No snapshot" };
            try {
                const resp = await rt.emitAck("intent", {
                    room: snapshot.roomCode,
                    action: "joker:start_game",
                    from: getSessionId(),
                }, 5000);
                return { ok: (resp as any)?.ok ?? false, error: (resp as any)?.msg };
            } catch (e) {
                return { ok: false, error: "Failed to start game" };
            }
        },

        async selectLocation(location) {
            const snapshot = get().snapshot;
            if (!snapshot) return { ok: false, error: "No snapshot" };
            const me = snapshot.players.find(p => p.sessionId === getSessionId());
            if (!me) return { ok: false, error: "Player not found" };

            try {
                const payload: SelectLocationPayload = { seat: me.seat, location };
                const resp = await rt.emitAck("intent", {
                    room: snapshot.roomCode,
                    action: "joker:select_location",
                    data: payload,
                    from: getSessionId(),
                }, 3000);
                return { ok: (resp as any)?.ok ?? false, error: (resp as any)?.msg };
            } catch (e) {
                return { ok: false, error: "Failed to select location" };
            }
        },

        async submitAction(code, action) {
            const snapshot = get().snapshot;
            if (!snapshot) return { ok: false, error: "No snapshot" };
            const me = snapshot.players.find(p => p.sessionId === getSessionId());
            if (!me) return { ok: false, error: "Player not found" };

            try {
                const payload: SubmitLifeCodeActionPayload = {
                    actorSeat: me.seat,
                    code,
                    action,
                };
                const resp = await rt.emitAck("intent", {
                    room: snapshot.roomCode,
                    action: "joker:submit_action",
                    data: payload,
                    from: getSessionId(),
                }, 3000);
                return { ok: (resp as any)?.ok ?? false, error: (resp as any)?.msg };
            } catch (e) {
                return { ok: false, error: "Failed to submit action" };
            }
        },

        async report() {
            const snapshot = get().snapshot;
            if (!snapshot) return { ok: false, error: "No snapshot" };

            try {
                const resp = await rt.emitAck("intent", {
                    room: snapshot.roomCode,
                    action: "joker:report",
                    from: getSessionId(),
                }, 3000);
                return { ok: (resp as any)?.ok ?? false, error: (resp as any)?.msg };
            } catch (e) {
                return { ok: false, error: "Failed to report" };
            }
        },

        async vote(targetSessionId) {
            const snapshot = get().snapshot;
            if (!snapshot) return { ok: false, error: "No snapshot" };

            try {
                const payload: SubmitVotePayload = { targetSessionId };
                const resp = await rt.emitAck("intent", {
                    room: snapshot.roomCode,
                    action: "joker:vote",
                    data: payload,
                    from: getSessionId(),
                }, 3000);
                return { ok: (resp as any)?.ok ?? false, error: (resp as any)?.msg };
            } catch (e) {
                return { ok: false, error: "Failed to vote" };
            }
        },

        async resetGame() {
            const snapshot = get().snapshot;
            if (!snapshot) return { ok: false, error: "No snapshot" };

            try {
                const resp = await rt.emitAck("intent", {
                    room: snapshot.roomCode,
                    action: "joker:reset_game",
                    from: getSessionId(),
                }, 3000);
                return { ok: (resp as any)?.ok ?? false, error: (resp as any)?.msg };
            } catch (e) {
                console.error("Failed to reset game", e);
                return { ok: false, error: "Failed to reset game" };
            }
        },

        async ghostSelectLocation(location) {
            const snapshot = get().snapshot;
            if (!snapshot) return { ok: false, error: "No snapshot" };

            try {
                const resp = await rt.emitAck("intent", {
                    room: snapshot.roomCode,
                    action: "joker:ghost_select_location",
                    data: { location },
                    from: getSessionId(),
                }, 3000);
                return { ok: (resp as any)?.ok ?? false, error: (resp as any)?.msg };
            } catch (e) {
                return { ok: false, error: "Failed to select ghost location" };
            }
        },

        async ghostHaunt(targetSessionId) {
            const snapshot = get().snapshot;
            if (!snapshot) return { ok: false, error: "No snapshot" };

            try {
                const resp = await rt.emitAck("intent", {
                    room: snapshot.roomCode,
                    action: "joker:ghost_haunt",
                    data: { targetSessionId },
                    from: getSessionId(),
                }, 3000);
                return { ok: (resp as any)?.ok ?? false, error: (resp as any)?.msg };
            } catch (e) {
                return { ok: false, error: "Failed to haunt" };
            }
        },
    }))
);

// Helper functions
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
        lifeCode: "",
        lifeCodeVersion: 0,
        oxygenState: {
            baseOxygen: 270,
            drainRate: 0,
            baseTimestamp: Date.now(),
        },
        duckEmergencyUsed: false,
        hawkEmergencyUsed: false,
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
        lastHauntTickAt: null,
    };
}

function syncSnapshotWithPresence(snapshot: JokerSnapshot, presence: PresenceState): void {
    const presenceMap = new Map(presence.users.map(u => [u.sessionId, u]));

    for (const player of snapshot.players) {
        if (!player.sessionId) continue;
        const presenceUser = presenceMap.get(player.sessionId);
        if (presenceUser) {
            player.name = presenceUser.name;
            player.isHost = presenceUser.isHost ?? false;
            player.isBot = presenceUser.isBot ?? false;
            player.isDisconnected = presenceUser.isDisconnected ?? false;
            if (snapshot.phase === "lobby") {
                player.isReady = presenceUser.ready ?? false;
            }
        }
    }

    // Add new players from presence
    for (const user of presence.users) {
        const exists = snapshot.players.some(p => p.sessionId === user.sessionId);
        if (!exists && user.seat >= 1 && user.seat <= MAX_SEATS) {
            const player = createEmptyPlayer(user.seat);
            player.sessionId = user.sessionId;
            player.name = user.name;
            player.isHost = user.isHost ?? false;
            player.isBot = user.isBot ?? false;
            player.isReady = user.ready ?? false;
            snapshot.players[user.seat - 1] = player;
        }
    }

    snapshot.updatedAt = Date.now();
}

function mergeIncomingSnapshot(target: JokerSnapshot, incoming: JokerSnapshotInput): void {
    // Full replace for most fields
    if (incoming.phase !== undefined) target.phase = incoming.phase;
    if (incoming.roundCount !== undefined) target.roundCount = incoming.roundCount;

    // Merge players while preserving names
    if (incoming.players !== undefined) {
        for (let i = 0; i < incoming.players.length && i < target.players.length; i++) {
            const incomingPlayer = incoming.players[i];
            const targetPlayer = target.players[i];

            // If incoming player has same sessionId, merge the data
            if (incomingPlayer.sessionId === targetPlayer.sessionId) {
                // Preserve name if incoming name is empty but target has a name
                const preservedName = incomingPlayer.name || targetPlayer.name;
                Object.assign(targetPlayer, incomingPlayer);
                if (preservedName) {
                    targetPlayer.name = preservedName;
                }
            } else {
                // Different player or new seat assignment, just replace
                target.players[i] = incomingPlayer;
            }
        }
        // Handle any additional players beyond target length
        if (incoming.players.length > target.players.length) {
            for (let i = target.players.length; i < incoming.players.length; i++) {
                target.players.push(incoming.players[i]);
            }
        }
    }

    if (incoming.activeLocations !== undefined) target.activeLocations = incoming.activeLocations;
    if (incoming.lifeCodes !== undefined) target.lifeCodes = incoming.lifeCodes;
    if (incoming.round !== undefined) target.round = incoming.round;
    if (incoming.meeting !== undefined) target.meeting = incoming.meeting;
    if (incoming.voting !== undefined) target.voting = incoming.voting;
    if (incoming.execution !== undefined) target.execution = incoming.execution;
    if (incoming.gameResult !== undefined) target.gameResult = incoming.gameResult;
    if (incoming.logs !== undefined) target.logs = incoming.logs;
    if ('deadline' in incoming) target.deadline = incoming.deadline;
    if ('paused' in incoming) target.paused = incoming.paused;
    if ('pauseRemainingMs' in incoming) target.pauseRemainingMs = incoming.pauseRemainingMs;
    if (incoming.hostSessionId !== undefined) target.hostSessionId = incoming.hostSessionId;
    if (incoming.taskProgress !== undefined) target.taskProgress = incoming.taskProgress;
    if (incoming.tasks !== undefined) target.tasks = incoming.tasks;
    if (incoming.deaths !== undefined) target.deaths = incoming.deaths;
    if (incoming.votingHistory !== undefined) target.votingHistory = incoming.votingHistory;
    if (incoming.locationHistory !== undefined) target.locationHistory = incoming.locationHistory;

    // Merge chat messages
    if (incoming.chatMessages) {
        const existingIds = new Set(target.chatMessages.map(m => m.id));
        for (const msg of incoming.chatMessages) {
            if (!existingIds.has(msg.id)) {
                target.chatMessages.push(msg);
            }
        }
    }

    target.updatedAt = incoming.updatedAt ?? Date.now();
}
