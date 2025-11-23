
import type { FlowerSnapshot, FlowerRole, FlowerLogEntry } from "./types.js";
import {
    GENERIC_OPENINGS,
    ROLE_CLAIMS,
    ACCUSATIONS,
    DEFENSES,
    DEATH_COMMENTS,
    LAST_WORDS,
    getRandomTemplate,
    formatTemplate
} from "./bot-templates.js";
import { getBotMemory, initBotMemory, updateBotSuspicion } from "./bot-state.js";

// --- Helper: Parse Police Memory from Logs ---
// (Kept similar but updates BotMemory)
function parsePoliceMemory(logs: FlowerLogEntry[], roomCode: string, mySeat: number) {
    const mem = getBotMemory(roomCode, mySeat);
    if (!mem) return;

    const badRegex = /警察验出座位 (\d+) 为坏特殊/;
    const goodRegex = /警察验出座位 (\d+) 非坏特殊/;

    logs.forEach(log => {
        let match = log.text.match(badRegex);
        if (match) {
            const seat = parseInt(match[1], 10);
            mem.knownRoles.set(seat, { role: "bad", source: "police" });
            // Update suspicion to MAX for bad guy
            mem.suspicion.set(seat, 100);
            return;
        }
        match = log.text.match(goodRegex);
        if (match) {
            const seat = parseInt(match[1], 10);
            mem.knownRoles.set(seat, { role: "good", source: "police" });
            // Update suspicion to MIN for good guy (if I am good)
            if (!["杀手", "魔法师", "森林老人", "恶民"].includes(mem.realRole)) {
                mem.suspicion.set(seat, 0);
            }
            return;
        }
    });
}

// --- Helper: Parse Chat for Police Claims ---
function parseChatForPoliceClaims(
    chatMessages: { senderSeat: number; content: string }[],
    roomCode: string,
    mySeat: number
) {
    const mem = getBotMemory(roomCode, mySeat);
    if (!mem) return;

    // Regex for Police claims
    // "我是警察"
    // "X号查杀" (X is bad)
    // "X号金水" (X is good)
    const policeClaimRegex = /我是警察/;
    const checkBadRegex = /(\d+)号?.*查杀/;
    const checkGoodRegex = /(\d+)号?.*金水/;

    chatMessages.forEach(msg => {
        // 1. Check if sender claims Police
        if (policeClaimRegex.test(msg.content)) {
            // If I am NOT Police, I might trust them.
            // If I AM Police, they are lying (Bad).
            if (mem.realRole === "警察") {
                mem.knownRoles.set(msg.senderSeat, { role: "bad", source: "witness" });
                mem.suspicion.set(msg.senderSeat, 100);
            } else {
                // If I am Good, I tentatively trust them unless I have conflicting info
                // For simplicity, let's just mark them as "Claimed Police" in a way?
                // Or just process their inspection results.
            }
        }

        // 2. Check for inspection results (only if we trust the sender or just listening)
        // For now, let's just listen to ANYONE saying "X号查杀" and treat it as a claim.
        // If multiple people claim, it's confusing.
        // Simplified logic: If someone says "X号查杀", and I don't know X is good, I might suspect X.

        const badMatch = msg.content.match(checkBadRegex);
        if (badMatch) {
            const targetSeat = parseInt(badMatch[1], 10);
            if (targetSeat !== mySeat) {
                // Someone says target is Bad.
                // If I am Good, I increase suspicion of target.
                if (!["杀手", "魔法师", "森林老人", "恶民"].includes(mem.realRole)) {
                    // But only if I don't know for sure they are Good.
                    const current = mem.suspicion.get(targetSeat) || 50;
                    mem.suspicion.set(targetSeat, Math.min(100, current + 30));
                }
            }
        }

        const goodMatch = msg.content.match(checkGoodRegex);
        if (goodMatch) {
            const targetSeat = parseInt(goodMatch[1], 10);
            if (targetSeat !== mySeat) {
                // Someone says target is Good.
                // If I am Good, I decrease suspicion.
                if (!["杀手", "魔法师", "森林老人", "恶民"].includes(mem.realRole)) {
                    const current = mem.suspicion.get(targetSeat) || 50;
                    mem.suspicion.set(targetSeat, Math.max(0, current - 30));
                }
            }
        }
    });
}

