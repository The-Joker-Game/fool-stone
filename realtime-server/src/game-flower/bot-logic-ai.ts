// realtime-server/src/game-flower/bot-logic-ai.ts
// AI-powered bot logic

import OpenAI from 'openai';
import type { FlowerSnapshot, FlowerHistoryRecord } from "./types.js";
import { getBotMemory, updateBotMemoryFromDecision } from "./bot-state.js";
import {
    FLOWER_GAME_RULES,
    type SpeechDecision,
    type SpeechPlan,
} from "./ai-protocol.js";

let gemini_ai: OpenAI | null = null;
let qwen_ai: OpenAI | null = null;
let deepseek_ai: OpenAI | null = null;

// Multi-key load balancing support
interface AIClientPool {
    clients: OpenAI[];
    currentIndex: number;
}

const clientPools: Map<"gemini" | "qwen" | "deepseek", AIClientPool> = new Map();

/**
 * Parse comma-separated API keys from environment variable
 */
function parseApiKeys(envVar: string | undefined): string[] {
    if (!envVar) return [];
    return envVar.split(',').map(k => k.trim()).filter(k => k.length > 0);
}

/**
 * Initialize client pool for a specific AI provider
 */
function initClientPool(type: "gemini" | "qwen" | "deepseek"): AIClientPool | null {
    let envVarName: string;
    let baseURL: string;
    let defaultHeaders: Record<string, string> | undefined;

    switch (type) {
        case "gemini":
            envVarName = "GEMINI_API_KEY";
            baseURL = "https://api.aintornas.dpdns.org/v1";
            defaultHeaders = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "application/json",
                "Connection": "keep-alive"
            };
            break;
        case "qwen":
            envVarName = "QWEN_API_KEY";
            baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
            break;
        case "deepseek":
            envVarName = "DEEPSEEK_API_KEY";
            baseURL = "https://api.deepseek.com";
            break;
    }

    const keys = parseApiKeys(process.env[envVarName]);
    if (keys.length === 0) return null;

    const clients = keys.map((apiKey, index) => {
        console.log(`[AIClient] Initializing ${type} client #${index + 1} of ${keys.length}`);
        return new OpenAI({
            baseURL,
            apiKey,
            ...(defaultHeaders ? { defaultHeaders } : {})
        });
    });

    return {
        clients,
        currentIndex: 0
    };
}

/**
 * Get next AI client using round-robin load balancing
 * Supports comma-separated API keys in environment variables
 * Example: GEMINI_API_KEY=key1,key2,key3
 */
function getAIClient(type: "gemini" | "qwen" | "deepseek" = "gemini"): OpenAI | null {
    // Check if pool exists, initialize if not
    if (!clientPools.has(type)) {
        const pool = initClientPool(type);
        if (pool) {
            clientPools.set(type, pool);
            console.log(`[AIClient] ${type} pool initialized with ${pool.clients.length} client(s)`);
        }
    }

    const pool = clientPools.get(type);
    if (!pool || pool.clients.length === 0) return null;

    // Round-robin selection
    const client = pool.clients[pool.currentIndex];
    pool.currentIndex = (pool.currentIndex + 1) % pool.clients.length;

    if (pool.clients.length > 1) {
        console.log(`[AIClient] Using ${type} client #${pool.currentIndex === 0 ? pool.clients.length : pool.currentIndex} of ${pool.clients.length}`);
    }

    return client;
}

/**
 * Wrapper for API calls with racing retry logic.
 * If the request takes longer than `timeoutMs`, a new request will be started.
 * The first response to return wins (previous requests are NOT cancelled).
 * @param fn - The async function to execute (should return a Promise)
 * @param timeoutMs - Timeout before starting a new racing request (default: 20000)
 * @param maxAttempts - Maximum number of concurrent attempts (default: 2)
 * @param label - Label for logging
 */
async function withRaceRetry<T>(
    fn: () => Promise<T>,
    timeoutMs: number = 20000,
    maxAttempts: number = 2,
    label: string = "API"
): Promise<T> {
    return new Promise((resolve, reject) => {
        let resolved = false;
        let attemptCount = 0;
        let errorCount = 0;
        const errors: Error[] = [];

        const startAttempt = (attemptNum: number) => {
            attemptCount++;
            console.log(`[${label}] Starting attempt ${attemptNum}`);

            fn()
                .then((result) => {
                    if (!resolved) {
                        resolved = true;
                        if (attemptNum > 1) {
                            console.log(`[${label}] Attempt ${attemptNum} won the race`);
                        }
                        resolve(result);
                    } else {
                        console.log(`[${label}] Attempt ${attemptNum} finished but another attempt already won`);
                    }
                })
                .catch((e) => {
                    errors.push(e);
                    errorCount++;
                    console.log(`[${label}] Attempt ${attemptNum} failed:`, e.message);

                    // If all attempts have failed, reject
                    if (errorCount >= attemptCount && attemptCount >= maxAttempts) {
                        reject(errors[0]);
                    }
                });
        };

        // Start first attempt immediately
        startAttempt(1);

        // Schedule additional attempts after timeout
        for (let i = 2; i <= maxAttempts; i++) {
            const attemptNum = i;
            setTimeout(() => {
                if (!resolved) {
                    console.log(`[${label}] Attempt 1 still pending after ${timeoutMs}ms, starting racing attempt ${attemptNum}`);
                    startAttempt(attemptNum);
                }
            }, timeoutMs * (i - 1));
        }
    });
}

