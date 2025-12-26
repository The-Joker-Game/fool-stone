// src/JokerRoom.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { rt, getSessionId, type PresenceState } from "./realtime/socket";
import type {
    JokerPlayerState,
    JokerLocation,
    JokerPhase,
    JokerSnapshot,
} from "./joker/types";
import { useJokerStore } from "./joker/store";
import type { JokerStore } from "./joker/store";
import { MiniGame, getRandomGame, type MiniGameType } from "./joker/mini-games";
import { GiKitchenKnives, GiMedicalPack, GiElectric, GiCctvCamera, GiCardboardBox } from "react-icons/gi";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
    Users,
    LogOut,
    Crown,
    Bot,
    Play,
    MapPin,
    Skull,
    AlertTriangle,
    Vote,
    RotateCcw,
    Zap,
    Wind,
    Fingerprint,
    Target,
    MessageCircle,
    Hand,
    CheckCircle2,
    Circle,
    Siren,
    UserX,
    DoorOpen,
    SkipForward,
    ClipboardList,
    Pause,
    Play as PlayIcon,
    BookOpen,
} from "lucide-react";
import Avvvatars from "avvvatars-react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";

// Utility
function randName() {
    const a = Math.random().toString(36).slice(2, 4);
    const b = Math.random().toString(36).slice(2, 4);
    return `Player-${a}${b}`;
}

const PHASE_LABELS: Record<JokerPhase, string> = {
    lobby: "等待大厅",
    role_reveal: "身份揭晓",
    green_light: "绿灯",
    yellow_light: "黄灯",
    red_light: "红灯",
    meeting: "会议",
    voting: "投票",
    execution: "处决",
    game_over: "游戏结束",
};

// Location icons mapping
const LOCATION_ICONS: Record<JokerLocation, React.ElementType> = {
    "厨房": GiKitchenKnives,
    "医务室": GiMedicalPack,
    "发电室": GiElectric,
    "监控室": GiCctvCamera,
    "仓库": GiCardboardBox,
};

const PHASE_GRADIENTS: Record<JokerPhase, string> = {
    lobby: "from-slate-900 to-slate-800",
    role_reveal: "from-indigo-900 to-slate-900",
    green_light: "from-emerald-900 to-slate-900",
    yellow_light: "from-yellow-900 to-slate-900",
    red_light: "from-red-900 to-slate-900",
    meeting: "from-blue-900 to-slate-900",
    voting: "from-violet-900 to-slate-900",
    execution: "from-orange-950 to-slate-900",
    game_over: "from-gray-900 to-black",
};

// Animation Variants - optimized for performance
const pageVariants = {
    initial: { opacity: 0 },
    in: { opacity: 1 },
    out: { opacity: 0 }
};

const cardVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 }
};

const DIGIT_SEGMENT_LAYOUT: Array<{ top?: string; bottom?: string; left?: string; right?: string; width: string; height: string }> = [
    { top: "0%", left: "15%", width: "70%", height: "8%" }, // top
    { top: "6%", right: "0%", width: "10%", height: "42%" }, // top-right
    { bottom: "6%", right: "0%", width: "10%", height: "42%" }, // bottom-right
    { bottom: "0%", left: "15%", width: "70%", height: "8%" }, // bottom
    { bottom: "6%", left: "0%", width: "10%", height: "42%" }, // bottom-left
    { top: "6%", left: "0%", width: "10%", height: "42%" }, // top-left
    { top: "46%", left: "15%", width: "70%", height: "8%" }, // middle
];
const DIGIT_BUTTONS = Array.from({ length: 10 }, (_, idx) => idx);

const NINE_GRID_ICON_SVGS: Array<(props: { className?: string }) => ReactElement> = [
    ({ className }) => (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="7" />
        </svg>
    ),
    ({ className }) => (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="5" width="14" height="14" rx="2" />
        </svg>
    ),
    ({ className }) => (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 4 20 20 4 20" />
        </svg>
    ),
    ({ className }) => (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 3 21 12 12 21 3 12" />
        </svg>
    ),
    ({ className }) => (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l2.7 6.6 7.3.6-5.6 4.8 1.7 7-6.1-3.7-6.1 3.7 1.7-7-5.6-4.8 7.3-.6z" />
        </svg>
    ),
    ({ className }) => (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="7 3 17 3 22 12 17 21 7 21 2 12" />
        </svg>
    ),
    ({ className }) => (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 3 21 10 17 21 7 21 3 10" />
        </svg>
    ),
    ({ className }) => (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
        </svg>
    ),
    ({ className }) => (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M18 6l-12 12" />
        </svg>
    ),
];

function getNineGridIconIndex(token: string): number | null {
    const numeric = Number(token);
    if (!Number.isNaN(numeric) && numeric >= 0 && numeric < NINE_GRID_ICON_SVGS.length) {
        return numeric;
    }
    const upper = token.trim().toUpperCase();
    if (upper.length === 1) {
        const code = upper.charCodeAt(0);
        const offset = code - 65;
        if (offset >= 0 && offset < NINE_GRID_ICON_SVGS.length) {
            return offset;
        }
    }
    return null;
}

function renderNineGridIcon(token: string): ReactElement {
    const idx = getNineGridIconIndex(token);
    if (idx === null) return <span className="text-sm">{token}</span>;
    const Icon = NINE_GRID_ICON_SVGS[idx];
    return <Icon className="w-6 h-6" />;
}

function renderDigitSegments(segmentsOn: number[]): ReactElement {
    const active = new Set(segmentsOn);
    return (
        <div className="relative w-24 h-40 mx-auto">
            {DIGIT_SEGMENT_LAYOUT.map((style, idx) => (
                <div
                    key={idx}
                    className={`absolute rounded-full ${active.has(idx)
                        ? "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.7)]"
                        : "bg-white/10"
                        }`}
                    style={style}
                />
            ))}
        </div>
    );
}

