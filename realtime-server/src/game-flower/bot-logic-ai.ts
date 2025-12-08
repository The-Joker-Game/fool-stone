// realtime-server/src/game-flower/bot-logic-ai.ts
// AI-powered bot logic using DeepSeek API (OpenAI Compatible)

import OpenAI from 'openai';
import type { FlowerSnapshot, FlowerRole } from "./types.js";
import { getBotMemory } from "./bot-state.js";
import {
    getBotNightActionTarget,
    getBotVoteTarget
} from "./bot-logic.js";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Initialize DeepSeek AI client
const ai = DEEPSEEK_API_KEY ? new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: DEEPSEEK_API_KEY
}) : null;

// Re-export night action and vote logic from original bot-logic.ts
export { getBotNightActionTarget, getBotVoteTarget };

/**
 * Build a comprehensive game context prompt for AI
 */
function buildGameContextPrompt(snapshot: FlowerSnapshot, botSeat: number, isLastWords: boolean = false): string {
    const mem = getBotMemory(snapshot.roomCode, botSeat);
    const bot = snapshot.players.find(p => p.seat === botSeat);

    if (!bot || !mem) {
        return "游戏状态未知。";
    }

    const alivePlayers = snapshot.players.filter(p => p.isAlive);
    const deadPlayers = snapshot.players.filter(p => !p.isAlive);
    const lastNightDeaths = snapshot.night.result?.deaths || [];
    const chatMessages = snapshot.chatMessages || [];
    const recentChat = chatMessages.slice(-20); // Last 20 messages for context

    // Build player list
    const playerList = snapshot.players.map(p => {
        const status = p.isAlive ? "存活" : "已死亡";
        const roleInfo = p.role ? `（身份：${p.role}）` : "（身份未知）";
        const isMe = p.seat === botSeat ? "【我】" : "";
        return `${isMe}${p.seat}号玩家：${p.name} - ${status}${roleInfo}`;
    }).join("\n");

    // Build suspicion list
    const suspicionList = Array.from(mem.suspicion.entries())
        .map(([seat, score]) => {
            const player = snapshot.players.find(p => p.seat === seat);
            if (!player || !player.isAlive) return null;
            return `${seat}号玩家：怀疑度 ${score}/100`;
        })
        .filter(Boolean)
        .join("\n");

    // Build known roles
    const knownRoles = Array.from(mem.knownRoles.entries())
        .map(([seat, info]) => {
            const player = snapshot.players.find(p => p.seat === seat);
            if (!player) return null;
            return `${seat}号玩家：${info.role === "good" ? "好人" : info.role === "bad" ? "坏人" : info.role}（来源：${info.source === "police" ? "警察查验" : "目击"}）`;
        })
        .filter(Boolean)
        .join("\n");

    // Build action history
    const actionHistory = mem.actionHistory.nightActions
        .slice(-5) // Last 5 actions
        .map(action => `第${action.turn}夜：对${action.target}号玩家使用了技能`)
        .join("\n");

    // Build recent chat summary
    const chatSummary = recentChat
        .map(msg => {
            const isBot = msg.sessionId === "bot";
            return `${msg.senderSeat}号${msg.senderName}${isBot ? "（机器人）" : ""}：${msg.content}`;
        })
        .join("\n");

    // Build vote history if in voting phase
    const currentVotes = snapshot.day.votes || [];
    const voteSummary = currentVotes.length > 0
        ? currentVotes.map(v => `${v.voterSeat}号投票给${v.targetSeat}号`).join("\n")
        : "暂无投票";

    const prompt = `
你是一个狼人杀游戏中的AI玩家，正在参与"花蝴蝶"游戏。

【我的信息】
- 座位号：${botSeat}号
- 真实身份：${mem.realRole}
- 声称身份：${mem.claimedRole}
- 是否存活：${bot.isAlive ? "是" : "否"}

【游戏状态】
- 当前阶段：${snapshot.phase}
- 第${snapshot.dayCount}天
- 存活玩家数：${alivePlayers.length}
- 死亡玩家数：${deadPlayers.length}

【玩家列表】
${playerList}

【昨晚情况】
${lastNightDeaths.length > 0
            ? lastNightDeaths.map(d => `${d.seat}号玩家死亡（原因：${d.reason}）`).join("\n")
            : "昨晚平安夜，无人死亡"}

【我的怀疑度评估】
${suspicionList || "暂无怀疑度信息"}

【已知信息】
${knownRoles || "暂无已知身份信息"}

【我的行动历史】
${actionHistory || "暂无行动历史"}

【最近的聊天记录】
${chatSummary || "暂无聊天记录"}

【当前投票情况】
${voteSummary}

【发言顺序】
当前发言顺序：${snapshot.day.speechOrder.join(", ")}号
当前发言者：${snapshot.day.speechOrder[snapshot.day.currentSpeakerIndex]}号

${isLastWords ? `
【遗言阶段】
你已经被投票出局，现在需要发表遗言。遗言应该：
1. 表明你的真实身份或声称的身份
2. 提供你认为有用的信息
3. 指出你认为的坏人
4. 鼓励好人阵营继续游戏
` : `
【发言要求】
现在轮到你发言，你需要：
执行下面其中一条或多条：
- 分析场上的情况，指出可疑的玩家。（30%几率执行这条）
- 如果你是好人，可以指出坏人，但不要暴露自己。（30%几率执行这条）
- 表明自己身份，并说明自己的行动。（30%几率执行这条）
- 提出合理怀疑。（30%几率执行这条）

注意：
如果被人提问质疑 需要辩解。
如果你是坏人 绝对不要承认，把自己伪装起来。
发言要自然、符合游戏逻辑，像真人玩家一样
发言长度控制在10-50字之间
可以自然结束，不需要固定的结尾格式
`}

请生成一段符合游戏逻辑的发言，要求：
- 使用中文
- 自然流畅，符合狼人杀游戏的发言风格，像真人玩家一样说话
- 根据你的身份和场上情况做出合理判断
- 不要过于机械或模板化，避免重复的格式
- 发言长度控制在10-40字之间,精简字数,口语化一些，有些语法错误也可以，倒装句 标点符号没用好也可以 不要太完美
- 可以自然结束，不需要固定的结尾格式，让发言看起来更真实
`;

    return prompt;
}

