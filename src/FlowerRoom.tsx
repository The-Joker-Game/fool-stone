// src/FlowerRoom.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rt, getSessionId, type PresenceState } from "./realtime/socket";
import type { FlowerPlayerState, FlowerRole } from "./flower/types";
import { useFlowerStore } from "./flower/store";
import type { FlowerStore } from "./flower/store";
import type { SubmitNightActionPayload, SubmitDayVotePayload } from "./flower/engine";

/** ———————————————————————— 小工具 ———————————————————————— */
function randName() {
  const a = Math.random().toString(36).slice(2, 4);
  const b = Math.random().toString(36).slice(2, 4);
  return `玩家-${a}${b}`;
}
const isUserReady = (u: unknown): boolean => !!(u as any)?.ready;
const GOOD_ROLE_SET = new Set<FlowerRole>(["花蝴蝶", "狙击手", "医生", "警察", "善民"]);
const BAD_ROLE_SET = new Set<FlowerRole>(["杀手", "魔法师", "森林老人", "恶民"]);

function randomFrom<T>(list: T[]): T | null {
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function pickBotTarget(role: FlowerRole | null, actorSeat: number, aliveSeats: number[]): number | null {
  if (!role) return null;
  const others = aliveSeats.filter(seat => seat !== actorSeat);
  switch (role) {
    case "花蝴蝶":
    case "狙击手":
    case "杀手":
    case "魔法师":
    case "警察":
    case "森林老人":
    case "善民":
    case "恶民":
      return randomFrom(others) ?? null;
    case "医生":
      return randomFrom(aliveSeats) ?? null;
    default:
      return null;
  }
}

/** ———————————————————————— 页面组件 ———————————————————————— */
type NightSelectionMap = Record<string, number | "" | null>;

export default function FlowerRoom() {
  const [connected, setConnected] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [presence, setPresence] = useState<PresenceState | null>(null);
  const [name, setName] = useState<string>(randName());
  const autoJoinAttempted = useRef(false);
  const wasHostRef = useRef<boolean>(false);
  const [nightActionSelections, setNightActionSelections] = useState<NightSelectionMap>({});
  const [dayVoteSelection, setDayVoteSelection] = useState<number | "">("");

  const flowerSnapshot = useFlowerStore((state: FlowerStore) => state.snapshot);
  const ensureSnapshotFromPresence = useFlowerStore((state: FlowerStore) => state.ensureSnapshotFromPresence);
  const setFlowerSnapshot = useFlowerStore((state: FlowerStore) => state.setSnapshot);
  const hostSubmitNightAction = useFlowerStore((state: FlowerStore) => state.hostSubmitNightAction);
  const submitNightAction = useFlowerStore((state: FlowerStore) => state.submitNightAction);
  const hostSubmitDayVote = useFlowerStore((state: FlowerStore) => state.hostSubmitDayVote);
  const submitDayVote = useFlowerStore((state: FlowerStore) => state.submitDayVote);
  const hostAssignRoles = useFlowerStore((state: FlowerStore) => state.hostAssignRoles);
  const hostResolveNight = useFlowerStore((state: FlowerStore) => state.hostResolveNight);
  const hostResolveDayVote = useFlowerStore((state: FlowerStore) => state.hostResolveDayVote);
  const broadcastSnapshot = useFlowerStore((state: FlowerStore) => state.broadcastSnapshot);

  const logRef = useRef<HTMLDivElement | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const pushLog = useCallback((line: string) => setLogs(prev => [...prev, line]), []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs.length]);

  /** 初始化 socket */
  useEffect(() => {
    rt.getSocket();

    const offConn = rt.onConnection(ok => setConnected(ok));

    const offPresence = rt.subscribePresence(p => {
      setPresence(p);
      if (p?.roomCode) setRoomCode(p.roomCode);
      const me = p?.users.find(u => u.sessionId === getSessionId());
      setIsHost(!!me?.isHost);
      ensureSnapshotFromPresence(p ?? null);
    });

    const offState = rt.subscribeState(msg => {
      try {
        const snap: any = msg?.snapshot ?? {};
        if (snap?.engine === "flower") {
          setFlowerSnapshot(snap);
        }
        pushLog(`[state:full] from=${msg?.from || "-"} keys=${Object.keys(snap || {}).join(",")}`);
      } catch (e) {
        console.warn("read snapshot failed:", e);
      }
    });

    return () => {
      offConn?.();
      offPresence?.();
      offState?.();
    };
  }, [pushLog, ensureSnapshotFromPresence, setFlowerSnapshot]);

  useEffect(() => {
    if (!isHost) return;
    const off = rt.subscribeIntent(async (msg) => {
      if (msg.action === "flower:submit_night_action") {
        const payload = msg.payload as SubmitNightActionPayload;
        const res = hostSubmitNightAction(payload);
        if (res.ok) {
          await broadcastSnapshot();
        } else {
          console.warn("处理夜间技能失败", res.error);
        }
      }
      if (msg.action === "flower:submit_day_vote") {
        const payload = msg.payload as SubmitDayVotePayload;
        const res = hostSubmitDayVote(payload);
        if (res.ok) {
          await broadcastSnapshot();
        } else {
          console.warn("处理白天投票失败", res.error);
        }
      }
    });
    return () => off();
  }, [isHost, hostSubmitNightAction, hostSubmitDayVote, broadcastSnapshot]);


  useEffect(() => {
    if (roomCode || autoJoinAttempted.current || !connected) return;
    const savedCode = (localStorage.getItem("lastRoomCode") || "").trim();
    const savedName = (localStorage.getItem("name") || "").trim() || name;
    if (!savedCode) return;
    autoJoinAttempted.current = true;
    setName(savedName);
    (async () => {
      try {
        const resp = await rt.joinFlowerRoom(savedCode, savedName);
        pushLog(`auto room:join ack: ${JSON.stringify(resp)}`);
        if (resp?.ok) {
          setRoomCode(savedCode);
          setIsHost(!!resp.me?.isHost);
        }
      } catch (err) {
        console.warn("auto join failed", err);
      }
    })();
  }, [roomCode, connected, name, pushLog]);

  useEffect(() => {
    const off = rt.subscribeKicked(() => {
      setRoomCode(null);
      setPresence(null);
      setFlowerSnapshot(null);
      alert("你已被房主移出房间");
    });
    return () => off();
  }, [setFlowerSnapshot]);

  useEffect(() => {
    if (isHost && !wasHostRef.current && flowerSnapshot) {
      broadcastSnapshot();
    }
    wasHostRef.current = isHost;
  }, [isHost, flowerSnapshot, broadcastSnapshot]);

  /** 列表派生 */
  const users = presence?.users ?? [];
  const me = useMemo(() => users.find(u => u.sessionId === getSessionId()) ?? null, [users]);
  const flowerPlayers: FlowerPlayerState[] = flowerSnapshot?.players ?? [];
  const darkVoteMap = (flowerSnapshot?.day?.tally ?? {}) as Record<string, number>;
  const flowerPhase = flowerSnapshot?.phase ?? "lobby";
  const flowerDayCount = flowerSnapshot?.dayCount ?? 0;
  const gameResult = flowerSnapshot?.gameResult ?? null;
  const everyoneReady = useMemo(() => {
    if (flowerPhase !== "lobby") return true;
    const playerReadyCheck = (p: FlowerPlayerState) => (p.isBot ? true : !!p.isReady);
    if (flowerPlayers.length > 0) {
      return flowerPlayers
        .filter(p => p.sessionId)
        .every(playerReadyCheck);
    }
    return users.length > 0 && users.every(u => (u as any).isBot ? true : isUserReady(u));
  }, [flowerPhase, flowerPlayers, users]);
  const occupiedSeats = flowerSnapshot
    ? flowerPlayers.filter(p => p.sessionId).length
    : users.length;
  const remainingSeats = Math.max(0, 9 - occupiedSeats);
  const canAddBot = isHost && !!roomCode && flowerPhase === "lobby" && remainingSeats > 0;
  const myFlowerPlayer = useMemo(
    () => flowerPlayers.find(p => p.sessionId === getSessionId()) ?? null,
    [flowerPlayers]
  );
  const mySeat = myFlowerPlayer?.seat ?? null;
  const myRole = myFlowerPlayer?.role ?? null;
  const myAlive = !!myFlowerPlayer?.isAlive;
  const myMuted = !!myFlowerPlayer?.isMutedToday;

  // game over UI handled before return (see bottom)

  useEffect(() => {
    if (!isHost || flowerPhase !== "night_actions" || !flowerSnapshot) return;
    const aliveSeats = flowerPlayers.filter(p => p.isAlive).map(p => p.seat);
    let changed = false;
    for (const player of flowerPlayers) {
      if (!player.isBot || !player.isAlive || !player.role) continue;
      if (player.nightAction && player.nightAction.status === "locked") continue;
      const targetSeat = pickBotTarget(player.role, player.seat, aliveSeats);
      const res = hostSubmitNightAction({
        role: player.role,
        actorSeat: player.seat,
        targetSeat,
      });
      if (res.ok) changed = true;
    }
    if (changed) {
      broadcastSnapshot();
    }
  }, [isHost, flowerPhase, flowerSnapshot?.updatedAt, flowerPlayers, hostSubmitNightAction, broadcastSnapshot]);

  /** ———— 发送端 ———— */

  // 创建房间（用封装，避免字段名再错）
  const createRoom = useCallback(async () => {
    try {
      const nick = name?.trim() || randName();
      const resp = await rt.createFlowerRoom(nick);
      pushLog(`room:create ack: ${JSON.stringify(resp)}`);
      if (resp?.ok && resp.code) {
        setRoomCode(String(resp.code));
        setIsHost(true);
        localStorage.setItem("name", nick);
        localStorage.setItem("lastRoomCode", resp.code);
      } else {
        alert(resp?.msg || "创建失败");
      }
    } catch (e) {
      console.error(e);
      alert("创建失败：Ack 超时或异常");
    }
  }, [name, pushLog]);

  // 加入房间（**这里一定要发 code，不是 room**）
  const joinRoom = useCallback(async () => {
    const code = prompt("请输入四位房间号", roomCode || localStorage.getItem("lastRoomCode") || "");
    if (!code) return;
    try {
      const nick = name?.trim() || randName();
      const resp = await rt.joinFlowerRoom(code.trim(), nick);
      pushLog(`room:join ack: ${JSON.stringify(resp)}`);
      if (resp?.ok) {
        setRoomCode(code.trim());
        setIsHost(false);
        localStorage.setItem("name", nick);
        localStorage.setItem("lastRoomCode", code.trim());
      } else {
        alert(resp?.msg || "加入失败");
      }
    } catch (e) {
      console.error(e);
      alert("加入失败：Ack 超时或异常");
    }
  }, [name, roomCode, pushLog]);

  const leaveRoom = useCallback(async () => {
    if (!roomCode) return;
    if (!confirm("确定要离开当前房间吗？")) return;
    try {
      await rt.emitAck("room:leave", { code: roomCode, sessionId: getSessionId() }, 2000);
    } catch {
      // ignore
    }
    localStorage.removeItem("lastRoomCode");
    setRoomCode(null);
    setPresence(null);
    setFlowerSnapshot(null);
    autoJoinAttempted.current = false;
  }, [roomCode, setFlowerSnapshot]);

  // 切换准备（**这里一定要发 code，不是 room**）
  const toggleReady = useCallback(async () => {
    if (!roomCode) return;
    const target = !(me as any)?.ready;
    try {
      const resp = await rt.emitAck("room:ready", {
        code: roomCode,                    // ← 关键：用 code
        sessionId: getSessionId(),
        ready: target,
      }, 3000);
      pushLog(`room:ready ack: ${JSON.stringify(resp)}`);
      if (!(resp as any)?.ok) {
        alert(`设置准备失败：${(resp as any)?.msg || "服务器未响应"}`);
      }
    } catch (e) {
      console.error(e);
      alert("设置准备失败：服务器未响应（详见控制台/事件日志）");
    }
  }, [roomCode, me, pushLog]);

  const kickPlayer = useCallback(async (targetSessionId: string | null) => {
    if (!roomCode || !isHost || !targetSessionId) return;
    if (!confirm("确定要请这位玩家离开房间吗？")) return;
    try {
      const resp = await rt.kickPlayer(roomCode, targetSessionId);
      if (!(resp as any)?.ok) {
        alert(`踢人失败：${(resp as any)?.msg || "服务器未响应"}`);
      }
    } catch (err) {
      console.error(err);
      alert("踢人失败：服务器未响应");
    }
  }, [roomCode, isHost]);

  const addBotPlaceholder = useCallback(async () => {
    if (!canAddBot || !roomCode) return;
    const nick = prompt("机器人昵称（可留空自动命名）", "");
    try {
      const resp = await rt.addBotToRoom(roomCode, nick?.trim() || undefined);
      pushLog(`room:add_bot ack: ${JSON.stringify(resp)}`);
      if (!(resp as any)?.ok) {
        alert(`添加机器人失败：${(resp as any)?.msg || "服务器未响应"}`);
      }
    } catch (err) {
      console.error(err);
      alert("添加机器人失败：服务器未响应");
    }
  }, [canAddBot, roomCode, pushLog]);

  useEffect(() => {
    if (!myRole) return;
    setNightActionSelections(prev => ({
      ...prev,
      [myRole]: myFlowerPlayer?.nightAction?.targetSeat ?? "",
    }));
  }, [myRole, myFlowerPlayer?.nightAction?.targetSeat]);

  useEffect(() => {
    if (flowerPhase !== "day_vote") {
      setDayVoteSelection("");
      return;
    }
    if (!mySeat) return;
    const myVote = flowerSnapshot?.day?.votes?.find(v => v.voterSeat === mySeat);
    setDayVoteSelection(myVote?.targetSeat ?? "");
  }, [flowerPhase, mySeat, flowerSnapshot?.day?.votes]);

  const handleNightActionSubmit = useCallback(async () => {
    if (!flowerSnapshot || flowerPhase !== "night_actions") {
      alert("当前阶段无法提交技能");
      return;
    }
    if (!myRole || !mySeat) {
      alert("未找到你的座位或身份");
      return;
    }
    const rawValue = nightActionSelections[myRole] ?? "";
    const targetSeat = rawValue === "" ? null : Number(rawValue);
    const payload: SubmitNightActionPayload = {
      role: myRole,
      actorSeat: mySeat,
      targetSeat,
    };
    const res = await submitNightAction(payload);
    if (!res.ok) {
      alert(res.error || "提交失败");
    }
  }, [
    flowerSnapshot,
    flowerPhase,
    myRole,
    mySeat,
    nightActionSelections,
    submitNightAction,
  ]);

  const handleDayVoteSubmit = useCallback(async () => {
    if (flowerPhase !== "day_vote") {
      alert("当前阶段无法投票");
      return;
    }
    if (!mySeat) {
      alert("未找到你的座位");
      return;
    }
    const targetSeat = dayVoteSelection === "" ? null : Number(dayVoteSelection);
    if (!targetSeat) {
      alert("请先选择投票目标");
      return;
    }
    const payload: SubmitDayVotePayload = { voterSeat: mySeat, targetSeat };
    const res = await submitDayVote(payload);
    if (!res.ok) {
      alert(res.error || "投票失败");
    }
  }, [flowerPhase, mySeat, dayVoteSelection, submitDayVote]);

  const handleResolveDayVote = useCallback(async () => {
    if (!isHost) { alert("只有房主可以结算投票"); return; }
    const res = hostResolveDayVote();
    if (!res.ok) {
      alert(res.error || "结算失败");
      return;
    }
    await broadcastSnapshot();
  }, [isHost, hostResolveDayVote, broadcastSnapshot]);

  const handleResolveNight = useCallback(async () => {
    if (!isHost) { alert("只有房主可以结算夜晚"); return; }
    const res = hostResolveNight();
    if (!res.ok) {
      alert(res.error || "结算失败");
      return;
    }
    await broadcastSnapshot();
  }, [isHost, hostResolveNight, broadcastSnapshot]);

  // 开始第一夜（仍走容错事件名；是否被实现取决于你的后端）
  const startFirstNight = useCallback(async () => {
    if (!roomCode) return;
    if (!isHost) { alert("只有房主可以开始游戏"); return; }
    if (occupiedSeats < 9) {
      alert("需要 9 名玩家（可用机器人占位）才能开始游戏");
      return;
    }
    if (!everyoneReady) {
      alert("还有玩家未准备，无法开始游戏");
      return;
    }

    const payload = { room: roomCode, sessionId: getSessionId() };
    const events = ["room:start", "flower:start", "flower:start_night", "flower:begin"];
    let lastErr: unknown = null;
    for (const evt of events) {
      try {
        const resp = await rt.emitAck<any>(evt as any, payload, 3000);
        pushLog(`${evt} ack: ${JSON.stringify(resp)}`);
        if ((resp as any)?.ok !== false) {
          if (isHost) {
            const assignRes = hostAssignRoles();
            if (!assignRes.ok) {
              alert(assignRes.error || "分配角色失败，请检查人数是否满 9 人");
            } else {
              await broadcastSnapshot();
            }
          }
          return; // 有回就认为成功
        }
      } catch (e) { lastErr = e; }
    }
    console.error("startFirstNight last error:", lastErr);
    alert("开始失败：服务端未响应开始事件（详见控制台/事件日志）");
  }, [roomCode, isHost, pushLog, hostAssignRoles, broadcastSnapshot, occupiedSeats, everyoneReady]);

  /** ———— UI ———— */

  const connText = connected ? "已连接" : "未连接";

  if (flowerPhase === "game_over" && flowerSnapshot && gameResult) {
    return (
      <div className="min-h-screen p-6 max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">花蝴蝶九人局 · 终局结算</h1>
          <button className="px-3 py-1 border rounded" onClick={leaveRoom}>离开房间</button>
        </div>
        <div className="p-4 border rounded bg-gray-50">
          <div className="text-lg font-semibold">{gameResult.winner === "good" ? "好人胜利" : gameResult.winner === "bad" ? "坏人胜利" : "平局"}</div>
          <div className="text-sm text-gray-600">{gameResult.reason}</div>
        </div>
        <table className="w-full text-sm border rounded">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-2 py-1 text-left">座位</th>
              <th className="px-2 py-1 text-left">玩家</th>
              <th className="px-2 py-1 text-left">角色</th>
              <th className="px-2 py-1 text-left">阵营</th>
              <th className="px-2 py-1 text-left">状态</th>
            </tr>
          </thead>
          <tbody>
            {flowerPlayers.map((p) => {
              const role = (p.role ?? "") as FlowerRole;
              const camp = GOOD_ROLE_SET.has(role) ? "好人" : BAD_ROLE_SET.has(role) ? "坏人" : "未知";
              return (
                <tr key={`final-${p.seat}`} className="border-t">
                  <td className="px-2 py-1">{p.seat}</td>
                  <td className="px-2 py-1">{p.name || `玩家${p.seat}`}</td>
                  <td className="px-2 py-1">{p.role ?? "未知"}</td>
                  <td className="px-2 py-1">{camp}</td>
                  <td className="px-2 py-1">{p.isAlive ? "存活" : "死亡"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="p-3 border rounded">
          <div className="font-medium mb-1">系统日志</div>
          <div className="max-h-80 overflow-auto text-sm">
            <ol className="list-decimal list-inside space-y-1">
              {flowerSnapshot.logs.map((entry, idx) => (
                <li key={`gameover-log-${idx}`}>{new Date(entry.at).toLocaleTimeString()} - {entry.text}</li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-5 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-3">花蝴蝶九人局 · 调试中</h1>

      {/* 顶部：连接 + 建/加房 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="text-sm">
          连接状态：<span className={connected ? "text-green-600" : "text-red-600"}>{connText}</span>
        </div>
        <input
          className="border rounded px-2 py-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="昵称"
        />
        <button className="px-3 py-1 rounded border" onClick={createRoom}>创建花蝴蝶房间</button>
        <button className="px-3 py-1 rounded border" onClick={joinRoom}>加入房间</button>
        {roomCode && (
          <button
            className="px-3 py-1 rounded border text-red-600 border-red-400"
            onClick={leaveRoom}
          >
            离开房间
          </button>
        )}
      </div>

      {/* 房间信息 */}
      <div className="mb-3 text-sm">
        {roomCode ? <>房间 <b>{roomCode}</b>（{isHost ? "房主" : "玩家"}）</>
                 : <span className="text-gray-500">（当前无房间，创建/加入后出现）</span>}
      </div>

      {/* 在线/座位 */}
      <div className="mb-4">
        <div className="font-medium">玩家列表（{flowerSnapshot ? flowerPlayers.length : users.length} 人）</div>
        <div className="space-y-2 mt-2">
          {flowerSnapshot
            ? flowerPlayers.map((player: FlowerPlayerState) => {
                const tags: string[] = [];
                if (player.isHost) tags.push("房主");
                if (player.sessionId === getSessionId()) tags.push("我");
                if (player.isReady && flowerPhase === "lobby") tags.push("已准备");
                if (player.isBot) tags.push("BOT");

                const statusParts: string[] = [];
                statusParts.push(player.sessionId ? (player.isAlive ? "存活" : "死亡") : "空位");
                if (player.isMutedToday) statusParts.push("禁言");
                if (player.hasVotedToday && flowerPhase === "day_vote") statusParts.push("已投票");

                return (
                  <div key={`seat-${player.seat}`} className="border rounded px-3 py-2 flex items-center justify-between">
                    <div>
                      <div className="font-medium">
                        {player.sessionId ? (player.name || `座位${player.seat}`) : `座位${player.seat}（空）`}
                      </div>
                      <div className="text-xs text-gray-500">座位 {player.seat}</div>
                      {statusParts.length > 0 && <div className="text-xs text-gray-500 mt-1">{statusParts.join(" · ")}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      {tags.length > 0 && <div className="text-xs text-gray-500">{tags.join(" · ")}</div>}
                      {isHost && player.sessionId && player.sessionId !== getSessionId() && (
                        <button
                          className="text-xs text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50"
                          onClick={() => kickPlayer(player.sessionId)}
                        >
                          踢出
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            : users.map((u: any) => {
                const tags: string[] = [];
                if (u.isHost) tags.push("房主");
                if (u.sessionId === getSessionId()) tags.push("我");
                if (u.ready) tags.push("已准备");
                if (u.isBot) tags.push("BOT");
                return (
                  <div key={u.sessionId} className="border rounded px-3 py-2 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{u.name || "（未命名）"}</div>
                      <div className="text-xs text-gray-500">座位 {u.seat}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {tags.length > 0 && <div className="text-xs text-gray-500">{tags.join(" · ")}</div>}
                      {isHost && u.sessionId !== getSessionId() && (
                        <button
                          className="text-xs text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50"
                          onClick={() => kickPlayer(u.sessionId)}
                        >
                          踢出
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          {!flowerSnapshot && users.length === 0 && (
            <div className="text-sm text-gray-500">（当前无玩家，创建/加入房间后会出现）</div>
          )}
        </div>
      </div>

      {/* 游戏状态 + 操作 */}
      <div className="p-3 border rounded mb-4">
        <div className="font-medium mb-2">花蝴蝶游戏状态</div>
        {flowerSnapshot ? (
          <div className="text-sm mb-3">
            阶段：<b>{flowerPhase}</b>； 天数：<b>{flowerDayCount}</b>
          </div>
        ) : (
          <div className="text-sm text-red-600 mb-3">还没有收到 <b>flower:state</b>（请创建/加入房间后再试）</div>
        )}

        <div className="flex flex-wrap gap-2 items-center">
          <button
            className={`px-4 py-2 rounded border ${((me as any)?.ready ? "bg-green-600 text-white" : "")}`}
            onClick={toggleReady}
            disabled={!roomCode || flowerPhase !== "lobby"}
          >
            {(me as any)?.ready ? "取消准备" : "准备"}
          </button>

          <button
            className={`px-4 py-2 rounded ${
              isHost && roomCode && flowerPhase === "lobby"
                ? "bg-black text-white"
                : "border text-gray-400 bg-gray-100 cursor-not-allowed"
            }`}
            disabled={!isHost || !roomCode || flowerPhase !== "lobby"}
            title={!isHost ? "只有房主可以开始" : ""}
            onClick={startFirstNight}
          >
            开始游戏（第一夜）
          </button>

          <button
            className={`px-4 py-2 rounded border ${canAddBot ? "" : "text-gray-400 bg-gray-100 cursor-not-allowed"}`}
            disabled={!canAddBot}
            onClick={addBotPlaceholder}
          >
            添加机器人（剩余 {remainingSeats}）
          </button>

          {isHost && roomCode && flowerPhase === "lobby" && (
            <div className="text-xs text-gray-500 flex items-center">
              {everyoneReady ? "（所有玩家已准备）" : "（有人未准备）"}
            </div>
          )}
        </div>
      </div>

      {/* 我的身份 / 夜间操作 */}
      {flowerSnapshot && myRole && (
        <div className="p-3 border rounded mb-4 space-y-2">
          <div className="font-medium">我的身份</div>
          <div className="text-sm">角色：<b>{myRole}</b>（座位 {mySeat ?? "?"}）</div>
          {!myAlive ? (
            <div className="text-xs text-red-600">你已死亡，无法执行任何行动。</div>
          ) : flowerPhase === "night_actions" ? (
            <div className="space-y-2">
              <div className="text-sm">夜晚技能目标</div>
              <select
                className="border rounded px-3 py-2 text-sm w-full"
                value={nightActionSelections[myRole] ?? ""}
                onChange={(e) =>
                  setNightActionSelections(prev => ({
                    ...prev,
                    [myRole]: e.target.value === "" ? "" : Number(e.target.value),
                  }))
                }
              >
                <option value="">（无/跳过）</option>
                {flowerPlayers
                  .filter(p => p.isAlive)
                  .map(p => (
                    <option key={`target-${p.seat}`} value={p.seat}>
                      座位 {p.seat} - {p.name || `玩家${p.seat}`}
                    </option>
                  ))}
              </select>
              <button
                className="px-4 py-2 rounded bg-black text-white hover:bg-black/90 disabled:opacity-50"
                onClick={handleNightActionSubmit}
                disabled={!mySeat || !myRole || !myAlive}
              >
                提交夜晚技能
              </button>
              <div className="text-xs text-gray-500">
                当前已提交：{myFlowerPlayer?.nightAction?.targetSeat ? `座位 ${myFlowerPlayer.nightAction.targetSeat}` : "尚未提交"}
              </div>
              {isHost && (
                <button
                  className="px-4 py-2 rounded border border-black text-black hover:bg-black/5 disabled:opacity-50"
                  onClick={handleResolveNight}
                  disabled={flowerPhase !== "night_actions"}
                >
                  结算夜晚
                </button>
              )}
        </div>
      ) : flowerPhase === "day_vote" ? (
        <div className="space-y-2">
          <div className="text-sm">白天投票目标</div>
          {!myAlive ? (
            <div className="text-xs text-red-600">你已死亡，无法投票。</div>
          ) : myMuted ? (
            <div className="text-xs text-red-600">你被禁言，无法投票。</div>
          ) : null}
          <select
            className="border rounded px-3 py-2 text-sm w-full"
            value={dayVoteSelection}
            onChange={(e) => setDayVoteSelection(e.target.value === "" ? "" : Number(e.target.value))}
            disabled={!myAlive || myMuted}
          >
            <option value="">（请选择投票目标）</option>
            {flowerPlayers
              .filter(p => p.isAlive)
              .map(p => (
                <option key={`vote-target-${p.seat}`} value={p.seat}>
                  座位 {p.seat} - {p.name || `玩家${p.seat}`}
                </option>
              ))}
          </select>
          <button
            className="px-4 py-2 rounded bg-black text-white hover:bg-black/90 disabled:opacity-50"
            onClick={handleDayVoteSubmit}
            disabled={!mySeat || !myAlive || myMuted}
          >
            提交投票
          </button>
          {isHost && (
            <button
              className="px-4 py-2 rounded border border-black text-black hover:bg-black/5 disabled:opacity-50"
              onClick={handleResolveDayVote}
              disabled={flowerPhase !== "day_vote"}
            >
              结算投票
            </button>
          )}
        </div>
      ) : (
        <div className="text-xs text-gray-500">当前阶段无需提交夜晚技能。</div>
      )}
        </div>
      )}

      {/* 夜晚结算结果 */}
          {flowerSnapshot?.night?.result && (
            <div className="p-3 border rounded mb-4 space-y-2">
              <div className="font-medium">夜晚结算</div>
              <div className="text-sm text-gray-700">
                死亡：
                {flowerSnapshot.night.result.deaths.length === 0
                  ? " 无"
                  : flowerSnapshot.night.result.deaths
                      .map(d => `座位 ${d.seat}`)
                      .join("、")}
              </div>
          <div className="text-sm text-gray-700">
            禁言：
            {flowerSnapshot.night.result.mutedSeats.length === 0
              ? " 无"
              : flowerSnapshot.night.result.mutedSeats.map(seat => `座位 ${seat}`).join("、")}
          </div>
          {flowerSnapshot.night.result.policeReports.length > 0 && (
            <div className="text-sm text-gray-700">
              警察验人：
              {flowerSnapshot.night.result.policeReports
                .map(r => {
                  const label = r.result === "bad_special" ? "坏特殊" : r.result === "not_bad_special" ? "非坏特殊" : "未知";
                  return `座位 ${r.targetSeat} → ${label}`;
                })
                .join("、")}
            </div>
          )}
        </div>
      )}

      {/* 系统日志 */}
      {flowerSnapshot && (
        <div className="p-3 border rounded mb-4">
          <div className="font-medium mb-1">系统日志</div>
          <div className="max-h-80 overflow-auto text-sm">
            <ol className="list-decimal list-inside space-y-1">
              {flowerSnapshot.logs.map((entry, idx) => (
                <li key={idx}>{new Date(entry.at).toLocaleTimeString()} - {entry.text}</li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {flowerSnapshot && (
        <div className="p-3 border rounded mb-4">
          <div className="font-medium mb-1">调试：角色与夜间行动</div>
          <div className="text-xs grid grid-cols-1 md:grid-cols-2 gap-2">
            {flowerPlayers.map((p) => (
              <div key={`debug-role-${p.seat}`} className="border rounded px-2 py-1">
                <div>座位 {p.seat}：{p.name || "玩家"}｜角色：{p.role ?? "未分配"}{p.isAlive ? "" : "（死亡）"}</div>
                <div>
                  夜晚行动：
                  {p.nightAction?.targetSeat
                    ? `指向座位 ${p.nightAction.targetSeat}`
                    : "未提交/无目标"}
                </div>
                {(p.needleCount > 0 || p.pendingNeedleDeath) && (
                  <div>
                    空针：{p.needleCount}
                    {p.pendingNeedleDeath && <span>（将于下一日死亡）</span>}
                  </div>
                )}
                {darkVoteMap?.[String(p.seat)] > 0 && (
                  <div>暗票：+{darkVoteMap[String(p.seat)]}</div>
                )}
              </div>
            ))}
          </div>
          {flowerSnapshot.night.lastActions && flowerSnapshot.night.lastActions.length > 0 && (
            <div className="mt-3 text-xs">
              <div className="font-medium text-sm mb-1">上一夜行动回顾</div>
              <ul className="space-y-1">
                {Array.from(flowerSnapshot.night.lastActions)
                  .sort((a, b) => a.actorSeat - b.actorSeat)
                  .map((action, idx) => {
                    const actor = flowerPlayers.find(p => p.seat === action.actorSeat);
                    const roleAtAction = action.role ?? actor?.role ?? "?";
                    const actorLabel = actor ? `${actor.name || "玩家"}（座位 ${actor.seat}｜${roleAtAction}）` : `座位 ${action.actorSeat}`;
                    const targetLabel = action.targetSeat ? `座位 ${action.targetSeat}` : "无目标";
                    return (
                      <li key={`last-action-${idx}`}>
                        {actorLabel} → {targetLabel}
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}
          {flowerSnapshot.day?.votes && flowerSnapshot.day.votes.length > 0 && (
            <div className="mt-3 text-xs">
              <div className="font-medium text-sm mb-1">白天投票（实时）</div>
              <ul className="space-y-1">
                {Array.from(flowerSnapshot.day.votes)
                  .sort((a, b) => a.voterSeat - b.voterSeat)
                  .map((vote, idx) => (
                    <li key={`day-vote-${idx}`}>
                      座位 {vote.voterSeat} → 座位 {vote.targetSeat}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 事件日志（调试） */}
      <div className="p-3 border rounded">
        <div className="font-medium mb-1">事件日志（调试用）</div>
        <div ref={logRef} className="max-h-80 overflow-auto text-sm">
          <ul className="list-disc pl-5 space-y-1">
            {logs.map((l, i) => (<li key={i}>{l}</li>))}
          </ul>
        </div>
      </div>
    </div>
  );
}