export default function JokerRoom() {
    const [connected, setConnected] = useState(false);
    const [roomCode, setRoomCode] = useState<string | null>(null);
    const [isHost, setIsHost] = useState(false);
    const [presence, setPresence] = useState<PresenceState | null>(null);
    const [showRules, setShowRules] = useState(false);
    const [name, setName] = useState<string>(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("name");
            if (saved && saved.trim().length > 0) return saved.trim();
        }
        return randName();
    });
    const autoJoinAttempted = useRef(false);

    // —— 屏幕常亮功能 —— //
    useEffect(() => {
        let wakeLock: WakeLockSentinel | null = null;

        const requestWakeLock = async () => {
            try {
                // 检查浏览器是否支持 Screen Wake Lock API
                if ('wakeLock' in navigator) {
                    wakeLock = await navigator.wakeLock.request('screen');
                    console.log('Screen Wake Lock is active');

                    // 监听页面可见性变化，当页面变为可见时重新请求唤醒锁
                    const handleVisibilityChange = () => {
                        if (wakeLock !== null && document.visibilityState === 'visible') {
                            requestWakeLock();
                        }
                    };

                    document.addEventListener('visibilitychange', handleVisibilityChange);

                    // 当唤醒锁释放时记录日志
                    wakeLock.addEventListener('release', () => {
                        console.log('Screen Wake Lock was released');
                    });
                } else {
                    console.warn('Screen Wake Lock API is not supported in this browser');
                }
            } catch (err) {
                console.error('Failed to acquire screen wake lock:', err);
            }
        };

        // 请求屏幕常亮
        requestWakeLock();

        // 组件卸载时释放唤醒锁
        return () => {
            if (wakeLock !== null) {
                wakeLock.release();
                wakeLock = null;
            }
        };
    }, []);

    // Life code input state
    const [lifeCodeInput, setLifeCodeInput] = useState("");
    const [cooldownSeconds, setCooldownSeconds] = useState(0);
    const actionCooldown = cooldownSeconds > 0;

    // Mini-game state
    const [showMiniGame, setShowMiniGame] = useState(false);
    const [currentGameType, setCurrentGameType] = useState<MiniGameType | null>(null);

    // Join room input
    const [joinCodeInput, setJoinCodeInput] = useState("");

    // Store
    const jokerSnapshot = useJokerStore((state: JokerStore) => state.snapshot);
    const setJokerSnapshot = useJokerStore((state: JokerStore) => state.setSnapshot);
    const ensureSnapshotFromPresence = useJokerStore((state: JokerStore) => state.ensureSnapshotFromPresence);
    const startGame = useJokerStore((state: JokerStore) => state.startGame);
    const selectLocation = useJokerStore((state: JokerStore) => state.selectLocation);
    const submitAction = useJokerStore((state: JokerStore) => state.submitAction);
    const report = useJokerStore((state: JokerStore) => state.report);
    const vote = useJokerStore((state: JokerStore) => state.vote);
    const resetGame = useJokerStore((state: JokerStore) => state.resetGame);

    const users = presence?.users ?? [];
    const jokerPlayers: JokerPlayerState[] = jokerSnapshot?.players ?? [];
    const phase = jokerSnapshot?.phase ?? "lobby";
    const me = useMemo(
        () => jokerPlayers.find(p => p.sessionId === getSessionId()) ?? null,
        [jokerPlayers]
    );
    const myAlive = me?.isAlive ?? false;
    const isPaused = jokerSnapshot?.paused ?? false;
    const isInteractionDisabled = isPaused;
    const sharedTask = me?.location ? jokerSnapshot?.tasks?.sharedByLocation?.[me.location] : undefined;
    const mySessionId = getSessionId();
    const isSharedParticipant = !!sharedTask?.participants?.includes(mySessionId);
    const mySharedSelection = sharedTask?.selections?.[mySessionId];
    const mySharedGrid = sharedTask?.gridBySession?.[mySessionId] ?? [];
    const myDigitSegments = sharedTask?.digitSegmentsBySession?.[mySessionId] ?? [];
    const myDigitSelection = sharedTask?.digitSelections?.[mySessionId];
    const [sharedTimeLeft, setSharedTimeLeft] = useState(0);
    const [sharedResultFlash, setSharedResultFlash] = useState<null | { result: "success" | "fail"; until: number }>(null);
    const lastSharedResolvedAtRef = useRef<number | null>(null);
    const sameLocationCount = useMemo(() => {
        if (!me?.location) return 0;
        return jokerPlayers.filter(p => p.isAlive && p.location === me.location).length;
    }, [jokerPlayers, me?.location]);
    const myVoteLabel = useMemo(() => {
        if (!me?.hasVoted) return null;
        if (me.voteTarget === null) return "弃票";
        const target = jokerPlayers.find(p => p.sessionId === me.voteTarget);
        if (!target) return "未知";
        return `${target.name || `玩家${target.seat}`}（${target.seat}）`;
    }, [me?.hasVoted, me?.voteTarget, jokerPlayers]);

    // Auto-close mini-game when phase changes away from red_light
    useEffect(() => {
        if (phase !== "red_light") {
            setShowMiniGame(false);
            setCurrentGameType(null);
        }
    }, [phase]);

    // Timer
    const [timeLeft, setTimeLeft] = useState(0);

    useEffect(() => {
        if (cooldownSeconds <= 0) return;
        const interval = setInterval(() => {
            setCooldownSeconds(prev => Math.max(0, prev - 1));
        }, 1000);
        return () => clearInterval(interval);
    }, [cooldownSeconds]);

    useEffect(() => {
        if (jokerSnapshot?.paused && typeof jokerSnapshot?.pauseRemainingMs === "number") {
            setTimeLeft(Math.max(0, Math.ceil(jokerSnapshot.pauseRemainingMs / 1000)));
            return;
        }
        const deadline = jokerSnapshot?.deadline;
        if (!deadline) {
            setTimeLeft(0);
            return;
        }

        const tick = () => {
            const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            setTimeLeft(remaining);
        };
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [jokerSnapshot?.deadline, jokerSnapshot?.paused, jokerSnapshot?.pauseRemainingMs]);

    // Local oxygen display (interpolates between server updates)
    const [displayOxygen, setDisplayOxygen] = useState(me?.oxygen ?? 270);
    const lastServerOxygenRef = useRef(me?.oxygen ?? 270);
    const lastServerOxygenTimeRef = useRef(me?.oxygenUpdatedAt ?? Date.now());

    // Update references when server sends new oxygen value
    useEffect(() => {
        if (me?.oxygen !== undefined && me?.oxygenUpdatedAt !== undefined) {
            lastServerOxygenRef.current = me.oxygen;
            lastServerOxygenTimeRef.current = me.oxygenUpdatedAt;
            if (!isPaused) {
                setDisplayOxygen(me.oxygen);
            }
        }
    }, [me?.oxygen, me?.oxygenUpdatedAt, isPaused]);

    useEffect(() => {
        if (displayOxygen === undefined) return;
        if (isPaused) {
            lastServerOxygenRef.current = displayOxygen;
            lastServerOxygenTimeRef.current = Date.now();
        } else {
            lastServerOxygenRef.current = displayOxygen;
            lastServerOxygenTimeRef.current = Date.now();
        }
    }, [isPaused, displayOxygen]);

    // Local oxygen tick during active phases
    useEffect(() => {
        const isActivePhase = ["green_light", "yellow_light", "red_light"].includes(phase);
        if (!isActivePhase || !myAlive) {
            // Non-active phase: just show server value directly
            if (me?.oxygen !== undefined) {
                setDisplayOxygen(me.oxygen);
            }
            return;
        }

        if (isPaused) {
            return;
        }

        const interval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - lastServerOxygenTimeRef.current) / 1000);
            const interpolatedOxygen = Math.max(0, lastServerOxygenRef.current - elapsed);
            setDisplayOxygen(interpolatedOxygen);
        }, 1000);

        return () => clearInterval(interval);
    }, [phase, myAlive, me?.oxygen, isPaused]);

    // Watermark randomization with responsive grid
    const WATERMARK_ROWS = 3;
    const [watermarkCols, setWatermarkCols] = useState(() => {
        if (typeof window !== 'undefined') {
            return window.innerWidth < 500 ? 2 : 3;
        }
        return 2;
    });
    const [watermarkIndices, setWatermarkIndices] = useState<string[]>(() => {
        // Initialize with 5 random positions immediately
        const cols = typeof window !== 'undefined' && window.innerWidth >= 500 ? 3 : 2;
        const indices = new Set<string>();
        const totalPositions = WATERMARK_ROWS * cols;
        const count = Math.min(5, totalPositions);
        while (indices.size < count) {
            const r = Math.floor(Math.random() * WATERMARK_ROWS);
            const c = Math.floor(Math.random() * cols);
            indices.add(`${r}-${c}`);
        }
        return Array.from(indices);
    });

    useEffect(() => {
        const handleResize = () => {
            const newCols = window.innerWidth < 500 ? 2 : 3;
            setWatermarkCols(newCols);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (phase !== "red_light") {
            return;
        }

        const tick = () => {
            const indices = new Set<string>();
            const totalPositions = WATERMARK_ROWS * watermarkCols;
            const count = Math.min(5, totalPositions);
            while (indices.size < count) {
                const r = Math.floor(Math.random() * WATERMARK_ROWS);
                const c = Math.floor(Math.random() * watermarkCols);
                indices.add(`${r}-${c}`);
            }
            setWatermarkIndices(Array.from(indices));
        };

        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [phase, watermarkCols]);

    // Socket initialization
    useEffect(() => {
        rt.getSocket();

        const offConn = rt.onConnection(ok => setConnected(ok));

        const offPresence = rt.subscribePresence(p => {
            setPresence(p);
            if (p?.roomCode) setRoomCode(p.roomCode);
            const meUser = p?.users.find(u => u.sessionId === getSessionId());
            setIsHost(!!meUser?.isHost);
            ensureSnapshotFromPresence(p ?? null);
        });

        const offState = rt.subscribeState(msg => {
            try {
                const snap = msg?.snapshot as unknown;
                if (snap && typeof snap === "object" && (snap as Record<string, unknown>).engine === "joker") {
                    setJokerSnapshot(snap as JokerSnapshot);
                    // Sync names from presence after snapshot update
                    const currentPresence = rt.getPresence();
                    if (currentPresence) {
                        ensureSnapshotFromPresence(currentPresence);
                    }
                }
            } catch (e) {
                console.warn("read snapshot failed:", e);
            }
        });

        return () => {
            offConn?.();
            offPresence?.();
            offState?.();
        };
    }, [ensureSnapshotFromPresence, setJokerSnapshot]);

    // Auto-rejoin on refresh
    useEffect(() => {
        if (roomCode || autoJoinAttempted.current || !connected) return;
        const savedCode = (localStorage.getItem("joker_lastRoomCode") || "").trim();
        if (!savedCode) return;
        autoJoinAttempted.current = true;

        (async () => {
            try {
                const resp = await rt.emitAck("room:join", {
                    code: savedCode,
                    name,
                    sessionId: getSessionId(),
                }, 3000);
                if ((resp as any)?.ok) {
                    setRoomCode(savedCode);
                    setIsHost(!!(resp as any).me?.isHost);
                    // Request joker snapshot
                    await rt.emitAck("intent", {
                        room: savedCode,
                        action: "joker:create_room",
                        from: getSessionId(),
                    }, 3000);
                }
            } catch (err) {
                console.warn("auto join failed", err);
            }
        })();
    }, [roomCode, connected, name]);

    // Room actions
    const createRoom = useCallback(async () => {
        try {
            const nick = name?.trim() || randName();
            const resp = await rt.createFlowerRoom(nick);
            if (resp?.ok && resp.code) {
                setRoomCode(resp.code);
                setIsHost(true);
                localStorage.setItem("name", nick);
                localStorage.setItem("joker_lastRoomCode", resp.code);
                // Initialize joker snapshot
                await rt.emitAck("intent", {
                    room: resp.code,
                    action: "joker:create_room",
                    from: getSessionId(),
                }, 3000);
            }
        } catch (e) {
            console.error(e);
        }
    }, [name]);

    const joinRoom = useCallback(async () => {
        if (!joinCodeInput.trim()) return;
        try {
            const nick = name?.trim() || randName();
            const resp = await rt.joinFlowerRoom(joinCodeInput.trim(), nick);
            if (resp?.ok) {
                setRoomCode(joinCodeInput.trim());
                setIsHost(false);
                localStorage.setItem("name", nick);
                localStorage.setItem("joker_lastRoomCode", joinCodeInput.trim());
            } else {
                await alert(resp?.msg || "游戏已经开始，无法加入");
            }
        } catch (e) {
            console.error(e);
        }
    }, [name, joinCodeInput]);

    const leaveRoom = useCallback(async () => {
        if (!roomCode) return;
        try {
            await rt.emitAck("room:leave", { code: roomCode, sessionId: getSessionId() }, 2000);
        } catch {
            // ignore
        }
        localStorage.removeItem("joker_lastRoomCode");
        setRoomCode(null);
        setPresence(null);
        setJokerSnapshot(null);
        autoJoinAttempted.current = false;
    }, [roomCode, setJokerSnapshot]);

    const toggleReady = useCallback(async () => {
        if (!roomCode) return;
        const meUser = users.find(u => u.sessionId === getSessionId());
        const target = !meUser?.ready;
        await rt.emitAck("room:ready", {
            code: roomCode,
            sessionId: getSessionId(),
            ready: target,
        }, 3000);
    }, [roomCode, users]);

    const handleStartGame = useCallback(async () => {
        const res = await startGame();
        if (!res.ok) {
            const msg =
                res.error === "Need at least 5 players to start"
                    ? "至少需要5位玩家才能开始游戏！"
                    : res.error === "All players must be ready to start"
                        ? "所有玩家准备后才能开始游戏！"
                        : res.error === "Only host can start game"
                            ? "只有房主可以开始游戏"
                            : res.error === "Game paused"
                                ? "游戏已暂停"
                                : res.error === "No snapshot"
                                    ? "暂无游戏快照"
                                    : "开始游戏失败";
            await alert(msg);
        }
    }, [startGame]);

    const handleSelectLocation = useCallback(async (loc: JokerLocation) => {
        await selectLocation(loc);
    }, [selectLocation]);

    const handleSubmitAction = useCallback(async (action: "kill" | "oxygen") => {
        if (lifeCodeInput.length !== 2 || actionCooldown || isInteractionDisabled) return;
        setCooldownSeconds(10);
        const res = await submitAction(lifeCodeInput, action);
        if (!res.ok) {
            const msg =
                res.error === "Invalid life code" || res.error === "No player with this code"
                    ? "无效代码"
                    : res.error === "Not in same location"
                        ? "该玩家与你不在同一场所"
                        : res.error === "Cannot give oxygen to yourself"
                            ? "不能给自己补氧"
                            : res.error === "Already gave oxygen to this player this round"
                                ? "本回合已对该玩家补氧"
                            : res.error === "Actions only available during red light"
                                ? "只能在红灯阶段操作"
                            : res.error === "Invalid actor"
                                ? "操作无效"
                            : res.error === "Unknown action"
                                ? "未知操作"
                            : res.error === "foul_death" || res.error === "foul"
                                ? "犯规死亡"
                            : res.error === "Game paused"
                                ? "游戏已暂停"
                            : res.error === "No snapshot"
                                ? "暂无游戏快照"
                            : res.error === "Player not found"
                                ? "未找到玩家"
                            : "操作失败";
            await alert(msg);
        }
        setLifeCodeInput("");
    }, [lifeCodeInput, actionCooldown, isInteractionDisabled, submitAction]);

    const handleVote = useCallback(async (targetSessionId: string | null) => {
        if (isInteractionDisabled) return;
        await vote(targetSessionId);
    }, [vote, isInteractionDisabled]);

    const handleReport = useCallback(async () => {
        if (isInteractionDisabled) return;
        await report();
    }, [report, isInteractionDisabled]);

    const handleMeetingStartVote = useCallback(async () => {
        if (!roomCode || isInteractionDisabled) return;
        await rt.emitAck("intent", { room: roomCode, action: "joker:meeting_start_vote" });
    }, [roomCode, isInteractionDisabled]);

    const handleMeetingExtend = useCallback(async () => {
        if (!roomCode || isInteractionDisabled) return;
        await rt.emitAck("intent", { room: roomCode, action: "joker:meeting_extend" });
    }, [roomCode, isInteractionDisabled]);

    const handleTogglePause = useCallback(async () => {
        if (!roomCode) return;
        await rt.emitAck("intent", { room: roomCode, action: "joker:toggle_pause" });
    }, [roomCode]);

    const handleVotingExtend = useCallback(async () => {
        if (!roomCode || isInteractionDisabled) return;
        await rt.emitAck("intent", { room: roomCode, action: "joker:voting_extend" });
    }, [roomCode, isInteractionDisabled]);

    const handleResetGame = useCallback(async () => {
        await resetGame();
    }, [resetGame]);

    // Task handlers
    const handleStartTask = useCallback(async () => {
        if (!roomCode || isInteractionDisabled) return;
        const result = await rt.emitAck("intent", { room: roomCode, action: "joker:start_task" });
        if ((result as any)?.ok) {
            setCurrentGameType(getRandomGame());
            setShowMiniGame(true);
        }
    }, [roomCode, isInteractionDisabled]);

    const handleJoinSharedTask = useCallback(async () => {
        if (!roomCode || isInteractionDisabled) return;
        const types: Array<"nine_grid" | "digit_puzzle"> = ["nine_grid", "digit_puzzle"];
        const type = types[Math.floor(Math.random() * types.length)];
        const resp = await rt.emitAck("intent", {
            room: roomCode,
            action: "joker:shared_task_join",
            data: { type },
        });
        if (!(resp as any)?.ok) {
            const err = (resp as any)?.msg;
            const msg =
                err === "Shared tasks only available during red light"
                    ? "只能在红灯阶段发起共同任务"
                    : err === "Player has no location"
                        ? "当前没有分配位置"
                        : err === "Shared task already active in another location"
                            ? "其他地点正在进行共同任务"
                            : err === "Not enough players for shared task"
                                ? "同场所至少需要2人才能进行共同任务"
                                : err === "Game paused"
                                    ? "游戏已暂停"
                                    : "无法发起共同任务";
            await alert(msg);
        }
    }, [roomCode, isInteractionDisabled]);

    const handleSharedTaskSubmit = useCallback(async (index: number) => {
        if (!roomCode || isInteractionDisabled) return;
        await rt.emitAck("intent", {
            room: roomCode,
            action: "joker:shared_task_submit",
            data: { index },
        });
    }, [roomCode, isInteractionDisabled]);

    useEffect(() => {
        if (!sharedTask?.deadlineAt || sharedTask.status !== "active") {
            setSharedTimeLeft(0);
            return;
        }
        const tick = () => {
            const remaining = Math.max(0, Math.ceil((sharedTask.deadlineAt! - Date.now()) / 1000));
            setSharedTimeLeft(remaining);
        };
        tick();
        const interval = setInterval(tick, 500);
        return () => clearInterval(interval);
    }, [sharedTask?.deadlineAt, sharedTask?.status]);

    useEffect(() => {
        if (sharedTask?.status !== "resolved" || !sharedTask.result || !sharedTask.resolvedAt) return;
        if (lastSharedResolvedAtRef.current === sharedTask.resolvedAt) return;
        lastSharedResolvedAtRef.current = sharedTask.resolvedAt;
        setSharedResultFlash({ result: sharedTask.result, until: Date.now() + 2000 });
    }, [sharedTask?.status, sharedTask?.result, sharedTask?.resolvedAt]);

    useEffect(() => {
        if (!sharedResultFlash) return;
        const delay = Math.max(0, sharedResultFlash.until - Date.now());
        const timer = setTimeout(() => setSharedResultFlash(null), delay);
        return () => clearTimeout(timer);
    }, [sharedResultFlash?.until]);

    const handleCompleteTask = useCallback(async () => {
        if (!roomCode) return;
        setShowMiniGame(false);
        setCurrentGameType(null);
        await rt.emitAck("intent", { room: roomCode, action: "joker:complete_task" });
    }, [roomCode]);

    const handleCloseTask = useCallback(() => {
        setShowMiniGame(false);
        setCurrentGameType(null);
    }, []);

    // Render: No room
    if (!roomCode) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900 flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full max-w-md"
                >
                    <Card className="bg-black/40 backdrop-blur-md border-white/10 text-white shadow-2xl">
                        <CardHeader className="text-center pb-2">
                            <div className="mx-auto w-16 h-16 bg-gradient-to-tr from-yellow-400 to-orange-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-orange-500/20">
                                <Crown className="w-8 h-8 text-white" />
                            </div>
                            <CardTitle className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
                                鹅鸭杀
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-white/50 uppercase tracking-wider">你的身份</label>
                                    <div className="relative">
                                        <Input
                                            placeholder="输入昵称..."
                                            value={name}
                                            onChange={e => setName(e.target.value)}
                                            className="bg-white/5 border-white/10 h-12 text-lg focus-visible:ring-orange-500/50 focus-visible:border-orange-500/50 pl-11"
                                        />
                                        <div className="absolute left-3 top-3">
                                            <Avvvatars value={name} size={24} />
                                        </div>
                                    </div>
                                </div>

                                <Button onClick={createRoom} className="w-full h-12 text-lg font-medium bg-gradient-to-r from-orange-500 to-pink-600 hover:from-orange-600 hover:to-pink-700 shadow-lg shadow-orange-900/20 border-0">
                                    <DoorOpen className="w-5 h-5 mr-2" />
                                    创建新房间
                                </Button>

                                <div className="flex items-center gap-3">
                                    <span className="flex-1 border-t border-white/10" />
                                    <span className="text-xs uppercase text-white/30">或加入已有房间</span>
                                    <span className="flex-1 border-t border-white/10" />
                                </div>

                                <div className="flex gap-3">
                                    <Input
                                        placeholder="房间代码"
                                        value={joinCodeInput}
                                        onChange={e => setJoinCodeInput(e.target.value.toUpperCase())}
                                        className="bg-white/5 border-white/10 h-12 text-lg font-mono tracking-widest text-center uppercase focus-visible:ring-blue-500/50 focus-visible:border-blue-500/50"
                                        maxLength={4}
                                    />
                                    <Button onClick={joinRoom} variant="secondary" className="h-12 px-8 bg-white/10 hover:bg-white/20 text-white border-0">
                                        加入
                                    </Button>
                                </div>
                            </div>
                            <p className="text-center text-xs text-white/30 flex items-center justify-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`} />
                                {connected ? "服务器已连接" : "连接中..."}
                            </p>
                        </CardContent>
                    </Card>
                </motion.div>
            </div>
        );
    }

    // Render: Dead player - exclusive screen
    if (roomCode && phase !== "lobby" && phase !== "game_over" && me && !me.isAlive) {
        return (
            <div className="min-h-screen relative flex flex-col items-center justify-center text-white p-6 bg-gradient-to-br from-red-950 via-red-900 to-black">
                {/* Dark overlay that pulses */}
                <div
                    className="absolute inset-0 bg-black"
                    style={{
                        animation: 'deadFade 4s ease-in-out infinite',
                    }}
                />
                <style>{`
                    @keyframes deadFade {
                        0%, 100% { opacity: 0; }
                        50% { opacity: 0.5; }
                    }
                `}</style>
                <div className="relative z-10 text-center space-y-8">
                    <div className="w-32 h-32 mx-auto rounded-full bg-red-800/50 flex items-center justify-center border-4 border-red-600/50 shadow-2xl shadow-red-900/50">
                        <Skull className="w-16 h-16 text-red-400" />
                    </div>
                    <div className="space-y-3">
                        <h1 className="text-5xl font-black tracking-tight text-red-200">你已死亡</h1>
                        <p className="text-2xl text-red-100 font-bold mt-6">请原地蹲下或坐下</p>
                        <p className="text-lg text-red-300/70">安静等待游戏结束</p>
                    </div>
                    <div className="pt-8 space-y-4">
                        <div className="text-sm text-red-400/50 uppercase tracking-widest">当前阶段</div>
                        <div className="text-2xl font-bold text-red-300">{PHASE_LABELS[phase]}</div>
                    </div>
                    {isHost && (
                        <div className="w-full max-w-sm mx-auto space-y-3 pt-4">
                            <div className="text-xs text-red-200/70 uppercase tracking-widest text-center">房主控制</div>
                            <Button
                                onClick={handleTogglePause}
                                className="w-full h-11 bg-white text-black hover:bg-white/90"
                            >
                                {isPaused ? "恢复游戏" : "暂停游戏"}
                            </Button>
                            {phase === "meeting" && (
                                <div className="grid grid-cols-2 gap-3">
                                    <Button
                                        onClick={handleMeetingStartVote}
                                        disabled={isInteractionDisabled}
                                        className="h-11 bg-white text-black hover:bg-white/90"
                                    >
                                        开始投票
                                    </Button>
                                    <Button
                                        onClick={handleMeetingExtend}
                                        disabled={isInteractionDisabled}
                                        className="h-11 bg-white/10 text-white hover:bg-white/20 border border-white/20"
                                    >
                                        延长30秒
                                    </Button>
                                </div>
                            )}
                            {phase === "voting" && (
                                <Button
                                    onClick={handleVotingExtend}
                                    disabled={isInteractionDisabled}
                                    className="w-full h-11 bg-white/10 text-white hover:bg-white/20 border border-white/20"
                                >
                                    延长30秒
                                </Button>
                            )}
                        </div>
                    )}
                    <Button
                        variant="ghost"
                        onClick={leaveRoom}
                        className="mt-12 text-red-400 hover:text-red-300 hover:bg-red-900/30"
                    >
                        <LogOut className="w-4 h-4 mr-2" />
                        离开房间
                    </Button>
                </div>
            </div>
        );
    }

    // Render: In room
    return (
        <div className={`min-h-screen bg-gradient-to-br ${PHASE_GRADIENTS[phase]} transition-colors duration-500 text-white selection:bg-orange-500/30`}>
            {/* Ambient Background - simplified for performance */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/5 to-transparent" />
            </div>

            {isPaused && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="w-[90%] max-w-sm rounded-2xl border border-white/10 bg-slate-950/90 p-6 text-center">
                        <div className="text-2xl font-black tracking-wide text-white">游戏已暂停</div>
                        <div className="mt-2 text-sm text-white/60">等待房主恢复游戏</div>
                        {isHost && (
                            <Button
                                onClick={handleTogglePause}
                                className="mt-6 h-12 w-full bg-white text-black hover:bg-white/90"
                            >
                                恢复游戏
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            onClick={leaveRoom}
                            className="mt-3 h-10 w-full text-white/60 hover:text-white hover:bg-white/10"
                        >
                            离开房间
                        </Button>
                    </div>
                </div>
            )}
            {showRules && (
                <div
                    className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                    onClick={() => setShowRules(false)}
                >
                    <div
                        className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/90 p-6 text-left"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="text-xl font-black tracking-wide text-white">游戏背景</div>
                        <div className="mt-3 text-sm text-white/70 leading-relaxed whitespace-pre-line">
                            在遥远的星际航线上，鹅族正在建造一艘承载新家园的巨型太空船。为了防止渗透与破坏，工程系统被设计成“红绿灯作业协议”：绿灯允许人员调度与沟通，黄灯强制分流到各个作业点，红灯则全船锁定——所有工程师必须原地完成关键维修与校准任务。
                            {"\n\n"}
                            但这艘船上混入了伪装者：鸭族。它们外表与鹅无异，却以破坏与清除为目标。更糟的是，飞船采用了生命维持的“命门代码”机制：每名成员都有一串的动态的氧气校验码，协作时可以互相输入以补充氧气；而鸭族只要在锁定时刻窥见并输入校验码，就能让对方的生命维持系统瞬间断开，制造无声的“事故”。
                            {"\n\n"}
                            当警报响起，船员只能召开紧急会议，用投票把怀疑者投入太空。工程进度、氧气余量、同伴的眼神与手机屏幕的反光，都会成为你判断真相的证据——在这艘尚未完工的星际方舟里，活下去与完工，必须同时做到。
                        </div>
                        <Button
                            onClick={() => setShowRules(false)}
                            className="mt-6 h-11 w-full bg-white text-black hover:bg-white/90"
                        >
                            关闭
                        </Button>
                    </div>
                </div>
            )}
            {sharedResultFlash && (
                <div className="fixed inset-0 z-[9998] pointer-events-none flex items-center justify-center">
                    <div className={`px-6 py-3 rounded-full border text-lg font-semibold ${sharedResultFlash.result === "success"
                        ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/30"
                        : "bg-red-500/20 text-red-200 border-red-500/30"
                        }`}>
                        共同任务{sharedResultFlash.result === "success" ? "成功" : "失败"}
                    </div>
                </div>
            )}

            {/* Low Oxygen Vignette Effect */}
            {myAlive && displayOxygen < 60 && phase !== "game_over" && (
                <div
                    className="fixed inset-0 z-[9998] pointer-events-none"
                    style={{
                        background: 'radial-gradient(ellipse at center, transparent 10%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.9) 100%)',
                        animation: 'oxygenPulse 4s ease-in-out infinite',
                    }}
                >
                    <style>{`
                        @keyframes oxygenPulse {
                            0%, 100% { opacity: 0.5; }
                            50% { opacity: 1; }
                        }
                    `}</style>
                </div>
            )}

            {/* Life Code Watermark Overlay - Only in Red Light */}
            {phase === "red_light" && me?.lifeCode && watermarkIndices.length > 0 && (
                <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden grid grid-rows-3 gap-1 select-none">
                    {/* Three rows */}
                    {Array.from({ length: WATERMARK_ROWS }).map((_, row) => (
                        <div key={row} className="flex items-center justify-around gap-1 overflow-hidden">
                            {Array.from({ length: watermarkCols }).map((_, col) => {
                                const isVisible = watermarkIndices.includes(`${row}-${col}`);
                                return (
                                    <div
                                        key={col}
                                        className={`transform -rotate-12 font-black whitespace-nowrap transition-opacity duration-300 ${isVisible ? "opacity-100" : "opacity-0"}`}
                                        style={{
                                            fontSize: watermarkCols === 2 ? 'min(28vh, 45vw)' : 'min(28vh, 30vw)',
                                            color: 'rgba(255, 255, 255, 0.12)',
                                        }}
                                    >
                                        {me.lifeCode}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}

            <div className="relative z-10 max-w-md mx-auto flex flex-col h-screen">

                {/* Header / Nav */}
                <header className="p-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="h-10 px-3 bg-white/5 rounded-xl flex items-center justify-center border border-white/10 backdrop-blur-sm">
                            <span className="font-mono font-bold tracking-widest text-white">{roomCode}</span>
                        </div>
                        {isHost && (
                            <>
                                <Badge className="bg-yellow-500/20 text-yellow-200 border-yellow-500/30 hover:bg-yellow-500/30">
                                    <Crown className="w-3 h-3 mr-1" /> 房主
                                </Badge>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleTogglePause}
                                    className="h-8 px-2 text-white/70 hover:text-white hover:bg-white/10"
                                >
                                    {isPaused ? <PlayIcon className="w-4 h-4 mr-1" /> : <Pause className="w-4 h-4 mr-1" />}
                                    {isPaused ? "继续" : "暂停"}
                                </Button>
                            </>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowRules(true)}
                            className="h-8 px-2 text-white/70 hover:text-white hover:bg-white/10"
                        >
                            <BookOpen className="w-4 h-4 mr-1" />
                            规则
                        </Button>
                    </div>
                    <Button variant="ghost" size="icon" onClick={leaveRoom} className="text-white/60 hover:text-white hover:bg-white/10 rounded-full">
                        <LogOut className="w-5 h-5" />
                    </Button>
                </header>

                {/* Main Content Area - Scrollable */}
                <ScrollArea className="flex-1 px-4 pb-20">

                    {/* Sticky Status Card - stays visible */}
                    {phase !== "lobby" && me && (
                        <div className="sticky top-0 z-20 pb-4 -mx-4 px-4 pt-2">
                            <Card className="bg-black/10 backdrop-blur-[2px] border-white/10 overflow-hidden relative">
                                <CardContent className="p-4 flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="relative">
                                            <Avvvatars value={String(me.seat ?? "?")} size={48} />
                                            {!myAlive && (
                                                <div className="absolute -bottom-1 -right-1 bg-red-500 rounded-full p-0.5 border-2 border-black">
                                                    <Skull className="w-3 h-3" />
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-white">{me.name}</span>
                                            </div>
                                            <div className="text-xs text-white/50 mt-0.5">
                                                {me.location && (
                                                    <span className="flex items-center gap-1">
                                                        <MapPin className="w-3 h-3" />{me.location}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Life Code & Oxygen - Always Visible */}
                                    <div className="flex items-center gap-4">
                                        {/* Life Code */}
                                        <div className="text-center">
                                            <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1 flex items-center gap-1">
                                                <Fingerprint className="w-3 h-3" />生命码
                                            </div>
                                            <div className="text-3xl font-mono font-black tracking-widest text-white">
                                                {me.lifeCode ?? "??"}
                                            </div>
                                        </div>

                                        {/* Oxygen */}
                                        <div className="text-center">
                                            <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1 flex items-center gap-1">
                                                <Wind className="w-3 h-3" />氧气
                                            </div>
                                            <div className={`text-2xl font-mono font-bold tabular-nums ${displayOxygen < 60 ? 'text-red-400' : displayOxygen < 120 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                                                {displayOxygen}s
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    <AnimatePresence mode="wait">
                        <motion.div
                            key={phase}
                            variants={pageVariants}
                            initial="initial"
                            animate="in"
                            exit="out"
                            transition={{ duration: 0.3 }}
                            className="space-y-6 pb-8"
                        >
                            {/* Phase Indicator */}
                            <motion.div
                                className="text-center space-y-2 py-4"
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                            >
                                <h1 className="text-4xl font-black italic tracking-tighter uppercase text-transparent bg-clip-text bg-gradient-to-b from-white to-white/60 drop-shadow-[0_2px_10px_rgba(255,255,255,0.2)]">
                                    {PHASE_LABELS[phase]}
                                </h1>
                                {timeLeft > 0 && phase !== "game_over" && phase !== "lobby" && (
                                    <div className="inline-flex items-center gap-2 bg-black/30 px-4 py-1.5 rounded-full border border-white/10 backdrop-blur-md">
                                        <RotateCcw className="w-3 h-3 text-orange-400 animate-spin-reverse" style={{ animationDuration: '3s' }} />
                                        <span className="font-mono text-xl text-orange-400 tabular-nums">{timeLeft}s</span>
                                    </div>
                                )}
                            </motion.div>

                            {/* Lobby UI */}
                            {phase === "lobby" && (
                                <div className="space-y-6">
                                    <Card className="bg-black/20 backdrop-blur-xl border-white/10">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm font-medium text-white/50 uppercase tracking-wider flex items-center gap-2">
                                                <Users className="w-4 h-4" />
                                                玩家 ({users.length})
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-3">
                                            {users.map(u => (
                                                <div
                                                    key={u.sessionId}
                                                    className={`group flex items-center justify-between p-3 rounded-xl transition-colors ${u.ready ? "bg-green-500/10 border border-green-500/20" : "bg-white/5 border border-white/5"
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <Avvvatars value={String(u.seat ?? "?")} style="character" size={32} />
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="font-medium text-sm flex items-center gap-1.5 truncate max-w-[120px] text-white">
                                                                <span className="truncate">{u.name}</span>
                                                                {u.isHost && <Crown className="w-3 h-3 text-yellow-400" />}
                                                                {u.isBot && <Bot className="w-3 h-3 text-blue-400" />}
                                                            </span>
                                                            {u.sessionId === getSessionId() && (
                                                                <span className="text-[10px] text-white/40 uppercase tracking-wider">你</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <Badge variant={u.ready ? "default" : "secondary"} className={`shrink-0 ${u.ready ? "bg-green-500/20 text-green-300 hover:bg-green-500/30 border-green-500/20" : "bg-white/10 text-white/50 hover:bg-white/15"}`}>
                                                        {u.ready ? <><CheckCircle2 className="w-3 h-3 mr-1" />已准备</> : <><Circle className="w-3 h-3 mr-1" />等待</>}
                                                    </Badge>
                                                </div>
                                            ))}
                                        </CardContent>

                                        {/* Action Bar */}
                                        <div className="p-4 border-t border-white/10 flex gap-3 sticky bottom-0 bg-black/20 backdrop-blur-xl rounded-b-xl z-20">
                                            <Button
                                                onClick={toggleReady}
                                                className={`flex-1 h-12 text-lg font-medium transition-all ${users.find(u => u.sessionId === getSessionId())?.ready
                                                    ? "bg-white/10 hover:bg-white/20 text-white"
                                                    : "bg-white text-black hover:bg-white/90"
                                                    }`}
                                            >
                                                {users.find(u => u.sessionId === getSessionId())?.ready ? "取消准备" : "准备"}
                                            </Button>

                                            {isHost && (
                                                <Button
                                                    onClick={handleStartGame}
                                                    className="flex-1 h-12 text-lg font-bold bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 shadow-lg shadow-green-900/20 text-white border-0"
                                                >
                                                    <Play className="w-5 h-5 mr-2 fill-current" /> 开始
                                                </Button>
                                            )}
                                        </div>
                                    </Card>
                                </div>
                            )}

                            {/* Role Reveal UI */}
                            {phase === "role_reveal" && me && (
                                <motion.div
                                    variants={cardVariants}
                                    initial="hidden"
                                    animate="visible"
                                    className="flex flex-col items-center justify-center py-10 space-y-8"
                                >
                                    <div className={`w-32 h-32 rounded-full flex items-center justify-center border-4 shadow-2xl ${me.role === "duck"
                                        ? "bg-orange-500/20 border-orange-500/50 shadow-orange-500/30"
                                        : "bg-white/20 border-white/50 shadow-white/30"
                                        }`}>
                                        <span className="text-6xl">
                                            {me.role === "duck" ? "🦆" : "🪿"}
                                        </span>
                                    </div>
                                    <div className="text-center space-y-3">
                                        <h2 className="text-4xl font-black tracking-tight">
                                            你是 <span className={me.role === "duck" ? "text-orange-400" : "text-white"}>
                                                {me.role === "duck" ? "鸭子" : "鹅"}
                                            </span>
                                        </h2>
                                        <p className="text-white/60 text-lg max-w-xs mx-auto">
                                            {me.role === "duck"
                                                ? "你的目标是消灭鹅，不要被发现！"
                                                : "你的目标是找出鸭子并投票淘汰他们！"}
                                        </p>
                                        {me.role === "duck" && (
                                            <div className="pt-3 space-y-2">
                                                <p className="text-xs uppercase tracking-widest text-orange-200/70">你的同伴</p>
                                                <div className="flex flex-wrap items-center justify-center gap-2">
                                                    {jokerPlayers
                                                        .filter(p => p.sessionId && p.role === "duck" && p.sessionId !== me.sessionId)
                                                        .map(p => (
                                                            <Badge
                                                                key={p.sessionId}
                                                                className="bg-orange-500/20 text-orange-200 border-orange-500/30 hover:bg-orange-500/30"
                                                            >
                                                                {p.name || `玩家${p.seat}`}（{p.seat}）
                                                            </Badge>
                                                        ))}
                                                    {jokerPlayers.filter(p => p.sessionId && p.role === "duck" && p.sessionId !== me.sessionId).length === 0 && (
                                                        <Badge className="bg-white/10 text-white/60 border-white/10 hover:bg-white/10">
                                                            暂无同伴
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-center">
                                        <p className="text-white/40 text-sm">请记住你的身份</p>
                                        <p className="text-white/40 text-sm">游戏即将开始...</p>
                                    </div>
                                </motion.div>
                            )}

                            {/* Green Light: Location Selection */}
                            {phase === "green_light" && myAlive && (
                                <motion.div variants={cardVariants} initial="hidden" animate="visible">
                                    <div className="grid grid-cols-2 gap-3">
                                        {jokerSnapshot?.activeLocations.map((loc) => (
                                            <button
                                                key={loc}
                                                onClick={() => handleSelectLocation(loc)}
                                                disabled={isInteractionDisabled}
                                                className={`relative h-24 rounded-2xl border-2 flex flex-col items-center justify-center gap-2 transition-all active:scale-95 ${me?.targetLocation === loc
                                                    ? "bg-green-500/20 text-green-400 border-green-500/50 shadow-[0_0_20px_rgba(34,197,94,0.3)]"
                                                    : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white hover:border-white/30"
                                                    }`}
                                            >
                                                <MapPin className={`w-6 h-6 ${me?.targetLocation === loc ? "text-green-400" : "text-white/70"}`} />
                                                <span className="font-bold text-lg">{loc}</span>
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-center text-white/50 mt-6 text-sm">点击位置前往</p>
                                </motion.div>
                            )}

                            {/* Yellow Light: Location Assignment */}
                            {phase === "yellow_light" && myAlive && (
                                <motion.div variants={cardVariants} className="flex flex-col items-center justify-center py-10 space-y-6">
                                    <div className="w-24 h-24 rounded-full bg-yellow-500/20 flex items-center justify-center border-4 border-yellow-500/30 shadow-[0_0_30px_rgba(234,179,8,0.3)]">
                                        {me?.location && LOCATION_ICONS[me.location] ? (
                                            (() => {
                                                const LocationIcon = LOCATION_ICONS[me.location];
                                                return <LocationIcon className="w-12 h-12 text-yellow-400" />;
                                            })()
                                        ) : (
                                            <Wind className="w-12 h-12 text-yellow-400" />
                                        )}
                                    </div>
                                    <div className="text-center space-y-2">
                                        <p className="text-white/50 uppercase tracking-widest text-sm">目的地已分配</p>
                                        <h2 className="text-5xl font-black text-white drop-shadow-lg">{me?.location ?? "..."}</h2>
                                    </div>
                                </motion.div>
                            )}

                            {/* Red Light: Actions */}
                            {phase === "red_light" && myAlive && (
                                <motion.div variants={cardVariants} className="space-y-6">
                                    <Card className="bg-black/10 backdrop-blur-[2px] border-white/10 shadow-2xl">
                                        <CardContent className="p-6 space-y-6">
                                            <div className="space-y-4">
                                                <label className="text-center flex items-center justify-center gap-2 text-xs font-bold text-white/40 uppercase tracking-widest">
                                                    <Target className="w-4 h-4" />
                                                    目标生命码
                                                </label>
                                                <div className="flex justify-center">
                                                    <InputOTP
                                                        maxLength={2}
                                                        value={lifeCodeInput}
                                                        onChange={(value) => setLifeCodeInput(value)}
                                                        disabled={actionCooldown || isInteractionDisabled}
                                                    >
                                                        <InputOTPGroup className="gap-4">
                                                            <InputOTPSlot
                                                                index={0}
                                                                className="w-20 h-24 text-5xl font-mono bg-black/20 border-white/20 rounded-xl text-white"
                                                            />
                                                            <InputOTPSlot
                                                                index={1}
                                                                className="w-20 h-24 text-5xl font-mono bg-black/20 border-white/20 rounded-xl text-white"
                                                            />
                                                        </InputOTPGroup>
                                                    </InputOTP>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <Button
                                                    onClick={() => handleSubmitAction("kill")}
                                                    disabled={lifeCodeInput.length !== 2 || actionCooldown || isInteractionDisabled}
                                                    className="h-20 rounded-2xl bg-gradient-to-br from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-50 border border-white/10 shadow-lg shadow-red-900/40 flex flex-col gap-1"
                                                >
                                                    <Skull className="w-6 h-6" />
                                                    <span className="text-xs font-bold uppercase tracking-widest">击杀</span>
                                                </Button>
                                                <Button
                                                    onClick={() => handleSubmitAction("oxygen")}
                                                    disabled={lifeCodeInput.length !== 2 || actionCooldown || isInteractionDisabled}
                                                    className="h-20 rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 disabled:opacity-50 border border-white/10 shadow-lg shadow-emerald-900/40 flex flex-col gap-1"
                                                >
                                                    <Zap className="w-6 h-6 fill-current" />
                                                    <span className="text-xs font-bold uppercase tracking-widest">补氧</span>
                                                </Button>
                                            </div>

                                            {actionCooldown && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    className="text-center p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20"
                                                >
                                                    <p className="text-yellow-400 text-sm font-medium">冷却中 {cooldownSeconds}s</p>
                                                </motion.div>
                                            )}

                                            {/* Task Progress & Button */}
                                            <div className="space-y-3 pt-2 border-t border-white/10">
                                                <div className="space-y-2">
                                                    <div className="flex items-center justify-between text-xs text-white/50">
                                                        <span className="flex items-center gap-1">
                                                            <ClipboardList className="w-3 h-3" />
                                                            任务进度
                                                        </span>
                                                        <span className="font-mono">{jokerSnapshot?.taskProgress ?? 0}%</span>
                                                    </div>
                                                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                                        <motion.div
                                                            className="h-full bg-gradient-to-r from-blue-500 to-cyan-500"
                                                            initial={{ width: 0 }}
                                                            animate={{ width: `${jokerSnapshot?.taskProgress ?? 0}%` }}
                                                            transition={{ duration: 0.5 }}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <Button
                                                        onClick={handleStartTask}
                                                        disabled={showMiniGame || isInteractionDisabled}
                                                        className="h-14 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-sm font-bold flex flex-col gap-1"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <ClipboardList className="w-4 h-4" />
                                                            个人任务
                                                        </div>
                                                        <span className="text-[11px] text-white/80">+1%进度</span>
                                                    </Button>
                                                    <Button
                                                        onClick={handleJoinSharedTask}
                                                        disabled={isInteractionDisabled || !myAlive || !me?.location || sameLocationCount < 2}
                                                        className="h-14 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-700 to-amber-600 hover:from-amber-600 hover:to-amber-500 text-sm font-bold flex flex-col gap-1 text-white"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <Users className="w-4 h-4" />
                                                            共同任务
                                                        </div>
                                                        <span className="text-[11px] text-white/80">+2%进度</span>
                                                    </Button>
                                                </div>
                                                {sharedTask && isSharedParticipant && (
                                                    <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-3 text-center text-sm text-white/70">
                                                        {sharedTask.status === "waiting" && (
                                                            <div>
                                                                等待其他同场所玩家加入
                                                                <div className="mt-1 text-xs text-white/50">
                                                                    已加入 {sharedTask.joined.length}/{sharedTask.participants.length}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {sharedTask.status === "active" && (
                                                            <div className="space-y-2">
                                                                <div>共同任务进行中... 剩余 {sharedTimeLeft}s</div>
                                                                {sharedTask.type === "nine_grid" && mySharedGrid.length === 9 && (
                                                                    <div className="grid grid-cols-3 gap-2 pt-2">
                                                                        {mySharedGrid.map((icon, idx) => {
                                                                            const selected = mySharedSelection === idx;
                                                                            return (
                                                                                <Button
                                                                                    key={idx}
                                                                                    onClick={() => handleSharedTaskSubmit(idx)}
                                                                                    disabled={isInteractionDisabled || sharedTask.status !== "active" || mySharedSelection !== undefined}
                                                                                    className={`h-12 text-xl font-bold ${selected ? "bg-emerald-500/70 hover:bg-emerald-500/70" : "bg-white/10 hover:bg-white/20"} text-white`}
                                                                                >
                                                                                    {renderNineGridIcon(icon)}
                                                                                </Button>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                                {sharedTask.type === "digit_puzzle" && (
                                                                    <div className="space-y-2 pt-2">
                                                                        <div className="text-xs text-white/60">数字拼图：你只看到部分亮段</div>
                                                                        {renderDigitSegments(myDigitSegments)}
                                                                        {myDigitSegments.length === 0 && (
                                                                            <div className="text-xs text-white/50">这次你没有亮段，观察他人屏幕</div>
                                                                        )}
                                                                        <div className="grid grid-cols-5 gap-2 pt-1">
                                                                            {DIGIT_BUTTONS.map((digit) => {
                                                                                const selected = myDigitSelection === digit;
                                                                                return (
                                                                                    <Button
                                                                                        key={digit}
                                                                                        onClick={() => handleSharedTaskSubmit(digit)}
                                                                                        disabled={isInteractionDisabled || sharedTask.status !== "active"}
                                                                                        className={`h-10 text-sm font-bold ${selected
                                                                                            ? "bg-amber-300 text-black hover:bg-amber-300"
                                                                                            : "bg-white/10 text-white hover:bg-white/20"
                                                                                            }`}
                                                                                    >
                                                                                        {digit}
                                                                                    </Button>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                        <div className="text-xs text-white/60">
                                                                            已选择：{myDigitSelection ?? "未选择"}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {sharedTask.type === "nine_grid" && mySharedSelection !== undefined && (
                                                                    <div className="text-xs text-white/60">已选择，请等待其他玩家</div>
                                                                )}
                                                            </div>
                                                        )}
                                                        {sharedTask.status === "resolved" && (
                                                            <div>
                                                                共同任务
                                                                {sharedTask.result === "success" ? "成功" : "失败"}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Players Nearby */}
                                    {me?.location && (
                                        <div className="space-y-3">
                                            <p className="text-xs font-medium text-white/40 uppercase tracking-widest pl-2">
                                                附近玩家 - {me.location}
                                            </p>
                                            <div className="grid grid-cols-1 gap-2">
                                                {jokerPlayers
                                                    .filter(p => p.location === me.location && p.isAlive && p.sessionId !== me.sessionId)
                                                    .map(p => (
                                                        <div key={p.sessionId} className="flex items-center gap-3 p-3 bg-white/5 border border-white/5 rounded-xl">
                                                            <Avvvatars value={String(p.seat)} size={32} />
                                                            <span className="font-medium text-white/90 truncate">{p.name}</span>
                                                        </div>
                                                    ))}
                                                {jokerPlayers.filter(p => p.location === me.location && p.isAlive && p.sessionId !== me.sessionId).length === 0 && (
                                                    <div className="p-4 rounded-xl border border-white/5 bg-white/5 text-center text-white/30 text-sm italic">
                                                        这里没有其他人...
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Report button */}
                                    <Button
                                        onClick={handleReport}
                                        variant="outline"
                                        disabled={isInteractionDisabled}
                                        className="w-full h-14 border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20 hover:border-red-500/50 hover:text-red-100"
                                    >
                                        <AlertTriangle className="w-5 h-5 mr-2" />
                                        报告发现尸体
                                    </Button>
                                </motion.div>
                            )}

                            {/* Meeting */}
                            {phase === "meeting" && (
                                <motion.div variants={cardVariants} className="text-center py-10">
                                    <div className="w-24 h-24 mx-auto bg-blue-500/20 rounded-full flex items-center justify-center mb-6 animate-pulse">
                                        <Siren className="w-12 h-12 text-blue-300" />
                                    </div>
                                    <h2 className="text-3xl font-black italic uppercase tracking-tighter mb-4 flex items-center justify-center gap-3">
                                        <MessageCircle className="w-7 h-7" />
                                        紧急会议
                                    </h2>
                                    <p className="text-white/70 max-w-xs mx-auto">与其他玩家讨论。谁的行为可疑？</p>
                                    {isHost && (
                                        <div className="mt-6 flex items-center justify-center gap-3">
                                            <Button
                                                onClick={handleMeetingStartVote}
                                                disabled={isInteractionDisabled}
                                                className="h-12 px-5 bg-white text-black hover:bg-white/90"
                                            >
                                                开始投票
                                            </Button>
                                            <Button
                                                onClick={handleMeetingExtend}
                                                variant="outline"
                                                disabled={isInteractionDisabled}
                                                className="h-12 px-5 border-white/20 bg-white/10 text-white hover:bg-white/20"
                                            >
                                                延长30秒
                                            </Button>
                                        </div>
                                    )}
                                </motion.div>
                            )}

                            {/* Voting */}
                            {phase === "voting" && myAlive && (
                                <motion.div variants={cardVariants} className="space-y-4">
                                    <Card className="bg-black/20 backdrop-blur-xl border-white/10">
                                        <CardHeader>
                                            <div className="flex items-center justify-between gap-3">
                                                <CardTitle className="flex items-center gap-2 text-lg text-white">
                                                    <Hand className="w-5 h-5" /> 投出你的票
                                                </CardTitle>
                                                {isHost && (
                                                    <Button
                                                        onClick={handleVotingExtend}
                                                        variant="outline"
                                                        disabled={isInteractionDisabled}
                                                        className="h-9 px-3 border-white/20 bg-white/10 text-white hover:bg-white/20"
                                                    >
                                                        延长30秒
                                                    </Button>
                                                )}
                                            </div>
                                        </CardHeader>
                                        <CardContent className="space-y-2">
                                            <ScrollArea className="h-[300px] pr-4">
                                                <div className="space-y-2">
                                                    {jokerPlayers
                                                        .filter(p => p.sessionId && p.isAlive)
                                                        .map(p => (
                                                            <Button
                                                                key={p.sessionId}
                                                                onClick={() => handleVote(p.sessionId)}
                                                                disabled={me?.hasVoted || isInteractionDisabled}
                                                                className={`w-full justify-between h-14 rounded-xl px-4 border ${me?.hasVoted ? "opacity-50 grayscale" : "hover:scale-[1.02]"
                                                                    } transition-all bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20`}
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <Avvvatars value={String(p.seat)} size={32} />
                                                                    <span>{p.name}</span>
                                                                    {p.sessionId === me?.sessionId && (
                                                                        <Badge className="bg-white/10 text-white/60 border-white/10 hover:bg-white/10">
                                                                            自己
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                <div className="text-xs text-white/30 uppercase tracking-wider">投票</div>
                                                            </Button>
                                                        ))}
                                                </div>
                                            </ScrollArea>

                                            <div className="pt-4 border-t border-white/10 mt-4">
                                                <Button
                                                    onClick={() => handleVote(null)}
                                                    variant="ghost"
                                                    className="w-full text-white/50 hover:text-white hover:bg-white/5 flex items-center gap-2"
                                                    disabled={me?.hasVoted || isInteractionDisabled}
                                                >
                                                    <SkipForward className="w-4 h-4" />
                                                    弃票
                                                </Button>
                                            </div>

                                            {me?.hasVoted && (
                                                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mt-4 p-4 bg-green-500/20 border border-green-500/30 rounded-xl text-center">
                                                    <span className="text-green-300 font-bold flex items-center justify-center gap-2">
                                                        <Vote className="w-5 h-5 fill-current" /> 投票已记录
                                                    </span>
                                                    {myVoteLabel && (
                                                        <div className="text-xs text-white/70 mt-2">
                                                            你的选择：{myVoteLabel}
                                                        </div>
                                                    )}
                                                </motion.div>
                                            )}
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            )}

                            {/* Execution Result */}
                            {phase === "execution" && jokerSnapshot?.execution && (
                                <motion.div variants={cardVariants} className="text-center py-10">
                                    {jokerSnapshot.execution.executedSessionId ? (
                                        <div className="space-y-6">
                                            <div className="relative inline-block">
                                                <Avvvatars value={String(jokerPlayers.find(p => p.sessionId === jokerSnapshot.execution?.executedSessionId)?.seat ?? "?")} size={120} />
                                                <motion.div
                                                    initial={{ opacity: 0, scale: 2 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    className="absolute -bottom-2 -right-2 bg-red-600 text-white p-3 rounded-full border-4 border-slate-900"
                                                >
                                                    <UserX className="w-8 h-8" />
                                                </motion.div>
                                            </div>
                                            <div>
                                                <h3 className="text-2xl font-bold mb-1 text-white">
                                                    {jokerPlayers.find(p => p.sessionId === jokerSnapshot.execution?.executedSessionId)?.name}
                                                </h3>
                                                <p className="text-red-400 font-mono uppercase tracking-widest text-lg">
                                                    身份是 {jokerSnapshot.execution.executedRole === "duck" ? "鸭子" : "鹅"}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-8 bg-white/5 rounded-3xl border border-white/10">
                                            <p className="text-xl text-white/70 italic">
                                                投票平局或弃票过多。
                                                <br />
                                                <span className="font-bold text-white not-italic mt-2 block">没有人被驱逐。</span>
                                            </p>
                                        </div>
                                    )}
                                    {jokerSnapshot.voting && (
                                        <div className="mt-8">
                                            <Card className="bg-black/20 backdrop-blur-xl border-white/10 text-left">
                                                <CardHeader>
                                                    <CardTitle className="text-sm uppercase tracking-widest text-white/50">投票结果</CardTitle>
                                                </CardHeader>
                                                <CardContent>
                                                    <div className="grid gap-2">
                                                        {jokerPlayers
                                                            .flatMap(p => {
                                                                const sessionId = p.sessionId;
                                                                if (!sessionId) return [];
                                                                const votes = jokerSnapshot.voting?.tally?.[sessionId] ?? 0;
                                                                if (votes <= 0) return [];
                                                                return [{ player: p, votes }];
                                                            })
                                                            .map(({ player, votes }) => (
                                                                <div
                                                                    key={player.sessionId}
                                                                    className="flex items-center justify-between p-3 rounded-lg border border-white/10 bg-white/5"
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <Avvvatars value={String(player.seat)} size={28} />
                                                                        <span className="font-medium text-white">{player.name}</span>
                                                                    </div>
                                                                    <span className="font-mono text-white/80">
                                                                        {votes} 票
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        <div className="flex items-center justify-between p-3 rounded-lg border border-white/10 bg-white/5">
                                                            <div className="flex items-center gap-3">
                                                                <span className="font-medium text-white">弃票</span>
                                                            </div>
                                                            <span className="font-mono text-white/80">
                                                                {jokerSnapshot.voting.skipCount} 票
                                                            </span>
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </div>
                                    )}
                                </motion.div>
                            )}

                            {/* Game Over */}
                            {phase === "game_over" && jokerSnapshot?.gameResult && (
                                <motion.div variants={cardVariants} className="space-y-8 text-center pt-8">
                                    <div className="space-y-2">
                                        <motion.div
                                            initial={{ scale: 0.5, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            transition={{ type: "spring", bounce: 0.5 }}
                                        >
                                            <h1 className="text-6xl font-black uppercase italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 to-yellow-600 drop-shadow-[0_4px_0_rgba(0,0,0,0.5)]">
                                                {jokerSnapshot.gameResult.winner === "duck" ? "鸭子获胜！" : "鹅获胜！"}
                                            </h1>
                                        </motion.div>
                                        <p className="text-white/60 text-lg">{jokerSnapshot.gameResult.reason}</p>
                                    </div>

                                    <Card className="bg-black/20 backdrop-blur-xl border-white/10 text-left">
                                        <CardHeader>
                                            <CardTitle className="text-sm uppercase tracking-widest text-white/50">角色揭晓</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <ScrollArea className="h-[300px] pr-4">
                                                <div className="grid gap-2">
                                                    {jokerPlayers.filter(p => p.sessionId).map((p, i) => (
                                                        <motion.div
                                                            key={p.sessionId}
                                                            initial={{ opacity: 0, x: -10 }}
                                                            animate={{ opacity: 1, x: 0 }}
                                                            transition={{ delay: i * 0.1 }}
                                                            className={`flex justify-between items-center p-3 rounded-lg border ${p.role === "duck"
                                                                ? "bg-orange-500/10 border-orange-500/20"
                                                                : "bg-blue-500/10 border-blue-500/20"
                                                                }`}
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <Avvvatars value={String(p.seat)} size={32} />
                                                                <span className="font-medium text-white">{p.name}</span>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <Badge variant="outline" className={p.role === "duck" ? "text-orange-300 border-orange-500/30" : "text-blue-300 border-blue-500/30"}>
                                                                    {p.role === "duck" ? "鸭子" : "鹅"}
                                                                </Badge>
                                                                <Badge className={p.isAlive ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/30 hover:bg-emerald-500/30" : "bg-red-500/20 text-red-200 border-red-500/30 hover:bg-red-500/30"}>
                                                                    {p.isAlive ? "存活" : "死亡"}
                                                                </Badge>
                                                            </div>
                                                        </motion.div>
                                                    ))}
                                                </div>
                                            </ScrollArea>
                                        </CardContent>
                                    </Card>

                                    {isHost && (
                                        <Button onClick={handleResetGame} size="lg" className="w-full h-14 text-xl font-bold rounded-xl bg-white text-black hover:bg-white/90">
                                            <RotateCcw className="w-5 h-5 mr-2" />再来一局
                                        </Button>
                                    )}
                                </motion.div>
                            )}

                        </motion.div>
                    </AnimatePresence>
                </ScrollArea>
            </div>

            {/* Mini-Game Overlay */}
            <AnimatePresence>
                {showMiniGame && currentGameType && (
                    <motion.div
                        initial={{ opacity: 0, y: 100 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 100 }}
                        className="fixed inset-x-0 bottom-0 z-50 p-4 pb-8"
                    >
                        <div className="max-w-md mx-auto">
                            <MiniGame
                                type={currentGameType}
                                onComplete={handleCompleteTask}
                                onClose={handleCloseTask}
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
