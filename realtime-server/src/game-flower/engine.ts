import type {
  FlowerSnapshot,
  FlowerPlayerState,
  FlowerNightAction,
  FlowerRole,
  FlowerGameResult,
  FlowerNightState,
  FlowerDayState,
} from "./types.js";
import { updateBotGuesses } from "./bot-state.js";

export const FLOWER_ROLES: FlowerRole[] = [
  "花蝴蝶",
  "狙击手",
  "医生",
  "警察",
  "善民",
  "杀手",
  "魔法师",
  "森林老人",
  "恶民",
];

const BAD_SPECIAL_ROLES = new Set<FlowerRole>(["杀手", "魔法师", "森林老人"]);
const GOOD_ROLES = new Set<FlowerRole>(["花蝴蝶", "狙击手", "医生", "警察", "善民"]);

export type AssignResult = { ok: boolean; error?: string };
export type ResolveResult = { ok: boolean; error?: string };
export type SubmitResult = { ok: boolean; error?: string };
export type VoteResult = { ok: boolean; error?: string };

const MAX_SEATS = 9;

interface InitPlayer {
  name: string;
  seat: number;
  sessionId: string | null;
}

function createEmptyPlayer(seat: number): FlowerPlayerState {
  return {
    seat,
    sessionId: null,
    name: `座位${seat}`,
    role: null,
    originalRole: null,
    isAlive: false,
    isReady: false,
    isHost: false,
    isBot: false,
    isMutedToday: false,
    hasVotedToday: false,
    voteTargetSeat: null,
    darkVoteTargetSeat: null,
    nightAction: null,
    needleCount: 0,
    pendingNeedleDeath: false,
    flags: {},
  };
}

function emptyNightState(): FlowerNightState {
  return { submittedActions: [], lastActions: [], result: null };
}

function emptyDayState(): FlowerDayState {
  return { speechOrder: [], currentSpeakerIndex: 0, voteOrder: [], votes: [], tally: {}, pendingExecution: null };
}

export function initFlowerRoom(roomCode: string, players: InitPlayer[]): FlowerSnapshot {
  const playerStates: FlowerPlayerState[] = Array.from({ length: MAX_SEATS }, (_, idx) =>
    createEmptyPlayer(idx + 1)
  );

  players.forEach((p) => {
    const seatIdx = p.seat - 1;
    if (seatIdx >= 0 && seatIdx < playerStates.length) {
      const ps = playerStates[seatIdx];
      ps.name = p.name;
      ps.sessionId = p.sessionId;
      ps.isAlive = true;
    }
  });

  const now = Date.now();
  return {
    engine: "flower",
    roomCode,
    hostSessionId: null,
    phase: "lobby",
    dayCount: 0,
    players: playerStates,
    night: emptyNightState(),
    day: emptyDayState(),
    history: [],
    logs: [{ at: now, text: "花蝴蝶房间创建，等待开始" }],
    chatMessages: [],
    pendingAction: null,
    gameResult: null,
    updatedAt: now,
  };
}

export function flowerPlayerReady(state: FlowerSnapshot, seat: number): FlowerSnapshot {
  const now = Date.now();
  return {
    ...state,
    logs: [...state.logs, { at: now, text: `✅ 座位 ${seat} 点击了准备` }],
    updatedAt: now,
  };
}

export function assignFlowerRoles(snapshot: FlowerSnapshot): AssignResult {
  if (!snapshot) return { ok: false, error: "没有可用的快照" };
  const occupied = snapshot.players.filter((p) => p.sessionId);
  if (occupied.length !== FLOWER_ROLES.length) {
    return { ok: false, error: "需要 9 名玩家才能开始游戏" };
  }

  const shuffledSeats = shuffleArray(occupied.map((p) => p.seat));
  const now = Date.now();
  snapshot.players.forEach((player) => {
    player.isAlive = !!player.sessionId;
    player.isMutedToday = false;
    player.hasVotedToday = false;
    player.voteTargetSeat = null;
    player.darkVoteTargetSeat = null;
    player.nightAction = null;
    if (!player.sessionId) {
      player.role = null;
      player.originalRole = null;
      player.flags = {};
      player.needleCount = 0;
      player.pendingNeedleDeath = false;
    }
  });

  shuffledSeats.forEach((seat, idx) => {
    const player = snapshot.players.find((p) => p.seat === seat);
    if (!player) return;
    const role = FLOWER_ROLES[idx];
    player.role = role;
    player.originalRole = role;
    player.flags = { isBadSpecial: BAD_SPECIAL_ROLES.has(role) };
    player.needleCount = 0;
    player.pendingNeedleDeath = false;
    snapshot.logs.push({
      at: now,
      text: `座位 ${seat}（${player.name || "玩家"}）抽到了【${role}】`,
    });
  });

  snapshot.dayCount = 1;
  snapshot.phase = "night_actions";
  snapshot.night = { submittedActions: [], result: null };
  snapshot.day = { speechOrder: [], currentSpeakerIndex: 0, voteOrder: [], votes: [], tally: {}, pendingExecution: null };
  snapshot.history = [];
  snapshot.logs.push({ at: now, text: "🌙 花蝴蝶对局开始，身份已分发" });
  snapshot.updatedAt = now;

  // Initialize bot guesses for Day 1
  updateBotGuesses(snapshot.roomCode, snapshot.dayCount, snapshot.players);

  return { ok: true };
}

