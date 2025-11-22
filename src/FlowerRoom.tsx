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
import { Badge } from "@/components/ui/badge";
import {
    Carousel,
    CarouselContent,
    CarouselItem,
    type CarouselApi,
} from "@/components/ui/carousel";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useConfirm } from "@/components/ConfirmDialog";
import { useAlert } from "@/components/AlertMessage";
import { useJoinRoomDialog } from "@/components/JoinRoomDialog";
import { TargetSelectionDrawer } from "@/components/TargetSelectionDrawer";
import { useAddBotDialog } from "@/components/AddBotDialog";
import { useEditNameDialog } from "@/components/EditNameDialog";
import { VantaBackground } from "@/components/VantaBackground";
import Avvvatars from "avvvatars-react";
import {
    Users,
    LogOut,
    Crown,
    Bot,
    Wifi,
    WifiOff,
    UserPlus,
    MessageSquare,
    Moon,
    Sun,
    Gamepad2,
    User,
    Pencil,
    Swords,
    House,
    CircleAlert, ThumbsUp, ThumbsDown, Heart, HeartCrack
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import {
    GiButterfly,
    GiCrosshair,
    GiDoctorFace, GiEntMouth,
    GiFarmer,
    GiHoodedAssassin,
    GiPoliceBadge, GiRobber,
    GiWizardStaff
} from "react-icons/gi";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";


/** ———————————————————————— 小工具 ———————————————————————— */
function randName() {
    const a = Math.random().toString(36).slice(2, 4);
    const b = Math.random().toString(36).slice(2, 4);
    return `玩家-${a}${b}`;
}

const AI_NAMES = [
    "ChatGPT",
    "Claude",
    "Gemini",
    "Llama",
    "DeepSeek",
    "通义千问",
    "豆包",
    "文心一言",
    "Kimi"
];

const isFakeBot = (name: string | undefined) => name?.endsWith("\u200B") ?? false;

function getAvailableAiName(usedNames: Set<string>): string {
    console.log("getAvailableAiName", usedNames);
    const available = AI_NAMES.filter(n => !usedNames.has(n));
    if (available.length === 0) return randomFrom(AI_NAMES)!;
    return randomFrom(available)!;
}

const isUserReady = (u: unknown): boolean => !!(u as any)?.ready;
const GOOD_ROLE_SET = new Set<FlowerRole>(["花蝴蝶", "狙击手", "医生", "警察", "善民"]);
const BAD_ROLE_SET = new Set<FlowerRole>(["杀手", "魔法师", "森林老人", "恶民"]);
const ROLE_ICONS: Record<string, React.ElementType> = {
    "花蝴蝶": GiButterfly,
    "狙击手": GiCrosshair,
    "医生": GiDoctorFace,
    "警察": GiPoliceBadge,
    "善民": GiFarmer,
    "杀手": GiHoodedAssassin,
    "魔法师": GiWizardStaff,
    "森林老人": GiEntMouth,
    "恶民": GiRobber,
};
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

type TabId = "players" | "chat" | "actions";

const TAB_LABELS: Record<TabId, string> = {
    players: "玩家",
    chat: "聊天",
    actions: "操作",
};

const TAB_ICONS: Record<TabId, React.ElementType> = {
    players: Users,
    chat: MessageSquare,
    actions: Gamepad2,
};

function MobileNavBar({
    tabs,
    activeTab,
    onTabChange,
    isNight
}: {
    tabs: TabId[];
    activeTab: TabId;
    onTabChange: (t: TabId) => void;
    isNight: boolean;
}) {
    return (
        <div className="flex justify-center mb-4 z-20 sticky top-0 pt-2">
            <div className={`flex items-center p-1 rounded-full border backdrop-blur-md transition-colors duration-500 ${isNight
                ? "bg-black/40 border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                : "bg-white/60 border-white/40 shadow-sm"
                }`}>
                {tabs.map((tab) => {
                    const isActive = activeTab === tab;
                    const Icon = TAB_ICONS[tab];
                    return (
                        <button
                            key={tab}
                            onClick={() => onTabChange(tab)}
                            className={`relative flex items-center justify-center h-9 px-4 rounded-full transition-all duration-300 ${isActive ? "flex-grow" : ""
                                }`}
                            style={{ minWidth: "3rem" }}
                        >
                            {isActive && (
                                <motion.div
                                    layoutId="nav-pill"
                                    className={`absolute inset-0 rounded-full ${isNight ? "bg-white text-black" : "bg-orange-500/50 text-gray-200"
                                        }`}
                                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                                />
                            )}
                            <div className={`relative z-10 flex items-center gap-2 ${isActive
                                ? (isNight ? "text-black" : "text-white")
                                : (isNight ? "text-white/60" : "text-black/60")
                                }`}>
                                <Icon className="w-4 h-4" />
                                <AnimatePresence mode="popLayout">
                                    {isActive && (
                                        <motion.span
                                            initial={{ opacity: 0, width: 0, scale: 0.8 }}
                                            animate={{ opacity: 1, width: "auto", scale: 1 }}
                                            exit={{ opacity: 0, width: 0, scale: 0.8 }}
                                            className="text-sm font-medium whitespace-nowrap overflow-hidden"
                                        >
                                            {TAB_LABELS[tab]}
                                        </motion.span>
                                    )}
                                </AnimatePresence>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

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

    const [activeTab, setActiveTab] = useState<TabId>("players");

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
    const resetGame = useFlowerStore((state: FlowerStore) => state.resetGame);

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
    const RoleIcon = ({ myRole }: { myRole: keyof typeof ROLE_ICONS }) => {
        const Icon = ROLE_ICONS[myRole];
        return <Icon className="w-4 h-4" />;
    }; const myAlive = !!myFlowerPlayer?.isAlive;
    const myMuted = !!myFlowerPlayer?.isMutedToday;
    const showDaySummary = flowerPhase === "night_actions" && latestDaySummary.hasSummary;
    const showNightSummary = flowerPhase === "day_vote" && !!flowerSnapshot?.night?.result;

    const isNight = flowerPhase === "night_actions" || flowerPhase === "night_result";
    const themeClass = isNight
        ? "backdrop-blur-sm bg-black/50 text-white border-white/20 shadow-none"
        : "backdrop-blur-sm bg-white/50 text-slate-900 border-white/40 shadow-sm";
    const mutedTextClass = isNight ? "text-white/70" : "text-slate-500";

    const availableTabs = useMemo<TabId[]>(() => {
        const tabs: TabId[] = ["players"];
        if (roomCode) tabs.push("chat");
        if (flowerSnapshot && flowerPhase !== "lobby") tabs.push("actions");
        return tabs;
    }, [roomCode, flowerSnapshot, flowerPhase]);

    // Smart Persistence
    useEffect(() => {
        if (!availableTabs.includes(activeTab)) {
            setActiveTab(availableTabs[0]);
        }
    }, [availableTabs, activeTab]);

    // —— Carousel State & Sync ——
    const [api, setApi] = useState<CarouselApi>();

    // Sync 1: Carousel -> Tab
    useEffect(() => {
        if (!api) return;

        const onSelect = () => {
            const index = api.selectedScrollSnap();
            const tab = availableTabs[index];
            if (tab) {
                setActiveTab(tab);
            }
        };

        api.on("select", onSelect);
        return () => {
            api.off("select", onSelect);
        };
    }, [api, availableTabs]);

    // Sync 2: Tab -> Carousel
    useEffect(() => {
        if (!api) return;
        const index = availableTabs.indexOf(activeTab);
        if (index !== -1) {
            api.scrollTo(index);
        }
    }, [activeTab, api, availableTabs]);




    // Dialog hooks to replace native alert/confirm
    const { confirm, ConfirmDialogComponent } = useConfirm(flowerSnapshot?.phase === "night_actions" || flowerSnapshot?.phase === "night_result");
    const { alert, AlertDialogComponent } = useAlert();
    const { showJoinRoomDialog, JoinRoomDialogComponent } = useJoinRoomDialog(flowerSnapshot?.phase === "night_actions" || flowerSnapshot?.phase === "night_result");
    const { showAddBotDialog, AddBotDialogComponent } = useAddBotDialog(flowerSnapshot?.phase === "night_actions" || flowerSnapshot?.phase === "night_result");
    const { showEditNameDialog, EditNameDialogComponent } = useEditNameDialog(flowerSnapshot?.phase === "night_actions" || flowerSnapshot?.phase === "night_result");

    const [_logs, setLogs] = useState<string[]>([]);
    const pushLog = useCallback((line: string) => setLogs(prev => [...prev, line]), []);


    // —— 屏幕常亮功能 —— //

    const wakeLockRef = useRef<WakeLockSentinel | null>(null);


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
                    // 接收服务器快照后，立即与当前 presence 同步
                    // 确保快照包含所有在线玩家（包括自己）
                    if (presence) {
                        ensureSnapshotFromPresence(presence);
                    }
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
    }, [pushLog, ensureSnapshotFromPresence, setFlowerSnapshot, presence]);

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

    // 服务器会在加入/重连时自动下发权威快照，无需手动请求或监听同步失败


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
            let nick = name?.trim() || randName();
            if (nick === "机器人") {
                // 创建房间时，没有其他玩家，直接随机
                const aiName = randomFrom(AI_NAMES) || "AI Robot";
                nick = aiName + "\u200B";
                setName(nick);
            }
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
            let nick = name?.trim() || randName();
            if (nick === "机器人") {
                // 加入前先获取房间用户列表，进行去重
                try {
                    const users = await rt.getRoomUsers(code.trim());
                    const usedNames = new Set(users.map(u => u.name?.replace(/\u200B/g, "")).filter(Boolean) as string[]);
                    const aiName = getAvailableAiName(usedNames);
                    nick = aiName + "\u200B";
                    setName(nick);
                } catch (err) {
                    console.warn("Failed to fetch room users for unique name check, falling back to random", err);
                    const aiName = randomFrom(AI_NAMES) || "AI Robot";
                    nick = aiName + "\u200B";
                    setName(nick);
                }
            }
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
    }, [roomCode, setFlowerSnapshot, confirm, flowerPhase]);

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

        let finalName = nick?.trim();
        if (!finalName) {
            const usedNames = new Set(users.map(u => u.name?.replace(/\u200B/g, "")).filter(Boolean) as string[]);
            finalName = getAvailableAiName(usedNames);
        }

        try {
            const resp = await rt.addBotToRoom(roomCode, finalName);
            pushLog(`room:add_bot ack: ${JSON.stringify(resp)}`);
            if (!(resp as any)?.ok) {
                await alert(`添加机器人失败：${(resp as any)?.msg || "服务器未响应"}`);
            }
        } catch (err) {
            console.error(err);
            await alert("添加机器人失败：服务器未响应");
        }
    }, [canAddBot, roomCode, pushLog, alert, users]);

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



    // Game Over logic integrated into main return


    return (
        <div className="h-[100dvh] flex flex-col overflow-hidden">
            <VantaBackground isNight={isNight} />

            <div className="w-full max-w-md mx-auto flex flex-col h-full relative z-10">

                {/* Fixed Top Card - 不滚动 */}
                <div className="sticky flex-none z-10 p-2 md:p-4">
                    <Card className={`w-full shadow-lg ${themeClass}`}>
                        <CardHeader className="pb-2 pt-4 px-4">
                            <div className="flex items-center gap-2">
                                {connected ? (
                                    <Wifi className="h-4 w-4 text-green-600" />
                                ) : (
                                    <WifiOff className="h-4 w-4 text-destructive" />
                                )}
                                <CardTitle className="text-lg md:text-xl">花蝴蝶 九人局</CardTitle>
                                {myRole && (
                                    <Badge variant="outline" className={`flex items-center gap-1.5 ml-auto backdrop-sm ${isNight ? "text-white border-black/50 bg-white/50" : "border-black/50 bg-white/50"
                                        }`}>
                                        {RoleIcon && <RoleIcon myRole={myRole} />}
                                        <span>{myRole}</span>
                                    </Badge>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent className="px-4 pb-4 pt-0">
                            <div className="grid grid-cols-2 gap-4">
                                {/* Left Column: Player & Room */}
                                <div className="flex flex-col justify-center space-y-2 border-r border-white/10 pr-4">
                                    <div>
                                        <div className={`text-xs ${mutedTextClass}`}>玩家昵称</div>
                                        <div className="flex items-center gap-2">
                                            <div className="font-medium truncate text-lg">{name.replace(/\u200B/g, "")}</div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                onClick={async () => {
                                                    const newName = await showEditNameDialog(name.replace(/\u200B/g, ""));
                                                    if (newName) {
                                                        let finalName = newName;
                                                        // 只有在房间内时，才立即进行机器人伪装处理
                                                        if (newName === "机器人" && roomCode) {
                                                            const usedNames = new Set(flowerPlayers.map(p => p.name?.replace(/\u200B/g, "")).filter(Boolean) as string[]);
                                                            const aiName = getAvailableAiName(usedNames);
                                                            finalName = aiName + "\u200B";
                                                        }
                                                        setName(finalName);
                                                        localStorage.setItem("name", finalName);
                                                        if (roomCode) {
                                                            try {
                                                                await rt.updateName(roomCode, finalName);
                                                            } catch (e) {
                                                                console.error("Failed to update name on server", e);
                                                            }
                                                        }
                                                    }
                                                }}
                                            >
                                                <Pencil className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </div>
                                    <div>
                                        <div className={`text-xs ${mutedTextClass}`}>房间号</div>
                                        <div className="font-mono font-bold text-xl truncate">
                                            {roomCode || "未加入"}
                                        </div>
                                    </div>
                                </div>

                                {/* Right Column: Phase & Day or Result */}
                                <div className="flex flex-col justify-center space-y-2 pl-4">
                                    {flowerPhase === "game_over" && gameResult ? (
                                        <>
                                            <div>
                                                <div className={`text-xs ${mutedTextClass}`}>对局结果</div>
                                                <div className={`font-bold text-lg ${gameResult.winner === "good" ? "text-green-600" : gameResult.winner === "bad" ? "text-red-600" : "text-gray-400"}`}>
                                                    {gameResult.winner === "good" ? "好人胜利" : gameResult.winner === "bad" ? "坏人胜利" : "平局"}
                                                </div>
                                            </div>
                                            <div>
                                                <div className={`text-xs ${mutedTextClass}`}>原因</div>
                                                <div className="text-sm font-medium leading-tight line-clamp-2" title={gameResult.reason}>{gameResult.reason}</div>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div>
                                                <div className={`text-xs ${mutedTextClass}`}>当前阶段</div>
                                                <div className="font-medium flex items-center gap-2 text-lg">
                                                    {flowerPhaseText}
                                                    {flowerPhase === "night_actions" && <Moon className="h-4 w-4 text-indigo-200" />}
                                                    {flowerPhase === "day_vote" && <Sun className="h-4 w-4 text-orange-500" />}
                                                </div>
                                            </div>
                                            <div>
                                                <div className={`text-xs ${mutedTextClass}`}>天数</div>
                                                <div className="font-bold text-xl">第 {flowerDayCount} 天</div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Game Over Buttons */}
                {flowerPhase === "game_over" && (
                    <div className="flex-none px-4 pb-2 z-10">
                        <div className="flex gap-3 justify-center">
                            {isHost && (
                                <Button
                                    variant="default"
                                    className="flex-1 max-w-[200px]"
                                    onClick={async () => {
                                        const confirmed = await confirm({
                                            title: "重新开始",
                                            description: "确定要重新开始游戏吗？聊天记录将会保留。"
                                        });
                                        if (!confirmed) return;
                                        resetGame();
                                        await broadcastSnapshot();
                                    }}
                                >
                                    <House className="h-4 w-4 mr-2" />
                                    重新开始
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                className={`flex-1 max-w-[200px] ${isNight ? "bg-transparent text-white border-white/50 hover:bg-white/20 hover:text-white" : ""}`}
                                onClick={leaveRoom}
                            >
                                <LogOut className="h-4 w-4 mr-2" />
                                离开房间
                            </Button>
                        </div>
                    </div>
                )}

                {/* Main Content Area with Dynamic Island Nav */}
                <div
                    className="flex-1 flex flex-col min-h-0 bg-transparent"
                    onClick={handleInteraction}
                    onTouchStart={handleInteraction}
                >
                    {flowerPhase !== "game_over" && roomCode && (
                        <MobileNavBar
                            tabs={availableTabs}
                            activeTab={activeTab}
                            onTabChange={setActiveTab}
                            isNight={isNight}
                        />
                    )}

                    <div className="flex-1 relative min-h-0 overflow-hidden">
                        {flowerPhase === "game_over" && gameResult ? (
                            <div className="h-full overflow-y-auto px-4 pb-20">
                                <div className={themeClass + " rounded-lg overflow-hidden"}>
                                    <Table>
                                        <TableHeader>
                                            <TableRow className={isNight ? "hover:bg-white/5 border-white/20" : "border-black/10"}>
                                                <TableHead className={`font-bold ${isNight ? "text-gray-300" : "text-gray-600"}`}>座位</TableHead>
                                                <TableHead className={`font-bold ${isNight ? "text-gray-300" : "text-gray-600"}`}>玩家</TableHead>
                                                <TableHead className={`font-bold ${isNight ? "text-gray-300" : "text-gray-600"}`}>角色</TableHead>
                                                <TableHead className={`font-bold ${isNight ? "text-gray-300" : "text-gray-600"}`}>阵营</TableHead>
                                                <TableHead className={`font-bold ${isNight ? "text-gray-300" : "text-gray-600"}`}>状态</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {flowerPlayers.map((p) => {
                                                const role = (p.role ?? "") as FlowerRole;
                                                const camp = GOOD_ROLE_SET.has(role) ? "好人" : BAD_ROLE_SET.has(role) ? "坏人" : "未知";
                                                return (
                                                    <TableRow key={`final-${p.seat}`} className={isNight ? "hover:bg-white/5 border-white/20" : "border-black/10"}>
                                                        <TableCell className="font-medium">{p.seat}</TableCell>
                                                        <TableCell>{p.name || `玩家${p.seat}`}</TableCell>
                                                        <TableCell>{p.role ? <span>{p.role}</span> : "未知"}</TableCell>
                                                        <TableCell className={camp === "好人" ? "text-green-700" : "text-red-700"}>
                                                            <div className={'flex items-center'}>
                                                                {camp === "好人" ? <ThumbsUp /> : <ThumbsDown />}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className={p.isAlive ? "text-red-700 " : "text-gray-400"}>
                                                            <div className={'flex items-center'}>
                                                                {p.isAlive ? <Heart /> : <HeartCrack />}
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        ) : (
                            <Carousel setApi={setApi} opts={{ watchDrag: true, loop: false, axis: "x" }} className="w-full h-full">
                                <CarouselContent className="h-full ml-0">
                                    {availableTabs.map((tab) => (
                                        <CarouselItem key={tab} className="h-full basis-full pl-0 overflow-hidden">
                                            <div className="h-full w-full pb-5">

                                                {tab === "players" && (
                                                    <div className="px-4 h-full flex flex-col gap-4">
                                                        {/* Room Actions Section */}
                                                        <div className="flex-none">
                                                            {!roomCode ? (
                                                                <div className="flex flex-col gap-4 mt-20 px-12">
                                                                    <Button onClick={createRoom} size="lg" className="w-full shadow-lg h-12 text-base">
                                                                        <House className="h-5 w-5 mr-2" />
                                                                        创建房间
                                                                    </Button>
                                                                    <Button variant="outline" onClick={joinRoom} size="lg" className={`w-full shadow-lg h-12 text-base ${isNight ? "bg-transparent text-white border-white/50 hover:bg-white/20 hover:text-white" : ""}`}>
                                                                        <UserPlus className="h-5 w-5 mr-2" />
                                                                        加入房间
                                                                    </Button>
                                                                </div>
                                                            ) : (
                                                                <div className="flex flex-wrap gap-2 items-center">
                                                                    {flowerPhase === "lobby" && (
                                                                        <>
                                                                            <Button
                                                                                variant={(me as any)?.ready ? "default" : "outline"}
                                                                                onClick={toggleReady}
                                                                                size="sm"
                                                                                className={isNight && !(me as any)?.ready ? "bg-transparent text-white border-white/50 hover:bg-white/20 hover:text-white" : ""}
                                                                            >
                                                                                {(me as any)?.ready ? "取消" : "准备"}
                                                                            </Button>
                                                                            {isHost && (
                                                                                <Button
                                                                                    onClick={startFirstNight}
                                                                                    disabled={occupiedSeats < 9 || !everyoneReady}
                                                                                    size="sm"
                                                                                >
                                                                                    <Swords className="h-4 w-4 mr-2" />
                                                                                    开始游戏
                                                                                </Button>
                                                                            )}
                                                                            {isHost && (
                                                                                <Button
                                                                                    variant="outline"
                                                                                    onClick={addBotPlaceholder}
                                                                                    disabled={!canAddBot}
                                                                                    size="sm"
                                                                                    className={isNight ? "bg-transparent text-white border-white/50 hover:bg-white/20 hover:text-white" : ""}
                                                                                >
                                                                                    <Bot className="h-4 w-4 mr-2" />
                                                                                    添加人机
                                                                                </Button>
                                                                            )}
                                                                        </>
                                                                    )}
                                                                    <Button
                                                                        variant="destructive"
                                                                        onClick={leaveRoom}
                                                                        size="sm"
                                                                    >
                                                                        <LogOut className="h-4 w-4 mr-2" />
                                                                        离开房间
                                                                    </Button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <ScrollArea className="space-y-2 min-h-0 flex-1 gap-4">
                                                            {flowerSnapshot
                                                                ? flowerPlayers.map((player: FlowerPlayerState) => {
                                                                    const isFake = isFakeBot(player.name);
                                                                    const displayName = player.name?.replace(/\u200B/g, "") || `座位${player.seat}`;
                                                                    const tags: string[] = [];
                                                                    const presenceInfo = player.sessionId ? presenceMap.get(player.sessionId) : undefined;
                                                                    if (player.isHost) tags.push("房主");
                                                                    if (player.sessionId === getSessionId()) tags.push("我");
                                                                    if (presenceInfo?.isDisconnected && !isFake) tags.push("暂离");
                                                                    if ((player.isReady || isFake) && flowerPhase === "lobby") tags.push("已准备");
                                                                    if (player.isBot || isFake) tags.push("BOT");

                                                                    const statusParts: string[] = [];
                                                                    statusParts.push(player.sessionId ? (player.isAlive ? "存活" : "死亡") : "空位");
                                                                    if (player.isMutedToday) statusParts.push("禁言");
                                                                    if (player.hasVotedToday && flowerPhase === "day_vote") statusParts.push("已投票");

                                                                    return (
                                                                        <Card key={`seat-${player.seat}`} className={themeClass}>
                                                                            <CardContent className="p-4">
                                                                                <div className="flex items-center gap-3">
                                                                                    {/* Avatar */}
                                                                                    {player.sessionId || player.isBot ? (
                                                                                        <div className="relative">
                                                                                            <div className={presenceInfo?.isDisconnected && !isFake ? "opacity-50 grayscale" : ""}>
                                                                                                <Avvvatars
                                                                                                    value={displayName}
                                                                                                    size={48}
                                                                                                    style="shape"
                                                                                                />
                                                                                            </div>
                                                                                            {presenceInfo?.isDisconnected && !isFake && (
                                                                                                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center border-2 border-white">
                                                                                                    <CircleAlert className="h-3 w-3 text-white" />
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div
                                                                                            className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                                                                                            <User
                                                                                                className="h-6 w-6 text-muted-foreground" />
                                                                                        </div>
                                                                                    )}

                                                                                    {/* Player Info */}
                                                                                    <div className="flex-1">
                                                                                        <div className={`font-medium ${isNight ? "text-white" : ""}`}>
                                                                                            {player.sessionId ? displayName : `座位${player.seat}`}
                                                                                        </div>
                                                                                        <div className={`text-xs ${mutedTextClass}`}>#{player.seat}</div>
                                                                                        {statusParts.length > 0 && (
                                                                                            <div className={`text-xs ${mutedTextClass} mt-1`}>
                                                                                                {statusParts.join(" · ")}
                                                                                            </div>
                                                                                        )}
                                                                                    </div>

                                                                                    {/* Tags and Actions */}
                                                                                    <div className="flex flex-col items-end gap-2">
                                                                                        {tags.length > 0 && (
                                                                                            <div className="flex flex-wrap gap-1 justify-end">
                                                                                                {player.isHost && (
                                                                                                    <Badge variant="default" className={`gap-1 ${isNight ? "bg-white text-black hover:bg-white/90" : ""}`}>
                                                                                                        <Crown className="h-3 w-3" />
                                                                                                        房主
                                                                                                    </Badge>
                                                                                                )}
                                                                                                {player.sessionId === getSessionId() && (
                                                                                                    <Badge variant="secondary" className={isNight ? "bg-white/20 text-white border-white/30" : ""}>
                                                                                                        我
                                                                                                    </Badge>
                                                                                                )}
                                                                                                {(player.isBot || isFake) && (
                                                                                                    <Badge variant="outline" className={`gap-1 ${isNight ? "text-white border-white/50" : "border-black/50"}`}>
                                                                                                        <Bot className="h-3 w-3" />
                                                                                                        BOT
                                                                                                    </Badge>
                                                                                                )}
                                                                                                {(player.isReady || isFake) && flowerPhase === "lobby" && (
                                                                                                    <Badge variant="outline" className={isNight ? "text-white border-white/50" : "border-black/50"}>
                                                                                                        已准备
                                                                                                    </Badge>
                                                                                                )}
                                                                                            </div>
                                                                                        )}
                                                                                        {isHost && player.sessionId && player.sessionId !== getSessionId() && (
                                                                                            <div className="flex gap-1">
                                                                                                {!player.isBot && !isFake && (
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
                                                                                                    {player.isBot || isFake ? "移除" : "踢出"}
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
                                                                    const isFake = isFakeBot(u.name);
                                                                    const displayName = u.name?.replace(/\u200B/g, "") || "未命名";
                                                                    const tags: string[] = [];
                                                                    if (u.isHost) tags.push("房主");
                                                                    if (u.sessionId === getSessionId()) tags.push("我");
                                                                    if (u.isDisconnected && !isFake) tags.push("暂离");
                                                                    if (u.ready || isFake) tags.push("已准备");
                                                                    if (u.isBot || isFake) tags.push("BOT");
                                                                    return (
                                                                        <Card key={u.sessionId} className={themeClass}>
                                                                            <CardContent className="p-4">
                                                                                <div className="flex items-center gap-3">
                                                                                    <div className={`relative ${u.isDisconnected && !isFake ? "opacity-50 grayscale" : ""}`}>
                                                                                        <Avvvatars
                                                                                            value={displayName}
                                                                                            size={48}
                                                                                            style="shape"
                                                                                        />
                                                                                        {u.isDisconnected && !isFake && (
                                                                                            <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center border-2 border-white">
                                                                                                <CircleAlert className="h-3 w-3 text-white" />
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                    <div className="flex-1">
                                                                                        <div
                                                                                            className="font-medium">{displayName}</div>
                                                                                        <div
                                                                                            className="text-xs text-muted-foreground">座位 {u.seat}</div>
                                                                                    </div>
                                                                                    <div className="flex flex-col items-end gap-2">
                                                                                        {tags.length > 0 && (
                                                                                            <div className="flex flex-wrap gap-1">
                                                                                                {u.isHost && (
                                                                                                    <Badge variant="default"
                                                                                                        className="gap-1">
                                                                                                        <Crown className="h-3 w-3" />
                                                                                                        房主
                                                                                                    </Badge>
                                                                                                )}
                                                                                                {u.sessionId === getSessionId() && (
                                                                                                    <Badge variant="secondary">我</Badge>
                                                                                                )}
                                                                                                {(u.isBot || isFake) && (
                                                                                                    <Badge variant="outline"
                                                                                                        className="gap-1">
                                                                                                        <Bot className="h-3 w-3" />
                                                                                                        BOT
                                                                                                    </Badge>
                                                                                                )}
                                                                                                {(u.ready || isFake) && (
                                                                                                    <Badge variant="outline">已准备</Badge>
                                                                                                )}
                                                                                            </div>
                                                                                        )}
                                                                                        {isHost && u.sessionId !== getSessionId() && (
                                                                                            <div className="flex gap-1">
                                                                                                {!u.isBot && !isFake && (
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
                                                                                                    {u.isBot || isFake ? "移除" : "踢出"}
                                                                                                </Button>
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            </CardContent>
                                                                        </Card>
                                                                    );
                                                                })}
                                                            {roomCode && !flowerSnapshot && users.length === 0 && (
                                                                <p className="text-sm text-black/50 text-center py-8">
                                                                    （当前无玩家，创建/加入房间后会出现）
                                                                </p>
                                                            )}
                                                        </ScrollArea>
                                                    </div>
                                                )}

                                                {tab === "chat" && (
                                                    <div className="h-full px-4">
                                                        <ChatPanel
                                                            key={roomCode}
                                                            messages={flowerSnapshot?.chatMessages || []}
                                                            players={flowerPlayers}
                                                            onSendMessage={addChatMessage}
                                                            mySessionId={getSessionId()}
                                                            isNight={isNight}
                                                        />
                                                    </div>
                                                )}

                                                {tab === "actions" && (
                                                    <div className="space-y-4 px-4">
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
                                                                                    className={`w-full justify-start ${isNight ? "bg-transparent text-white border-white/50 hover:bg-white/20 hover:text-white" : ""}`}
                                                                                    onClick={() => setNightActionDrawerOpen(true)}
                                                                                >
                                                                                    {nightActionSelections[myRole] ? `已选择：座位 ${nightActionSelections[myRole]}` : "选择行动目标"}
                                                                                </Button>
                                                                            </>
                                                                        )}

                                                                        {isHost && (
                                                                            <Button
                                                                                variant="outline"
                                                                                className={`w-full ${isNight ? "bg-transparent text-white border-white/50 hover:bg-white/20 hover:text-white" : ""}`}
                                                                                onClick={handleResolveNight}
                                                                                disabled={flowerPhase !== "night_actions"}
                                                                            >
                                                                                结算夜晚
                                                                            </Button>
                                                                        )}
                                                                    </div>
                                                                ) : flowerPhase === "day_vote" ? (
                                                                    <Card className={themeClass}>
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
                                                            <div className={`p-3 border rounded space-y-2 ${isNight ? "border-white/20" : ""}`}>
                                                                <div className={`font-medium ${isNight ? "text-white" : ""}`}>白天结算</div>
                                                                <div className={`text-sm ${mutedTextClass}`}>
                                                                    处决：{latestDaySummary.executionText || "无人被处决"}
                                                                </div>
                                                                {latestDaySummary.votesText && (
                                                                    <div className={`text-sm ${mutedTextClass}`}>
                                                                        票型：{latestDaySummary.votesText}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}

                                                        {showNightSummary && flowerSnapshot?.night?.result && (
                                                            <div className={`p-3 border rounded space-y-2 ${isNight ? "border-white/20" : ""}`}>
                                                                <div className={`font-medium ${isNight ? "text-white" : ""}`}>夜晚结算</div>
                                                                <div className={`text-sm ${mutedTextClass}`}>
                                                                    死亡：
                                                                    {flowerSnapshot.night.result.deaths.length === 0
                                                                        ? " 无"
                                                                        : flowerSnapshot.night.result.deaths
                                                                            .map(d => `座位 ${d.seat}`)
                                                                            .join("、")}
                                                                </div>
                                                                <div className={`text-sm ${mutedTextClass}`}>
                                                                    禁言：
                                                                    {flowerSnapshot.night.result.mutedSeats.length === 0
                                                                        ? " 无"
                                                                        : flowerSnapshot.night.result.mutedSeats.map(seat => `座位 ${seat}`).join("、")}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </CarouselItem>
                                    ))}
                                </CarouselContent>
                            </Carousel>
                        )}
                    </div>

                    {/* Dialog Components */}
                    <ConfirmDialogComponent />
                    <AlertDialogComponent />
                    <JoinRoomDialogComponent />
                    <AddBotDialogComponent />
                    <EditNameDialogComponent />

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
                        isNight={isNight}
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
                        isNight={false}
                    />
                </div>
            </div>
        </div>
    );
}
