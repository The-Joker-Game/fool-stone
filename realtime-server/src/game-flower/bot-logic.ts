// realtime-server/src/game-flower/bot-logic.ts
import type { FlowerSnapshot, FlowerRole, FlowerLogEntry } from "./types.js";
import {
    OPENING_TEMPLATES,
    FOLLOW_UP_OPENINGS,
    DEATH_COMMENT_TEMPLATES,
    SUSPICION_TEMPLATES,
    DEFENSE_TEMPLATES,
    PASS_TEMPLATES
} from "./bot-templates.js";

function randomFrom<T>(list: T[]): T | null {
    if (list.length === 0) return null;
    return list[Math.floor(Math.random() * list.length)];
}

function formatTemplate(template: string, replacements: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(replacements)) {
        result = result.replace(new RegExp(`{${key}}`, "g"), value);
    }
    return result;
}

// --- Helper: Parse Police Memory from Logs ---
interface PoliceMemory {
    badSeats: Set<number>;
    goodSeats: Set<number>;
    checkedSeats: Set<number>;
}

function parsePoliceMemory(logs: FlowerLogEntry[]): PoliceMemory {
    const memory: PoliceMemory = {
        badSeats: new Set(),
        goodSeats: new Set(),
        checkedSeats: new Set(),
    };

    // Regex to match police logs (assuming standard format)
    const badRegex = /警察验出座位 (\d+) 为坏特殊/;
    const goodRegex = /警察验出座位 (\d+) 非坏特殊/;
    const unknownRegex = /警察无法验出座位 (\d+)/;

    logs.forEach(log => {
        let match = log.text.match(badRegex);
        if (match) {
            const seat = parseInt(match[1], 10);
            memory.badSeats.add(seat);
            memory.checkedSeats.add(seat);
            return;
        }
        match = log.text.match(goodRegex);
        if (match) {
            const seat = parseInt(match[1], 10);
            memory.goodSeats.add(seat);
            memory.checkedSeats.add(seat);
            return;
        }
        match = log.text.match(unknownRegex);
        if (match) {
            // const seat = parseInt(match[1], 10);
            // Even if unknown, we tried to check them. Maybe don't check again immediately?
            // For simplicity, let's say we don't count them as "checked" so we might retry,
            // OR we count them to avoid wasting turns. Let's NOT add to checkedSeats to allow retry.
            return;
        }
    });

    return memory;
}

// --- Bot Night Action Logic ---
export function getBotNightActionTarget(
    snapshot: FlowerSnapshot,
    mySeat: number,
    myRole: FlowerRole
): number | null {
    const players = snapshot.players;
    const alivePlayers = players.filter(p => p.isAlive);
    const aliveSeats = alivePlayers.map(p => p.seat);
    const otherAliveSeats = aliveSeats.filter(s => s !== mySeat);

    if (aliveSeats.length === 0) return null;

    switch (myRole) {
        case "警察": {
            // Police Strategy: Prioritize unchecked players
            const memory = parsePoliceMemory(snapshot.logs || []);
            const uncheckedCandidates = otherAliveSeats.filter(s => !memory.checkedSeats.has(s));

            if (uncheckedCandidates.length > 0) {
                return randomFrom(uncheckedCandidates);
            }
            // If all checked (unlikely), pick random other
            return randomFrom(otherAliveSeats);
        }

        case "医生": {
            // Doctor Strategy: 
            // Night 0 (first night): 90% chance to save self
            // Other nights: Random save (can include self, but maybe lower chance?)
            // For simplicity: Random from ALL alive (including self)
            // But let's add the Night 0 bias.
            if (snapshot.dayCount === 0) {
                if (Math.random() < 0.9) return mySeat;
            }
            return randomFrom(aliveSeats);
        }

        case "花蝴蝶":
        case "狙击手":
        case "杀手":
        case "魔法师":
        case "森林老人":
        case "善民":
        case "恶民":
            // Standard offensive/action roles: Target others
            return randomFrom(otherAliveSeats);

        default:
            return null;
    }
}