const SPEECH_PLAN_SCHEMA = {
    type: "object",
    properties: {
        draft: { type: "string", description: "The speech draft content." },
        updatedPlayerNotes: { type: "string", description: "Updated natural language notes about other players." },
        strategicPlan: { type: "string", description: "Long-term strategy update." },
        strategicNote: { type: "string", description: "Short-term thoughts and rationale." },
        claimedRole: {
            type: "string",
            enum: ["花蝴蝶", "狙击手", "医生", "警察", "善民", "杀手", "魔法师", "森林老人", "恶民", "无"],
            description: "The role currently claimed by the bot."
        }
    },
    required: ["draft", "updatedPlayerNotes", "strategicPlan", "strategicNote", "claimedRole"],
    additionalProperties: false
};

// Simplified schema for last words - player is already dead, no need to update strategy
const LAST_WORDS_SCHEMA = {
    type: "object",
    properties: {
        draft: { type: "string", description: "The last words draft content." }
    },
    required: ["draft"],
    additionalProperties: false
};

const ACTION_SCHEMA = {
    type: "object",
    properties: {
        targetSeat: { type: "integer", description: "The target seat number for the action." },
        reason: { type: "string", description: "Reason for the action." },
        updatedPlayerNotes: { type: "string", description: "Updated natural language notes about other players." },
        strategicPlan: { type: "string", description: "Long-term strategy update." },
        strategicNote: { type: "string", description: "Short-term thoughts and rationale." }
    },
    required: ["targetSeat", "reason", "updatedPlayerNotes", "strategicPlan", "strategicNote"],
    additionalProperties: false
};


/**
 * Helper: Smart Fallback Target Selection
 * Uses cached assessments to pick a target when AI fails.
 */
