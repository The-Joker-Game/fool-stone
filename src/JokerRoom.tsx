// src/JokerRoom.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rt, getSessionId, type PresenceState } from "./realtime/socket";
import type {
    JokerPlayerState,
    JokerLocation,
    JokerPhase,
    JokerSnapshot,
} from "./joker/types";
import { useJokerStore } from "./joker/store";
import type { JokerStore } from "./joker/store";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Users,
    LogOut,
    Crown,
    Bot,
    Play,
    MapPin,
    Heart,
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

// Animation Variants
const pageVariants = {
    initial: { opacity: 0, y: 20 },
    in: { opacity: 1, y: 0 },
    out: { opacity: 0, y: -20 }
};

const cardVariants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1 }
};

export default function JokerRoom() {
    const [connected, setConnected] = useState(false);
    const [roomCode, setRoomCode] = useState<string | null>(null);
    const [isHost, setIsHost] = useState(false);
    const [presence, setPresence] = useState<PresenceState | null>(null);
    const [name, setName] = useState<string>(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("joker_name");
            if (saved && saved.trim().length > 0) return saved.trim();
        }
        return randName();
    });
    const autoJoinAttempted = useRef(false);

    // Life code input state
    const [lifeCodeInput, setLifeCodeInput] = useState("");
    const [actionCooldown, setActionCooldown] = useState(false);

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

    // Timer
    const [timeLeft, setTimeLeft] = useState(0);

    useEffect(() => {
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
    }, [jokerSnapshot?.deadline]);

    // Local oxygen display (interpolates between server updates)
    const [displayOxygen, setDisplayOxygen] = useState(me?.oxygen ?? 240);
    const lastServerOxygenRef = useRef(me?.oxygen ?? 240);
    const lastServerOxygenTimeRef = useRef(Date.now());

    // Update references when server sends new oxygen value
    useEffect(() => {
        if (me?.oxygen !== undefined) {
            lastServerOxygenRef.current = me.oxygen;
            lastServerOxygenTimeRef.current = Date.now();
            setDisplayOxygen(me.oxygen);
        }
    }, [me?.oxygen]);

    // Local oxygen tick during active phases
    useEffect(() => {
        const isActivePhase = ["green_light", "yellow_light", "red_light"].includes(phase);
        if (!isActivePhase || !myAlive) {
            return;
        }

        const interval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - lastServerOxygenTimeRef.current) / 1000);
            const interpolatedOxygen = Math.max(0, lastServerOxygenRef.current - elapsed);
            setDisplayOxygen(interpolatedOxygen);
        }, 1000);

        return () => clearInterval(interval);
    }, [phase, myAlive]);

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
                localStorage.setItem("joker_name", nick);
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
                localStorage.setItem("joker_name", nick);
                localStorage.setItem("joker_lastRoomCode", joinCodeInput.trim());
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
            console.error("Start game failed:", res.error);
        }
    }, [startGame]);

    const handleSelectLocation = useCallback(async (loc: JokerLocation) => {
        await selectLocation(loc);
    }, [selectLocation]);

    const handleSubmitAction = useCallback(async (action: "kill" | "oxygen") => {
        if (lifeCodeInput.length !== 2 || actionCooldown) return;
        const res = await submitAction(lifeCodeInput, action);
        if (!res.ok) {
            setActionCooldown(true);
            setTimeout(() => setActionCooldown(false), 10000);
        }
        setLifeCodeInput("");
    }, [lifeCodeInput, actionCooldown, submitAction]);

    const handleVote = useCallback(async (targetSessionId: string | null) => {
        await vote(targetSessionId);
    }, [vote]);

    const handleReport = useCallback(async () => {
        await report();
    }, [report]);

    const handleResetGame = useCallback(async () => {
        await resetGame();
    }, [resetGame]);

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

    // Render: In room
    return (
        <div className={`min-h-screen bg-gradient-to-br ${PHASE_GRADIENTS[phase]} transition-all duration-1000 text-white selection:bg-orange-500/30`}>
            {/* Ambient Background Elements */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[100px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[100px]" />
            </div>

            <div className="relative z-10 max-w-md mx-auto flex flex-col h-screen">

                {/* Header / Nav */}
                <header className="p-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="h-10 px-3 bg-white/5 rounded-xl flex items-center justify-center border border-white/10 backdrop-blur-sm">
                            <span className="font-mono font-bold tracking-widest text-white">{roomCode}</span>
                        </div>
                        {isHost && (
                            <Badge className="bg-yellow-500/20 text-yellow-200 border-yellow-500/30 hover:bg-yellow-500/30">
                                <Crown className="w-3 h-3 mr-1" /> 房主
                            </Badge>
                        )}
                    </div>
                    <Button variant="ghost" size="icon" onClick={leaveRoom} className="text-white/60 hover:text-white hover:bg-white/10 rounded-full">
                        <LogOut className="w-5 h-5" />
                    </Button>
                </header>

                {/* Main Content Area - Scrollable */}
                <ScrollArea className="flex-1 px-4 pb-20">
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
                                className="text-center space-y-2 py-6"
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                            >
                                <h1 className="text-4xl font-black italic tracking-tighter uppercase text-transparent bg-clip-text bg-gradient-to-b from-white to-white/60 drop-shadow-[0_2px_10px_rgba(255,255,255,0.2)]">
                                    {PHASE_LABELS[phase]}
                                </h1>
                                {timeLeft > 0 && (
                                    <div className="inline-flex items-center gap-2 bg-black/30 px-4 py-1.5 rounded-full border border-white/10 backdrop-blur-md">
                                        <RotateCcw className="w-3 h-3 text-orange-400 animate-spin-reverse" style={{ animationDuration: '3s' }} />
                                        <span className="font-mono text-xl text-orange-400 tabular-nums">{timeLeft}s</span>
                                    </div>
                                )}
                            </motion.div>

                            {/* My Status Card */}
                            {phase !== "lobby" && me && (
                                <motion.div variants={cardVariants} initial="hidden" animate="visible">
                                    <Card className="bg-black/20 backdrop-blur-xl border-white/10 overflow-hidden relative">
                                        <CardContent className="p-5 flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="relative">
                                                    <Avvvatars value={me.name} size={48} />
                                                    {me.isAlive ? (
                                                        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 border-2 border-slate-900 rounded-full flex items-center justify-center">
                                                            <Heart className="w-2.5 h-2.5 text-slate-900 fill-current" />
                                                        </div>
                                                    ) : (
                                                        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-red-500 border-2 border-slate-900 rounded-full flex items-center justify-center">
                                                            <Skull className="w-3 h-3 text-white" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="text-xs text-white/50 font-medium uppercase tracking-wider mb-0.5 flex items-center gap-1">
                                                        <Fingerprint className="w-3 h-3" />
                                                        生命码
                                                    </div>
                                                    <div className="text-3xl font-mono font-bold tracking-widest text-white drop-shadow-md">
                                                        {me.lifeCode}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-4">
                                                {/* Oxygen Display */}
                                                <div className="text-center">
                                                    <div className="text-xs text-white/50 font-medium uppercase tracking-wider mb-1">氧气</div>
                                                    <div className={`text-2xl font-mono font-bold tabular-nums ${displayOxygen < 60 ? 'text-red-400' : displayOxygen < 120 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                                                        {displayOxygen}s
                                                    </div>
                                                </div>

                                                {/* Location Display */}
                                                <div className="text-right">
                                                    <div className="text-xs text-white/50 font-medium uppercase tracking-wider mb-1">位置</div>
                                                    <div className="flex items-center justify-end gap-2 text-sm font-medium">
                                                        {me.location ? (
                                                            <span className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-md border border-white/5 text-white/90">
                                                                <MapPin className="w-3.5 h-3.5 text-blue-400" />
                                                                {me.location}
                                                            </span>
                                                        ) : (
                                                            <span className="text-white/30 italic">未知</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            )}

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
                                                        <Avvvatars value={u.name || "User"} style="shape" size={32} />
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
                                        {jokerSnapshot?.activeLocations.map((loc, idx) => (
                                            <motion.button
                                                key={loc}
                                                initial={{ opacity: 0, scale: 0.8 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                transition={{ delay: idx * 0.05 }}
                                                onClick={() => handleSelectLocation(loc)}
                                                className={`relative h-24 rounded-2xl border-2 flex flex-col items-center justify-center gap-2 transition-all active:scale-95 ${me?.targetLocation === loc
                                                    ? "bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                                                    : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white hover:border-white/30"
                                                    }`}
                                            >
                                                <MapPin className={`w-6 h-6 ${me?.targetLocation === loc ? "fill-black" : "fill-none"}`} />
                                                <span className="font-bold text-lg">{loc}</span>
                                                {me?.targetLocation === loc && (
                                                    <motion.div layoutId="selection-ring" className="absolute inset-0 rounded-2xl border-2 border-white pointer-events-none" />
                                                )}
                                            </motion.button>
                                        ))}
                                    </div>
                                    <p className="text-center text-white/50 mt-6 text-sm">点击位置前往</p>
                                </motion.div>
                            )}

                            {/* Yellow Light: Location Assignment */}
                            {phase === "yellow_light" && myAlive && (
                                <motion.div variants={cardVariants} className="flex flex-col items-center justify-center py-10 space-y-6">
                                    <div className="w-24 h-24 rounded-full bg-yellow-500/20 flex items-center justify-center border-4 border-yellow-500/30 shadow-[0_0_30px_rgba(234,179,8,0.3)]">
                                        <Wind className="w-12 h-12 text-yellow-400" />
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
                                    <Card className="bg-black/40 backdrop-blur-xl border-white/10 shadow-2xl">
                                        <CardContent className="p-6 space-y-6">
                                            <div className="space-y-4">
                                                <label className="text-center flex items-center justify-center gap-2 text-xs font-bold text-white/40 uppercase tracking-widest">
                                                    <Target className="w-4 h-4" />
                                                    目标生命码
                                                </label>
                                                <Input
                                                    placeholder="_ _"
                                                    value={lifeCodeInput}
                                                    onChange={e => setLifeCodeInput(e.target.value.replace(/\D/g, "").slice(0, 2))}
                                                    className="h-24 text-center text-6xl font-mono tracking-[0.5em] bg-black/20 border-white/10 rounded-2xl focus-visible:ring-0 focus-visible:border-white/40 placeholder:text-white/10"
                                                    maxLength={2}
                                                    disabled={actionCooldown}
                                                    inputMode="numeric"
                                                    autoFocus
                                                />
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <Button
                                                    onClick={() => handleSubmitAction("kill")}
                                                    disabled={lifeCodeInput.length !== 2 || actionCooldown}
                                                    className="h-20 rounded-2xl bg-gradient-to-br from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-50 border border-white/10 shadow-lg shadow-red-900/40 flex flex-col gap-1"
                                                >
                                                    <Skull className="w-6 h-6" />
                                                    <span className="text-xs font-bold uppercase tracking-widest">击杀</span>
                                                </Button>
                                                <Button
                                                    onClick={() => handleSubmitAction("oxygen")}
                                                    disabled={lifeCodeInput.length !== 2 || actionCooldown}
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
                                                    <p className="text-yellow-400 text-sm font-medium">冷却中</p>
                                                </motion.div>
                                            )}
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
                                                            <Avvvatars value={p.name} size={32} />
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
                                </motion.div>
                            )}

                            {/* Voting */}
                            {phase === "voting" && myAlive && (
                                <motion.div variants={cardVariants} className="space-y-4">
                                    <Card className="bg-black/20 backdrop-blur-xl border-white/10">
                                        <CardHeader>
                                            <CardTitle className="flex items-center gap-2 text-lg text-white">
                                                <Hand className="w-5 h-5" /> 投出你的票
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-2">
                                            <ScrollArea className="h-[300px] pr-4">
                                                <div className="space-y-2">
                                                    {jokerPlayers
                                                        .filter(p => p.sessionId && p.isAlive && p.sessionId !== me?.sessionId)
                                                        .map(p => (
                                                            <Button
                                                                key={p.sessionId}
                                                                onClick={() => handleVote(p.sessionId)}
                                                                disabled={me?.hasVoted}
                                                                className={`w-full justify-between h-14 rounded-xl px-4 border ${me?.hasVoted ? "opacity-50 grayscale" : "hover:scale-[1.02]"
                                                                    } transition-all bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20`}
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <Avvvatars value={p.name} size={32} />
                                                                    <span>{p.name}</span>
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
                                                    disabled={me?.hasVoted}
                                                >
                                                    <SkipForward className="w-4 h-4" />
                                                    跳过投票
                                                </Button>
                                            </div>

                                            {me?.hasVoted && (
                                                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mt-4 p-4 bg-green-500/20 border border-green-500/30 rounded-xl text-center">
                                                    <span className="text-green-300 font-bold flex items-center justify-center gap-2">
                                                        <Vote className="w-5 h-5 fill-current" /> 投票已记录
                                                    </span>
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
                                                <Avvvatars value={jokerPlayers.find(p => p.sessionId === jokerSnapshot.execution?.executedSessionId)?.name || 'Unknown'} size={120} />
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
                                                投票平局或被跳过。
                                                <br />
                                                <span className="font-bold text-white not-italic mt-2 block">没有人被驱逐。</span>
                                            </p>
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
                                            <CardTitle className="text-sm uppercase tracking-widest text-white/50">最终角色</CardTitle>
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
                                                                <Avvvatars value={p.name} size={32} />
                                                                <span className="font-medium text-white">{p.name}</span>
                                                            </div>
                                                            <Badge variant="outline" className={p.role === "duck" ? "text-orange-300 border-orange-500/30" : "text-blue-300 border-blue-500/30"}>
                                                                {p.role === "duck" ? "鸭子" : "鹅"}
                                                            </Badge>
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
        </div>
    );
}
