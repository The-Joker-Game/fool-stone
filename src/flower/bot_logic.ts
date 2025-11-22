// src/flower/bot_logic.ts
import type { FlowerSnapshot } from "./types";
import {
    OPENING_TEMPLATES,
    FOLLOW_UP_OPENINGS,
    DEATH_COMMENT_TEMPLATES,
    SUSPICION_TEMPLATES,
    DEFENSE_TEMPLATES,
    PASS_TEMPLATES
} from "./bot_speech_templates";

function randomFrom<T>(list: T[]): T {
    return list[Math.floor(Math.random() * list.length)];
}

function formatTemplate(template: string, replacements: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(replacements)) {
        result = result.replace(new RegExp(`{${key}}`, "g"), value);
    }
    return result;
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
        parts.push(randomFrom(templates));
    }

    // 2. Comment on death (if any) (50% chance if deaths occurred)
    if (hasDeathsLastNight && Math.random() < 0.5) {
        const deadSeat = lastNightDeaths[0].seat;
        const deadPlayer = players.find(p => p.seat === deadSeat);
        const deadName = deadPlayer ? `${deadPlayer.seat}号` : "昨晚死者";
        parts.push(formatTemplate(randomFrom(DEATH_COMMENT_TEMPLATES), { dead: deadName }));
    }

    // 3. Main Content (Suspicion or Defense)
    const actionRoll = Math.random();
    if (actionRoll < 0.4 && alivePlayers.length > 0) {
        // Suspicion
        const target = randomFrom(alivePlayers);
        const targetName = `${target.seat}号`;
        parts.push(formatTemplate(randomFrom(SUSPICION_TEMPLATES), { target: targetName }));
    } else if (actionRoll < 0.7) {
        // Defense
        parts.push(randomFrom(DEFENSE_TEMPLATES));
    } else {
        // Just pass (handled by closing)
    }

    // 4. Closing (Always, unless covered by main content implying end, but templates are safe to combine)
    parts.push(randomFrom(PASS_TEMPLATES));

    return parts.join("");
}
