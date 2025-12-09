
import type { FlowerRole } from "./types.js";

// ==========================================
// 1. 游戏规则常量
// ==========================================

export const FLOWER_GAME_RULES = `
花蝴蝶 9 人局规则
人数与角色
•	固定 9 名玩家，座位按顺时针 1~9 号。
•	角色随机分配：
    - 好人阵营：花蝴蝶、狙击手、医生、警察、善民
    - 坏人阵营：杀手、魔法师、森林老人、恶民
•	角色继承：杀手死 → 魔法师转杀手；杀手 + 魔法师都死 → 森林老人转杀手；升职者失去原技能。

夜晚行动
1.	魔法师：对任意座位施法，使其当晚技能无效（若目标是花蝴蝶本人，会让抱人失效；若目标是被抱者且抱生效，则施法被顶掉）。
2.	花蝴蝶：抱起 1 人，被抱者免疫所有指向技能；花蝴蝶遭受的效果复制给被抱者（抱自己=弃权；若被施法则抱人失效）。
3.	杀手/狙击手：各自杀 1 人，受害者次日公布死亡。
4.	医生：扎 1 人；若目标当晚被杀/被狙且只有一方命中则免死，否则留下空针，累积 2 针次日死亡。
5.	警察：查验 1 人，结果为坏特殊/非坏特殊/无法验。
6.	森林老人：禁言 1 人，次日无法发言投票、死亡者不能留遗言。
7.	善民/恶民：各投暗票 +1，计入下一次白天票数；善恶民死亡当夜暗票仍有效；若被施法则当晚无法投暗票。
夜间结果：医生救人、空针死亡、抱人转移、魔法师失效、禁言名单、警察验人、暗票等同时结算并写入系统日志。

白天流程
•	公布夜间死亡与禁言名单；死亡者按规则留遗言。
•	所有存活者顺序发言后投票。单人死亡，则死者座号之后的第一位存活玩家发言，否则随机某人开始发言。
•	计票 = 白天明票 + 上一夜暗票；最高票唯一者立即死亡，公布出局人是否为坏特殊，若为坏特殊不能留遗言，平票则无人死亡。
•	禁言者当日不能发言投票。
•	入夜，若有「坏特殊」升级为杀手，该玩家会私下收到通知。

胜负条件
•	好人阵营全灭 → 坏人胜。
•	杀手、魔法师、森林老人全部死亡 → 好人胜。
•	若只剩恶民或善民+恶民，判平局；所有人死也判平局。
`;

// ==========================================
// 2. AI 决策接口定义
// ==========================================

export interface PlayerAssessment {
    seat: number;
    /**
     * Guess the player's role based on observation.
     */
    roleGuess: FlowerRole | "Unknown";
    /**
     * Guess the player's intent (e.g., "Trying to lead votes", "Acting confused").
     */
    intentGuess: string;
    /**
     * Reason for the assessment.
     */
    reasoning: string;
}

export interface SpeechDecision {
    /**
     * The speech content to be sent to chat.
     */
    content: string;

    /**
     * Evaluation of all other players.
     */
    playerAssessments: PlayerAssessment[];

    /**
     * A short strategic note summarizing current situation and plan.
     * Saved to memory for context in next steps.
     */
    strategicNote: string;

    /**
     * Updated long-term strategy for the game.
     */
    strategicPlan?: string;

    /**
     * The role this bot claims to be in public for this decision cycle.
     * E.g. "善民", "警察", "医生".
     */
    claimedRole: import("./types.js").FlowerRole;
}

export interface VoteDecision {
    targetSeat: number; // 0 for abstain/skip
    reason: string;
    /**
     * Updated assessments during the voting phase.
     */
    playerAssessments?: PlayerAssessment[];
    strategicNote?: string;
    strategicPlan?: string;
    claimedRole?: import("./types.js").FlowerRole;
}

export interface NightActionDecision {
    targetSeat: number | null; // null for no action / skip
    reason: string;
    strategicPlan?: string;
}