function getSmartFallbackTarget(
    snapshot: FlowerSnapshot,
    botSeat: number,
    actionType: "vote" | "kill" | "protect"
): number | null {
    const mem = getBotMemory(snapshot.roomCode, botSeat);
    const aliveOthers = snapshot.players
        .filter(p => p.isAlive && p.seat !== botSeat)
        .map(p => p.seat);

    if (aliveOthers.length === 0) return null;
    if (!mem) return aliveOthers[Math.floor(Math.random() * aliveOthers.length)];

    // 1. Filter targets based on KNOWN roles (Absolute Logic)
    let candidates: number[] = [];

    if (actionType === "vote" || actionType === "kill") {
        // Find known enemies
        candidates = aliveOthers.filter(seat => {
            const known = mem.knownRoles.get(seat);
            return known && (known.role === "good" || ["警察", "医生", "花蝴蝶", "狙击手", "善民"].includes(known.role));
        });
    } else if (actionType === "protect") {
        // Find known allies
        candidates = aliveOthers.filter(seat => {
            const known = mem.knownRoles.get(seat);
            return known && (known.role === "bad" || ["杀手", "魔法师", "森林老人", "恶民"].includes(known.role));
        });
    }

    // 2. If no specific candidates, default to all alive others
    if (candidates.length === 0) {
        candidates = aliveOthers;
    }

    // 3. Pick random from candidates
    return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Helper: Convert structured game history into natural language memory
 */
function generateEventSummary(
    record: FlowerHistoryRecord,
    type: "night" | "day",
    mySeat: number,
    myRole?: string
): string {
    const dayTag = `[第 ${record.dayCount} 天${type === "night" ? "夜间" : "白天"}结算]`;

    if (type === "night") {
        const deaths = record.night.result.deaths;
        const deathStr = deaths.length > 0
            ? deaths.map(d => `${d.seat}号遇害`).join("、")
            : "平安夜，无人死亡";

        let extraInfo = "";
        // Police check
        if (myRole === "警察") {
            const reports = record.night.result.policeReports || [];
            if (reports.length > 0) {
                const repLines = reports.map(r => {
                    let resStr = "未知";
                    if (r.result === "bad_special") resStr = "坏特殊（杀手/魔法师/森林老人）";
                    else if (r.result === "not_bad_special") resStr = "非坏特殊（好人/花/医/狙/善民/恶民）";
                    else if (r.result === "unknown") resStr = "无法查验（对象死亡、被花蝴蝶免疫或视线受阻）";
                    return `${r.targetSeat}号身份为：${resStr}`;
                });
                extraInfo += `【警察验人结果】${repLines.join("，")}。`;
            }
        }

        return `${dayTag} 昨晚情况：${deathStr}。${extraInfo}`;
    }

    if (type === "day" && record.day) {
        // Summarize votes
        const votes = record.day.votes;
        if (votes.length === 0) return `${dayTag} 无人投票。`;

        // Simple vote aggregation
        const voteMap = new Map<number, number[]>();
        votes.forEach(v => {
            if (!voteMap.has(v.targetSeat)) voteMap.set(v.targetSeat, []);
            voteMap.get(v.targetSeat)?.push(v.voterSeat);
        });

        const voteDetails = Array.from(voteMap.entries())
            .map(([target, voters]) => `${target}号被投(由${voters.join(",")})`)
            .join("；");

        const exec = record.day.execution;
        const resultStr = exec
            ? `${exec.seat}号被投票处决${exec.isBadSpecial ? "(坏特殊)" : "(非坏特殊)"}`
            : "平票，无人出局";

        return `${dayTag} 投票详情：${voteDetails}。结果：${resultStr}。`;
    }

    return "";
}

/**
 * Core: Incrementally sync game events and chats to memory stream
 */
function syncGameEvents(snapshot: FlowerSnapshot, botSeat: number) {
    const mem = getBotMemory(snapshot.roomCode, botSeat);
    if (!mem) return;

    // 1. Sync Chat (Incremental)
    const newMsgs = (snapshot.chatMessages || []).filter(m => m.timestamp > mem.lastSeenChatTime);
    if (newMsgs.length > 0) {
        newMsgs.sort((a, b) => a.timestamp - b.timestamp);

        // Determine temporal context for these new messages
        // Note: This uses the CURRENT snapshot phase as an approximation for the batch of new messages.
        // In a high-frequency sync loop, this is accurate enough.
        const isNight = snapshot.phase.startsWith("night") || snapshot.phase === "lobby";
        const timeLabel = `[第${snapshot.dayCount}天${isNight ? "夜间" : "白天"}] ${snapshot.phase === "day_discussion" ? "发言" : (snapshot.phase === "day_last_words" ? "遗言" : "")}`;

        for (const msg of newMsgs) {
            if (msg.sessionId === "system") {
                // Skip system messages (e.g. voting reminders) to avoid polluting AI memory
                continue;
            }
            mem.contextHistory.push(`${timeLabel} ${msg.senderSeat}号: ${msg.content}`);
        }
        mem.lastSeenChatTime = newMsgs[newMsgs.length - 1].timestamp;
    }

    // 2. Sync Game Events (New Incremental Logic)
    const history = snapshot.history || [];

    // Process new days that haven't been summarized
    let targetDay = mem.lastSummarizedDay + 1;
    let record = history.find(h => h.dayCount === targetDay);

    while (record) {
        // --- Process Night ---
        if (!mem.hasSummarizedNight) {
            const nightSummary = generateEventSummary(record, "night", botSeat, mem.realRole);
            mem.contextHistory.push(nightSummary);
            mem.hasSummarizedNight = true;
            // console.log(`[BotMemory-${botSeat}] Summarized Day ${targetDay} Night`);
        }

        // --- Process Day ---
        // Only summarize Day if the day execution result is present (meaning day phase is effectively done for this record)
        if (record.day) {
            const daySummary = generateEventSummary(record, "day", botSeat, mem.realRole);
            mem.contextHistory.push(daySummary);

            mem.lastSummarizedDay = targetDay;
            mem.hasSummarizedNight = false; // Reset for next night
            // console.log(`[BotMemory-${botSeat}] Summarized Day ${targetDay} Day`);

            targetDay++;
            record = history.find(h => h.dayCount === targetDay);
        } else {
            // Day part not ready or not finished
            break;
        }
    }
}

/**
 * Format assessments for prompt
 */
function formatPlayerNotes(mem: import("./bot-state.js").BotMemory): string {
    const notes = mem.playerNotes;
    if (typeof notes === 'object') {
        return JSON.stringify(notes);
    }
    return notes || "";
}

/**
 * Format self action log for prompt
 */
function formatActionLog(mem: import("./bot-state.js").BotMemory): string {
    return mem.selfActionLog.slice(-10).map(l => {
        return `- Day ${l.day} [${l.phase}]: ${l.action} (Target: ${l.target ?? "None"}).`;
    }).join("\n") || "";
}

/**
 * Build a contextual prompt for AI decision making
 * Structure: Rules -> Strategy -> History -> Current State -> Task
 */
function buildDecisionPrompt(
    snapshot: FlowerSnapshot,
    botSeat: number,
    taskType: "speech" | "vote" | "night_action" | "last_words"
): string {
    const mem = getBotMemory(snapshot.roomCode, botSeat);
    const bot = snapshot.players.find(p => p.seat === botSeat);

    if (!bot || !mem) return "";

    // 1. 同步记忆 (增量逻辑)
    syncGameEvents(snapshot, botSeat);

    // 2. 获取存活玩家列表（用于投票和行动）
    const alivePlayers = snapshot.players
        .filter(p => p.isAlive)
        .map(p => p.seat)
        .sort((a, b) => a - b);
    const validTargetStr = alivePlayers.join("、");

    const basePrompt = `
你在游玩一个叫花蝴蝶的杀人游戏，你没有视觉，没有听觉，你只能看到以下文字，你的目标是赢得胜利。**请先仔细阅读并理解规则。**
---
${FLOWER_GAME_RULES}
---
`;

    // 记忆与历史 (Memory & History)
    const memoryStream = mem.contextHistory.slice(-50).join("\n");
    const myActionHistory = formatActionLog(mem);
    const myPlayerNotes = formatPlayerNotes(mem);

    const memoryBlock = `
${memoryStream && ("【历史事件流】\n" + memoryStream)}
${myActionHistory && ("【我的行动记录】\n" + myActionHistory)}
${myPlayerNotes && ("【我对其他玩家的笔记】\n" + myPlayerNotes)}
`;

    // 局势部分 (Current State)
    const getSpeakingStatus = (seat: number) => {
        if (snapshot.phase === "day_discussion" && snapshot.day?.speechOrder) {
            const index = snapshot.day.speechOrder.indexOf(seat);
            const current = snapshot.day.currentSpeakerIndex ?? 0;
            if (index === -1) return "";
            if (index < current) return " [已发言]";
            if (index === current) return " [当前发言]";
            return " [等待发言]";
        }
        if (snapshot.phase === "day_last_words" && snapshot.day?.lastWords?.queue) {
            const index = snapshot.day.lastWords.queue.indexOf(seat);
            const current = snapshot.day.currentSpeakerIndex ?? 0;
            if (index === -1) return "";
            if (index < current) return " [已遗言]";
            if (index === current) return " [当前遗言]";
            return " [等待遗言]";
        }
        return "";
    };

    const playerList = snapshot.players.map(p => {
        const status = p.isAlive ? "存活" : "已死亡";
        const roleInfo = (p.seat === botSeat) ? `(我, ${mem.realRole}, 伪装:${mem.claimedRole})` : "";
        const known = mem.knownRoles.get(p.seat);
        const knownStr = known ? `[已知:${known.role}]` : "";
        const speakingStatus = getSpeakingStatus(p.seat);

        return `- ${p.seat}号${p.seat === botSeat ? `(${p.name})` : ""}: ${status} ${roleInfo} ${knownStr}${speakingStatus}`;
    }).join("\n");

    let cnPhase = "未知阶段";
    switch (snapshot.phase) {
        case "night_actions": cnPhase = "夜晚行动阶段"; break;
        case "day_discussion": cnPhase = "白天发言阶段"; break;
        case "day_vote": cnPhase = "白天投票阶段"; break;
        case "day_last_words": cnPhase = "白天遗言阶段"; break;
        case "lobby": cnPhase = "准备阶段"; break;
        case "game_over": cnPhase = "游戏结束"; break;
    }

    let speakingOrderStr = "";
    if (snapshot.phase === "day_discussion" && snapshot.day?.speechOrder && snapshot.day.speechOrder.length > 0) {
        const order = snapshot.day.speechOrder;
        const currentIdx = snapshot.day.currentSpeakerIndex ?? 0;
        const visualOrder = order.map((s, i) => {
            if (i < currentIdx) return `${s}号(已发言)`;
            if (i === currentIdx) return `${s}号(当前发言)`;
            return `${s}号(等待发言)`;
        }).join(" -> ");
        speakingOrderStr = `\n【当前发言顺序】\n${visualOrder}\n(注意：未发言的玩家是因为顺序未到，并非不敢发言)`;
    } else if (snapshot.phase === "day_last_words" && snapshot.day?.lastWords?.queue && snapshot.day.lastWords.queue.length > 0) {
        const order = snapshot.day.lastWords.queue;
        const currentIdx = snapshot.day.currentSpeakerIndex ?? 0;
        const visualOrder = order.map((s, i) => {
            if (i < currentIdx) return `${s}号(已遗言)`;
            if (i === currentIdx) return `${s}号(当前遗言)`;
            return `${s}号(等待遗言)`;
        }).join(" -> ");
        speakingOrderStr = `\n【当前遗言顺序】\n${visualOrder}\n(注意：未发言的玩家是因为顺序未到，并非不敢发言)`;
    }

    const currentState = `
【当前局势】
阶段：${snapshot.phase} (第 ${snapshot.dayCount} 天 - ${cnPhase})
存活玩家：
${playerList}
${speakingOrderStr}
${mem.longTermStrategy && '【当前的strategicPlan】\n' + mem.longTermStrategy}
${mem.roundMemory.analysisSummary && '【当前的strategicNote】\n' + mem.roundMemory.analysisSummary}
`;

    // --- 任务指令 (Task Instruction) ---
    let taskInstruction = "";

    if (taskType === "speech") {
        taskInstruction = `
【本轮任务：日常发言规划】

**【战略推演与自我审查】**
在你最终确定发言稿之前，必须进行以下思考：
1. **谎言可行性分析**：我声称的身份和行为，在游戏规则下是否可能发生？是否存在唯一解？
2. **对手视角分析**：如果一个聪明的好人听到我的发言，他会根据规则推导出什么结论？
3. **利弊权衡**：这个结论对我的阵营（坏人）是有利还是有害？如果弊大于利，则必须放弃或修改这个发言策略。

【注意】
你现在需要分析局势，模拟自己作为玩家，为你本轮的发言提供一个**事无巨细的发言草稿**，这将展示给全场玩家。
你可以在完成自己的发言草稿后，根据当前的局势，更新自己对当前局势的理解，他们将作为你的思考成果，供你下一次行动时参考。**请特别记录本次思考中获得的顿悟，这将减少下一次思考的启动成本。**
按照规则，如果某人未发言，说明他的发言次序在你之后，或被禁言，否则按照规则必须发言，所以你不能攻击未发言、沉默这一行为本身。
${snapshot.dayCount === 1 && "上一次行动是首夜，所有人除了各自的位置以外没有任何其他信息，所以死亡也可能是死者队友所为，因为任何人使用技能都是随机的。"}

**输出要求**：请输出 JSON。
- claimedRole: 当前宣称身份（花蝴蝶/狙击手/医生/警察/善民/杀手/魔法师/森林老人/恶民/无 的其中之一）。仔细考虑你是否伪装，是否欺骗他人，让对立阵营迷惑很重要，但要小心不要被队友误伤。
- draft: 你的发言草稿，逻辑严密的表述了你的发言内容，不换行。你是${botSeat}号,所以始终使用"我"指代${botSeat}号，30-80词。不要重复前面的观点，提出你自己基于宣称身份的建设性见解。没有确切证据的情况下，不要cue任何人。${["杀手", "魔法师", "森林老人", "恶民"].includes(mem.realRole) && "你是坏人，如果猜到队友已经暴露，不要附和他们，不然你会在接下来被好人集火。"}
- updatedPlayerNotes: 使用自然语言记录你对每一个玩家的理解。
- strategicPlan: 将你的长期战略更新在此。
- strategicNote: 将其他有价值的想法更新在此，简要记录想法的来由，让每一个想法有据可依。
`;

    } else if (taskType === "last_words") {
        taskInstruction = `
【本轮任务：发表遗言规划】

**【战略推演与自我审查】**
在你最终确定发言稿之前，必须进行以下思考：
1. **谎言可行性分析**：我声称的身份和行为，在游戏规则下是否可能发生？是否存在唯一解？
2. **对手视角分析**：如果一个聪明的好人听到我的发言，他会根据规则推导出什么结论？
3. **利弊权衡**：这个结论对我的阵营（坏人）是有利还是有害？如果弊大于利，则必须放弃或修改这个发言策略。

**【遗言阶段要求】**
你已经在上一夜死亡或在今天被投票出局(具体情况关注系统公告中对【${botSeat}号】的提及)，你现在需要模拟自己死后，为你本轮的遗言提供一个**事无巨细的遗言草稿**，这将展示给全场的所有玩家。
按照规则，如果某人未发言，说明他的发言次序在你之后，或被禁言，否则按照规则必须发言，所以你不能攻击未发言、沉默这一行为本身。
${snapshot.dayCount === 1 && "上一次行动是首夜，所有人除了各自的位置以外没有任何其他信息，所以死亡也可能是死者队友所为，因为任何人使用技能都是随机的。"}

**输出要求**：请输出 JSON。
- draft: 你的发言草稿，逻辑严密的表述了你的发言内容，不换行，不要自报家门，你是${botSeat}号,始终使用"我"指代${botSeat}号，30-80词。不要重复前面的观点，这是你最后一次发言，思考是否有任何后事需要交代(你的职业，每晚行动结果，你的洞察等)。没有确切证据的情况下，不要cue任何人。
`;

    } else if (taskType === "vote") {
        taskInstruction = `
【本轮任务：投票】
**可选投票目标（存活玩家）：[${validTargetStr}]**
请从上述列表中选择一个座位号。
你可以在完成自己的投票后，根据当前的局势，更新自己对当前局势的理解，他们将作为你的思考成果，供你下一次行动时参考。**请特别记录本次思考中获得的顿悟，这将减少下一次思考的启动成本。**

输出 JSON：
- targetSeat(number): 必须投票
- reason: 简短理由
- updatedPlayerNotes: 使用自然语言记录你对每一个玩家的理解
- strategicPlan: 将你的长期战略更新在此。
- strategicNote: 将其他有价值的想法更新在此，简要记录想法的来由，让每一个想法有据可依。
`;

    } else if (taskType === "night_action") {
        taskInstruction = `
【本轮任务：夜晚行动】
你的角色是【${mem.realRole}】。请决定你的技能目标。
**可选技能目标：[${validTargetStr}]**
你可以在完成自己的行动后，根据当前的局势，更新自己对当前局势的理解，他们将作为你的思考成果，供你下一次行动时参考。**请特别记录本次思考中获得的顿悟，这将减少下一次思考的启动成本。**
${snapshot.dayCount === 1 && "这是首夜，你应该只依据自己的位置进行判断。你的技能可能会影响将来的发言顺序(顺序和座位号无关，若恰好死一人，则死者下一位开始发言，否则随机选一个人开始发言)，如果你在偏前位置发言，其他人可能会给你泼脏水，但也有可能先给大家好印象。后发言，则让其他角色没有机会评价你。深刻考虑自己和相近位置和对角位置的关系，考虑他们在发言环节上是否能让你更有优势。"}

输出 JSON：
- targetSeat(number): 必须使用技能
- reason: 简短理由
- updatedPlayerNotes: 请使用自然语言记录你对每一个玩家的理解
- strategicPlan: 将你的长期战略更新在此。
- strategicNote: 将其他有价值的想法更新在此，简要记录想法的来由，让每一个想法有据可依。
`;
    }

    return basePrompt + memoryBlock + currentState + taskInstruction;
}

/**
 * Step 1: Logic & Planning
 * Generates the semantic intent and strategy, but NOT the final speech text.
 */
export async function getBotSpeechPlan(
    snapshot: FlowerSnapshot,
    botSeat: number,
    isLastWords: boolean = false
): Promise<SpeechPlan> {
    const existingMem = getBotMemory(snapshot.roomCode, botSeat);

    // fallback
    const fallbackPlan: SpeechPlan = {
        draft: isLastWords ? "表达遗憾，希望好人胜利" : "表示没有听出什么漏洞，过。",
        updatedPlayerNotes: existingMem ? existingMem.playerNotes : "",
        strategicNote: "Fallback due to error.",
        claimedRole: existingMem ? existingMem.claimedRole : "善民"
    };

    const aiClient = getAIClient();
    if (!aiClient) return fallbackPlan;
    if (!existingMem) return fallbackPlan;

    try {
        const prompt = buildDecisionPrompt(snapshot, botSeat, isLastWords ? "last_words" : "speech");
        console.log(`[BotAI-${botSeat}] Prompt (Plan):`, prompt);

        const response = await aiClient.chat.completions.create({
            model: 'gemini-3-flash-preview',
            messages: [
                { role: 'system', content: "You are a player in the game. Respond with the specified JSON schema." },
                { role: 'user', content: prompt }
            ],
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: isLastWords ? "last_words" : "speech_plan",
                    schema: isLastWords ? LAST_WORDS_SCHEMA : SPEECH_PLAN_SCHEMA,
                    strict: true
                }
            },
            temperature: 0,
            top_p: 0.85,
            reasoning_effort: 'medium'
        });

        const rawContent = response.choices[0]?.message?.content || "";
        console.log(`[BotAI-${botSeat}] Response (Plan):`, rawContent);

        if (!rawContent) throw new Error("Empty response from AI");

        const parsed = JSON.parse(rawContent);

        const plan: SpeechPlan = {
            draft: parsed.draft || fallbackPlan.draft,
            updatedPlayerNotes: parsed.updatedPlayerNotes || existingMem.playerNotes,
            strategicNote: parsed.strategicNote || "No strategy note.",
            strategicPlan: parsed.strategicPlan,
            claimedRole: parsed.claimedRole || existingMem.claimedRole || "无"
        };

        // Update Memory immediately after planning
        updateBotMemoryFromDecision(
            snapshot.roomCode,
            botSeat,
            plan.updatedPlayerNotes,
            plan.strategicNote,
            plan.claimedRole,
            plan.strategicPlan
        );

        return plan;
    } catch (e) {
        console.error("[Bot AI] Planning Error:", e);
        return fallbackPlan;
    }
}

