// src/FlowerRoom.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rt, getSessionId, type PresenceState } from "./realtime/socket";
import type { FlowerPlayerState, FlowerRole, FlowerPhase, ChatMessage } from "./flower/types";
import { useFlowerStore } from "./flower/store";
import type { FlowerStore } from "./flower/store";
import type { SubmitNightActionPayload, SubmitDayVotePayload } from "./flower/engine";
import type { WakeLockSentinel } from "./types";
import { ChatPanel } from "./flower/ChatPanel";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useConfirm } from "@/components/ConfirmDialog";
import { useAlert } from "@/components/AlertMessage";
import { useJoinRoomDialog } from "@/components/JoinRoomDialog";
import { TargetSelectionDrawer } from "@/components/TargetSelectionDrawer";
import { useAddBotDialog } from "@/components/AddBotDialog";
import Avvvatars from "avvvatars-react";
import { Users, LogOut, Crown, Bot, Wifi, WifiOff, UserPlus, MessageSquare, Moon, Sun, Gamepad2, Wrench, User } from "lucide-react";


/** ———————————————————————— 小工具 ———————————————————————— */
function randName() {
  const a = Math.random().toString(36).slice(2, 4);
  const b = Math.random().toString(36).slice(2, 4);
  return `玩家-${a}${b}`;
}