// --- Bot Vote Logic ---
export function getBotVoteTarget(
    snapshot: FlowerSnapshot,
    mySeat: number,
    myRole: FlowerRole
): number | null {
    const alivePlayers = snapshot.players.filter(p => p.isAlive);
    const otherAliveSeats = alivePlayers
        .filter(p => p.seat !== mySeat)
        .map(p => p.seat);

    if (otherAliveSeats.length === 0) return null;

    // 1. Police Logic: Vote for known bad guys
    if (myRole === "警察") {
        const memory = parsePoliceMemory(snapshot.logs || []);
        // Find alive bad guys
        const aliveBadSeats = Array.from(memory.badSeats).filter(s =>
            alivePlayers.some(p => p.seat === s)
        );

        if (aliveBadSeats.length > 0) {
            // Found a bad guy! Vote him!
            return aliveBadSeats[0];
        }
    }

    // 2. Bandwagon Logic (Follow the crowd)
    // Check current votes
    const currentVotes = snapshot.day.votes || [];
    const voteCounts: Record<number, number> = {};

    currentVotes.forEach(v => {
        voteCounts[v.targetSeat] = (voteCounts[v.targetSeat] || 0) + 1;
    });

    // Find leaders
    let maxVotes = 0;
    const leaders: number[] = [];
    for (const [seatStr, count] of Object.entries(voteCounts)) {
        const seat = parseInt(seatStr, 10);
        if (count > maxVotes) {
            maxVotes = count;
            leaders.length = 0; // clear
            leaders.push(seat);
        } else if (count === maxVotes) {
            leaders.push(seat);
        }
    }

    // If there is a clear leader (or leaders) with at least 2 votes, 
    // and we are not a police with a specific target, maybe join them?
    // 50% chance to join the bandwagon if maxVotes >= 2
    if (maxVotes >= 2 && leaders.length > 0 && Math.random() < 0.5) {
        // Filter leaders to ensure they are valid targets (alive and not self)
        const validLeaders = leaders.filter(s => otherAliveSeats.includes(s));
        if (validLeaders.length > 0) {
            return randomFrom(validLeaders);
        }
    }

    // 3. Default: Random Vote
    return randomFrom(otherAliveSeats);
}

export function generateBotSpeech(snapshot: FlowerSnapshot, botSeat: number): string {
    const players = snapshot.players;
    const alivePlayers = players.filter(p => p.isAlive && p.seat !== botSeat);
    // const deadPlayers = players.filter(p => !p.isAlive);

    // Determine context
    const lastNightDeaths = snapshot.night.result?.deaths || [];
    const hasDeathsLastNight = lastNightDeaths.length > 0;
    const speechOrder = snapshot.day.speechOrder;
    const botIndex = speechOrder.indexOf(botSeat);

    const parts: string[] = [];

    // 1. Opening (30% chance)
    if (Math.random() < 0.3) {
        let templates = [...OPENING_TEMPLATES];
        // Only use follow-up openings if there have been at least 3 previous speakers
        // to avoid awkwardness like "heard a lot of speeches" when only 1 person spoke.
        if (botIndex >= 3) {
            templates = [...templates, ...FOLLOW_UP_OPENINGS];
        }
        const opening = randomFrom(templates);
        if (opening) parts.push(opening);
    }

    // 2. Comment on death (if any) (50% chance if deaths occurred)
    if (hasDeathsLastNight && Math.random() < 0.5) {
        const deadSeat = lastNightDeaths[0].seat;
        const deadPlayer = players.find(p => p.seat === deadSeat);
        const deadName = deadPlayer ? `${deadPlayer.seat}号` : "昨晚死者";
        const template = randomFrom(DEATH_COMMENT_TEMPLATES);
        if (template) {
            parts.push(formatTemplate(template, { dead: deadName }));
        }
    }

    // 3. Main Content (Suspicion or Defense)
    const actionRoll = Math.random();
    if (actionRoll < 0.4 && alivePlayers.length > 0) {
        // Suspicion
        const target = randomFrom(alivePlayers);
        if (target) {
            const targetName = `${target.seat}号`;
            const template = randomFrom(SUSPICION_TEMPLATES);
            if (template) {
                parts.push(formatTemplate(template, { target: targetName }));
            }
        }
    } else if (actionRoll < 0.7) {
        // Defense
        const template = randomFrom(DEFENSE_TEMPLATES);
        if (template) parts.push(template);
    } else {
        // Just pass (handled by closing)
    }

    // 4. Closing (Always, unless covered by main content implying end, but templates are safe to combine)
    const closing = randomFrom(PASS_TEMPLATES);
    if (closing) parts.push(closing);

    return parts.join("");
}