// --- Helper: Get Random Element ---
function getRandomElement<T>(list: T[]): T | undefined {
    if (!list || list.length === 0) return undefined;
    return list[Math.floor(Math.random() * list.length)];
}

// --- Bot Night Action Logic ---
export function getBotNightActionTarget(
    snapshot: FlowerSnapshot,
    mySeat: number,
    myRole: FlowerRole
): number | null {
    const mem = getBotMemory(snapshot.roomCode, mySeat);
    // If memory doesn't exist (e.g. server restart), try to init (best effort)
    if (!mem) {
        // We can't easily init here without allPlayers list if not passed, 
        // but snapshot has players.
        initBotMemory(snapshot.roomCode, mySeat, myRole, snapshot.players);
        // Retry
        return getBotNightActionTarget(snapshot, mySeat, myRole);
    }

    const alivePlayers = snapshot.players.filter(p => p.isAlive);
    const aliveSeats = alivePlayers.map(p => p.seat);
    const otherAliveSeats = aliveSeats.filter(s => s !== mySeat);

    if (aliveSeats.length === 0) return null;

    // Helper to get enemies (High suspicion) and allies (Low suspicion)
    // Shuffle first to avoid seat bias in stable sort
    const shuffledSeats = [...otherAliveSeats].sort(() => Math.random() - 0.5);

    // Sort by suspicion
    const sortedBySuspicion = shuffledSeats.sort((a, b) => {
        return (mem.suspicion.get(b) || 50) - (mem.suspicion.get(a) || 50);
    });

    const enemies = sortedBySuspicion.slice(0, Math.ceil(sortedBySuspicion.length / 2)); // Top half suspicious
    const allies = sortedBySuspicion.slice(Math.ceil(sortedBySuspicion.length / 2)).reverse(); // Bottom half (least suspicious)

    switch (myRole) {
        case "警察": {
            // Check someone unknown and suspicious
            // Filter out known roles
            const unknownCandidates = sortedBySuspicion.filter(s => !mem.knownRoles.has(s));
            if (unknownCandidates.length > 0) {
                // Pick the most suspicious unknown
                // Since we shuffled, unknownCandidates[0] is random among the most suspicious
                return unknownCandidates[0];
            }
            return unknownCandidates[0] || getRandomElement(otherAliveSeats) || null;
        }

        case "医生": {
            // Save allies or self.
            // MUST use skill.
            // Avoid consecutive empty needles on same target.

            // 1. Check self status
            const myState = snapshot.players.find(p => p.seat === mySeat);
            const myNeedles = myState?.needleCount || 0;

            // If I am high value (Doctor) and have needles < 2, maybe save self?
            // 30% chance to save self if not in immediate danger (random logic)
            // But if I have 1 needle, saving self again kills me? No, 2 needles kill.
            // If I have 1 needle, I should NOT save myself unless I am sure I will be attacked.

            // Strategy:
            // - If I have 0 needles: 40% save self, 60% save ally.
            // - If I have 1 needle: 10% save self (risky), 90% save ally.

            let target = -1;
            const saveSelfChance = myNeedles === 0 ? 0.4 : 0.1;

            if (Math.random() < saveSelfChance) {
                target = mySeat;
            } else {
                // Pick an ally
                target = allies[0] || mySeat;
            }

            // Check history to avoid consecutive saves on same target (if it causes empty needle)
            // Actually, we don't know if it was empty needle unless we track it.
            // But we can just avoid repeating the LAST target if possible.
            const lastAction = mem.actionHistory.nightActions[mem.actionHistory.nightActions.length - 1];
            if (lastAction && lastAction.target === target && allies.length > 1) {
                // Switch target
                target = allies[1];
            }

            mem.actionHistory.nightActions.push({ target, turn: snapshot.dayCount });
            return target;
        }

        case "狙击手":
        case "杀手": {
            // Kill enemies.
            // Prioritize high suspicion (which for Bad guys means Good guys)
            // For Sniper (Good), enemies are Bad guys.
            // For Killer (Bad), enemies are Good guys.
            // The suspicion list is already sorted by "Enemy-ness" based on init logic.
            const target = getRandomElement(enemies) || getRandomElement(otherAliveSeats);
            return target || null;
        }

        case "魔法师": {
            // Block strong enemies.
            const target = getRandomElement(enemies) || getRandomElement(otherAliveSeats);
            return target || null;
        }

        case "森林老人": {
            // Silence talkative enemies or just enemies.
            const target = getRandomElement(enemies) || getRandomElement(otherAliveSeats);
            return target || null;
        }

        case "花蝴蝶": {
            // Hug ally to protect, or enemy to block?
            // Usually hug ally to protect.
            const target = allies[0] || getRandomElement(otherAliveSeats);
            return target || null;
        }

        case "善民":
        case "恶民":
            // Dark vote (handled as night action in some versions, or separate)
            // If this function is called for them, return a target.
            const target = getRandomElement(enemies) || getRandomElement(otherAliveSeats);
            return target || null;

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
    const mem = getBotMemory(snapshot.roomCode, mySeat);
    if (!mem) return null; // Should init

    // Update memory from logs before voting
    parsePoliceMemory(snapshot.logs || [], snapshot.roomCode, mySeat);
    // Update memory from chat (Police claims)
    parseChatForPoliceClaims(snapshot.chatMessages || [], snapshot.roomCode, mySeat);

    const alivePlayers = snapshot.players.filter(p => p.isAlive);
    const otherAliveSeats = alivePlayers
        .filter(p => p.seat !== mySeat)
        .map(p => p.seat);

    if (otherAliveSeats.length === 0) return null;

    // 1. Follow Police (if I am Good and there is a known Police)
    // We parse chat to find Police claims. 
    // For now, rely on "Known Bad" from Police logs.

    // Find known bads
    const knownBads = Array.from(mem.knownRoles.entries())
        .filter(([seat, info]) => info.role === "bad" && otherAliveSeats.includes(seat))
        .map(([seat]) => seat);

    if (knownBads.length > 0) {
        return knownBads[0];
    }

    // 2. Vote most suspicious
    const sortedBySuspicion = [...otherAliveSeats].sort((a, b) => {
        return (mem.suspicion.get(b) || 50) - (mem.suspicion.get(a) || 50);
    });

    return sortedBySuspicion[0];
}

// --- Bot Speech Logic ---
export function generateBotSpeech(snapshot: FlowerSnapshot, botSeat: number): string {
    const mem = getBotMemory(snapshot.roomCode, botSeat);
    if (!mem) return "我是好人，过。"; // Fallback

    const parts: string[] = [];
    const players = snapshot.players;
    const alivePlayers = players.filter(p => p.isAlive && p.seat !== botSeat);

    // Sort enemies for targeting
    const enemies = alivePlayers
        .map(p => p.seat)
        .sort((a, b) => (mem.suspicion.get(b) || 50) - (mem.suspicion.get(a) || 50));

    // 1. Opening (Random chance to skip)
    if (Math.random() < 0.7) {
        parts.push(getRandomTemplate(GENERIC_OPENINGS));
    }

    // 2. Death Comments (If deaths occurred)
    const lastNightDeaths = snapshot.night.result?.deaths || [];
    if (lastNightDeaths.length > 0 && Math.random() < 0.6) {
        const deadSeat = lastNightDeaths[0].seat;
        const deadPlayer = players.find(p => p.seat === deadSeat);
        const deadName = deadPlayer ? `${deadPlayer.seat}号` : "昨晚死者";
        const tpl = getRandomTemplate(DEATH_COMMENTS);
        parts.push(formatTemplate(tpl, { dead: deadName }));
    }

    // 3. Role Claim (If not already claimed or want to reiterate)
    // 40% chance to state role
    if (Math.random() < 0.4) {
        const templates = ROLE_CLAIMS[mem.claimedRole] || ROLE_CLAIMS["善民"];
        let tpl = getRandomTemplate(templates);

        if (tpl.includes("{target}")) {
            // Need a target for the claim
            let targetSeat = -1;

            // Try to get from history first
            const lastAction = mem.actionHistory.nightActions[mem.actionHistory.nightActions.length - 1];
            if (lastAction) {
                targetSeat = lastAction.target;
            } else {
                // If no history (e.g. Day 1 or lying), pick a plausible target
                // If claiming Doctor/Butterfly -> Pick an ally (low suspicion)
                // If claiming Police/Sniper -> Pick an enemy (high suspicion) or random
                if (["医生", "花蝴蝶"].includes(mem.claimedRole)) {
                    // Pick "Ally" (last in enemies list is least suspicious)
                    targetSeat = enemies[enemies.length - 1] || (alivePlayers[0]?.seat);
                } else {
                    // Pick "Enemy"
                    targetSeat = enemies[0] || (alivePlayers[0]?.seat);
                }
            }

            if (targetSeat !== -1 && targetSeat !== undefined) {
                tpl = formatTemplate(tpl, { target: `${targetSeat}号` });
            } else {
                tpl = tpl.replace("{target}", "某人");
            }
        }
        parts.push(tpl);
    }

    // 4. Main Content: Accuse or Defend
    const target = enemies[0];
    if (target && Math.random() < 0.6) {
        const tpl = getRandomTemplate(ACCUSATIONS);
        parts.push(formatTemplate(tpl, { target: `${target}号` }));
    } else {
        // Defend self
        parts.push(getRandomTemplate(DEFENSES));
    }

    // 5. Deception (If Bad) - Specific lies
    // Only if not already covered by Role Claim
    if (mem.claimedRole === "医生" && Math.random() < 0.2) {
        const saved = enemies[enemies.length - 1]; // "Ally"
        if (saved) parts.push(`昨晚我扎了${saved}号，他是金水。`);
    }
    if (mem.claimedRole === "警察" && Math.random() < 0.2) {
        const checked = enemies[0]; // Enemy
        if (checked) parts.push(`昨晚验了${checked}号，他是查杀！`);
    }

    // 6. Closing
    if (parts.length === 0 || Math.random() < 0.5) {
        parts.push("过。");
    }

    return parts.join("");
}

export function generateBotLastWords(snapshot: FlowerSnapshot, botSeat: number): string {
    const mem = getBotMemory(snapshot.roomCode, botSeat);
    if (!mem) return "我是好人，大家加油。";

    let category = "good";
    if (["杀手", "魔法师", "森林老人", "恶民"].includes(mem.realRole)) {
        category = "bad";
    }
    if (mem.realRole === "警察") category = "police";
    if (mem.realRole === "医生") category = "doctor";

    const templates = LAST_WORDS[category] || LAST_WORDS["good"];
    let tpl = getRandomTemplate(templates);

    if (tpl.includes("{target}")) {
        // Need a target
        let targetSeat = -1;
        const lastAction = mem.actionHistory.nightActions[mem.actionHistory.nightActions.length - 1];
        if (lastAction) {
            targetSeat = lastAction.target;
        } else {
            // Random alive
            const alive = snapshot.players.filter(p => p.isAlive && p.seat !== botSeat);
            if (alive.length > 0) targetSeat = alive[Math.floor(Math.random() * alive.length)].seat;
        }

        if (targetSeat !== -1 && targetSeat !== undefined) {
            tpl = formatTemplate(tpl, { target: `${targetSeat}号` });
        } else {
            tpl = tpl.replace("{target}", "某人");
        }
    }

    return tpl;
}