/**
 * Step 2: Style Transfer (Streaming)
 * Transforms intent into styled speech with bubble splitting.
 * Pure logic, no game state context, just intent -> style.
 */
export async function* streamStyledSpeech(
    draft: string,
    isLastWords: boolean = false
): AsyncGenerator<string, void, unknown> {
    const aiClient = getAIClient();
    if (!aiClient) {
        yield draft;
        return;
    }

    const systemPrompt = `
你是一个风格迁移助手，你的形象是**一个真实玩家**。你的任务是将输入的“心理活动”改写为符合特定风格的“游戏发言”，**严格按照draft的内容进行转换**。
你在一个即时聊天软件中发表自己的想法，不得使用任何markdown格式，不得使用任何带括号的心理描写和任何人类在该类即时聊天软件中不会使用的符号。
**当话题发生重大转折时**（例如：从分析别人 -> 转到聊自己）时，请使用换行符进行自然分段。学习下面的样本进行模仿，学习他们的行为范式，不局限于某个特定的词汇。
`.trim();

    const examples = `
Draft: 我怀疑2号玩家，因为他提到了好人没有的“私聊”，而且他作为警察没报验人信息。3号保了我，我觉得他是好人。我身份是好人。4号好像没在玩。
Output: 我感觉2是不是聊爆了，他说私聊环节，匪徒才会有私聊环节吧？而且你说要验人，你第一天的验人信息是啥哇，我没听到你报啊。3保了我，我肯定觉得他还行。
我确实是好人，铁铁的超级大好人。然后这个4感觉也没有很在游戏内。反正我先独自傍水一波。

Draft: 5号刚才的发言太划水了，什么都没说，建议大家关注一下。1号逻辑很硬，我站边1号。
Output: 然后这个5号感觉一直在划水哇，说了半天啥也没说，反正大家多关注一下吧。
我是觉得1号逻辑蛮硬的，铁铁的好人牌感觉，目前先站边1号看看，听听后面怎么聊。

Draft: 我是被冤枉的，不要出我，我是医生，昨晚救了人。如果出我好人就崩了。
Output: 不是，别出我啊，我铁铁的医生牌！昨晚平安夜是我救出来的哇。而且你们现在出我，好人直接崩盘了吧？
反正我是好人，你们再盘盘别人呢？

Draft: (遗言) 我昨晚什么动静都没听到，不知道为什么会死。希望好人能赢，不要盲目跟风，去盘逻辑。我的暗票投给了可疑的人。
Output: 啊？我咋死了哇？完全没搞懂状况... 昨晚啥动静都没有啊。
反正我是个平民走的，你们好人稳住心态多盘盘逻辑吧，别被带节奏了，加油哇。

Draft: (遗言) 我是警察，昨晚验了3号是查杀。我死得太冤了，大家一定要出3号，不要让他跑了。
Output: 服了，首刀我？我是警察啊！昨晚验的3号是查杀，铁狼！
兄弟们全票出3，千万别让他跑了，这把靠你们了啊，无语死我了。
`.trim();

    const userPrompt = `Draft: ${isLastWords && "(遗言)"} ${draft}\nOutput:`;

    try {
        const stream = await aiClient.chat.completions.create({
            model: 'gemini-3-flash-preview',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: examples },
                { role: 'user', content: userPrompt }
            ],
            stream: true,
        });
        let buffer = "";
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || "";
            buffer += delta;

            // Handle both real newlines and literal "\n" sequences
            const splitter = /(?:\r\n|\r|\n|\\n)/g;
            if (buffer.search(splitter) !== -1) {
                const parts = buffer.split(splitter);
                // Yield all complete parts
                while (parts.length > 1) {
                    const bubble = parts.shift();
                    if (bubble && bubble.trim()) {
                        yield bubble.trim();
                    }
                }
                // Keep the last partial part
                buffer = parts[0];
            }
        }

        if (buffer && buffer.trim()) {
            yield buffer.trim();
        }

    } catch (e) {
        console.error("[Bot AI] Streaming Error:", e);
        yield draft; // Fallback to raw intent
    }
}

