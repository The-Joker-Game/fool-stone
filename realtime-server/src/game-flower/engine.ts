import type {
  FlowerSnapshot,
  FlowerPlayerState,
  FlowerNightAction,
  FlowerRole,
  FlowerGameResult,
  FlowerNightState,
  FlowerDayState,
} from "./types.js";

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
  snapshot.logs.push({ at: now, text: "🌙 花蝴蝶对局开始，身份已分发" });
  snapshot.updatedAt = now;
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
  if (snapshot.phase !== "day_vote" && snapshot.phase !== "day_discussion") return { ok: false, error: "当前阶段无法投票" };
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

  promoteBadSpecial(snapshot);

  snapshot.day.pendingExecution = executedSeat
    ? { seat: executedSeat, isBadSpecial: !!snapshot.players.find((p) => p.seat === executedSeat)?.flags?.isBadSpecial }
    : null;
  const dayResult = evaluateGameResult(snapshot);
  if (dayResult) {
    finalizeGame(snapshot, dayResult);
  } else {
    snapshot.day.votes = [];
    snapshot.day.tally = {};
    snapshot.players.forEach((p) => {
      p.hasVotedToday = false;
    });
    snapshot.phase = "night_actions";
    snapshot.night.submittedActions = [];
    snapshot.night.lastActions = [];
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

  ctx.players.forEach((player) => {
    if (player.pendingNeedleDeath && player.isAlive) {
      deaths.push({ seat: player.seat, reason: "needles" });
      ctx.aliveSeats.delete(player.seat);
      player.pendingNeedleDeath = false;
    }
  });

  const getActiveRolePlayer = (role: FlowerRole) => {
    const player = ctx.roleSeats.get(role);
    if (!player || !alive(player.seat)) return null;
    return player;
  };

  const butterflyPlayer = getActiveRolePlayer("花蝴蝶");
  const butterflyAction = butterflyPlayer ? ctx.actionsByRole.get("花蝴蝶") : undefined;
  let butterflyTarget = butterflyAction?.targetSeat && butterflyAction.targetSeat !== butterflyPlayer?.seat ? butterflyAction.targetSeat : null;
  if (butterflyTarget && !alive(butterflyTarget)) butterflyTarget = null;
  let butterflyActive = !!butterflyTarget;

  const magePlayer = getActiveRolePlayer("魔法师");
  const mageAction = magePlayer ? ctx.actionsByRole.get("魔法师") : undefined;
  const invalidActors = new Set<number>();

  if (butterflyActive && mageAction && mageAction.targetSeat === butterflyPlayer?.seat && butterflyTarget === magePlayer?.seat) {
    butterflyActive = false;
    logs.push("魔法师与花蝴蝶相互指向，花蝴蝶本回合抱人失败");
  }

  if (mageAction && mageAction.targetSeat && alive(mageAction.targetSeat) && magePlayer && alive(magePlayer.seat)) {
    if (butterflyActive && mageAction.targetSeat === butterflyTarget) {
      logs.push("魔法师的施法被花蝴蝶抱走所抵消");
    } else {
      invalidActors.add(mageAction.targetSeat);
      logs.push(`魔法师使座位 ${mageAction.targetSeat} 的技能失效`);
    }
    if (butterflyActive && mageAction.targetSeat === butterflyPlayer?.seat) {
      butterflyActive = false;
      logs.push("魔法师对花蝴蝶施法，花蝴蝶本回合抱人失效");
    }
  }

  const killAttempts = new Map<number, Array<"killer" | "sniper">>();
  const docTargets = new Set<number>();
  const emptyNeedleTargets = new Set<number>();

  function registerEffect(targetSeat: number | null | undefined, effect: (seat: number) => void) {
    if (!targetSeat || !alive(targetSeat)) return;
    if (butterflyActive && targetSeat === butterflyTarget) {
      return; // 抱走的目标免疫指向
    }
    effect(targetSeat);
    if (butterflyActive && targetSeat === butterflyPlayer?.seat && butterflyTarget) {
      effect(butterflyTarget);
    }
  }

  const killerPlayer = getActiveRolePlayer("杀手");
  const killerAction = killerPlayer && !invalidActors.has(killerPlayer.seat) ? ctx.actionsByRole.get("杀手") : undefined;
  if (killerAction && killerAction.targetSeat) {
    registerEffect(killerAction.targetSeat, (seat) => {
      const arr = killAttempts.get(seat) ?? [];
      arr.push("killer");
      killAttempts.set(seat, arr);
    });
  }

  const sniperPlayer = getActiveRolePlayer("狙击手");
  const sniperAction = sniperPlayer && !invalidActors.has(sniperPlayer.seat) ? ctx.actionsByRole.get("狙击手") : undefined;
  if (sniperAction && sniperAction.targetSeat) {
    registerEffect(sniperAction.targetSeat, (seat) => {
      const arr = killAttempts.get(seat) ?? [];
      arr.push("sniper");
      killAttempts.set(seat, arr);
    });
  }

  const doctorPlayer = getActiveRolePlayer("医生");
  const doctorAction = doctorPlayer && !invalidActors.has(doctorPlayer.seat) ? ctx.actionsByRole.get("医生") : undefined;
  let doctorTargets: number[] = [];
  if (doctorAction && doctorAction.targetSeat) {
    const targets: number[] = [];
    if (!(butterflyActive && doctorAction.targetSeat === butterflyTarget)) {
      if (alive(doctorAction.targetSeat)) targets.push(doctorAction.targetSeat);
      if (butterflyActive && doctorAction.targetSeat === butterflyPlayer?.seat && butterflyTarget && alive(butterflyTarget)) {
        targets.push(butterflyTarget);
      }
    }
    doctorTargets = targets;
    targets.forEach((seat) => docTargets.add(seat));
  }

  const policePlayer = getActiveRolePlayer("警察");
  const policeAction = policePlayer && !invalidActors.has(policePlayer.seat) ? ctx.actionsByRole.get("警察") : undefined;
  if (policeAction && policeAction.targetSeat) {
    if (butterflyActive && policeAction.targetSeat === butterflyTarget) {
      policeReports.push({ targetSeat: policeAction.targetSeat, result: "unknown" });
      logs.push("警察验人被花蝴蝶抱走目标阻断");
    } else if (!alive(policeAction.targetSeat)) {
      policeReports.push({ targetSeat: policeAction.targetSeat, result: "unknown" });
    } else {
      const targetPlayer = ctx.playersBySeat.get(policeAction.targetSeat);
      if (!targetPlayer || !targetPlayer.role) {
        policeReports.push({ targetSeat: policeAction.targetSeat, result: "unknown" });
      } else if (BAD_SPECIAL_ROLES.has(targetPlayer.role)) {
        policeReports.push({ targetSeat: policeAction.targetSeat, result: "bad_special" });
      } else {
        policeReports.push({ targetSeat: policeAction.targetSeat, result: "not_bad_special" });
      }
    }
  }

  const elderPlayer = getActiveRolePlayer("森林老人");
  const elderAction = elderPlayer && !invalidActors.has(elderPlayer.seat) ? ctx.actionsByRole.get("森林老人") : undefined;
  if (elderAction && elderAction.targetSeat) {
    registerEffect(elderAction.targetSeat, (seat) => {
      if (!mutedSeats.includes(seat)) mutedSeats.push(seat);
    });
  }

  const goodCitizenPlayer = getActiveRolePlayer("善民");
  const goodCitizenAction = goodCitizenPlayer && !invalidActors.has(goodCitizenPlayer.seat) ? ctx.actionsByRole.get("善民") : undefined;
  if (goodCitizenAction && goodCitizenAction.targetSeat) {
    registerEffect(goodCitizenAction.targetSeat, (seat) => {
      darkVotes.set(seat, (darkVotes.get(seat) ?? 0) + 1);
    });
  }

  const evilCitizenPlayer = getActiveRolePlayer("恶民");
  const evilCitizenAction = evilCitizenPlayer && !invalidActors.has(evilCitizenPlayer.seat) ? ctx.actionsByRole.get("恶民") : undefined;
  if (evilCitizenAction && evilCitizenAction.targetSeat) {
    registerEffect(evilCitizenAction.targetSeat, (seat) => {
      darkVotes.set(seat, (darkVotes.get(seat) ?? 0) + 1);
    });
  }

  doctorTargets.forEach((seat) => {
    const attempts = killAttempts.get(seat);
    if (!attempts || attempts.length === 0) {
      emptyNeedleTargets.add(seat);
    } else {
      const killTypes = new Set(attempts);
      if (killTypes.size >= 2) {
        logs.push(`医生试图救治座位 ${seat}，但同时遭遇多次击杀，无法救回`);
      } else {
        killAttempts.delete(seat);
        logs.push(`医生成功救下座位 ${seat}`);
      }
    }
  });

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
    } else {
      player.pendingNeedleDeath = false;
    }
  });

  const butterflyLink = butterflyPlayer
    ? { butterflySeat: butterflyPlayer.seat, targetSeat: butterflyTarget, active: butterflyActive }
    : null;

  deaths.forEach((d) => {
    if (d.reason === "needles") {
      logs.push(`座位 ${d.seat} 累计两次空针，悄然离场`);
    } else if (d.reason === "sniper") {
      logs.push(`狙击手击杀了座位 ${d.seat}`);
    } else {
      logs.push(`杀手击杀了座位 ${d.seat}`);
    }
  });

  mutedSeats.forEach((seat) => {
    logs.push(`森林老人禁言了座位 ${seat}`);
  });

  policeReports.forEach((report) => {
    if (report.result === "bad_special") logs.push(`警察验出座位 ${report.targetSeat} 为坏特殊`);
    else if (report.result === "not_bad_special") logs.push(`警察验出座位 ${report.targetSeat} 非坏特殊`);
    else logs.push(`警察无法验出座位 ${report.targetSeat}`);
  });

  return { deaths, mutedSeats, butterflyLink, policeReports, upgrades, darkVotes, logs };
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
  };
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
    snapshot.phase = "day_discussion";
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
  if (!snapshot || snapshot.phase !== "day_discussion") return { ok: false, error: "当前阶段无法过麦" };
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