export interface SubmitNightActionPayload {
  role: FlowerRole;
  actorSeat: number;
  targetSeat?: number | null;
  secondarySeat?: number | null;
}

export interface SubmitDayVotePayload {
  voterSeat: number;
  targetSeat: number;
}

export function submitNightAction(snapshot: FlowerSnapshot, payload: SubmitNightActionPayload): SubmitResult {
  if (!snapshot) return { ok: false, error: "没有可用的快照" };
  if (snapshot.phase !== "night_actions") return { ok: false, error: "当前阶段无法提交夜晚技能" };
  const actor = snapshot.players.find((p) => p.seat === payload.actorSeat);
  if (!actor || !actor.isAlive || actor.role !== payload.role) {
    return { ok: false, error: "当前玩家无法执行该技能" };
  }

  const action: FlowerNightAction = {
    role: payload.role,
    actorSeat: payload.actorSeat,
    targetSeat: payload.targetSeat ?? null,
    secondarySeat: payload.secondarySeat ?? null,
    submittedAt: Date.now(),
    status: "locked",
  };

  snapshot.night.submittedActions = snapshot.night.submittedActions.filter((a) => a.role !== payload.role);
  snapshot.night.submittedActions.push(action);
  actor.nightAction = action;
  const now = Date.now();
  const actorName = `${actor.name || "玩家"}（座位 ${actor.seat}）`;
  const targetText = action.targetSeat ? `座位 ${action.targetSeat}` : "无目标";
  snapshot.logs.push({ at: now, text: `🌙 ${actorName} 的【${action.role}】指向 ${targetText}` });
  snapshot.updatedAt = now;
  return { ok: true };
}

export function resolveNight(snapshot: FlowerSnapshot): ResolveResult {
  if (!snapshot) return { ok: false, error: "没有可用的快照" };
  if (snapshot.phase !== "night_actions") return { ok: false, error: "当前阶段无法结算夜晚" };
  const context = buildNightContext(snapshot);
  if (!context) return { ok: false, error: "缺少夜晚上下文" };

  const result = computeNightOutcome(context);
  applyNightOutcome(snapshot, result);
  return { ok: true };
}

export function submitDayVote(snapshot: FlowerSnapshot, payload: SubmitDayVotePayload): VoteResult {
  if (!snapshot) return { ok: false, error: "没有可用的快照" };
  if (snapshot.phase !== "day_vote" && snapshot.phase !== "day_discussion" && snapshot.phase !== "day_last_words") return { ok: false, error: "当前阶段无法投票" };

  // Special check for day_last_words: only allow voting if it's the "morning" last words (next phase is discussion)
  if (snapshot.phase === "day_last_words") {
    if (snapshot.day.lastWords?.nextPhase !== "day_discussion") {
      return { ok: false, error: "当前遗言阶段无法投票" };
    }
  }
  const voter = snapshot.players.find((p) => p.seat === payload.voterSeat);
  const target = snapshot.players.find((p) => p.seat === payload.targetSeat);
  if (!voter || !target) return { ok: false, error: "座位不存在" };
  if (!voter.isAlive) return { ok: false, error: "死亡玩家无法投票" };
  if (voter.isMutedToday) return { ok: false, error: "被禁言玩家无法投票" };
  if (!target.isAlive) return { ok: false, error: "目标玩家已死亡" };

  snapshot.day.votes = snapshot.day.votes.filter((v) => v.voterSeat === payload.voterSeat ? false : true);
  snapshot.day.votes.push({
    voterSeat: payload.voterSeat,
    targetSeat: payload.targetSeat,
    submittedAt: Date.now(),
    source: "day",
  });
  voter.hasVotedToday = true;
  voter.voteTargetSeat = payload.targetSeat;
  snapshot.updatedAt = Date.now();
  snapshot.logs.push({ at: Date.now(), text: `白天投票：座位 ${payload.voterSeat} 投给座位 ${payload.targetSeat}` });
  return { ok: true };
}