/**
 * Legacy wrapper for non-streaming callers
 */
export async function getBotSpeechDecision(
    snapshot: FlowerSnapshot,
    botSeat: number,
    isLastWords: boolean = false
): Promise<SpeechDecision> {
    // 1. Plan
    const plan = await getBotSpeechPlan(snapshot, botSeat, isLastWords);

    // 2. Stream & Collect
    let fullContent = "";
    try {
        const generator = streamStyledSpeech(plan.draft, isLastWords);
        for await (const chunk of generator) {
            fullContent += chunk + " "; // Add space between bubbles for flat text
        }
    } catch (e) {
        fullContent = plan.draft;
    }

    // Log Action (Moved here to capture full content)
    const mem = getBotMemory(snapshot.roomCode, botSeat);
    if (mem) {
        mem.selfActionLog.push({
            day: snapshot.dayCount,
            phase: isLastWords ? "last_words" : "speech",
            action: "Speak",
            reason: plan.strategicNote,
            content: fullContent.trim()
        });
    }

    return {
        ...plan,
        content: fullContent.trim()
    };
}

/**
 * Get AI Vote Target (New LLM Implementation)
 */
export async function getBotVoteTarget(
    snapshot: FlowerSnapshot,
    botSeat: number
): Promise<number | null> {
    const aiClient = getAIClient();
    if (!aiClient) return null;

    try {
        const prompt = buildDecisionPrompt(snapshot, botSeat, "vote");
        console.log(`[BotAI-${botSeat}] Prompt (Vote):`, prompt);

        const response = await aiClient.chat.completions.create({
            model: 'gemini-3-flash-preview',
            messages: [
                { role: 'system', content: "You are a player in the game. Respond with the specified JSON schema." },
                { role: 'user', content: prompt }
            ],
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: "vote_action",
                    schema: ACTION_SCHEMA,
                    strict: true
                }
            },
            temperature: 0,
            top_p: 0.85,
            reasoning_effort: 'medium',
        });

        const rawContent = response.choices[0]?.message?.content || "";
        console.log(`[BotAI-${botSeat}] Response (Vote):`, rawContent);

        const parsed = JSON.parse(rawContent);

        // Update memory with new thoughts if provided
        if (parsed.updatedPlayerNotes || parsed.strategicPlan) {
            const currentMem = getBotMemory(snapshot.roomCode, botSeat);
            if (currentMem) {
                updateBotMemoryFromDecision(
                    snapshot.roomCode,
                    botSeat,
                    parsed.updatedPlayerNotes,
                    parsed.strategicNote || currentMem.roundMemory.analysisSummary,
                    currentMem.claimedRole,
                    parsed.strategicPlan
                );
            }
        }

        const currentMem = getBotMemory(snapshot.roomCode, botSeat);

        // parsed.targetSeat
        if (typeof parsed.targetSeat === 'number' && parsed.targetSeat > 0) {
            if (currentMem) {
                currentMem.selfActionLog.push({
                    day: snapshot.dayCount,
                    phase: "vote",
                    action: "Vote",
                    target: parsed.targetSeat,
                    reason: parsed.reason || "Vote"
                });
            }
            return parsed.targetSeat;
        }
        throw new Error("AI returned invalid vote target");

    } catch (e) {
        console.error(`[BotAI-${botSeat}] Vote Error, using fallback:`, e);

        // Fallback: Smart Vote based on last known assessments
        const fallbackSeat = getSmartFallbackTarget(snapshot, botSeat, "vote");
        return fallbackSeat;
    }
}