const isUserReady = (u: unknown): boolean => !!(u as any)?.ready;
const GOOD_ROLE_SET = new Set<FlowerRole>(["花蝴蝶", "狙击手", "医生", "警察", "善民"]);
const BAD_ROLE_SET = new Set<FlowerRole>(["杀手", "魔法师", "森林老人", "恶民"]);
const PHASE_TEXT_MAP: Record<FlowerPhase, string> = {
  lobby: "准备阶段",
  night_actions: "夜晚行动",
  night_result: "夜晚结算",
  day_discussion: "白天讨论",
  day_vote: "白天投票",
  game_over: "游戏结束",
};

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
  const [dayVoteDrawerOpen, setDayVoteDrawerOpen] = useState(false);
  const [nightActionDrawerOpen, setNightActionDrawerOpen] = useState(false);


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
  const addChatMessage = useFlowerStore((state: FlowerStore) => state.addChatMessage);

  // Dialog hooks to replace native alert/confirm
  const { confirm, ConfirmDialogComponent } = useConfirm();
  const { alert, AlertDialogComponent } = useAlert();
  const { showJoinRoomDialog, JoinRoomDialogComponent } = useJoinRoomDialog();
  const { showAddBotDialog, AddBotDialogComponent } = useAddBotDialog();

  const logRef = useRef<HTMLDivElement | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const pushLog = useCallback((line: string) => setLogs(prev => [...prev, line]), []);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs.length]);

  // —— 屏幕常亮功能 —— //

  let wakeLockRef = useRef<WakeLockSentinel | null>(null);


  const requestWakeLock = useCallback(async () => {
    if (wakeLockRef.current) return; // Already active

    try {
      // 检查浏览器是否支持 Screen Wake Lock API
      if ('wakeLock' in navigator) {
        const wakeLock = await navigator.wakeLock.request('screen');
        wakeLockRef.current = wakeLock;

        console.log('Screen Wake Lock is active');

        // 监听页面可见性变化，当页面变为可见时重新请求唤醒锁
        const handleVisibilityChange = () => {
          if (wakeLockRef.current !== null && document.visibilityState === 'visible') {
            requestWakeLock();
          }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        // 当唤醒锁释放时记录日志
        wakeLock.addEventListener('release', () => {
          console.log('Screen Wake Lock was released');

          wakeLockRef.current = null;
        });
      } else {
        console.warn('Screen Wake Lock API is not supported in this browser');
      }
    } catch (err) {
      console.error('Failed to acquire screen wake lock:', err);

    }
  }, []);

  const handleInteraction = useCallback(() => {
    if (!wakeLockRef.current) {
      requestWakeLock();
    }
  }, [requestWakeLock]);


  // 组件卸载时释放唤醒锁
  useEffect(() => {
    return () => {
      if (wakeLockRef.current !== null) {
        wakeLockRef.current.release();
        wakeLockRef.current = null;

      }
    };
  }, []);

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
      // 房主不再需要处理聊天消息，因为服务器会直接广播给所有成员
    });
    return () => off();
  }, [isHost, hostSubmitNightAction, hostSubmitDayVote, broadcastSnapshot, setFlowerSnapshot, flowerSnapshot]);

  // 添加对聊天消息的订阅处理
  useEffect(() => {
    const off = rt.subscribeAction(async (msg) => {
      if (msg.action === "flower:chat_message") {
        const chatMsg = msg.payload as ChatMessage;
        const currentSnapshot = flowerSnapshot;
        if (currentSnapshot) {
          const chatMessages = currentSnapshot.chatMessages || [];
          // Avoid duplicates
          if (!chatMessages.some((m: ChatMessage) => m.id === chatMsg.id)) {
            setFlowerSnapshot({
              ...currentSnapshot,
              chatMessages: [...chatMessages, chatMsg],
              updatedAt: Date.now(),
            });
          }
        }
      }
    });
    return () => off();
  }, [flowerSnapshot, setFlowerSnapshot]);

  // 添加对 state:request 事件的监听
  useEffect(() => {
    if (!isHost) return;
    const off = rt.subscribeStateRequest(async (msg) => {
      console.log("[state:request] received from", msg.from);
      // 广播当前快照给请求者
      if (flowerSnapshot) {
        try {
          // 将 FlowerSnapshot 转换为 GameSnapshot
          const gameSnapshot: any = {
            game: null,
            endThreshold: 0,
            isOver: false,
            finalRanks: null,
            flaskMap: null,
            nextFlaskMap: null,
            foolPrankUsed: false,
            roundStartScores: null,
            ...flowerSnapshot
          };
          await rt.sendState(gameSnapshot, msg.from);
        } catch (err) {
          console.error("Failed to send state to requester", err);
        }
      }
    });
    return () => off();
  }, [isHost, flowerSnapshot]);

  // 添加对连接状态变化的监听，确保重新连接时能获取最新状态
  useEffect(() => {
    // 当连接建立且在房间内时，请求最新的快照状态
    if (roomCode && connected) {
      const timer = setTimeout(async () => {
        try {
          console.log("Requesting latest state...");
          await rt.requestState();
        } catch (err) {
          console.warn("Failed to request state after reconnect", err);
        }
      }, 1000); // 延迟1秒确保连接稳定

      return () => clearTimeout(timer);
    }
  }, [roomCode, connected]);

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
    const off = rt.subscribeKicked(async () => {
      setRoomCode(null);
      setPresence(null);
      setFlowerSnapshot(null);
      await alert("你已被房主移出房间");
    });
    return () => off();
  }, [setFlowerSnapshot, alert]);

  useEffect(() => {
    if (isHost && !wasHostRef.current && flowerSnapshot) {
      broadcastSnapshot();
    }
    wasHostRef.current = isHost;
  }, [isHost, flowerSnapshot, broadcastSnapshot]);

  /** 列表派生 */
  const users = presence?.users ?? [];
  const presenceMap = useMemo(() => {
    const map = new Map<string, PresenceState["users"][number]>();
    for (const u of users) {
      if (u?.sessionId) map.set(u.sessionId, u);
    }
    return map;
  }, [users]);
  const me = useMemo(() => users.find(u => u.sessionId === getSessionId()) ?? null, [users]);
  const flowerPlayers: FlowerPlayerState[] = flowerSnapshot?.players ?? [];
  const darkVoteMap = (flowerSnapshot?.day?.tally ?? {}) as Record<string, number>;
  const flowerPhase = flowerSnapshot?.phase ?? "lobby";
  const flowerPhaseText = PHASE_TEXT_MAP[flowerPhase] ?? flowerPhase;
  const flowerDayCount = flowerSnapshot?.dayCount ?? 0;
  const gameResult = flowerSnapshot?.gameResult ?? null;
  const latestDaySummary = useMemo(() => {
    const logs = flowerSnapshot?.logs;
    if (!logs || logs.length === 0) {
      return { executionText: null as string | null, votesText: null as string | null, hasSummary: false };
    }
    let executionText: string | null = null;
    let votesText: string | null = null;
    for (let i = logs.length - 1; i >= 0; i -= 1) {
      const text = logs[i].text || "";
      if (!executionText) {
        if (text.startsWith("白天票决：")) {
          executionText = text.replace(/^白天票决：/, "");
        } else if (text.startsWith("白天投票平票") || text.includes("平票，无人死亡")) {
          executionText = "无人被处决";
        }
      }
      if (!votesText && text.startsWith("白天票型：")) {
        votesText = text.replace(/^白天票型：/, "");
      }
      if (executionText && votesText) break;
    }
    const hasSummary = !!executionText || !!votesText;
    return { executionText, votesText, hasSummary };
  }, [flowerSnapshot?.logs, flowerSnapshot?.updatedAt]);
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
  const myDayVoteTarget = myFlowerPlayer?.voteTargetSeat ?? null;
  const showDaySummary = flowerPhase === "night_actions" && latestDaySummary.hasSummary;
  const showNightSummary = flowerPhase === "day_vote" && !!flowerSnapshot?.night?.result;



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
        await alert(resp?.msg || "创建失败");
      }
    } catch (e) {
      console.error(e);
      await alert("创建失败：Ack 超时或异常");
    }
  }, [name, pushLog]);

  // 加入房间（**这里一定要发 code，不是 room**）
  const joinRoom = useCallback(async () => {
    const code = await showJoinRoomDialog(roomCode || localStorage.getItem("lastRoomCode") || "");
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
        await alert(resp?.msg || "加入失败");
      }
    } catch (e) {
      console.error(e);
      await alert("加入失败：Ack 超时或异常");
    }
  }, [name, roomCode, pushLog, showJoinRoomDialog, alert]);

  const leaveRoom = useCallback(async () => {
    if (!roomCode) return;
    const confirmed = await confirm({
      title: "离开房间",
      description: "确定要离开当前房间吗？",
      variant: "destructive"
    });
    if (!confirmed) return;
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
  }, [roomCode, setFlowerSnapshot, confirm]);

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
        await alert(`设置准备失败：${(resp as any)?.msg || "服务器未响应"}`);
      }
    } catch (e) {
      console.error(e);
      await alert("设置准备失败：服务器未响应（详见控制台/事件日志）");
    }
  }, [roomCode, me, pushLog]);

  const kickPlayer = useCallback(async (targetSessionId: string | null) => {
    if (!roomCode || !isHost || !targetSessionId) return;
    const confirmed = await confirm({
      title: "踢出玩家",
      description: "确定要请这位玩家离开房间吗？",
      variant: "destructive"
    });
    if (!confirmed) return;
    try {
      const resp = await rt.kickPlayer(roomCode, targetSessionId);
      if (!(resp as any)?.ok) {
        await alert(`踢人失败：${(resp as any)?.msg || "服务器未响应"}`);
      }
    } catch (err) {
      console.error(err);
      await alert("踢人失败：服务器未响应");
    }
  }, [roomCode, isHost, confirm, alert]);

  const addBotPlaceholder = useCallback(async () => {
    if (!canAddBot || !roomCode) return;
    const nick = await showAddBotDialog();
    if (nick === null) return; // User cancelled
    try {
      const resp = await rt.addBotToRoom(roomCode, nick?.trim() || undefined);
      pushLog(`room:add_bot ack: ${JSON.stringify(resp)}`);
      if (!(resp as any)?.ok) {
        await alert(`添加机器人失败：${(resp as any)?.msg || "服务器未响应"}`);
      }
    } catch (err) {
      console.error(err);
      await alert("添加机器人失败：服务器未响应");
    }
  }, [canAddBot, roomCode, pushLog, alert]);

  const transferHostInternal = useCallback(
    async (targetSessionId: string | null, options?: { confirm?: boolean; label?: string }) => {
      const snapshot = flowerSnapshot;
      const roomCheck = !!roomCode;
      const isHost = snapshot?.hostSessionId === getSessionId();
      if (!snapshot || !roomCheck || !isHost || !targetSessionId) return false;
      const confirmNeeded = options?.confirm ?? true;
      const label = options?.label?.trim() || "该玩家";
      if (confirmNeeded) {
        const confirmed = await confirm({
          title: "交接房主",
          description: `确定将房主交接给 ${label} 吗？`
        });
        if (!confirmed) return false;
      }
      try {
        const resp = await rt.transferHost(String(roomCode), targetSessionId);
        if (!(resp as any)?.ok) {
          const msg = (resp as any)?.msg || "服务器未响应";
          if (confirmNeeded) {
            await alert(`交接失败：${msg}`);
          }
          return false;
        }
        return true;
      } catch (err) {
        console.error("transfer host failed", err);
        if (confirmNeeded) {
          await alert("交接失败：服务器未响应");
        }
        return false;
      }
    },
    [roomCode, flowerSnapshot, confirm, alert]
  );

  const handoverHost = useCallback(
    async (targetSessionId: string | null, displayName?: string | null) => {
      await transferHostInternal(targetSessionId, { confirm: true, label: displayName || undefined });
    },
    [transferHostInternal]
  );



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




  const handleResolveDayVote = useCallback(async () => {
    if (!isHost) {
      await alert("只有房主可以结算投票");
      return;
    }
    const confirmed = await confirm({
      title: "结算投票",
      description: "确认要结算当前白天投票吗？（请确保所有玩家都已完成投票）"
    });
    if (!confirmed) return;
    const res = hostResolveDayVote();
    if (!res.ok) {
      await alert(res.error || "结算失败");
      return;
    }
    await broadcastSnapshot();
  }, [isHost, hostResolveDayVote, broadcastSnapshot, confirm, alert]);

  const handleResolveNight = useCallback(async () => {
    if (!isHost) {
      await alert("只有房主可以结算夜晚");
      return;
    }
    const confirmed = await confirm({
      title: "结算夜晚",
      description: "确认要结算当前夜晚吗？（请确保所有夜间技能都已提交）"
    });
    if (!confirmed) return;
    const res = hostResolveNight();
    if (!res.ok) {
      await alert(res.error || "结算失败");
      return;
    }
    await broadcastSnapshot();
  }, [isHost, hostResolveNight, broadcastSnapshot, confirm, alert]);

  // 开始第一夜（仍走容错事件名；是否被实现取决于你的后端）
  const startFirstNight = useCallback(async () => {
    if (!roomCode) return;
    if (!isHost) {
      await alert("只有房主可以开始游戏");
      return;
    }
    if (occupiedSeats < 9) {
      await alert("需要 9 名玩家（可用机器人占位）才能开始游戏");
      return;
    }
    if (!everyoneReady) {
      await alert("还有玩家未准备，无法开始游戏");
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
              await alert(assignRes.error || "分配角色失败，请检查人数是否满 9 人");
            } else {
              await broadcastSnapshot();
            }
          }
          return; // 有回就认为成功
        }
      } catch (e) {
        lastErr = e;
      }
    }
    console.error("startFirstNight last error:", lastErr);
    await alert("开始失败：服务端未响应开始事件（详见控制台/事件日志）");
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
          <div
            className="text-lg font-semibold">{gameResult.winner === "good" ? "好人胜利" : gameResult.winner === "bad" ? "坏人胜利" : "平局"}</div>
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
    <>
      <div
        className="min-h-screen bg-background p-5"
        onClick={handleInteraction}
        onTouchStart={handleInteraction}
      >
        <div className="max-w-6xl mx-auto space-y-4">
          {/* 顶部标题和连接状态 */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <CardTitle className="text-2xl">花蝴蝶 九人局</CardTitle>
                <div className="flex items-center gap-2">
                  {connected ? (
                    <Wifi className="h-4 w-4 text-green-600" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-destructive" />
                  )}
                  <Badge variant={connected ? "default" : "destructive"}>
                    {connText}
                  </Badge>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* 顶部：连接 + 建/加房 */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="昵称"
                  className="w-40"
                />
                <Button onClick={createRoom}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  创建花蝴蝶房间
                </Button>
                <Button variant="outline" onClick={joinRoom}>
                  加入房间
                </Button>
                {roomCode && (
                  <Button
                    variant="destructive"
                    onClick={leaveRoom}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    离开房间
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 房间信息 */}
          {roomCode ? (
            <Card>
              <CardContent className="py-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">房间号:</span>
                  <Badge variant="outline" className="font-mono text-base">
                    {roomCode}
                  </Badge>
                  <Separator orientation="vertical" className="h-4" />
                  <Badge variant={isHost ? "default" : "secondary"}>
                    {isHost ? (
                      <>
                        <Crown className="h-3 w-3 mr-1" />
                        房主
                      </>
                    ) : (
                      "玩家"
                    )}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-3">
                <p className="text-sm text-muted-foreground">
                  （当前无房间，创建/加入后出现）
                </p>
              </CardContent>
            </Card>
          )}

          {/* 当前阶段信息卡片 */}
          {flowerSnapshot && (
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>当前阶段</span>
                  <Badge variant="outline" className="text-lg">
                    {flowerPhaseText} - 第{flowerDayCount}天
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {myRole && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">你的角色：</span>
                      <Badge variant="default">{myRole}</Badge>
                      {!myAlive && <Badge variant="destructive">已死亡</Badge>}
                      {myMuted && <Badge variant="outline">禁言</Badge>}
                    </div>
                  )}
                  {flowerPhase === "lobby" && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant={(me as any)?.ready ? "default" : "outline"}
                        onClick={toggleReady}
                        disabled={!roomCode}
                      >
                        {(me as any)?.ready ? "取消准备" : "准备"}
                      </Button>
                      {isHost && (
                        <Button
                          onClick={startFirstNight}
                          disabled={occupiedSeats < 9 || !everyoneReady}
                        >
                          开始游戏
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={addBotPlaceholder}
                        disabled={!canAddBot}
                      >
                        添加机器人 ({remainingSeats})
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Accordion 工作区域 */}
          <Accordion type="multiple" defaultValue={["players", "actions", "chat"]} className="space-y-2">
            {/* 玩家列表区域 */}
            <AccordionItem value="players">
              <AccordionTrigger className="px-4">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  <span className="font-semibold">
                    玩家列表（{flowerSnapshot ? flowerPlayers.length : users.length} 人）
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4">
                <ScrollArea className="max-h-[500px] pr-4">
                  <div className="space-y-2">
                    {flowerSnapshot
                      ? flowerPlayers.map((player: FlowerPlayerState) => {
                        const tags: string[] = [];
                        const presenceInfo = player.sessionId ? presenceMap.get(player.sessionId) : undefined;
                        if (player.isHost) tags.push("房主");
                        if (player.sessionId === getSessionId()) tags.push("我");
                        if (presenceInfo?.isDisconnected) tags.push("暂离");
                        if (player.isReady && flowerPhase === "lobby") tags.push("已准备");
                        if (player.isBot) tags.push("BOT");

                        const statusParts: string[] = [];
                        statusParts.push(player.sessionId ? (player.isAlive ? "存活" : "死亡") : "空位");
                        if (player.isMutedToday) statusParts.push("禁言");
                        if (player.hasVotedToday && flowerPhase === "day_vote") statusParts.push("已投票");

                        return (
                          <Card key={`seat-${player.seat}`}>
                            <CardContent className="p-4">
                              <div className="flex items-center gap-3">
                                {/* Avatar */}
                                {player.sessionId || player.isBot ? (
                                  <Avvvatars
                                    value={player.name || `座位${player.seat}`}
                                    size={48}
                                    style="shape"
                                  />
                                ) : (
                                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                                    <User className="h-6 w-6 text-muted-foreground" />
                                  </div>
                                )}

                                {/* Player Info */}
                                <div className="flex-1">
                                  <div className="font-medium">
                                    {player.sessionId ? (player.name || `座位${player.seat}`) : `座位${player.seat}（空）`}
                                  </div>
                                  <div className="text-xs text-muted-foreground">座位 {player.seat}</div>
                                  {statusParts.length > 0 && (
                                    <div className="text-xs text-muted-foreground mt-1">
                                      {statusParts.join(" · ")}
                                    </div>
                                  )}
                                </div>

                                {/* Tags and Actions */}
                                <div className="flex flex-col items-end gap-2">
                                  {tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 justify-end">
                                      {player.isHost && (
                                        <Badge variant="default" className="gap-1">
                                          <Crown className="h-3 w-3" />
                                          房主
                                        </Badge>
                                      )}
                                      {player.sessionId === getSessionId() && (
                                        <Badge variant="secondary">我</Badge>
                                      )}
                                      {player.isBot && (
                                        <Badge variant="outline" className="gap-1">
                                          <Bot className="h-3 w-3" />
                                          BOT
                                        </Badge>
                                      )}
                                      {player.isReady && flowerPhase === "lobby" && (
                                        <Badge variant="outline">已准备</Badge>
                                      )}
                                      {presenceInfo?.isDisconnected && (
                                        <Badge variant="destructive">暂离</Badge>
                                      )}
                                    </div>
                                  )}
                                  {isHost && player.sessionId && player.sessionId !== getSessionId() && (
                                    <div className="flex gap-1">
                                      {!player.isBot && (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => handoverHost(player.sessionId, player.name || `座位${player.seat}`)}
                                          disabled={!!presenceInfo?.isDisconnected}
                                        >
                                          交接房主
                                        </Button>
                                      )}
                                      <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => kickPlayer(player.sessionId)}
                                      >
                                        {player.isBot ? "移除" : "踢出"}
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })
                      : users.map((u: any) => {
                        const tags: string[] = [];
                        if (u.isHost) tags.push("房主");
                        if (u.sessionId === getSessionId()) tags.push("我");
                        if (u.isDisconnected) tags.push("暂离");
                        if (u.ready) tags.push("已准备");
                        if (u.isBot) tags.push("BOT");
                        return (
                          <Card key={u.sessionId}>
                            <CardContent className="p-4">
                              <div className="flex items-center gap-3">
                                <Avvvatars
                                  value={u.name || "未命名"}
                                  size={48}
                                  style="shape"
                                />
                                <div className="flex-1">
                                  <div className="font-medium">{u.name || "（未命名）"}</div>
                                  <div className="text-xs text-muted-foreground">座位 {u.seat}</div>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                  {tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {u.isHost && (
                                        <Badge variant="default" className="gap-1">
                                          <Crown className="h-3 w-3" />
                                          房主
                                        </Badge>
                                      )}
                                      {u.sessionId === getSessionId() && (
                                        <Badge variant="secondary">我</Badge>
                                      )}
                                      {u.isBot && (
                                        <Badge variant="outline" className="gap-1">
                                          <Bot className="h-3 w-3" />
                                          BOT
                                        </Badge>
                                      )}
                                      {u.ready && (
                                        <Badge variant="outline">已准备</Badge>
                                      )}
                                      {u.isDisconnected && (
                                        <Badge variant="destructive">暂离</Badge>
                                      )}
                                    </div>
                                  )}
                                  {isHost && u.sessionId !== getSessionId() && (
                                    <div className="flex gap-1">
                                      {!u.isBot && (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => handoverHost(u.sessionId, u.name || `座位${u.seat}`)}
                                          disabled={!!u.isDisconnected}
                                        >
                                          交接房主
                                        </Button>
                                      )}
                                      <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => kickPlayer(u.sessionId)}
                                      >
                                        {u.isBot ? "移除" : "踢出"}
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    {!flowerSnapshot && users.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        （当前无玩家，创建/加入房间后会出现）
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </AccordionContent>
            </AccordionItem>

            {/* 聊天区域 */}
            {roomCode && flowerSnapshot && (
              <AccordionItem value="chat">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5" />
                    <span className="font-semibold">聊天室</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4">
                  <ChatPanel
                    messages={flowerSnapshot.chatMessages || []}
                    players={flowerPlayers}
                    onSendMessage={addChatMessage}
                    mySessionId={getSessionId()}
                  />
                </AccordionContent>
              </AccordionItem>
            )}

            {/* 游戏操作区域 */}
            {flowerSnapshot && flowerPhase !== "lobby" && (
              <AccordionItem value="actions">
                <AccordionTrigger className="px-4">
                  <div className="flex items-center gap-2">
                    {flowerPhase === "night_actions" ? <Moon className="h-5 w-5" /> :
                      flowerPhase === "day_vote" ? <Sun className="h-5 w-5" /> :
                        <Gamepad2 className="h-5 w-5" />}
                    <span className="font-semibold">
                      {flowerPhase === "night_actions" ? "夜晚行动" : flowerPhase === "day_vote" ? "白天投票" : "游戏操作"}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 space-y-4">
                  {myRole && (
                    <div className="space-y-2">
                      {!myAlive && (
                        <div className="text-xs text-red-600">你已死亡，无法执行玩家行动。</div>
                      )}

                      {flowerPhase === "night_actions" ? (
                        <div className="space-y-2">
                          {myAlive && (
                            <>
                              <Button
                                variant="outline"
                                className="w-full justify-start"
                                onClick={() => setNightActionDrawerOpen(true)}
                              >
                                {nightActionSelections[myRole] ? `已选择：座位 ${nightActionSelections[myRole]}` : "选择行动目标"}
                              </Button>
                              <div className="text-xs text-gray-500">
                                当前已提交：{myFlowerPlayer?.nightAction?.targetSeat ? `座位 ${myFlowerPlayer.nightAction.targetSeat}` : "尚未提交"}
                              </div>
                            </>
                          )}

                          {isHost && (
                            <Button
                              variant="outline"
                              className="w-full"
                              onClick={handleResolveNight}
                              disabled={flowerPhase !== "night_actions"}
                            >
                              结算夜晚
                            </Button>
                          )}
                        </div>
                      ) : flowerPhase === "day_vote" ? (
                        <Card>
                          <CardHeader>
                            <CardTitle>白天投票</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {myAlive && !myMuted ? (
                              <>
                                <Button
                                  variant="outline"
                                  className="w-full justify-start"
                                  onClick={() => setDayVoteDrawerOpen(true)}
                                >
                                  {dayVoteSelection ? `已选择：座位 ${dayVoteSelection}` : "选择投票目标"}
                                </Button>
                                <div className="text-sm text-muted-foreground">
                                  当前已投票：{myDayVoteTarget ? `座位 ${myDayVoteTarget}` : "尚未投票"}
                                </div>
                              </>
                            ) : (
                              <div className="text-sm text-destructive">
                                {!myAlive ? "你已死亡，无法投票。" : "你被禁言，无法投票。"}
                              </div>
                            )}

                            {isHost && (
                              <Button
                                variant="outline"
                                onClick={handleResolveDayVote}
                                disabled={flowerPhase !== "day_vote"}
                                className="w-full"
                              >
                                结算投票
                              </Button>
                            )}
                          </CardContent>
                        </Card>
                      ) : (
                        <div className="text-xs text-gray-500">当前阶段无需提交行动。</div>
                      )}
                    </div>
                  )}

                  {/* 结算结果显示 */}
                  {showDaySummary && (
                    <div className="p-3 border rounded space-y-2">
                      <div className="font-medium">白天结算</div>
                      <div className="text-sm text-gray-700">
                        处决：{latestDaySummary.executionText || "无人被处决"}
                      </div>
                      {latestDaySummary.votesText && (
                        <div className="text-sm text-gray-700">票型：{latestDaySummary.votesText}</div>
                      )}
                    </div>
                  )}

                  {showNightSummary && flowerSnapshot?.night?.result && (
                    <div className="p-3 border rounded space-y-2">
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
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            )}

            {/* 调试区域 */}
            <AccordionItem value="debug">
              <AccordionTrigger className="px-4">
                <div className="flex items-center gap-2">
                  <Wrench className="h-5 w-5" />
                  <span className="font-semibold">调试信息</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 space-y-4">
                {/* 系统日志 */}
                {flowerSnapshot && (
                  <div className="p-3 border rounded">
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

                {/* 角色调试 */}
                {flowerSnapshot && (
                  <div className="p-3 border rounded">
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

                {/* 事件日志 */}
                <Card>
                  <CardHeader>
                    <CardTitle>事件日志（调试用）</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="max-h-80">
                      <ul className="list-disc pl-5 space-y-1 text-sm">
                        {logs.map((l, i) => (<li key={i}>{l}</li>))}
                      </ul>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>

      {/* Dialog Components */}
      <ConfirmDialogComponent />
      <AlertDialogComponent />
      <JoinRoomDialogComponent />
      <AddBotDialogComponent />

      {/* Target Selection Drawers */}
      <TargetSelectionDrawer
        open={nightActionDrawerOpen}
        onOpenChange={setNightActionDrawerOpen}
        title="选择夜晚行动目标"
        description={`你的身份是 ${myRole}，请选择目标`}
        players={flowerPlayers}
        currentSelection={
          myRole && nightActionSelections[myRole] !== "" && nightActionSelections[myRole] != null
            ? Number(nightActionSelections[myRole])
            : null
        }
        onConfirm={async (targetSeat) => {
          if (!myRole || !mySeat) return;
          // Update local state
          setNightActionSelections(prev => ({
            ...prev,
            [myRole]: targetSeat ?? ""
          }));

          // Submit immediately
          const payload: SubmitNightActionPayload = {
            role: myRole,
            actorSeat: mySeat,
            targetSeat,
          };
          const res = await submitNightAction(payload);
          if (!res.ok) {
            await alert(res.error || "提交失败");
          }
        }}
        disabled={!myAlive}
        disabledMessage="你已死亡，无法行动"
        filterPlayers={(p) => p.isAlive}
      />

      <TargetSelectionDrawer
        open={dayVoteDrawerOpen}
        onOpenChange={setDayVoteDrawerOpen}
        title="选择投票目标"
        description="请选择你要投票淘汰的玩家"
        players={flowerPlayers}
        currentSelection={typeof dayVoteSelection === "number" ? dayVoteSelection : null}
        onConfirm={async (targetSeat) => {
          if (targetSeat !== null) {
            setDayVoteSelection(targetSeat);

            if (!mySeat) return;
            const payload: SubmitDayVotePayload = { voterSeat: mySeat, targetSeat };
            const res = await submitDayVote(payload);
            if (!res.ok) {
              await alert(res.error || "投票失败");
            }
          }
        }}
        disabled={!myAlive || myMuted}
        disabledMessage={!myAlive ? "你已死亡，无法投票" : "你被禁言，无法投票"}
        filterPlayers={(p) => p.isAlive}
      />
    </>
  );
}