export function resolveDayVote(snapshot: FlowerSnapshot): ResolveResult {
  if (!snapshot) return { ok: false, error: "没有可用的快照" };
  if (snapshot.phase !== "day_vote") return { ok: false, error: "当前阶段无法结算" };

  const tally = new Map<number, number>();
  Object.entries(snapshot.day.tally || {}).forEach(([seat, count]) => {
    tally.set(Number(seat), (tally.get(Number(seat)) ?? 0) + (count ?? 0));
  });
  snapshot.day.votes.forEach((vote) => {
    tally.set(vote.targetSeat, (tally.get(vote.targetSeat) ?? 0) + 1);
  });

  let maxVotes = -Infinity;
  const topSeats: number[] = [];
  tally.forEach((value, seat) => {
    if (value > maxVotes) {
      maxVotes = value;
      topSeats.length = 0;
      topSeats.push(seat);
    } else if (value === maxVotes) {
      topSeats.push(seat);
    }
  });

  let executedSeat: number | null = null;
  if (topSeats.length === 1) {
    executedSeat = topSeats[0];
  }

  if (executedSeat) {
    const player = snapshot.players.find((p) => p.seat === executedSeat);
    if (player) {
      player.isAlive = false;
      snapshot.logs.push({ at: Date.now(), text: `白天票决：座位 ${executedSeat} 被处决${player.flags?.isBadSpecial ? "（坏特殊）" : ""}` });
    }
  } else {
    snapshot.logs.push({ at: Date.now(), text: "白天投票平票，无人死亡" });
  }

  if (snapshot.day.votes.length > 0) {
    const voteSummary = snapshot.day.votes
      .map((vote) => `座位 ${vote.voterSeat} → 座位 ${vote.targetSeat}`)
      .join("；");
    snapshot.logs.push({ at: Date.now(), text: `白天票型：${voteSummary}` });
  }

  const promoted = promoteBadSpecial(snapshot);
  const upgrades = promoted ? [{ seat: promoted.seat, fromRole: promoted.fromRole, toRole: "杀手" as const }] : [];

  snapshot.day.pendingExecution = executedSeat
    ? { seat: executedSeat, isBadSpecial: !!snapshot.players.find((p) => p.seat === executedSeat)?.flags?.isBadSpecial }
    : null;

  // Update history with day results
  // We look for the history record for the current dayCount
  // Note: dayCount starts at 1.
  // If we just finished night 1, we created a history record with dayCount 1.
  // Now we are finishing day 1, so we update that same record.
  const historyRecord = snapshot.history.find(h => h.dayCount === snapshot.dayCount);
  if (historyRecord) {
    historyRecord.day = {
      votes: [...snapshot.day.votes],
      execution: snapshot.day.pendingExecution,
      upgrades: upgrades
    };
  } else {
    // Should not happen if logic is correct, but fallback just in case
    // Maybe it's day 1 and we somehow missed night history? Unlikely in normal flow.
    // Or maybe we just recovered from a crash?
  }

  const dayResult = evaluateGameResult(snapshot);
  if (dayResult) {
    finalizeGame(snapshot, dayResult);
  } else {
    // Increment day count when advancing to next night
    snapshot.dayCount += 1;
    snapshot.day.votes = [];
    snapshot.day.tally = {};
    snapshot.players.forEach((p) => {
      p.hasVotedToday = false;
      p.isMutedToday = false;  // Reset mute status when entering new night
    });

    // Update bot guesses for the new day
    updateBotGuesses(snapshot.roomCode, snapshot.dayCount, snapshot.players);

    // Check for Last Words eligibility for the executed player
    let hasLastWords = false;
    if (executedSeat) {
      const executedPlayer = snapshot.players.find(p => p.seat === executedSeat);
      if (executedPlayer && !executedPlayer.flags?.isBadSpecial && !executedPlayer.isMutedToday) {
        hasLastWords = true;
        snapshot.phase = "day_last_words";
        snapshot.day.lastWords = {
          queue: [executedSeat],
          nextPhase: "night_actions"
        };
        snapshot.day.currentSpeakerIndex = 0; // Reuse for queue index
        snapshot.logs.push({ at: Date.now(), text: `座位 ${executedSeat} 发表遗言` });
      }
    }

    if (!hasLastWords) {
      snapshot.phase = "night_actions";
      snapshot.night.submittedActions = [];
      snapshot.night.lastActions = [];
    }
  }
  snapshot.updatedAt = Date.now();
  return { ok: true };
}

function finalizeGame(snapshot: FlowerSnapshot, result: FlowerGameResult) {
  snapshot.phase = "game_over";
  snapshot.gameResult = result;
  snapshot.logs.push({ at: Date.now(), text: `🎉 游戏结束：${result.reason}` });
}

function evaluateGameResult(snapshot: FlowerSnapshot): FlowerGameResult | null {
  const alive = snapshot.players.filter(p => p.isAlive);
  if (alive.length === 0) {
    return { winner: "draw", reason: "所有玩家全部出局，平局" };
  }
  if (alive.every(p => p.role === "恶民")) {
    return { winner: "draw", reason: "仅剩恶民，平局" };
  }
  if (alive.every(p => p.role === "善民" || p.role === "恶民")) {
    return { winner: "draw", reason: "仅剩善民与恶民，平局" };
  }

  const goodAlive = alive.some(p => GOOD_ROLES.has((p.role ?? "") as FlowerRole));
  if (!goodAlive) {
    return { winner: "bad", reason: "好人阵营全部阵亡，坏人胜" };
  }

  const badSpecialAlive = alive.some(p => p.flags?.isBadSpecial);
  if (!badSpecialAlive) {
    return { winner: "good", reason: "杀手、魔法师与森林老人全部阵亡，好人胜" };
  }

  return null;
}