/**
 * Get AI Night Action Target (New LLM Implementation)
 */
export async function getBotNightActionTarget(
    snapshot: FlowerSnapshot,
    botSeat: number,
    myRole: import("./types.js").FlowerRole
): Promise<number | null> {
    const aiClient = getAIClient();

    // Fallback getter
    const getFallbackTarget = () => {
        const others = snapshot.players.filter(p => p.isAlive && p.seat !== botSeat);
        if (others.length > 0) {
            return others[Math.floor(Math.random() * others.length)].seat;
        }
        return null; // No one else alive?
    };

    if (!aiClient) return getFallbackTarget();

    try {
        const prompt = buildDecisionPrompt(snapshot, botSeat, "night_action");
        console.log(`[BotAI-${botSeat}] Prompt (Night):`, prompt);

        const response = await withRaceRetry(
            () => aiClient.chat.completions.create({
                model: 'gemini-3-flash-preview',
                messages: [
                    { role: 'system', content: "You are a player in the game. Respond with the specified JSON schema." },
                    { role: 'user', content: prompt }
                ],
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: "night_action",
                        schema: ACTION_SCHEMA,
                        strict: true
                    }
                },
                temperature: 0,
                top_p: 0.85,
                reasoning_effort: "medium"
            }),
            20000,  // 20 second timeout before racing
            2,      // max 2 concurrent attempts
            `BotAI-${botSeat}-Night`
        );

        const rawContent = response.choices[0]?.message?.content || "";
        console.log(`[BotAI-${botSeat}] Response (Night):`, rawContent);

        const parsed = JSON.parse(rawContent);

        if (typeof parsed.targetSeat === 'number' && parsed.targetSeat > 0) {
            const mem = getBotMemory(snapshot.roomCode, botSeat);
            if (mem) {
                updateBotMemoryFromDecision(
                    snapshot.roomCode,
                    botSeat,
                    parsed.updatedPlayerNotes,
                    parsed.reason || "Night Action", // strategicNote reuse
                    mem.claimedRole,
                    parsed.strategicPlan
                );

                mem.selfActionLog.push({
                    day: snapshot.dayCount,
                    phase: "night_action",
                    action: "NightSkill",
                    target: parsed.targetSeat,
                    reason: parsed.reason || "Skill"
                });
            }
            return parsed.targetSeat;
        }
        throw new Error("AI returned invalid night target");

    } catch (e) {
        console.error(`[BotAI-${botSeat}] Night Action Error, using fallback:`, e);

        // Smart Fallback
        const type = (myRole === "医生" || myRole === "花蝴蝶") ? "protect" : "kill";
        return getSmartFallbackTarget(snapshot, botSeat, type);
    }
}

// Backwards compatibility wrappers
export async function generateBotSpeech(snapshot: FlowerSnapshot, botSeat: number): Promise<string> {
    const decision = await getBotSpeechDecision(snapshot, botSeat, false);
    return decision.content;
}

export async function generateBotLastWords(snapshot: FlowerSnapshot, botSeat: number): Promise<string> {
    const decision = await getBotSpeechDecision(snapshot, botSeat, true);
    return decision.content;
}