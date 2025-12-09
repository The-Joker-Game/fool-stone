// realtime-server/src/game-flower/bot-logic-ai.ts
// AI-powered bot logic using DeepSeek API (OpenAI Compatible)

import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import type { FlowerSnapshot, FlowerHistoryRecord } from "./types.js";
import { getBotMemory, updateBotMemoryFromAssessment } from "./bot-state.js";
import {
    FLOWER_GAME_RULES,
    type SpeechDecision,
    type PlayerAssessment,
} from "./ai-protocol.js";

// Initialize DeepSeek AI client lazily to avoid hoisting issues
let ai: OpenAI | null = null;

function getAIClient(): OpenAI | null {
    if (ai) return ai;
    const key = process.env.DEEPSEEK_API_KEY;
    if (key) {
        ai = new OpenAI({
            baseURL: 'https://api.deepseek.com',
            apiKey: key
        });
    }
    return ai;
}

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

    // 1. Filter targets based on cached assessments
    let candidates: number[] = [];

    if (actionType === "vote" || actionType === "kill") {
        // Find suspected enemies
        // In new logic: look for roleGuess = Bad Roles OR reasoning containing "suspect"
        const badRoles = ["杀手", "魔法师", "森林老人", "恶民"];
        candidates = aliveOthers.filter(seat => {
            const assessment = mem.assessments.get(seat);
            if (!assessment) return false;
            // If we guessed they are bad
            if (badRoles.includes(assessment.roleGuess)) return true;
            // Or if reasoning seems hostile (simple keyword check as fallback)
            if (assessment.reasoning.includes("坏") || assessment.reasoning.includes("杀")) return true;
            return false;
        });
    } else if (actionType === "protect") {
        // Find suspected allies (Good Roles)
        const goodRoles = ["花蝴蝶", "狙击手", "医生", "警察", "善民"];
        candidates = aliveOthers.filter(seat => {
            const assessment = mem.assessments.get(seat);
            if (!assessment) return false;
            if (goodRoles.includes(assessment.roleGuess)) return true;
            // Or if reasoning seems friendly
            if (assessment.reasoning.includes("好") || assessment.reasoning.includes("金水")) return true;
            return false;
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
    const dayTag = `【第 ${record.dayCount} 天${type === "night" ? "夜间" : "白天"}结算】`;

    if (type === "night") {
        const deaths = record.night.result.deaths;
        const deathStr = deaths.length > 0
            ? deaths.map(d => `${d.seat}号(${d.reason === "needles" ? "双扎/空针" : "遇害"})`).join("、")
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
                extraInfo += ` 🕵️‍♂️【警察验人结果】${repLines.join("，")}。`;
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
            ? `${exec.seat}号被投票处决${exec.isBadSpecial ? "(坏特殊)" : ""}`
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
        for (const msg of newMsgs) {
            if (msg.sessionId === "system") {
                mem.contextHistory.push(`【系统公告】${msg.content}`);
            } else {
                mem.contextHistory.push(`${msg.senderSeat}号${msg.senderName}: ${msg.content}`);
            }
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
function formatAssessments(mem: import("./bot-state.js").BotMemory): string {
    const lines: string[] = [];
    mem.assessments.forEach(a => {
        lines.push(`- Seat ${a.seat}: Guess=[${a.roleGuess}], Intent=[${a.intentGuess}]\n  Reasoning: ${a.reasoning}`);
    });
    return lines.length > 0 ? lines.join("\n") : "None yet.";
}

/**
 * Format self action log for prompt
 */
function formatActionLog(mem: import("./bot-state.js").BotMemory): string {
    return mem.selfActionLog.slice(-10).map(l => {
        return `- Day ${l.day} [${l.phase}]: ${l.action} (Target: ${l.target ?? "None"}). Reason: ${l.reason}`;
    }).join("\n") || "None.";
}

/**
 * Build a contextual prompt for AI decision making (Optimized for DeepSeek Context Caching)
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

    // --- Prompt 构建开始 ---

    // 基础规则与人设
    const basePrompt = `
你是一个《花蝴蝶》杀人游戏中的**高阶玩家**。
你的目标是赢得胜利。
【游戏规则】
${FLOWER_GAME_RULES}
`;

    // 策略部分 (Strategy)
    const isBad = ["杀手", "魔法师", "森林老人", "恶民"].includes(mem.realRole);
    let strategyPrompt = "";

    if (isBad) {
        strategyPrompt = `
【你的身份：坏人阵营】
策略：生存至上，六亲不认。必要时倒钩（踩队友做高身份）。制造混乱，或者伪装成“真诚的平民”。
`;
    } else {
        strategyPrompt = `
【你的身份：好人阵营】
策略：怀疑一切，寻找逻辑断层。保护神职，如果你是神职可以适当“钓鱼执法”。
`;
    }

    // 记忆与历史 (Memory & History)
    const memoryStream = mem.contextHistory.slice(-50).join("\n");
    const myActionHistory = formatActionLog(mem);
    const myAssessments = formatAssessments(mem);

    const memoryBlock = `
【历史事件流 (Public History)】
${memoryStream}

【我的行动记录 (My Action Log)】
${myActionHistory}

【我对其他玩家的分析 (My Previous Analysis)】
${myAssessments}
`;

    // 局势部分 (Current State)
    const playerList = snapshot.players.map(p => {
        const status = p.isAlive ? "存活" : "已死亡";
        const roleInfo = (p.seat === botSeat) ? `(我, ${mem.realRole}, 伪装:${mem.claimedRole})` : "";
        const known = mem.knownRoles.get(p.seat);
        const knownStr = known ? `[已知:${known.role}]` : "";

        return `- ${p.seat}号${p.name}: ${status} ${roleInfo} ${knownStr}`;
    }).join("\n");

    const currentState = `
【当前局势】
阶段：${snapshot.phase}
存活玩家：
${playerList}

【当前长期战略 (Current Strategic Goal)】
${mem.longTermStrategy}
`;

    // --- 任务指令 (Task Instruction) ---
    let taskInstruction = "";

    if (taskType === "speech") {
        taskInstruction = `
【本轮任务：日常发言】
**请严格遵守以下【发言要求】：**

   **重要注意（Style Constraints）**：
1. 发言要自然、符合游戏逻辑。
2. 控制在50字以内。
3. 根据当前局势，可选是否更新你的 longTermStrategy（如果和原来保持一致则不更新）。
4. 对话需要具有自己的独特性，鼓励在符合自己决策的情况下提出自己的独特观点，因为属于不同的角色，你要和别人的发言之间产生显著的差异。请注意，如果复述别人的观点可能引起怀疑！

**输出要求**：请输出 JSON。
- playerAssessments: 这里的 assessment 必须非常详细地分析每个玩家的身份可能性和意图。
- strategicNote: 本轮简短思考。
- strategicPlan: 更新后的长期战略目标。
- claimedRole: 本轮宣称身份。
- content: 发言内容。
`;

    } else if (taskType === "last_words") {
        taskInstruction = `
【本轮任务：发表遗言】
**你已经死了！**

**【遗言阶段要求】**
你已经在上一夜死亡或被投票出局，现在需要发表遗言。遗言应该：
1. 表明你的真实身份或声称的身份。
2. 提供你认为有用的信息（如：如果是神职，报出验人/救人信息）。
3. 指出你认为的坏人。
4. 鼓励好人阵营继续游戏（或者如果你是坏人，试着误导好人）。
5. 对话需要具有自己的独特性，鼓励在符合自己决策的情况下提出自己的独特观点，因为属于不同的角色，你应该和别人的发言之间产生显著的差异。

**注意**：
- 字数控制在 50 字以内。
- 情绪要到位（委屈、愤怒或无奈）。

**输出要求**：请输出 JSON。
- content: 发言内容。
`;

    } else if (taskType === "vote") {
        taskInstruction = `
【本轮任务：投票】
**可选投票目标（存活玩家）：[${validTargetStr}]**
请从上述列表中选择一个座位号。

**思考方向**：
- 结合你的长期战略和对其他人的评估。
- 寻找逻辑漏洞、倒钩狼或冲票行为。

输出 JSON：
- targetSeat (座位号)
- reason (理由)
- playerAssessments (可选，更新分析)
- strategicPlan (可选，更新战略)
`;

    } else if (taskType === "night_action") {
        taskInstruction = `
【本轮任务：夜晚行动】
你的角色是【${mem.realRole}】。请决定你的技能目标。
**可选技能目标：[${validTargetStr}]**

**重要策略提示**：
- 首夜盲选时，请展现你的随机性，越是不可预测的行为，越能让好人阵营混乱。

输出 JSON：
 - targetSeat (目标座位)
 - reason (理由)
 - playerAssessments (可选，更新分析)
 - strategicPlan (可选)
`;
    }

    return basePrompt + strategyPrompt + memoryBlock + currentState + taskInstruction;
}

/**
 * Get AI decision for speech and thought process
 */
export async function getBotSpeechDecision(
    snapshot: FlowerSnapshot,
    botSeat: number,
    isLastWords: boolean = false
): Promise<SpeechDecision> {

    const existingMem = getBotMemory(snapshot.roomCode, botSeat);

    // Default fallback
    const fallbackDecision: SpeechDecision = {
        content: isLastWords ? "我是好人，大家加油。" : "过。",
        playerAssessments: [],
        strategicNote: "Fallback due to error.",
        claimedRole: existingMem ? existingMem.claimedRole : "善民"
    };

    const aiClient = getAIClient();
    if (!aiClient) return fallbackDecision;
    if (!existingMem) return fallbackDecision;

    try {
        const prompt = buildDecisionPrompt(snapshot, botSeat, isLastWords ? "last_words" : "speech");

        console.log(`[BotAI-${botSeat}] Prompt (Speech):`, prompt);

        const response = await aiClient.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: "You are a master player of 'Flower Butterfly'. Respond ONLY in JSON." },
                { role: 'user', content: prompt }
            ],
            response_format: { type: "json_object" },
            max_tokens: 1000,
            temperature: 0.8
        });

        const rawContent = response.choices[0]?.message?.content || "";
        console.log(`[BotAI-${botSeat}] Response (Speech):`, rawContent);

        if (!rawContent) throw new Error("Empty response from AI");

        const fixedJson = jsonrepair(rawContent);
        const parsed = JSON.parse(fixedJson);

        const decision: SpeechDecision = {
            content: parsed.content || fallbackDecision.content,
            playerAssessments: Array.isArray(parsed.playerAssessments) ? parsed.playerAssessments : [],
            strategicNote: parsed.strategicNote || "No strategy note.",
            strategicPlan: parsed.strategicPlan,
            claimedRole: parsed.claimedRole || existingMem.claimedRole || "善民"
        };

        // Log Action
        existingMem.selfActionLog.push({
            day: snapshot.dayCount,
            phase: isLastWords ? "last_words" : "speech",
            action: "Speak",
            reason: decision.strategicNote,
            content: decision.content
        });

        return decision;
    } catch (e) {
        console.error("[Bot AI] Decision Error:", e);
        return fallbackDecision;
    }
}

/**
 * Get AI Vote Target (New LLM Implementation)
 */
export async function getBotVoteTarget(
    snapshot: FlowerSnapshot,
    botSeat: number,
    myRole: import("./types.js").FlowerRole // Argument to match original signature, though we get it from memory
): Promise<number | null> {
    const aiClient = getAIClient();
    if (!aiClient) return null;

    try {
        const prompt = buildDecisionPrompt(snapshot, botSeat, "vote");
        console.log(`[BotAI-${botSeat}] Prompt (Vote):`, prompt);

        const response = await aiClient.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: "Respond ONLY in JSON." },
                { role: 'user', content: prompt }
            ],
            response_format: { type: "json_object" },
            max_tokens: 1000,
            temperature: 0.5 // Lower temp for voting
        });

        const rawContent = response.choices[0]?.message?.content || "";
        console.log(`[BotAI-${botSeat}] Response (Vote):`, rawContent);

        const fixedJson = jsonrepair(rawContent);
        const parsed = JSON.parse(fixedJson);

        // Update memory with new thoughts if provided
        if (parsed.playerAssessments || parsed.strategicPlan) {
            const currentMem = getBotMemory(snapshot.roomCode, botSeat);
            if (currentMem) {
                updateBotMemoryFromAssessment(
                    snapshot.roomCode,
                    botSeat,
                    Array.isArray(parsed.playerAssessments) ? parsed.playerAssessments : [],
                    parsed.strategicNote || "",
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

        const response = await aiClient.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: "Respond ONLY in JSON." },
                { role: 'user', content: prompt }
            ],
            response_format: { type: "json_object" },
            max_tokens: 1000,
            temperature: 0.5
        });

        const rawContent = response.choices[0]?.message?.content || "";
        console.log(`[BotAI-${botSeat}] Response (Night):`, rawContent);

        const fixedJson = jsonrepair(rawContent);
        const parsed = JSON.parse(fixedJson);

        if (typeof parsed.targetSeat === 'number' && parsed.targetSeat > 0) {
            const mem = getBotMemory(snapshot.roomCode, botSeat);
            if (mem) {
                mem.selfActionLog.push({
                    day: snapshot.dayCount,
                    phase: "night_action",
                    action: "NightSkill",
                    target: parsed.targetSeat,
                    reason: parsed.reason || "Skill"
                });
                if (parsed.strategicPlan) mem.longTermStrategy = parsed.strategicPlan;
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