/**
 * Generate bot speech using AI
 */
export async function generateBotSpeech(snapshot: FlowerSnapshot, botSeat: number): Promise<string> {
    // Fallback if AI is not configured
    if (!ai || !DEEPSEEK_API_KEY) {
        console.warn("[Bot AI] DeepSeek API not configured, falling back to default message");
        return "我是好人，过。";
    }

    const mem = getBotMemory(snapshot.roomCode, botSeat);
    if (!mem) {
        return "我是好人，过。";
    }

    try {
        const prompt = buildGameContextPrompt(snapshot, botSeat, false);

        const response = await ai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 100
        });

        let speech = response.choices[0]?.message?.content?.trim() || "";

        // Fallback if response is empty
        if (!speech || speech.length < 5) {
            console.warn("[Bot AI] Empty or too short response, using fallback");
            return "我是好人，过。";
        }

        return speech;
    } catch (error) {
        console.error("[Bot AI] Error generating speech:", error);
        // Fallback to simple message on error
        return "我是好人，过。";
    }
}

/**
 * Generate bot last words using AI
 */
export async function generateBotLastWords(snapshot: FlowerSnapshot, botSeat: number): Promise<string> {
    // Fallback if AI is not configured
    if (!ai || !DEEPSEEK_API_KEY) {
        console.warn("[Bot AI] DeepSeek API not configured, falling back to default last words");
        return "我是好人，大家加油。";
    }

    const mem = getBotMemory(snapshot.roomCode, botSeat);
    if (!mem) {
        return "我是好人，大家加油。";
    }

    try {
        const prompt = buildGameContextPrompt(snapshot, botSeat, true);

        const response = await ai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 100
        });

        let lastWords = response.choices[0]?.message?.content?.trim() || "";

        // Fallback if response is empty
        if (!lastWords || lastWords.length < 5) {
            console.warn("[Bot AI] Empty or too short response for last words, using fallback");
            return "我是好人，大家加油。";
        }

        return lastWords;
    } catch (error) {
        console.error("[Bot AI] Error generating last words:", error);
        // Fallback to simple message on error
        return "我是好人，大家加油。";
    }
}