function shuffleArray(arr: number[]): number[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type NightContext = {
  players: FlowerPlayerState[];
  playersBySeat: Map<number, FlowerPlayerState>;
  roleSeats: Map<FlowerRole, FlowerPlayerState>;
  actionsByRole: Map<FlowerRole, FlowerNightAction>;
  aliveSeats: Set<number>;
};

function buildNightContext(snapshot: FlowerSnapshot): NightContext | null {
  const players = snapshot.players;
  const playersBySeat = new Map<number, FlowerPlayerState>();
  const roleSeats = new Map<FlowerRole, FlowerPlayerState>();
  const aliveSeats = new Set<number>();
  players.forEach((p) => {
    playersBySeat.set(p.seat, p);
    if (p.isAlive) {
      aliveSeats.add(p.seat);
      if (p.role) roleSeats.set(p.role, p);
    }
  });
  const actionsByRole = new Map<FlowerRole, FlowerNightAction>();
  snapshot.night.submittedActions.forEach((action) => {
    actionsByRole.set(action.role, action);
  });
  return { players, playersBySeat, roleSeats, actionsByRole, aliveSeats };
}

type NightOutcome = {
  deaths: Array<{ seat: number; reason: "sniper" | "killer" | "needles" }>;
  mutedSeats: number[];
  butterflyLink: { butterflySeat: number; targetSeat?: number | null; active: boolean } | null;
  policeReports: Array<{ targetSeat: number; result: "bad_special" | "not_bad_special" | "unknown" }>;
  upgrades: Array<{ seat: number; fromRole: FlowerRole; toRole: "杀手" }>;
  darkVotes: Map<number, number>;
  logs: string[];
};

function computeNightOutcome(ctx: NightContext): NightOutcome {
  const logs: string[] = [];
  const deaths: Array<{ seat: number; reason: "sniper" | "killer" | "needles" }> = [];
  const mutedSeats: number[] = [];
  const policeReports: Array<{ targetSeat: number; result: "bad_special" | "not_bad_special" | "unknown" }> = [];
  const upgrades: Array<{ seat: number; fromRole: FlowerRole; toRole: "杀手" }> = [];
  const darkVotes = new Map<number, number>();

  const alive = (seat: number | null | undefined) => !!seat && ctx.aliveSeats.has(seat);

  // 1. Handle pending needle deaths from previous nights
  ctx.players.forEach((player) => {
    if (player.pendingNeedleDeath && player.isAlive) {
      deaths.push({ seat: player.seat, reason: "needles" });
      ctx.aliveSeats.delete(player.seat);
      player.pendingNeedleDeath = false;
      logs.push(`座位 ${player.seat} 因累计两次空针，毒发身亡`);
    }
  });

  const getActiveRolePlayer = (role: FlowerRole) => {
    const player = ctx.roleSeats.get(role);
    if (!player || !alive(player.seat)) return null;
    return player;
  };

  // 2. Determine Flower Butterfly status
  const butterflyPlayer = getActiveRolePlayer("花蝴蝶");
  const butterflyAction = butterflyPlayer ? ctx.actionsByRole.get("花蝴蝶") : undefined;
  let butterflyTarget = butterflyAction?.targetSeat && butterflyAction.targetSeat !== butterflyPlayer?.seat ? butterflyAction.targetSeat : null;
  if (butterflyTarget && !alive(butterflyTarget)) butterflyTarget = null;
  let butterflyActive = !!butterflyTarget;

  // 3. Determine Magician status and interactions
  const magePlayer = getActiveRolePlayer("魔法师");
  const mageAction = magePlayer ? ctx.actionsByRole.get("魔法师") : undefined;
  const invalidActors = new Set<number>();

  // Magician vs Flower Butterfly priority
  if (butterflyActive && mageAction && mageAction.targetSeat === butterflyPlayer?.seat && butterflyTarget === magePlayer?.seat) {
    // If they target each other, Magician wins (FB is sealed)
    butterflyActive = false;
    logs.push("魔法师与花蝴蝶相互指向，花蝴蝶被封印，抱人失败");
  }

  if (mageAction && mageAction.targetSeat && alive(mageAction.targetSeat) && magePlayer && alive(magePlayer.seat)) {
    if (butterflyActive && mageAction.targetSeat === butterflyTarget) {
      // Magician targets someone hugged by FB -> Blocked
      logs.push(`魔法师试图封印座位 ${mageAction.targetSeat}，但被花蝴蝶挡下`);
    } else {
      // Magician targets someone else (or FB directly)
      invalidActors.add(mageAction.targetSeat);
      if (mageAction.targetSeat === butterflyPlayer?.seat) {
        butterflyActive = false;
        logs.push("魔法师封印了花蝴蝶，导致其抱人失效");
      } else {
        logs.push(`魔法师封印了座位 ${mageAction.targetSeat}，使其技能失效`);
      }
    }
  }

  // 4. Register effects (Killer, Sniper, Doctor, Elder, etc.)
  const killAttempts = new Map<number, Array<"killer" | "sniper">>();
  const docTargets = new Set<number>();
  const emptyNeedleTargets = new Set<number>();

  // Helper to handle effect registration with FB transfer logic
  function registerEffect(targetSeat: number | null | undefined, sourceRole: string, effect: (seat: number) => void) {
    if (!targetSeat || !alive(targetSeat)) return;

    // If target is hugged by FB -> Transfer to FB (unless it's a check/seal which might be blocked? Rules say "FB suffers effects")
    // For Magician/Elder/Killer/Sniper/Doctor, the effect is transferred.
    // BUT Magician was already handled above for "Block" vs "Seal".
    // Here we handle "Damage" and "Status".

    if (butterflyActive && targetSeat === butterflyTarget) {
      // Target is hugged. Effect transfers to FB?
      // Rule: "被抱者免疫所有指向技能；花蝴蝶遭受的效果复制给被抱者" -> Wait.
      // "花蝴蝶：抱起 1 人，被抱者免疫所有指向技能；花蝴蝶遭受的效果复制给被抱者"
      // This means:
      // 1. Skill -> Hugged Person: Immune. (FB blocks it? Or just immune?)
      //    Usually "Immune" means it hits FB instead? "花蝴蝶抱人挡刀" implies FB takes the hit.
      //    Let's assume: Skill -> Hugged Person => Redirect to FB.

      if (butterflyPlayer) {
        logs.push(`${sourceRole} 的技能指向座位 ${targetSeat}，但被花蝴蝶挡下（转移至花蝴蝶）`);
        effect(butterflyPlayer.seat);
      }
      return;
    }

    // Normal case
    effect(targetSeat);

    // If target IS FB, and FB is hugging someone -> Effect copies to Hugged Person?
    // Rule: "花蝴蝶遭受的效果复制给被抱者"
    // So if Killer -> FB, then FB dies AND Hugged Person dies?
    // Or does it mean "Transfer"? "花蝴蝶遭受的效果复制给被抱者" means COPY.
    // But usually in "Flower Butterfly" (Guard), if Guard protects A, and Killer -> A, Guard dies?
    // "花蝴蝶 9 人局规则": "花蝴蝶：抱起 1 人，被抱者免疫所有指向技能；花蝴蝶遭受的效果复制给被抱者"
    // This implies:
    // 1. Target = Hugged Person -> Immune (Effect Nullified on Target). Does it go to FB? "花蝴蝶抱人挡刀" implies yes.
    // 2. Target = FB -> FB takes effect. AND Hugged Person takes effect (Copy).

    if (butterflyActive && targetSeat === butterflyPlayer?.seat && butterflyTarget) {
      logs.push(`${sourceRole} 的技能指向花蝴蝶，效果同时也作用于被抱者（座位 ${butterflyTarget}）`);
      effect(butterflyTarget);
    }
  }

  // Killer
  const killerPlayer = getActiveRolePlayer("杀手");
  const killerAction = killerPlayer && !invalidActors.has(killerPlayer.seat) ? ctx.actionsByRole.get("杀手") : undefined;
  if (killerAction && killerAction.targetSeat) {
    registerEffect(killerAction.targetSeat, "杀手", (seat) => {
      const arr = killAttempts.get(seat) ?? [];
      arr.push("killer");
      killAttempts.set(seat, arr);
    });
  }

  // Sniper
  const sniperPlayer = getActiveRolePlayer("狙击手");
  const sniperAction = sniperPlayer && !invalidActors.has(sniperPlayer.seat) ? ctx.actionsByRole.get("狙击手") : undefined;
  if (sniperAction && sniperAction.targetSeat) {
    registerEffect(sniperAction.targetSeat, "狙击手", (seat) => {
      const arr = killAttempts.get(seat) ?? [];
      arr.push("sniper");
      killAttempts.set(seat, arr);
    });
  }

  // Doctor
  const doctorPlayer = getActiveRolePlayer("医生");
  const doctorAction = doctorPlayer && !invalidActors.has(doctorPlayer.seat) ? ctx.actionsByRole.get("医生") : undefined;
  let doctorTargets: number[] = [];
  if (doctorAction && doctorAction.targetSeat) {
    // Doctor logic is slightly different for narrative, but registerEffect handles the redirection
    registerEffect(doctorAction.targetSeat, "医生", (seat) => {
      doctorTargets.push(seat);
      docTargets.add(seat);
    });
  }

  // Elder
  const elderPlayer = getActiveRolePlayer("森林老人");
  const elderAction = elderPlayer && !invalidActors.has(elderPlayer.seat) ? ctx.actionsByRole.get("森林老人") : undefined;
  if (elderAction && elderAction.targetSeat) {
    registerEffect(elderAction.targetSeat, "森林老人", (seat) => {
      if (!mutedSeats.includes(seat)) mutedSeats.push(seat);
    });
  }

  // Police
  const policePlayer = getActiveRolePlayer("警察");
  const policeAction = policePlayer && !invalidActors.has(policePlayer.seat) ? ctx.actionsByRole.get("警察") : undefined;
  if (policeAction && policeAction.targetSeat) {
    if (butterflyActive && policeAction.targetSeat === butterflyTarget) {
      policeReports.push({ targetSeat: policeAction.targetSeat, result: "unknown" });
      logs.push(`警察试图查验座位 ${policeAction.targetSeat}，但视线被花蝴蝶遮挡（免疫）`);
      logs.push(`警察无法验出座位 ${policeAction.targetSeat}`);
    } else if (!alive(policeAction.targetSeat)) {
      policeReports.push({ targetSeat: policeAction.targetSeat, result: "unknown" });
      logs.push(`警察无法验出座位 ${policeAction.targetSeat}`);
    } else {
      const targetPlayer = ctx.playersBySeat.get(policeAction.targetSeat);
      if (!targetPlayer || !targetPlayer.role) {
        policeReports.push({ targetSeat: policeAction.targetSeat, result: "unknown" });
        logs.push(`警察无法验出座位 ${policeAction.targetSeat}`);
      } else if (BAD_SPECIAL_ROLES.has(targetPlayer.role)) {
        policeReports.push({ targetSeat: policeAction.targetSeat, result: "bad_special" });
        logs.push(`警察验出座位 ${policeAction.targetSeat} 为坏特殊`);
      } else {
        policeReports.push({ targetSeat: policeAction.targetSeat, result: "not_bad_special" });
        logs.push(`警察验出座位 ${policeAction.targetSeat} 非坏特殊`);
      }
    }
  }

  // Good/Evil Citizen (Dark Votes) - usually not blocked by FB? 
  // "若被施法则当晚无法投暗票" - handled by invalidActors check.
  // "善恶民死亡当夜暗票仍有效" - handled by getActiveRolePlayer check (we need to allow dead if they died TONIGHT? No, "死亡当夜" means if they die tonight their vote counts. 
  // But getActiveRolePlayer checks `alive(player.seat)`. 
  // We need to allow them to vote even if they are about to die. 
  // Actually `alive` checks `ctx.aliveSeats` which is current state. So they are alive now.

  const goodCitizenPlayer = getActiveRolePlayer("善民");
  const goodCitizenAction = goodCitizenPlayer && !invalidActors.has(goodCitizenPlayer.seat) ? ctx.actionsByRole.get("善民") : undefined;
  if (goodCitizenAction && goodCitizenAction.targetSeat) {
    darkVotes.set(goodCitizenAction.targetSeat, (darkVotes.get(goodCitizenAction.targetSeat) ?? 0) + 1);
  } else if (goodCitizenPlayer && invalidActors.has(goodCitizenPlayer.seat)) {
    logs.push("善民被封印，无法投出暗票");
  }

  const evilCitizenPlayer = getActiveRolePlayer("恶民");
  const evilCitizenAction = evilCitizenPlayer && !invalidActors.has(evilCitizenPlayer.seat) ? ctx.actionsByRole.get("恶民") : undefined;
  if (evilCitizenAction && evilCitizenAction.targetSeat) {
    darkVotes.set(evilCitizenAction.targetSeat, (darkVotes.get(evilCitizenAction.targetSeat) ?? 0) + 1);
  } else if (evilCitizenPlayer && invalidActors.has(evilCitizenPlayer.seat)) {
    logs.push("恶民被封印，无法投出暗票");
  }

  // 5. Resolve Doctor vs Kills (and generate consolidated logs)
  // We iterate over all players who were targeted by Doctor OR Killer/Sniper
  const allInvolvedSeats = new Set([...killAttempts.keys(), ...docTargets]);

  allInvolvedSeats.forEach(seat => {
    const attempts = killAttempts.get(seat) || [];
    const isHealed = docTargets.has(seat);

    if (attempts.length > 0) {
      // Was attacked
      const attackers = attempts.map(a => a === "killer" ? "杀手" : "狙击手").join("与");

      if (isHealed) {
        if (attempts.length >= 2) {
          logs.push(`医生试图救治座位 ${seat}，但因伤势过重（遭${attackers}同时攻击），救治失败`);
          // Still dies
        } else {
          killAttempts.delete(seat); // Saved!
          logs.push(`${attackers}试图击杀座位 ${seat}，但被医生成功救治`);
        }
      } else {
        // No doctor
        logs.push(`${attackers}击杀了座位 ${seat}`);
      }
    } else {
      // Not attacked, but healed? -> Empty needle
      if (isHealed) {
        emptyNeedleTargets.add(seat);
        logs.push(`医生对座位 ${seat} 施针，因无伤势造成空针`);
      }
    }
  });

  // 6. Finalize Deaths
  killAttempts.forEach((reasons, seat) => {
    if (!reasons || reasons.length === 0) return;
    const reason = reasons.includes("sniper") ? "sniper" : "killer";
    deaths.push({ seat, reason });
  });

  emptyNeedleTargets.forEach((seat) => {
    const player = ctx.playersBySeat.get(seat);
    if (!player) return;
    player.needleCount = (player.needleCount || 0) + 1;
    if (player.needleCount >= 2) {
      player.needleCount = 0;
      player.pendingNeedleDeath = false;
      deaths.push({ seat, reason: "needles" });
      // Log for this is generated next night or handled here?
      // "累积 2 针次日死亡" -> Usually means they die at the END of this night? 
      // Or next night? "次日死亡" usually means "Die immediately at daybreak".
      // So we add to deaths list.
      logs.push(`座位 ${seat} 累积两次空针，不幸身亡`);
    }
  });

  const butterflyLink = butterflyPlayer
    ? { butterflySeat: butterflyPlayer.seat, targetSeat: butterflyTarget, active: butterflyActive }
    : null;

  // Muted logs
  mutedSeats.forEach((seat) => {
    // Already logged in registerEffect? 
    // "森林老人禁言了座位 X"
    // But we might want to deduplicate if multiple effects?
    // Elder only acts once.
    // But if transferred?
    // registerEffect logs "X -> Y (Transferred)".
    // We should add a simple log if it wasn't covered.
    // Actually, let's rely on registerEffect for the transfer log, and here for the result log?
    // Or just one log?
    // The registerEffect logs the ACTION.
    // Let's add a result log if it's not redundant.
    // "森林老人让 [A] 陷入了沉默"
    // If we already logged "Elder -> A", maybe that's enough?
    // Let's check registerEffect for Elder again.
    // It logs nothing currently in my new code (except transfer).
    // So I should add a log here.
    if (!logs.some(l => l.includes(`森林老人`) && l.includes(`座位 ${seat}`))) {
      logs.push(`森林老人禁言了座位 ${seat}`);
    }
  });

  return { deaths, mutedSeats, butterflyLink, policeReports, upgrades: [], darkVotes, logs };
}

function applyNightOutcome(snapshot: FlowerSnapshot, outcome: NightOutcome) {
  const now = Date.now();
  const deathSeats = new Set(outcome.deaths.map((d) => d.seat));

  snapshot.players.forEach((player) => {
    if (deathSeats.has(player.seat)) {
      player.isAlive = false;
      player.pendingNeedleDeath = false;
    } else if (outcome.deaths.some((d) => d.reason === "needles" && d.seat === player.seat)) {
      player.isAlive = false;
      player.pendingNeedleDeath = false;
    }
    if (outcome.mutedSeats.includes(player.seat)) {
      player.isMutedToday = true;
    } else {
      player.isMutedToday = false;
    }
    player.hasVotedToday = false;
    player.voteTargetSeat = null;
    player.darkVoteTargetSeat = null;
    player.nightAction = null;
  });

  snapshot.night.lastActions = snapshot.night.submittedActions.map(action => ({ ...action }));
  snapshot.night.result = {
    deaths: outcome.deaths,
    mutedSeats: outcome.mutedSeats,
    butterflyLink: outcome.butterflyLink ? { butterflySeat: outcome.butterflyLink.butterflySeat, targetSeat: outcome.butterflyLink.targetSeat } : undefined,
    policeReports: outcome.policeReports,
    upgrades: outcome.upgrades,
    logs: outcome.logs,
  };

  // Record history for this night
  snapshot.history.push({
    dayCount: snapshot.dayCount,
    night: {
      actions: snapshot.night.lastActions || [],
      result: snapshot.night.result!
    }
  });

  snapshot.night.submittedActions = [];
  snapshot.day.tally = Object.fromEntries(outcome.darkVotes.entries());
  snapshot.day.votes = [];
  snapshot.day.pendingExecution = null;
  const nightResult = evaluateGameResult(snapshot);
  if (nightResult) {
    finalizeGame(snapshot, nightResult);
  } else {
    const aliveSeats = snapshot.players
      .filter(p => p.isAlive)
      .map(p => p.seat)
      .sort((a, b) => a - b);

    let firstSpeakerSeat: number;

    if (outcome.deaths.length === 1) {
      const deadSeat = outcome.deaths[0].seat;
      const sortedSeats = snapshot.players.map(p => p.seat).sort((a, b) => a - b);
      const deadIndex = sortedSeats.indexOf(deadSeat);
      let nextIndex = (deadIndex + 1) % sortedSeats.length;
      while (!aliveSeats.includes(sortedSeats[nextIndex])) {
        nextIndex = (nextIndex + 1) % sortedSeats.length;
      }
      firstSpeakerSeat = sortedSeats[nextIndex];
    } else {
      firstSpeakerSeat = aliveSeats[Math.floor(Math.random() * aliveSeats.length)];
    }

    const speechOrder: number[] = [];
    const startIndex = aliveSeats.indexOf(firstSpeakerSeat);
    for (let i = 0; i < aliveSeats.length; i++) {
      speechOrder.push(aliveSeats[(startIndex + i) % aliveSeats.length]);
    }

    snapshot.day.speechOrder = speechOrder.filter(seat => !outcome.mutedSeats.includes(seat));
    snapshot.day.currentSpeakerIndex = 0;

    // Check for Night Death Last Words
    const deadSeats = outcome.deaths.map(d => d.seat);
    const lastWordsQueue = deadSeats.filter(seat => !outcome.mutedSeats.includes(seat));

    if (lastWordsQueue.length > 0) {
      snapshot.phase = "day_last_words";
      snapshot.day.lastWords = {
        queue: lastWordsQueue,
        nextPhase: "day_discussion"
      };
      // We use currentSpeakerIndex to track position in the queue (which is just an array of seats)
      // But wait, speechOrder is for discussion. lastWords.queue is for last words.
      // We can reuse currentSpeakerIndex to index into lastWords.queue? Yes.
      snapshot.day.currentSpeakerIndex = 0;
      snapshot.logs.push({ at: now, text: "💀 昨晚死亡玩家发表遗言" });
    } else {
      snapshot.phase = "day_discussion";
    }
  }
  outcome.logs.forEach((text) => snapshot.logs.push({ at: now, text }));
  handleRoleUpgrades(snapshot, outcome);
  snapshot.updatedAt = now;
}

function handleRoleUpgrades(snapshot: FlowerSnapshot, outcome: NightOutcome) {
  const promoted = promoteBadSpecial(snapshot);
  if (promoted) {
    outcome.upgrades.push({ seat: promoted.seat, fromRole: promoted.fromRole, toRole: "杀手" });
  }
}

function promoteBadSpecial(snapshot: FlowerSnapshot): { seat: number; fromRole: FlowerRole } | null {
  const findAliveRole = (role: FlowerRole) => snapshot.players.find((p) => p.role === role && p.isAlive);
  const killer = findAliveRole("杀手");
  if (killer) return null;
  const mage = findAliveRole("魔法师");
  if (mage) {
    mage.role = "杀手";
    mage.flags = { isBadSpecial: true };
    snapshot.logs.push({ at: Date.now(), text: `魔法师（座位 ${mage.seat}）继承为新的杀手` });
    return { seat: mage.seat, fromRole: "魔法师" };
  }
  const elder = findAliveRole("森林老人");
  if (elder) {
    elder.role = "杀手";
    elder.flags = { isBadSpecial: true };
    snapshot.logs.push({ at: Date.now(), text: `森林老人（座位 ${elder.seat}）继承为新的杀手` });
    return { seat: elder.seat, fromRole: "森林老人" };
  }
  return null;
}

export function passTurn(snapshot: FlowerSnapshot): { ok: boolean; error?: string } {
  if (!snapshot) return { ok: false, error: "没有可用的快照" };

  if (snapshot.phase === "day_last_words") {
    const lastWords = snapshot.day.lastWords;
    if (!lastWords || !lastWords.queue || lastWords.queue.length === 0) {
      // Should not happen, but recover
      snapshot.phase = lastWords?.nextPhase || "day_discussion";
      return { ok: true };
    }

    const nextIndex = snapshot.day.currentSpeakerIndex + 1;
    if (nextIndex >= lastWords.queue.length) {
      // All last words spoken
      snapshot.phase = lastWords.nextPhase;
      snapshot.day.currentSpeakerIndex = 0;
      snapshot.day.lastWords = null; // Clear it

      if (snapshot.phase === "night_actions") {
        // If we transitioned to night, we need to reset night stuff if not already done?
        // Actually resolveDayVote already did reset if it went straight to night.
        // But if we went to last words, we didn't reset night actions yet?
        // Let's check resolveDayVote.
        // In resolveDayVote, we set snapshot.night.submittedActions = [] ONLY if !hasLastWords.
        // So we need to do it here if we are transitioning to night.
        snapshot.night.submittedActions = [];
        snapshot.night.lastActions = [];
        // Reset player states when entering new night
        snapshot.players.forEach((p) => {
          p.hasVotedToday = false;
          p.isMutedToday = false;
        });
        snapshot.logs.push({ at: Date.now(), text: "🌙 进入夜晚" });
      } else {
        snapshot.logs.push({ at: Date.now(), text: "☀️ 遗言结束，进入白天讨论" });
      }
    } else {
      snapshot.day.currentSpeakerIndex = nextIndex;
    }
    snapshot.updatedAt = Date.now();
    return { ok: true };
  }

  if (snapshot.phase !== "day_discussion") return { ok: false, error: "当前阶段无法过麦" };
  const day = snapshot.day;
  if (!day.speechOrder || day.speechOrder.length === 0) return { ok: false, error: "没有发言顺序" };

  const nextIndex = day.currentSpeakerIndex + 1;
  if (nextIndex >= day.speechOrder.length) {
    // All players have spoken, move to vote phase
    snapshot.phase = "day_vote";
    snapshot.day.currentSpeakerIndex = 0; // Reset for next day? Or irrelevant.
    snapshot.logs.push({ at: Date.now(), text: "☀️ 发言结束，进入投票阶段" });
  } else {
    day.currentSpeakerIndex = nextIndex;
  }
  snapshot.updatedAt = Date.now();
  return { ok: true };
}

export function resetFlowerGame(snapshot: FlowerSnapshot): { ok: boolean; error?: string } {
  if (!snapshot) return { ok: false, error: "没有可用的快照" };

  const now = Date.now();
  snapshot.phase = "lobby";
  snapshot.dayCount = 0;
  snapshot.night = emptyNightState();
  snapshot.day = emptyDayState();
  snapshot.history = [];
  snapshot.pendingAction = null;
  snapshot.gameResult = null;

  // 清空游戏日志，重新开始时不保留上一局的游戏记录
  snapshot.logs = [{ at: now, text: "🔄 游戏已重置，等待开始" }];

  // chatMessages 不在这里清空，保留聊天记录

  // Reset player states but keep seats/names/sessions
  snapshot.players.forEach(p => {
    p.role = null;
    p.isAlive = !!p.sessionId;
    p.isReady = false;
    p.isMutedToday = false;
    p.hasVotedToday = false;
    p.voteTargetSeat = null;
    p.darkVoteTargetSeat = null;
    p.nightAction = null;
    p.needleCount = 0;
    p.pendingNeedleDeath = false;
    p.flags = {};
  });

  snapshot.updatedAt = now;
  return { ok: true };
}
