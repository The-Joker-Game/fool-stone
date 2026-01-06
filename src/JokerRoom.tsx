// src/JokerRoom.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import { rt, getSessionId, type PresenceState } from "./realtime/socket";
import type {
    JokerPlayerState,
    JokerLocation,
    JokerPhase,
    JokerSnapshot,
    JokerRole,
    JokerRoleTemplate,
} from "./joker/types";
import { useJokerStore } from "./joker/store";
import type { JokerStore } from "./joker/store";
import { MiniGame, getRandomGame, type MiniGameType } from "./joker/mini-games";
import { JokerGameReview } from "./joker/components/JokerGameReview";
import { GiKitchenKnives, GiMedicalPack, GiElectric, GiCctvCamera, GiCardboardBox, GiGhost, GiDuck, GiGoose, GiChicken, GiEagleHead, GiShipWheel, GiCryoChamber, GiHummingbird } from "react-icons/gi";
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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
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
    Eye,
    Languages,
} from "lucide-react";
import Avvvatars from "avvvatars-react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConfirm } from "@/flower/components/ConfirmDialog";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

// Utility
function randName() {
    const a = Math.random().toString(36).slice(2, 4);
    const b = Math.random().toString(36).slice(2, 4);
    return `Player-${a}${b}`;
}

const ROLE_REVEAL_STYLES: Record<JokerRole, { ring: string; text: string; icon: React.ElementType }> = {
    // 🦢 Goose faction - Blue
    goose: {
        ring: "bg-blue-500/20 border-blue-400/50 shadow-blue-500/30",
        text: "text-blue-300",
        icon: GiGoose,
    },
    vigilante_goose: {
        ring: "bg-blue-500/20 border-blue-400/50 shadow-blue-500/30",
        text: "text-blue-300",
        icon: GiGoose,
    },
    sheriff_goose: {
        ring: "bg-blue-500/20 border-blue-400/50 shadow-blue-500/30",
        text: "text-blue-300",
        icon: GiGoose,
    },
    coroner_goose: {
        ring: "bg-blue-500/20 border-blue-400/50 shadow-blue-500/30",
        text: "text-blue-300",
        icon: GiGoose,
    },
    overseer_goose: {
        ring: "bg-blue-500/20 border-blue-400/50 shadow-blue-500/30",
        text: "text-blue-300",
        icon: GiGoose,
    },
    // 🦆 Duck faction - Red
    duck: {
        ring: "bg-red-500/20 border-red-400/50 shadow-red-500/30",
        text: "text-red-300",
        icon: GiDuck,
    },
    poisoner_duck: {
        ring: "bg-red-500/20 border-red-400/50 shadow-red-500/30",
        text: "text-red-300",
        icon: GiDuck,
    },
    saboteur_duck: {
        ring: "bg-red-500/20 border-red-400/50 shadow-red-500/30",
        text: "text-red-300",
        icon: GiDuck,
    },
    // 🐦 Neutral faction - Yellow/Amber
    dodo: {
        ring: "bg-amber-500/20 border-amber-400/50 shadow-amber-500/30",
        text: "text-amber-200",
        icon: GiChicken,
    },
    hawk: {
        ring: "bg-amber-500/20 border-amber-400/50 shadow-amber-500/30",
        text: "text-amber-200",
        icon: GiEagleHead,
    },
    woodpecker: {
        ring: "bg-amber-500/20 border-amber-400/50 shadow-amber-500/30",
        text: "text-amber-200",
        icon: GiHummingbird,
    },
};

const ROLE_CARD_STYLES: Record<JokerRole, { card: string; badge: string }> = {
    // 🦢 Goose faction - Blue
    goose: {
        card: "bg-blue-500/10 border-blue-500/20",
        badge: "text-blue-300 border-blue-500/30",
    },
    vigilante_goose: {
        card: "bg-blue-500/10 border-blue-500/20",
        badge: "text-blue-300 border-blue-500/30",
    },
    sheriff_goose: {
        card: "bg-blue-500/10 border-blue-500/20",
        badge: "text-blue-300 border-blue-500/30",
    },
    coroner_goose: {
        card: "bg-blue-500/10 border-blue-500/20",
        badge: "text-blue-300 border-blue-500/30",
    },
    overseer_goose: {
        card: "bg-blue-500/10 border-blue-500/20",
        badge: "text-blue-300 border-blue-500/30",
    },
    // 🦆 Duck faction - Red
    duck: {
        card: "bg-red-500/10 border-red-500/20",
        badge: "text-red-300 border-red-500/30",
    },
    poisoner_duck: {
        card: "bg-red-500/10 border-red-500/20",
        badge: "text-red-300 border-red-500/30",
    },
    saboteur_duck: {
        card: "bg-red-500/10 border-red-500/20",
        badge: "text-red-300 border-red-500/30",
    },
    // 🐦 Neutral faction - Yellow/Amber
    dodo: {
        card: "bg-amber-500/10 border-amber-500/20",
        badge: "text-amber-200 border-amber-400/30",
    },
    hawk: {
        card: "bg-amber-500/10 border-amber-500/20",
        badge: "text-amber-200 border-amber-400/30",
    },
    woodpecker: {
        card: "bg-amber-500/10 border-amber-500/20",
        badge: "text-amber-200 border-amber-400/30",
    },
};

// Location icons mapping
// 场所 -> 英文key 映射
const LOCATION_KEY_MAP: Record<JokerLocation, string> = {
    "厨房": "kitchen",
    "医务室": "medical",
    "发电室": "power",
    "监控室": "monitor",
    "仓库": "warehouse",
    "调度室": "dispatch",
    "休眠舱": "stasis",
};

const LOCATION_ICONS: Record<JokerLocation, React.ElementType> = {
    "厨房": GiKitchenKnives,
    "医务室": GiMedicalPack,
    "发电室": GiElectric,
    "监控室": GiCctvCamera,
    "仓库": GiCardboardBox,
    "调度室": GiShipWheel,
    "休眠舱": GiCryoChamber,
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
    const { t } = useTranslation();
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

    // —— 浏览器标题跟随语言切换 —— //
    useEffect(() => {
        document.title = t('home.pageTitle');
    }, [t, i18n.language]);

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
    const [taskCooldownSeconds, setTaskCooldownSeconds] = useState(0);
    const taskCooldown = taskCooldownSeconds > 0;
    const [lifeCodeWarningCountdown, setLifeCodeWarningCountdown] = useState(0);
    const [lifeCodeRefreshedCountdown, setLifeCodeRefreshedCountdown] = useState(0);
    const [showMedicalDialog, setShowMedicalDialog] = useState(false);
    const [showMonitorLocationDialog, setShowMonitorLocationDialog] = useState(false);
    const [showReview, setShowReview] = useState(false);
    const [pendingVoteTarget, setPendingVoteTarget] = useState<{ sessionId: string | null; name: string } | null>(null);
    const [suppressPauseDialog, setSuppressPauseDialog] = useState(false);
    const [coronerEmptyChecked, setCoronerEmptyChecked] = useState(false);
    const [overseerEmptyChecked, setOverseerEmptyChecked] = useState(false);
    const [pendingLocationEffect, setPendingLocationEffect] = useState<null | { location: JokerLocation; targetSessionId?: string; monitorTargetLocation?: JokerLocation }>(null);

    // Role template selection (shown in host badge popover) - persisted to localStorage
    const [roleTemplate, setRoleTemplate] = useState<JokerRoleTemplate>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem("joker_roleTemplate");
            return saved === "special" ? "special" : "simple";
        }
        return "simple";
    });
    const [enableSoloEffects, setEnableSoloEffects] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem("joker_enableSoloEffects");
            return saved !== "false"; // default true
        }
        return true;
    });

    // Persist settings to localStorage
    useEffect(() => {
        localStorage.setItem("joker_roleTemplate", roleTemplate);
    }, [roleTemplate]);
    useEffect(() => {
        localStorage.setItem("joker_enableSoloEffects", String(enableSoloEffects));
    }, [enableSoloEffects]);

    // Mini-game state
    const [showMiniGame, setShowMiniGame] = useState(false);
    const [currentGameType, setCurrentGameType] = useState<MiniGameType | null>(null);

    // Join room input
    const [joinCodeInput, setJoinCodeInput] = useState("");

    const { confirm, ConfirmDialogElement } = useConfirm(true);

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
    const rulesVersion = import.meta.env.VITE_BUILD_VERSION || "unknown";
    const myRole = (me?.role ?? "goose") as JokerRole;
    const myAlive = me?.isAlive ?? false;
    const executedPlayer = useMemo(() => {
        if (!jokerSnapshot?.execution?.executedSessionId) return null;
        return jokerPlayers.find(p => p.sessionId === jokerSnapshot.execution?.executedSessionId) ?? null;
    }, [jokerSnapshot?.execution?.executedSessionId, jokerPlayers]);
    const isPaused = jokerSnapshot?.paused ?? false;
    const showPauseDialog = isPaused && !suppressPauseDialog;
    const isInteractionDisabled = isPaused;
    const sharedTask = me?.location ? jokerSnapshot?.tasks?.sharedByLocation?.[me.location] : undefined;
    const mySessionId = getSessionId();
    const goldenRabbitTask = me?.location ? jokerSnapshot?.tasks?.emergencyByLocation?.[me.location] : undefined;
    const isSharedParticipant = !!sharedTask?.participants?.includes(mySessionId);
    const mySharedSelection = sharedTask?.selections?.[mySessionId];
    const mySharedGrid = sharedTask?.gridBySession?.[mySessionId] ?? [];
    const myDigitSegments = sharedTask?.digitSegmentsBySession?.[mySessionId] ?? [];
    const myDigitSelection = sharedTask?.digitSelections?.[mySessionId];
    const isGoldenRabbitParticipant = !!goldenRabbitTask?.participants?.includes(mySessionId);
    const myGoldenRabbitSelection = goldenRabbitTask?.selections?.[mySessionId];
    const myGoldenRabbitX = goldenRabbitTask?.xBySession?.[mySessionId] ?? [];
    const [sharedTimeLeft, setSharedTimeLeft] = useState(0);
    const [goldenRabbitJoinLeft, setGoldenRabbitJoinLeft] = useState(0);
    const lastSharedResolvedAtRef = useRef<number | null>(null);
    const lastGoldenRabbitResolvedAtRef = useRef<number | null>(null);
    const lastOxygenLeakStartedAtRef = useRef<number | null>(null);
    const lastOxygenLeakResolvedAtRef = useRef<number | null>(null);
    const lastLifeCodeVersionRef = useRef<number | null>(null);
    const sameLocationCount = useMemo(() => {
        if (!me?.location) return 0;
        return jokerPlayers.filter(p => p.isAlive && p.location === me.location).length;
    }, [jokerPlayers, me?.location]);
    const yellowLocationPlayers = useMemo(() => {
        if (!me?.location) return [];
        return jokerPlayers.filter(p =>
            p.isAlive &&
            p.sessionId &&
            !p.isDisconnected &&
            p.location === me.location
        );
    }, [jokerPlayers, me?.location]);
    const soloLocation = !!me?.location && sameLocationCount === 1;
    const soloLocationEffect = myAlive && phase === "red_light" && soloLocation ? me.location : null;
    const soloEffectsDisabled = jokerSnapshot?.enableSoloEffects === false;
    const powerBoostUsed = !!jokerSnapshot?.round?.powerBoostBySession?.[mySessionId];
    const powerBoostActive = !!jokerSnapshot?.round?.powerBoostActiveBySession?.[mySessionId];
    const warehouseUsed = !!jokerSnapshot?.round?.warehouseUsedBySession?.[mySessionId];
    const monitorUsed = !!jokerSnapshot?.round?.monitorUsedBySession?.[mySessionId];
    const kitchenUsed = !!jokerSnapshot?.round?.kitchenUsedBySession?.[mySessionId];
    const medicalUsed = !!jokerSnapshot?.round?.medicalUsedBySession?.[mySessionId];
    const dispatchUsed = !!jokerSnapshot?.round?.dispatchUsedBySession?.[mySessionId];
    const stasisUsed = !!jokerSnapshot?.round?.stasisActiveBySession?.[mySessionId];
    const arrivalMap = jokerSnapshot?.round?.arrivedBySession ?? {};
    const meArrived = !!arrivalMap[mySessionId];
    const personalTaskProgressLabel =
        soloLocationEffect === "发电室" && powerBoostActive ? t('task.progress3') : t('task.progress2');
    const medicalTargets = useMemo(
        () => jokerPlayers.filter(p => p.isAlive && p.sessionId && p.sessionId !== me?.sessionId),
        [jokerPlayers, me?.sessionId]
    );
    const myVoteLabel = useMemo(() => {
        if (!me?.hasVoted) return null;
        if (me.voteTarget === null) return t('voting.abstain');
        const target = jokerPlayers.find(p => p.sessionId === me.voteTarget);
        if (!target) return t('common.unknown');
        return `${target.name || `${t('game.player')}${target.seat}`}（${target.seat}）`;
    }, [me?.hasVoted, me?.voteTarget, jokerPlayers, t]);

    // Auto-close mini-game when phase changes away from red_light
    useEffect(() => {
        if (phase !== "red_light") {
            setShowMiniGame(false);
            setCurrentGameType(null);
            setPendingLocationEffect(null);
        }
    }, [phase]);

    useEffect(() => {
        if (!showMedicalDialog) return;
        if (phase !== "red_light" || soloLocationEffect !== "医务室") {
            setShowMedicalDialog(false);
        }
    }, [phase, soloLocationEffect, showMedicalDialog]);

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
        if (taskCooldownSeconds <= 0) return;
        const interval = setInterval(() => {
            setTaskCooldownSeconds(prev => Math.max(0, prev - 1));
        }, 1000);
        return () => clearInterval(interval);
    }, [taskCooldownSeconds]);

    // Reset coroner and overseer empty check at the start of each new round
    useEffect(() => {
        setCoronerEmptyChecked(false);
        setOverseerEmptyChecked(false);
    }, [jokerSnapshot?.roundCount]);

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

    // Local oxygen display (calculates from oxygenState)
    const [displayOxygen, setDisplayOxygen] = useState(270);
    const oxygenStateRef = useRef(me?.oxygenState);

    // Keep ref in sync with server state
    useEffect(() => {
        if (me?.oxygenState) {
            oxygenStateRef.current = me.oxygenState;
        }
    }, [me?.oxygenState?.baseOxygen, me?.oxygenState?.drainRate, me?.oxygenState?.baseTimestamp]);

    // Calculate current oxygen from oxygenState
    const calculateOxygen = useCallback(() => {
        const state = oxygenStateRef.current;
        if (!state) return 270;
        const elapsed = (Date.now() - state.baseTimestamp) / 1000;
        // Use Math.ceil: only decrease after a full second (269.1 → 270, 269.0 → 269)
        return Math.max(0, Math.ceil(state.baseOxygen - state.drainRate * elapsed));
    }, []);

    // Local oxygen tick during active phases
    useEffect(() => {
        const isActivePhase = ["green_light", "yellow_light", "red_light"].includes(phase);
        if (!isActivePhase || !myAlive) {
            // Non-active phase: calculate once from state
            setDisplayOxygen(calculateOxygen());
            return;
        }

        if (isPaused) {
            // When paused, show current value but don't tick
            setDisplayOxygen(calculateOxygen());
            return;
        }

        // Run immediately then every second
        // IMPORTANT: Interval does NOT depend on oxygenState, only on phase/alive/paused
        // This prevents interval recreation on every server update
        setDisplayOxygen(calculateOxygen());
        const interval = setInterval(() => {
            setDisplayOxygen(calculateOxygen());
        }, 1000);

        return () => clearInterval(interval);
    }, [phase, myAlive, isPaused, calculateOxygen]);

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

        // Subscribe to life code warning action
        const offAction = rt.subscribeAction(msg => {
            if (msg.action === "joker:life_code_warning") {
                setLifeCodeWarningCountdown(5);
            }
        });

        return () => {
            offConn?.();
            offPresence?.();
            offState?.();
            offAction?.();
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
                await alert(resp?.msg || t('error.gameAlreadyStarted'));
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

    const handleAddBot = useCallback(async () => {
        if (!roomCode || !isHost) return;
        try {
            const resp = await rt.emitAck("room:add_bot", {
                code: roomCode,
                sessionId: getSessionId(),
            }, 3000);
            if (!(resp as any)?.ok) {
                const err = (resp as any)?.msg;
                await alert(err || t('error.addBotFailed'));
            }
        } catch (e) {
            console.error(e);
            await alert(t('error.addBotFailed'));
        }
    }, [roomCode, isHost, t]);

    const handleStartGame = useCallback(async () => {
        const res = await startGame(roleTemplate, enableSoloEffects);
        if (!res.ok) {
            const msg =
                res.error === "Need at least 5 players to start"
                    ? t('error.needPlayers')
                    : res.error === "All players must be ready to start"
                        ? t('error.allReady')
                        : res.error === "Only host can start game"
                            ? t('error.hostOnly')
                            : res.error === "Game paused"
                                ? t('error.gamePaused')
                                : res.error === "No snapshot"
                                    ? t('error.noSnapshot')
                                    : res.error || t('error.startFailed');
            await alert(msg);
        }
    }, [startGame, t, roleTemplate, enableSoloEffects]);

    const handleSelectLocation = useCallback(async (loc: JokerLocation) => {
        await selectLocation(loc);
    }, [selectLocation]);

    const handleSubmitAction = useCallback(async (action: "kill" | "oxygen") => {
        if (lifeCodeInput.length !== 2 || actionCooldown || isInteractionDisabled) return;
        setCooldownSeconds(10);
        const res = await submitAction(lifeCodeInput, action);
        if (!res.ok) {
            const isKillPenalty =
                action === "kill" &&
                (myRole === "duck" || myRole === "hawk") &&
                res.error === "Invalid life code";
            const msg =
                isKillPenalty
                    ? t('error.wrongCodePenalty')
                    : res.error === "Invalid life code" || res.error === "No player with this code"
                        ? t('error.invalidCode')
                        : res.error === "Not in same location"
                            ? t('error.notSameLocation')
                            : res.error === "Cannot give oxygen to yourself"
                                ? t('error.cantOxygenSelf')
                                : res.error === "Already gave oxygen to this player this round"
                                    ? t('error.alreadyGaveOxygen')
                                    : res.error === "Cannot give oxygen consecutively to the same player"
                                        ? t('error.consecutiveOxygen')
                                        : res.error === "Actions only available during red light"
                                            ? t('error.redLightOnly')
                                            : res.error === "Invalid actor"
                                                ? t('error.invalidActor')
                                                : res.error === "Unknown action"
                                                    ? t('error.unknownAction')
                                                    : res.error === "foul_death" || res.error === "foul"
                                                        ? t('error.foulDeath')
                                                        : res.error === "Game paused"
                                                            ? t('error.gamePaused')
                                                            : res.error === "No snapshot"
                                                                ? t('error.noSnapshot')
                                                                : res.error === "Player not found"
                                                                    ? t('error.playerNotFound')
                                                                    : t('error.operationFailed');
            await alert(msg);
        }
        setLifeCodeInput("");
    }, [lifeCodeInput, actionCooldown, isInteractionDisabled, submitAction, myRole, t]);

    const handleVoteConfirm = useCallback(async () => {
        if (isInteractionDisabled || !pendingVoteTarget) return;
        await vote(pendingVoteTarget.sessionId);
        setPendingVoteTarget(null);
    }, [vote, isInteractionDisabled, pendingVoteTarget]);

    const handleVoteClick = useCallback((targetSessionId: string | null, targetName: string) => {
        if (isInteractionDisabled) return;
        setPendingVoteTarget({ sessionId: targetSessionId, name: targetName });
    }, [isInteractionDisabled]);

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

    const handleConfirmArrival = useCallback(async () => {
        if (!roomCode || isInteractionDisabled) return;
        const resp = await rt.emitAck("intent", { room: roomCode, action: "joker:confirm_arrival" });
        if (!(resp as any)?.ok) {
            const err = (resp as any)?.msg;
            const msg =
                err === "Arrival only available during yellow light"
                    ? t('error.yellowLightOnly')
                    : err === "Player has no location"
                        ? t('error.noLocation')
                        : err === "Invalid player"
                            ? t('error.invalidActor')
                            : err
                                ? `${t('error.confirmFailed')}: ${err}`
                                : t('error.confirmFailed');
            await alert(msg);
        }
    }, [roomCode, isInteractionDisabled, t]);

    const handleTogglePause = useCallback(async () => {
        if (!roomCode) return;
        await rt.emitAck("intent", { room: roomCode, action: "joker:toggle_pause" });
    }, [roomCode]);

    const handleVotingExtend = useCallback(async () => {
        if (!roomCode || isInteractionDisabled) return;
        await rt.emitAck("intent", { room: roomCode, action: "joker:voting_extend" });
    }, [roomCode, isInteractionDisabled]);

    const handleResetGame = useCallback(async () => {
        const res = await resetGame();
        if (!res.ok) {
            const msg =
                res.error === "Only host can reset game"
                    ? t('error.hostOnly')
                    : res.error === "Game paused"
                        ? t('error.gamePaused')
                        : res.error === "No snapshot"
                            ? t('error.noSnapshot')
                            : res.error === "Joker game not initialized"
                                ? t('error.roomNotInit')
                                : res.error
                                    ? `${t('error.restartFailed')}: ${res.error}`
                                    : t('error.restartFailed');
            await alert(msg);
        }
    }, [resetGame, t]);

    const handleRestartGame = useCallback(async () => {
        setSuppressPauseDialog(true);
        const confirmed = await confirm({
            title: t('confirm.restartTitle'),
            description: t('confirm.restartDesc'),
            confirmText: t('confirm.confirmRestart'),
            cancelText: t('common.cancel'),
            variant: "destructive",
        });
        try {
            if (!confirmed) return;
            const res = await resetGame();
            if (!res.ok) {
                const msg =
                    res.error === "Only host can reset game"
                        ? t('error.hostOnly')
                        : res.error === "Game paused"
                            ? t('error.gamePaused')
                            : res.error === "No snapshot"
                                ? t('error.noSnapshot')
                                : res.error === "Joker game not initialized"
                                    ? t('error.roomNotInit')
                                    : res.error
                                        ? `${t('error.restartFailed')}: ${res.error}`
                                        : t('error.restartFailed');
                await alert(msg);
            }
        } finally {
            setSuppressPauseDialog(false);
        }
    }, [confirm, resetGame, t]);

    // Task handlers
    const handleStartTask = useCallback(async () => {
        if (!roomCode || isInteractionDisabled || taskCooldown) return;
        const result = await rt.emitAck("intent", { room: roomCode, action: "joker:start_task" });
        if ((result as any)?.ok) {
            setPendingLocationEffect(null);
            setCurrentGameType(getRandomGame());
            setShowMiniGame(true);
        }
    }, [roomCode, isInteractionDisabled, taskCooldown]);

    const handleJoinSharedTask = useCallback(async () => {
        if (!roomCode || isInteractionDisabled || taskCooldown) return;
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
                    ? t('error.redLightOnly')
                    : err === "Player has no location"
                        ? t('error.noLocation')
                        : err === "Shared task already active in another location"
                            ? t('error.sharedTaskActive')
                            : err === "Not enough players for shared task"
                                ? t('error.notEnoughPlayers')
                                : err === "Game paused"
                                    ? t('error.gamePaused')
                                    : err === "Invalid player"
                                        ? t('error.invalidActor')
                                        : err === "Joker game not initialized"
                                            ? t('error.roomNotInit')
                                            : err === "Unknown action"
                                                ? t('error.unknownAction')
                                                : err
                                                    ? `${t('error.cannotStartShared')}: ${err}`
                                                    : t('error.cannotStartShared');
            await alert(msg);
        }
    }, [roomCode, isInteractionDisabled, taskCooldown, t]);

    const handleSharedTaskSubmit = useCallback(async (index: number) => {
        if (!roomCode || isInteractionDisabled) return;
        await rt.emitAck("intent", {
            room: roomCode,
            action: "joker:shared_task_submit",
            data: { index },
        });
    }, [roomCode, isInteractionDisabled]);

    const handleJoinGoldenRabbit = useCallback(async () => {
        if (!roomCode || isInteractionDisabled) return;
        await rt.emitAck("intent", {
            room: roomCode,
            action: "joker:golden_rabbit_join",
        });
    }, [roomCode, isInteractionDisabled]);

    const handleGoldenRabbitSubmit = useCallback(async (index: number) => {
        if (!roomCode || isInteractionDisabled) return;
        await rt.emitAck("intent", {
            room: roomCode,
            action: "joker:golden_rabbit_submit",
            data: { index },
        });
    }, [roomCode, isInteractionDisabled]);

    const locationEffectErrorMessage = useCallback((err?: string) => {
        if (!err) return t('error.operationFailed');
        const map: Record<string, string> = {
            "Location effects only available during red light": t('error.locationEffectRedLightOnly'),
            "Invalid player": t('error.invalidActor'),
            "Not in monitoring room": t('error.notInMonitorRoom'),
            "Not in power room": t('error.notInPowerRoom'),
            "Not in kitchen": t('error.notInKitchen'),
            "Not in medical room": t('error.notInMedicalRoom'),
            "Not in warehouse": t('error.notInWarehouse'),
            "Not alone in location": t('error.notAlone'),
            "No eligible target": t('error.noTarget'),
            "No eligible target at location": t('error.noTargetAtLocation'),
            "No target location specified": t('error.noTargetAtLocation'),
            "Already gave oxygen to this player this round": t('error.alreadyGaveOxygen'),
            "Invalid target": t('error.invalidTarget'),
            "Warehouse already used this round": t('error.warehouseUsed'),
            "Monitoring already used this round": t('error.monitorUsed'),
            "Power boost already used this round": t('error.powerUsed'),
            "Kitchen already used this round": t('error.kitchenUsed'),
            "Medical already used this round": t('error.medicalUsed'),
            "Dispatch already used this round": t('error.dispatchUsed'),
            "Already in stasis": t('error.stasisUsed'),
            "Not in dispatch room": t('error.notInDispatchRoom'),
            "Not in stasis pod": t('error.notInStasisPod'),
            "Target is in stasis": t('error.targetInStasis'),
            "Invalid location": t('error.invalidLocation'),
        };
        return map[err] ?? t('error.operationFailed');
    }, [t]);

    const startLocationEffectTask = useCallback((location: JokerLocation, targetSessionId?: string, monitorTargetLocation?: JokerLocation) => {
        if (!roomCode || showMiniGame) return;
        setPendingLocationEffect({ location, targetSessionId, monitorTargetLocation });
        setCurrentGameType(getRandomGame());
        setShowMiniGame(true);
    }, [roomCode, showMiniGame]);

    const handleMonitorPeek = useCallback(() => {
        if (isInteractionDisabled) return;
        if (monitorUsed) {
            alert(t('error.monitorUsed'));
            return;
        }
        setShowMonitorLocationDialog(true);
    }, [isInteractionDisabled, monitorUsed, t]);

    const handleMonitorLocationSelect = useCallback((targetLocation: JokerLocation) => {
        if (isInteractionDisabled) return;
        setShowMonitorLocationDialog(false);
        startLocationEffectTask("监控室", undefined, targetLocation);
    }, [isInteractionDisabled, startLocationEffectTask]);

    const handlePowerBoost = useCallback(() => {
        if (isInteractionDisabled) return;
        startLocationEffectTask("发电室");
    }, [isInteractionDisabled, startLocationEffectTask]);

    const handleKitchenOxygen = useCallback(() => {
        if (isInteractionDisabled) return;
        startLocationEffectTask("厨房");
    }, [isInteractionDisabled, startLocationEffectTask]);

    const handleWarehouseOxygen = useCallback(() => {
        if (isInteractionDisabled) return;
        startLocationEffectTask("仓库");
    }, [isInteractionDisabled, startLocationEffectTask]);

    const handleDispatchRoom = useCallback(() => {
        if (isInteractionDisabled) return;
        startLocationEffectTask("调度室");
    }, [isInteractionDisabled, startLocationEffectTask]);

    const handleStasisPod = useCallback(() => {
        if (isInteractionDisabled) return;
        startLocationEffectTask("休眠舱");
    }, [isInteractionDisabled, startLocationEffectTask]);

    const handleMedicalOpen = useCallback(() => {
        if (isInteractionDisabled) return;
        if (medicalUsed) {
            alert(t('error.medicalUsed'));
            return;
        }
        if (medicalTargets.length === 0) {
            alert(t('error.noOxygenTargets'));
            return;
        }
        setShowMedicalDialog(true);
    }, [isInteractionDisabled, medicalTargets.length, medicalUsed]);

    const handleMedicalSelect = useCallback((targetSessionId: string) => {
        if (isInteractionDisabled) return;
        setShowMedicalDialog(false);
        startLocationEffectTask("医务室", targetSessionId);
    }, [isInteractionDisabled, startLocationEffectTask]);

    const handleLocationEffectFail = useCallback(async () => {
        if (!roomCode) return;
        const resp = await rt.emitAck("intent", {
            room: roomCode,
            action: "joker:location_effect_fail",
        });
        if (!(resp as any)?.ok) {
            await alert(locationEffectErrorMessage((resp as any)?.msg));
            return;
        }
        toast.error(t('toast.locationEffectFailed'), { classNames: { toast: 'toast-error' } });
    }, [roomCode, locationEffectErrorMessage, t]);

    // 验尸鹅 (coroner_goose) investigation handler
    const handleCoronerInvestigate = useCallback(async (deadSessionId: string) => {
        if (!roomCode) return;
        const resp = await rt.emitAck("intent", {
            room: roomCode,
            action: "joker:coroner_investigate",
            data: { deadSessionId },
        });
        if (!(resp as any)?.ok) {
            toast.error((resp as any)?.msg || t('error.operationFailed'), { classNames: { toast: 'toast-error' } });
            return;
        }
        const data = (resp as any)?.data;
        if (data) {
            const reasonMap: Record<string, string> = {
                kill: "击杀",
                poison: "毒杀",
                oxygen: "缺氧",
                suicide: "自杀",
                foul: "犯规",
                vote: "投票",
            };
            const reasonText = reasonMap[data.reason] || data.reason;
            toast.info(`${data.deadName}（座位${data.deadSeat}）死因：${reasonText}`, {
                duration: 8000,
                classNames: { toast: 'toast-info' }
            });
        }
    }, [roomCode, t]);

    // 监工鹅 (overseer_goose) investigation handler
    const handleOverseerInvestigate = useCallback(async (targetSessionId: string) => {
        if (!roomCode) return;
        const resp = await rt.emitAck("intent", {
            room: roomCode,
            action: "joker:overseer_investigate",
            data: { targetSessionId },
        });
        if (!(resp as any)?.ok) {
            toast.error((resp as any)?.msg || t('error.operationFailed'), { classNames: { toast: 'toast-error' } });
            return;
        }
        const data = (resp as any)?.data;
        if (data) {
            toast.info(`${data.targetName}（座位${data.targetSeat}）任务贡献度：${data.contribution}%`, {
                duration: 8000,
                classNames: { toast: 'toast-info' }
            });
        }
    }, [roomCode, t]);

    const handleLocationEffectSuccess = useCallback(async (effect: { location: JokerLocation; targetSessionId?: string; monitorTargetLocation?: JokerLocation }) => {
        if (!roomCode) return;
        let resp: any = null;
        if (effect.location === "监控室") {
            resp = await rt.emitAck("intent", {
                room: roomCode,
                action: "joker:location_monitor",
                data: { targetLocation: effect.monitorTargetLocation },
            });
        } else if (effect.location === "发电室") {
            resp = await rt.emitAck("intent", { room: roomCode, action: "joker:location_power" });
        } else if (effect.location === "厨房") {
            resp = await rt.emitAck("intent", { room: roomCode, action: "joker:location_kitchen" });
        } else if (effect.location === "仓库") {
            resp = await rt.emitAck("intent", { room: roomCode, action: "joker:location_warehouse" });
        } else if (effect.location === "调度室") {
            resp = await rt.emitAck("intent", { room: roomCode, action: "joker:location_dispatch" });
        } else if (effect.location === "休眠舱") {
            resp = await rt.emitAck("intent", { room: roomCode, action: "joker:location_stasis" });
        } else if (effect.location === "医务室") {
            if (!effect.targetSessionId) {
                await alert(t('error.invalidTarget'));
                return;
            }
            resp = await rt.emitAck("intent", {
                room: roomCode,
                action: "joker:location_medical",
                data: { targetSessionId: effect.targetSessionId },
            });
        }

        if (!resp || !(resp as any)?.ok) {
            await alert(locationEffectErrorMessage((resp as any)?.msg));
            return;
        }

        if (effect.location === "监控室") {
            const code = (resp as any)?.data?.lifeCode;
            if (code) {
                toast.info(`${t('toast.peekLifeCode')} ${code}`, { duration: 5000, classNames: { toast: 'toast-info' } });
            }
        }

        // Success feedback is handled by the effect UI itself (e.g. monitor code reveal).
    }, [roomCode, locationEffectErrorMessage]);

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
        if (!goldenRabbitTask?.joinDeadlineAt || goldenRabbitTask.status !== "waiting") {
            setGoldenRabbitJoinLeft(0);
            return;
        }
        const tick = () => {
            const remaining = Math.max(0, Math.ceil((goldenRabbitTask.joinDeadlineAt! - Date.now()) / 1000));
            setGoldenRabbitJoinLeft(remaining);
        };
        tick();
        const interval = setInterval(tick, 200);
        return () => clearInterval(interval);
    }, [goldenRabbitTask?.joinDeadlineAt, goldenRabbitTask?.status]);

    useEffect(() => {
        if (sharedTask?.status !== "resolved" || !sharedTask.result || !sharedTask.resolvedAt) return;
        if (lastSharedResolvedAtRef.current === sharedTask.resolvedAt) return;
        lastSharedResolvedAtRef.current = sharedTask.resolvedAt;
        if (isSharedParticipant) {
            if (sharedTask.result === "success") {
                toast.success(t('sharedTask.success'), { duration: 3000, classNames: { toast: 'toast-success' } });
            } else {
                toast.error(t('sharedTask.fail'), { duration: 3000, classNames: { toast: 'toast-error' } });
            }
            setTaskCooldownSeconds(10);
        }
    }, [sharedTask?.status, sharedTask?.result, sharedTask?.resolvedAt, isSharedParticipant]);

    useEffect(() => {
        if (goldenRabbitTask?.status !== "resolved" || !goldenRabbitTask.result || !goldenRabbitTask.resolvedAt) return;
        if (lastGoldenRabbitResolvedAtRef.current === goldenRabbitTask.resolvedAt) return;
        lastGoldenRabbitResolvedAtRef.current = goldenRabbitTask.resolvedAt;
        if (isGoldenRabbitParticipant) {
            if (goldenRabbitTask.result === "success") {
                toast.success(t('emergency.captureSuccess'), { duration: 4000, classNames: { toast: 'toast-warning' } });
            } else {
                toast.error(t('emergency.captureFail'), { duration: 3000, classNames: { toast: 'toast-error' } });
            }
        }
    }, [goldenRabbitTask?.status, goldenRabbitTask?.result, goldenRabbitTask?.resolvedAt, isGoldenRabbitParticipant]);

    useEffect(() => {
        if (!me?.oxygenLeakActive || !me.oxygenLeakStartedAt) return;
        if (lastOxygenLeakStartedAtRef.current === me.oxygenLeakStartedAt) return;
        lastOxygenLeakStartedAtRef.current = me.oxygenLeakStartedAt;
        toast.error(t('toast.oxygenLeak'), { duration: 3000, classNames: { toast: 'toast-error' } });
    }, [me?.oxygenLeakActive, me?.oxygenLeakStartedAt]);

    useEffect(() => {
        if (!me?.oxygenLeakResolvedAt) return;
        if (lastOxygenLeakResolvedAtRef.current === me.oxygenLeakResolvedAt) return;
        lastOxygenLeakResolvedAtRef.current = me.oxygenLeakResolvedAt;
        toast.success(t('toast.oxygenFixed'), { classNames: { toast: 'toast-success' } });
    }, [me?.oxygenLeakResolvedAt]);

    useEffect(() => {
        // Reset warning countdown when life codes are refreshed
        if (!jokerSnapshot?.lifeCodes) return;
        const version = jokerSnapshot.lifeCodes.version;
        if (lastLifeCodeVersionRef.current === version) return;
        // Only show "refreshed" notification if this is not the first version (initial assignment)
        if (lastLifeCodeVersionRef.current !== 0) {
            setLifeCodeRefreshedCountdown(5);
        }
        lastLifeCodeVersionRef.current = version;
        setLifeCodeWarningCountdown(0);
    }, [jokerSnapshot?.lifeCodes?.version]);

    // Life code warning countdown timer
    useEffect(() => {
        if (lifeCodeWarningCountdown <= 0) return;
        const timer = setTimeout(() => {
            setLifeCodeWarningCountdown(prev => Math.max(0, prev - 1));
        }, 1000);
        return () => clearTimeout(timer);
    }, [lifeCodeWarningCountdown]);

    // Life code refreshed notification countdown timer
    useEffect(() => {
        if (lifeCodeRefreshedCountdown <= 0) return;
        const timer = setTimeout(() => {
            setLifeCodeRefreshedCountdown(prev => Math.max(0, prev - 1));
        }, 1000);
        return () => clearTimeout(timer);
    }, [lifeCodeRefreshedCountdown]);

    const handleCompleteTask = useCallback(async () => {
        if (!roomCode) return;
        setShowMiniGame(false);
        setCurrentGameType(null);
        if (pendingLocationEffect) {
            const effect = pendingLocationEffect;
            setPendingLocationEffect(null);
            await handleLocationEffectSuccess(effect);
            return;
        }
        await rt.emitAck("intent", { room: roomCode, action: "joker:complete_task" });
        toast.success(t('toast.taskSuccess'), { duration: 2000, classNames: { toast: 'toast-success' } });
        setTaskCooldownSeconds(10);
    }, [roomCode, pendingLocationEffect, handleLocationEffectSuccess]);

    const handleCloseTask = useCallback(() => {
        setShowMiniGame(false);
        setCurrentGameType(null);
        if (pendingLocationEffect) {
            setPendingLocationEffect(null);
            handleLocationEffectFail();
            return;
        }
        toast.error(t('toast.taskFailed'), { duration: 2000, classNames: { toast: 'toast-error' } });
        setTaskCooldownSeconds(10);
    }, [pendingLocationEffect, handleLocationEffectFail]);

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
                                {t('home.title')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-white/50 uppercase tracking-wider">{t('home.identityLabel')}</label>
                                    <div className="relative">
                                        <Input
                                            placeholder={t('home.nicknamePlaceholder')}
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
                                    {t('home.createRoom')}
                                </Button>

                                <div className="flex items-center gap-3">
                                    <span className="flex-1 border-t border-white/10" />
                                    <span className="text-xs uppercase text-white/30">{t('home.orJoinExisting')}</span>
                                    <span className="flex-1 border-t border-white/10" />
                                </div>

                                <div className="flex gap-3">
                                    <Input
                                        placeholder={t('home.roomCode')}
                                        value={joinCodeInput}
                                        onChange={e => setJoinCodeInput(e.target.value.toUpperCase())}
                                        className="bg-white/5 border-white/10 h-12 text-lg font-mono tracking-widest text-center uppercase focus-visible:ring-blue-500/50 focus-visible:border-blue-500/50"
                                        maxLength={4}
                                    />
                                    <Button onClick={joinRoom} variant="secondary" className="h-12 px-8 bg-white/10 hover:bg-white/20 text-white border-0">
                                        {t('home.join')}
                                    </Button>
                                </div>
                            </div>
                            <p className="text-center text-xs text-white/30 flex items-center justify-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`} />
                                {connected ? t('home.serverConnected') : t('home.connecting')}
                            </p>
                        </CardContent>
                    </Card>
                </motion.div>
            </div>
        );
    }

    // Render: Dead player - exclusive screen
    if (roomCode && phase !== "lobby" && phase !== "game_over" && me && !me.isAlive) {
        // Check if player is an active ghost (death revealed)
        const myDeath = jokerSnapshot?.deaths?.find(d => d.sessionId === me.sessionId);
        const isActiveGhost = myDeath?.revealed === true;

        // Get players at ghost's assigned location for haunting
        const hauntablePlayers = isActiveGhost && me.ghostAssignedLocation
            ? jokerPlayers.filter(p => p.isAlive && p.sessionId && p.location === me.ghostAssignedLocation)
            : [];

        // Get other ghosts at same location
        const ghostsAtSameLocation = isActiveGhost && me.ghostAssignedLocation
            ? jokerPlayers.filter(p => !p.isAlive && p.sessionId !== me.sessionId && p.ghostAssignedLocation === me.ghostAssignedLocation)
            : [];

        // Handle ghost location selection
        const handleGhostSelectLocation = async (location: JokerLocation) => {
            const { ghostSelectLocation } = useJokerStore.getState();
            const result = await ghostSelectLocation(location);
            if (!result.ok) {
                toast.error(result.error || t('ghost.selectLocationFailed'), { classNames: { toast: 'toast-error' } });
            }
        };

        // Handle ghost haunt
        const handleGhostHaunt = async (targetSessionId: string) => {
            const { ghostHaunt } = useJokerStore.getState();
            const result = await ghostHaunt(targetSessionId);
            if (!result.ok) {
                toast.error(result.error || t('ghost.hauntFailed'), { classNames: { toast: 'toast-error' } });
            }
        };

        return (
            <>
                <div className="min-h-screen relative flex flex-col items-center justify-between text-white p-6 bg-gradient-to-br from-red-950 via-red-900 to-black">
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
                    <div className="relative z-10 text-center space-y-6 flex-1 flex flex-col items-center justify-center">
                        <div className="w-32 h-32 mx-auto rounded-full bg-red-800/50 flex items-center justify-center border-4 border-red-600/50 shadow-2xl shadow-red-900/50">
                            {isActiveGhost ? (
                                <GiGhost className="w-16 h-16 text-purple-300" />
                            ) : (
                                <Skull className="w-16 h-16 text-red-400" />
                            )}
                        </div>
                        <div className="space-y-3">
                            <h1 className="text-5xl font-black tracking-tight text-red-200">
                                {isActiveGhost ? t('ghost.title') : t('dead.title')}
                            </h1>
                            {!isActiveGhost && (
                                <>
                                    <p className="text-2xl text-red-100 font-bold mt-6">{t('dead.crouchDown')}</p>
                                    <p className="text-lg text-red-300/70">{t('dead.waitForEnd')}</p>
                                </>
                            )}
                            {isActiveGhost && (
                                <p className="text-lg text-purple-300/80">{t('ghost.canHaunt')}</p>
                            )}
                        </div>
                        <div className="pt-4 space-y-4">
                            <div className="text-sm text-red-400/50 uppercase tracking-widest">{t('dead.currentPhase')}</div>
                            <div className="text-2xl font-bold text-red-300">{t(`phases.${phase}`)}</div>
                            {timeLeft > 0 && (
                                <div className="inline-flex items-center gap-2 bg-black/30 px-4 py-1.5 rounded-full border border-red-500/20">
                                    <RotateCcw className="w-3 h-3 text-red-400 animate-spin-reverse" style={{ animationDuration: '3s' }} />
                                    <span className="font-mono text-xl text-red-400 tabular-nums">{timeLeft}s</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Ghost Interaction Area */}
                    {isActiveGhost && (
                        <div className="relative z-10 w-full max-w-lg mx-auto space-y-4 pb-4">
                            {/* Green Light: Location Selection Carousel */}
                            {phase === "green_light" && (
                                <div className="bg-purple-900/30 rounded-xl p-4 border border-purple-500/20">
                                    <div className="flex items-center gap-2 mb-3">
                                        <GiGhost className="w-5 h-5 text-purple-300" />
                                        <span className="text-sm text-purple-200">{t('ghost.selectLocation')}</span>
                                    </div>
                                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                                        {(jokerSnapshot?.activeLocations ?? []).map((loc) => {
                                            const LocationIcon = LOCATION_ICONS[loc];
                                            return (
                                                <button
                                                    key={loc}
                                                    onClick={() => handleGhostSelectLocation(loc)}
                                                    className={`flex-shrink-0 px-4 py-3 rounded-lg transition-all ${me.ghostTargetLocation === loc
                                                        ? 'bg-purple-600 text-white border-2 border-purple-400'
                                                        : 'bg-black/30 text-purple-200 border border-purple-500/30 hover:bg-purple-800/40'
                                                        }`}
                                                >
                                                    <LocationIcon className="w-4 h-4 inline" />
                                                    <span className="ml-2 text-sm font-medium">{t(`locations.${LOCATION_KEY_MAP[loc]}`)}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {me.ghostTargetLocation && (
                                        <div className="text-sm text-purple-300 mt-2">
                                            {t('ghost.selectedLocation')}: {t(`locations.${me.ghostTargetLocation}`)}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Yellow Light: Show destination */}
                            {phase === "yellow_light" && me.ghostAssignedLocation && (
                                <div className="bg-yellow-900/30 rounded-xl p-4 border border-yellow-500/20">
                                    <div className="flex items-center gap-2">
                                        <GiGhost className="w-5 h-5 text-yellow-300" />
                                        <span className="text-sm text-yellow-200">{t('ghost.goingTo')}</span>
                                        <span className="font-bold text-yellow-100">{t(`locations.${LOCATION_KEY_MAP[me.ghostAssignedLocation]}`)}</span>
                                    </div>
                                </div>
                            )}

                            {/* Red Light: Haunt Target Carousel */}
                            {phase === "red_light" && me.ghostAssignedLocation && (
                                <div className="bg-red-900/30 rounded-xl p-4 border border-red-500/20">
                                    <div className="flex items-center gap-2 mb-3">
                                        <GiGhost className="w-5 h-5 text-red-300" />
                                        <span className="text-sm text-red-200">
                                            {t('ghost.atLocation')}: {t(`locations.${LOCATION_KEY_MAP[me.ghostAssignedLocation]}`)}
                                        </span>
                                    </div>

                                    {/* Hauntable Players */}
                                    {hauntablePlayers.length > 0 ? (
                                        <div className="space-y-3">
                                            <div className="text-xs text-red-400 uppercase tracking-wider">{t('ghost.availableTargets')}</div>
                                            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                                                {hauntablePlayers.map((player) => (
                                                    <button
                                                        key={player.sessionId}
                                                        onClick={() => player.sessionId && handleGhostHaunt(player.sessionId)}
                                                        disabled={!!me.hauntingTarget}
                                                        className={`flex-shrink-0 flex items-center px-4 py-3 rounded-lg transition-all ${me.hauntingTarget === player.sessionId
                                                            ? 'bg-red-600 text-white border-2 border-red-400'
                                                            : me.hauntingTarget
                                                                ? 'bg-gray-800/50 text-gray-500 border border-gray-600/30 cursor-not-allowed'
                                                                : 'bg-black/30 text-red-200 border border-red-500/30 hover:bg-red-800/40'
                                                            }`}
                                                    >
                                                        <div className="mr-2">
                                                            <Avvvatars value={String(player.seat)} size={24} />
                                                        </div>
                                                        <span className="text-sm font-medium">{player.name}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-sm text-red-400/70">{t('ghost.noTargets')}</div>
                                    )}

                                    {/* Current haunting status */}
                                    {me.hauntingTarget && (
                                        <div className="mt-3 p-3 bg-red-800/40 rounded-lg border border-red-500/40">
                                            <div className="flex items-center gap-2 text-red-200">
                                                <GiGhost className="w-4 h-4 animate-pulse" />
                                                <span>{t('ghost.haunting')}: </span>
                                                <div className="flex items-center gap-2 font-bold">
                                                    {(() => {
                                                        const target = jokerPlayers.find(p => p.sessionId === me.hauntingTarget);
                                                        return target ? (
                                                            <>
                                                                <Avvvatars value={String(target.seat)} size={20} />
                                                                <span>{target.name}</span>
                                                            </>
                                                        ) : null;
                                                    })()}
                                                </div>
                                            </div>
                                            <div className="text-xs text-red-400/70 mt-1">{t('ghost.hauntingEffect')}</div>
                                        </div>
                                    )}

                                    {/* Other ghosts at same location */}
                                    {ghostsAtSameLocation.length > 0 && (
                                        <div className="mt-3 text-sm text-red-300/70">
                                            {t('ghost.otherGhosts')}: {ghostsAtSameLocation.map(g => g.name).join(', ')}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Host controls and Leave button */}
                    <div className="relative z-10 w-full max-w-sm mx-auto space-y-3">
                        {isHost && (
                            <div className="space-y-3 pt-4">
                                <div className="text-xs text-red-200/70 uppercase tracking-widest text-center">{t('host.controls')}</div>
                                <Button
                                    onClick={handleTogglePause}
                                    className="w-full h-11 bg-white text-black hover:bg-white/90"
                                >
                                    {isPaused ? t('game.resume') : t('game.pause')}
                                </Button>
                                <Button
                                    onClick={handleRestartGame}
                                    className="w-full h-11 bg-white/10 text-white hover:bg-white/20 border border-white/20"
                                >
                                    <RotateCcw className="w-4 h-4 mr-2" />
                                    {t('game.restart')}
                                </Button>
                                {phase === "meeting" && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <Button
                                            onClick={handleMeetingStartVote}
                                            disabled={isInteractionDisabled}
                                            className="h-11 bg-white text-black hover:bg-white/90"
                                        >
                                            {t('meeting.startVote')}
                                        </Button>
                                        <Button
                                            onClick={handleMeetingExtend}
                                            disabled={isInteractionDisabled}
                                            className="h-11 bg-white/10 text-white hover:bg-white/20 border border-white/20"
                                        >
                                            {t('meeting.extend30s')}
                                        </Button>
                                    </div>
                                )}
                                {phase === "voting" && (
                                    <Button
                                        onClick={handleVotingExtend}
                                        disabled={isInteractionDisabled}
                                        className="w-full h-11 bg-white/10 text-white hover:bg-white/20 border border-white/20"
                                    >
                                        {t('meeting.extend30s')}
                                    </Button>
                                )}
                            </div>
                        )}
                        <Button
                            variant="ghost"
                            onClick={leaveRoom}
                            className="w-full mt-4 text-red-400 hover:text-red-300 hover:bg-red-900/30"
                        >
                            <LogOut className="w-4 h-4 mr-2" />
                            {t('pause.leaveRoom')}
                        </Button>
                    </div>
                </div>
                {ConfirmDialogElement}
            </>
        );
    }

    // Render: In room
    return (
        <div className={`min-h-screen bg-gradient-to-br ${PHASE_GRADIENTS[phase]} transition-colors duration-500 text-white selection:bg-orange-500/30`}>
            {/* Ambient Background - simplified for performance */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/5 to-transparent" />
            </div>

            {showPauseDialog && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="w-[90%] max-w-sm rounded-2xl border border-white/10 bg-slate-950/90 p-6 text-center">
                        <div className="text-2xl font-black tracking-wide text-white">{t('pause.title')}</div>
                        <div className="mt-2 text-sm text-white/60">{t('pause.waitHost')}</div>
                        {isHost && (
                            <Button
                                onClick={handleTogglePause}
                                className="mt-6 h-12 w-full bg-white text-black hover:bg-white/90"
                            >
                                {t('pause.resume')}
                            </Button>
                        )}
                        {isHost && (
                            <Button
                                onClick={handleRestartGame}
                                className="mt-3 h-11 w-full bg-white/10 text-white hover:bg-white/20 border border-white/20"
                            >
                                <RotateCcw className="w-4 h-4 mr-2" />
                                {t('game.restart')}
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            onClick={leaveRoom}
                            className="mt-3 h-10 w-full text-white/60 hover:text-white hover:bg-white/10"
                        >
                            {t('pause.leaveRoom')}
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
                        <div className="text-xl font-black tracking-wide text-white">{t('rules.title')}</div>
                        <ScrollArea className="mt-3 max-h-[70vh] pr-2">
                            <div className="text-sm text-white/70 leading-relaxed whitespace-pre-line">
                                {i18n.language.startsWith('zh') ? '【' : '['}{t('rules.version')}{i18n.language.startsWith('zh') ? '】' : ']'}{rulesVersion}
                                {"\n"}
                                {t('rules.content')}
                            </div>
                        </ScrollArea>
                        <Button
                            onClick={() => setShowRules(false)}
                            className="mt-6 h-11 w-full bg-white text-black hover:bg-white/90"
                        >
                            {t('rules.close')}
                        </Button>
                    </div>
                </div>
            )}

            {/* Low Oxygen Vignette Effect */}
            {myAlive && displayOxygen < 60 && phase !== "game_over" && phase !== "lobby" && (
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

            <div className="relative z-10 max-w-md mx-auto flex flex-col h-screen">

                {/* Header / Nav */}
                <header className="p-4 flex items-center shrink-0">
                    <div className="flex items-center gap-2 sm:gap-3">
                        <div className="h-10 px-3 bg-white/5 rounded-xl flex items-center justify-center border border-white/10 backdrop-blur-sm">
                            <span className="font-mono font-bold tracking-widest text-white">{roomCode}</span>
                        </div>
                        {isHost && (
                            <>
                                {phase === "lobby" ? (
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Badge className="bg-yellow-500/20 text-yellow-200 border-yellow-500/30 hover:bg-yellow-500/30 cursor-pointer">
                                                <Crown className="w-3 h-3 mr-1" /> {t('lobby.host')}
                                            </Badge>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-64 bg-slate-900 border-slate-700 p-4">
                                            <div className="space-y-4">
                                                <div className="text-sm font-medium text-white">
                                                    {t('lobby.gameSettings', '游戏设置')}
                                                </div>
                                                {/* 特殊角色开关 */}
                                                <div className="flex items-center justify-between">
                                                    <div className="space-y-0.5">
                                                        <label htmlFor="special-roles" className="text-sm text-white">
                                                            {t('lobby.specialRoles', '特殊角色')}
                                                        </label>
                                                        <p className="text-xs text-slate-400">
                                                            {t('lobby.specialRolesDesc', '启用毒师鸭、警长鹅等')}
                                                        </p>
                                                    </div>
                                                    <Switch
                                                        id="special-roles"
                                                        checked={roleTemplate === "special"}
                                                        onCheckedChange={(checked) => setRoleTemplate(checked ? "special" : "simple")}
                                                    />
                                                </div>
                                                {/* 单人场所效果开关 */}
                                                <div className="flex items-center justify-between">
                                                    <div className="space-y-0.5">
                                                        <label htmlFor="solo-effects" className="text-sm text-white">
                                                            {t('lobby.soloEffects', '场所效果')}
                                                        </label>
                                                        <p className="text-xs text-slate-400">
                                                            {t('lobby.soloEffectsDesc', '单人时触发场所技能')}
                                                        </p>
                                                    </div>
                                                    <Switch
                                                        id="solo-effects"
                                                        checked={enableSoloEffects}
                                                        onCheckedChange={setEnableSoloEffects}
                                                    />
                                                </div>
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                ) : (
                                    <Badge className="bg-yellow-500/20 text-yellow-200 border-yellow-500/30">
                                        <Crown className="w-3 h-3 mr-1" /> {t('lobby.host')}
                                    </Badge>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleTogglePause}
                                    className="h-8 px-2 text-white/70 hover:text-white hover:bg-white/10"
                                >
                                    {isPaused ? <PlayIcon className="w-4 h-4 sm:mr-1" /> : <Pause className="w-4 h-4 sm:mr-1" />}
                                    <span className="hidden sm:inline">{isPaused ? t('game.continue') : t('game.pause')}</span>
                                </Button>
                            </>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowRules(true)}
                            className="h-8 px-2 text-white/70 hover:text-white hover:bg-white/10"
                        >
                            <BookOpen className="w-4 h-4 sm:mr-1" />
                            <span className="hidden sm:inline">{t('game.rules')}</span>
                        </Button>
                    </div>
                    <div className="flex-1" />
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                                const newLang = i18n.language.startsWith('zh') ? 'en' : 'zh';
                                i18n.changeLanguage(newLang);
                            }}
                            className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/10 rounded-full"
                        >
                            <Languages className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={leaveRoom} className="text-white/60 hover:text-white hover:bg-white/10 rounded-full">
                            <LogOut className="w-5 h-5" />
                        </Button>
                    </div>
                </header>

                {/* Main Content Area - Scrollable */}
                <ScrollArea className="flex-1 px-4 pb-20">

                    {/* Sticky Status Card - stays visible */}
                    {phase !== "lobby" && me && (
                        <div className="sticky top-0 z-20 pb-4 -mx-4 px-4 pt-2">
                            <Card className="bg-black/10 backdrop-blur-sm border-white/10 overflow-hidden relative">
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
                                                        <MapPin className="w-3 h-3" />{t(`locations.${LOCATION_KEY_MAP[me.location]}`)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <div className="text-center">
                                            <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1 flex items-center gap-1">
                                                <Fingerprint className="w-3 h-3" />{t('game.lifeCode')}
                                            </div>
                                            <div className="text-3xl font-mono font-black tracking-widest text-white">
                                                {me.lifeCode ?? "??"}
                                            </div>
                                        </div>

                                        {/* Oxygen */}
                                        <div className="text-center">
                                            <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1 flex items-center gap-1">
                                                <Wind className="w-3 h-3" />{t('game.oxygen')}
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
                                    {t(`phases.${phase}`)}
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
                                                {t('lobby.players')} ({users.length})
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
                                                                <span className="text-[10px] text-white/40 uppercase tracking-wider">{t('lobby.you')}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <Badge variant={u.ready ? "default" : "secondary"} className={`shrink-0 ${u.ready ? "bg-green-500/20 text-green-300 hover:bg-green-500/30 border-green-500/20" : "bg-white/10 text-white/50 hover:bg-white/15"}`}>
                                                        {u.ready ? <><CheckCircle2 className="w-3 h-3 mr-1" />{t('lobby.ready')}</> : <><Circle className="w-3 h-3 mr-1" />{t('lobby.waiting')}</>}
                                                    </Badge>
                                                </div>
                                            ))}
                                        </CardContent>
                                    </Card>
                                </div>
                            )}

                            {/* Lobby Action Bar - Fixed at bottom */}
                            {phase === "lobby" && (
                                <div className="fixed bottom-0 left-0 right-0 z-30">
                                    <div className="max-w-md mx-auto px-4 pb-4">
                                        <div className="p-4 border border-white/10 flex gap-3 bg-black/80 backdrop-blur-xl rounded-2xl shadow-2xl">
                                            <Button
                                                onClick={toggleReady}
                                                className={`flex-1 h-12 text-lg font-medium transition-all ${users.find(u => u.sessionId === getSessionId())?.ready
                                                    ? "bg-white/10 hover:bg-white/20 text-white"
                                                    : "bg-white text-black hover:bg-white/90"
                                                    }`}
                                            >
                                                {users.find(u => u.sessionId === getSessionId())?.ready ? t('lobby.cancelReady') : t('lobby.readyUp')}
                                            </Button>

                                            {isHost && (
                                                <Button
                                                    onClick={handleAddBot}
                                                    className="h-12 px-4 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30"
                                                    title={t('lobby.addBot')}
                                                >
                                                    <Bot className="w-5 h-5" />
                                                </Button>
                                            )}

                                            {isHost && (
                                                <Button
                                                    onClick={handleStartGame}
                                                    className="flex-1 h-12 text-lg font-bold bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 shadow-lg shadow-green-900/20 text-white border-0"
                                                >
                                                    <Play className="w-5 h-5 mr-2 fill-current" /> {t('lobby.start')}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
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
                                    <div className="flex justify-center mb-8">
                                        <div className={`w-32 h-32 rounded-full border-4 flex items-center justify-center text-7xl shadow-[0_0_50px_rgba(0,0,0,0.5)] ${ROLE_REVEAL_STYLES[myRole].ring}`}>
                                            {(() => {
                                                const Icon = ROLE_REVEAL_STYLES[myRole].icon;
                                                return <Icon className="w-20 h-20" />;
                                            })()}
                                        </div>
                                    </div>
                                    <div className="text-center space-y-3">
                                        <h2 className="text-4xl font-black tracking-tight">
                                            {t('game.youAre')} <span className={ROLE_REVEAL_STYLES[myRole].text}>
                                                {t(`roles.${myRole}`)}
                                            </span>
                                        </h2>
                                        <p className="text-white/60 text-lg max-w-xs mx-auto">
                                            {t(`roleDesc.${myRole}`)}
                                        </p>
                                        {(myRole === "duck" || myRole.endsWith("_duck")) && (
                                            <div className="pt-3 space-y-2">
                                                <p className="text-xs uppercase tracking-widest text-orange-200/70">{t('game.yourCompanions')}</p>
                                                <div className="flex flex-wrap items-center justify-center gap-2">
                                                    {jokerPlayers
                                                        .filter(p => p.sessionId && (p.role === "duck" || p.role?.endsWith("_duck")) && p.sessionId !== me.sessionId)
                                                        .map(p => (
                                                            <Badge
                                                                key={p.sessionId}
                                                                className="bg-orange-500/20 text-orange-200 border-orange-500/30 hover:bg-orange-500/30"
                                                            >
                                                                {p.name || `${t('game.player')}${p.seat}`}（{p.seat}）- {t(`roles.${p.role}`)}
                                                            </Badge>
                                                        ))}
                                                    {jokerPlayers.filter(p => p.sessionId && (p.role === "duck" || p.role?.endsWith("_duck")) && p.sessionId !== me.sessionId).length === 0 && (
                                                        <Badge className="bg-white/10 text-white/60 border-white/10 hover:bg-white/10">
                                                            {t('game.noCompanions')}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-center">
                                        <p className="text-white/40 text-sm">{t('game.rememberRole')}</p>
                                        <p className="text-white/40 text-sm">{t('game.gameStarting')}</p>
                                    </div>
                                </motion.div>
                            )}

                            {/* Green Light: Location Selection */}
                            {phase === "green_light" && myAlive && (
                                <motion.div variants={cardVariants} initial="hidden" animate="visible">
                                    <div className="grid grid-cols-2 gap-3">
                                        {jokerSnapshot?.activeLocations.map((loc) => {
                                            const LocationIcon = LOCATION_ICONS[loc];
                                            return (
                                                <button
                                                    key={loc}
                                                    onClick={() => handleSelectLocation(loc)}
                                                    disabled={isInteractionDisabled}
                                                    className={`relative h-24 rounded-2xl border-2 flex flex-col items-center justify-center gap-2 transition-all active:scale-95 ${me?.targetLocation === loc
                                                        ? "bg-green-500/20 text-green-400 border-green-500/50 shadow-[0_0_20px_rgba(34,197,94,0.3)]"
                                                        : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white hover:border-white/30"
                                                        }`}
                                                >
                                                    <LocationIcon className={`w-6 h-6 ${me?.targetLocation === loc ? "text-green-400" : "text-white/70"}`} />
                                                    <span className="font-bold text-lg">{t(`locations.${LOCATION_KEY_MAP[loc]}`)}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <p className="text-center text-white/50 mt-6 text-sm">{t('game.clickToGo')}</p>
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
                                        <p className="text-white/50 uppercase tracking-widest text-sm">{t('yellow.destinationAssigned')}</p>
                                        <h2 className="text-5xl font-black text-white drop-shadow-lg">{me?.location ? t(`locations.${LOCATION_KEY_MAP[me.location]}`) : "..."}</h2>
                                    </div>
                                    <Card className="w-full max-w-sm bg-black/20 backdrop-blur-xl border-white/10 text-left">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-xs uppercase tracking-widest text-white/50">
                                                {t('yellow.sameLocationPlayers')}
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-2">
                                            {yellowLocationPlayers.map(p => {
                                                const arrived = !!arrivalMap[p.sessionId ?? ""];
                                                return (
                                                    <div
                                                        key={p.sessionId}
                                                        className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <Avvvatars value={String(p.seat)} size={26} />
                                                            <span className="text-sm text-white">
                                                                {p.name || `${t('game.player')}${p.seat}`}
                                                            </span>
                                                            <span className="text-[11px] text-white/40">{t('game.seat')} {p.seat}</span>
                                                        </div>
                                                        {arrived ? (
                                                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                                        ) : (
                                                            <Circle className="w-4 h-4 text-white/30" />
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            {yellowLocationPlayers.length === 0 && (
                                                <div className="text-center text-xs text-white/40">{t('yellow.waitingAssignment')}</div>
                                            )}
                                            <Button
                                                onClick={handleConfirmArrival}
                                                disabled={isInteractionDisabled || meArrived}
                                                className="mt-2 w-full h-11 bg-white text-black hover:bg-white/90"
                                            >
                                                {meArrived ? t('yellow.arrived') : t('yellow.confirmArrival')}
                                            </Button>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            )}

                            {/* Red Light: Actions */}
                            {phase === "red_light" && myAlive && (
                                <motion.div variants={cardVariants} className="space-y-6">
                                    <Card className="bg-black/10 backdrop-blur-sm border-white/10 shadow-2xl">
                                        <CardContent className="p-6 space-y-6">
                                            <div className="space-y-4">
                                                <label className="text-center flex items-center justify-center gap-2 text-xs font-bold text-white/40 uppercase tracking-widest">
                                                    <Target className="w-4 h-4" />
                                                    {t('game.targetLifeCode')}
                                                </label>
                                                {phase === "red_light" && myAlive && !isPaused && lifeCodeWarningCountdown > 0 && (
                                                    <div className="text-center text-xs font-semibold text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-full py-1">
                                                        {t('game.lifeCodeRefresh')} {lifeCodeWarningCountdown}s
                                                    </div>
                                                )}
                                                {phase === "red_light" && myAlive && !isPaused && lifeCodeRefreshedCountdown > 0 && lifeCodeWarningCountdown === 0 && (
                                                    <div className="text-center text-xs font-semibold text-emerald-200/90 bg-emerald-500/10 border border-emerald-500/20 rounded-full py-1">
                                                        {t('game.lifeCodeRefreshed')}
                                                    </div>
                                                )}
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
                                                    <span className="text-xs font-bold uppercase tracking-widest">{t('game.kill')}</span>
                                                </Button>
                                                <Button
                                                    onClick={() => handleSubmitAction("oxygen")}
                                                    disabled={lifeCodeInput.length !== 2 || actionCooldown || isInteractionDisabled}
                                                    className="h-20 rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 disabled:opacity-50 border border-white/10 shadow-lg shadow-emerald-900/40 flex flex-col gap-1"
                                                >
                                                    <Zap className="w-6 h-6 fill-current" />
                                                    <span className="text-xs font-bold uppercase tracking-widest">{t('game.giveOxygen')}</span>
                                                </Button>
                                            </div>

                                            {actionCooldown && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    className="text-center p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20"
                                                >
                                                    <p className="text-yellow-400 text-sm font-medium">{t('game.cooldown')} {cooldownSeconds}s</p>
                                                </motion.div>
                                            )}

                                            {/* Emergency Tasks */}
                                            {(me?.oxygenLeakActive || (goldenRabbitTask && goldenRabbitTask.status !== "resolved")) && (
                                                <div className="space-y-3 pt-2 border-t border-white/10">
                                                    <div className="flex items-center gap-2 text-xs text-white/50 uppercase tracking-widest">
                                                        <Siren className="w-3 h-3" />
                                                        {t('emergency.title')}
                                                    </div>
                                                    {me?.oxygenLeakActive && (
                                                        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                                                            <div className="font-semibold">{t('emergency.oxygenLeak')}</div>
                                                            <div className="mt-1 text-xs text-red-200/70">{t('emergency.oxygenLeakRate')}</div>
                                                        </div>
                                                    )}
                                                    {goldenRabbitTask && me?.location === goldenRabbitTask.location && goldenRabbitTask.status !== "resolved" && (
                                                        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100 space-y-2">
                                                            {goldenRabbitTask.status === "waiting" && (
                                                                <>
                                                                    <div className="font-semibold">{t('emergency.goldenRabbit')}</div>
                                                                    <div className="space-y-2">
                                                                        <Button
                                                                            onClick={handleJoinGoldenRabbit}
                                                                            disabled={isInteractionDisabled || isGoldenRabbitParticipant || goldenRabbitJoinLeft <= 0}
                                                                            className="w-full h-10 rounded-lg bg-amber-500/80 hover:bg-amber-500 text-sm font-bold text-black disabled:opacity-50"
                                                                        >
                                                                            {isGoldenRabbitParticipant ? t('emergency.joined') : t('emergency.joinHunt')}
                                                                        </Button>
                                                                        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                                                            <div
                                                                                className="h-full bg-amber-400"
                                                                                style={{
                                                                                    width: `${Math.min(100, (goldenRabbitJoinLeft / 8) * 100)}%`,
                                                                                }}
                                                                            />
                                                                        </div>
                                                                        <div className="text-xs text-white/70">{t('emergency.countdown')} {goldenRabbitJoinLeft}s</div>
                                                                    </div>
                                                                </>
                                                            )}
                                                            {goldenRabbitTask.status === "active" && (
                                                                <>
                                                                    {isGoldenRabbitParticipant ? (
                                                                        <div className="space-y-2">
                                                                            <div className="text-xs text-amber-300/90 bg-amber-500/10 px-2 py-1 rounded">{t('emergency.huntInstruction')}</div>
                                                                            <div className="grid grid-cols-3 gap-2">
                                                                                {Array.from({ length: 9 }, (_, idx) => {
                                                                                    const blocked = myGoldenRabbitX.includes(idx);
                                                                                    const selected = myGoldenRabbitSelection === idx;
                                                                                    const disabled = blocked || myGoldenRabbitSelection !== undefined || isInteractionDisabled;
                                                                                    return (
                                                                                        <Button
                                                                                            key={idx}
                                                                                            onClick={() => handleGoldenRabbitSubmit(idx)}
                                                                                            disabled={disabled}
                                                                                            className={`h-12 text-lg font-bold ${blocked
                                                                                                ? "bg-white/5 text-red-300/80"
                                                                                                : selected
                                                                                                    ? "bg-emerald-500/70 hover:bg-emerald-500/70 text-white"
                                                                                                    : "bg-white/10 hover:bg-white/20 text-white"
                                                                                                }`}
                                                                                        >
                                                                                            {blocked ? "X" : ""}
                                                                                        </Button>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                            {myGoldenRabbitSelection !== undefined && (
                                                                                <div className="text-xs text-white/70">{t('emergency.selected')}</div>
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-xs text-white/70">{t('emergency.huntInProgress')}</div>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Task Progress & Button */}
                                            <div className="space-y-3 pt-2 border-t border-white/10">
                                                <div className="space-y-2">
                                                    <div className="flex items-center justify-between text-xs text-white/50">
                                                        <span className="flex items-center gap-1">
                                                            <ClipboardList className="w-3 h-3" />
                                                            {t('game.taskProgress')}
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
                                                        disabled={showMiniGame || isInteractionDisabled || taskCooldown}
                                                        className="h-14 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-sm font-bold flex flex-col gap-1"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <ClipboardList className="w-4 h-4" />
                                                            {t('game.personalTask')}
                                                        </div>
                                                        <span className="text-[11px] text-white/80">{personalTaskProgressLabel}</span>
                                                    </Button>
                                                    {soloLocationEffect ? (() => {
                                                        const LocationIcon = LOCATION_ICONS[soloLocationEffect];
                                                        // 场所效果被禁用时显示灰色禁用按钮
                                                        if (soloEffectsDisabled) {
                                                            return (
                                                                <Button
                                                                    disabled
                                                                    className="h-14 rounded-xl border border-white/10 bg-slate-700/50 text-sm font-bold flex flex-col gap-1 text-white/50 cursor-not-allowed"
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <LocationIcon className="w-4 h-4" />
                                                                        {t('locationEffect.disabled', '场所效果')}
                                                                    </div>
                                                                    <span className="text-[11px] text-white/40">
                                                                        {t('locationEffect.disabledDesc', '本局已禁用')}
                                                                    </span>
                                                                </Button>
                                                            );
                                                        }
                                                        if (soloLocationEffect === "监控室") {
                                                            return (
                                                                <Button
                                                                    onClick={handleMonitorPeek}
                                                                    disabled={isInteractionDisabled || showMiniGame || monitorUsed}
                                                                    className="h-14 rounded-xl border border-white/10 bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-sm font-bold flex flex-col gap-1 text-white"
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <LocationIcon className="w-4 h-4" />
                                                                        {t('locationEffect.monitor')}
                                                                    </div>
                                                                    <span className="text-[11px] text-white/80">
                                                                        {monitorUsed ? t('locationEffect.usedThisRound') : t('locationEffect.monitorDesc')}
                                                                    </span>
                                                                </Button>
                                                            );
                                                        }
                                                        if (soloLocationEffect === "发电室") {
                                                            return (
                                                                <Button
                                                                    onClick={handlePowerBoost}
                                                                    disabled={isInteractionDisabled || showMiniGame || powerBoostUsed}
                                                                    className="h-14 rounded-xl border border-white/10 bg-gradient-to-r from-amber-600 to-yellow-500 hover:from-amber-500 hover:to-yellow-400 text-sm font-bold flex flex-col gap-1 text-white"
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <LocationIcon className="w-4 h-4" />
                                                                        {t('locationEffect.power')}
                                                                    </div>
                                                                    <span className="text-[11px] text-white/90">
                                                                        {powerBoostUsed ? t('locationEffect.usedThisRound') : t('locationEffect.powerDesc')}
                                                                    </span>
                                                                </Button>
                                                            );
                                                        }
                                                        if (soloLocationEffect === "厨房") {
                                                            return (
                                                                <Button
                                                                    onClick={handleKitchenOxygen}
                                                                    disabled={isInteractionDisabled || showMiniGame || kitchenUsed}
                                                                    className="h-14 rounded-xl border border-white/10 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-sm font-bold flex flex-col gap-1 text-white"
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <LocationIcon className="w-4 h-4" />
                                                                        {t('locationEffect.kitchen')}
                                                                    </div>
                                                                    <span className="text-[11px] text-white/90">
                                                                        {kitchenUsed ? t('locationEffect.usedThisRound') : t('locationEffect.kitchenDesc')}
                                                                    </span>
                                                                </Button>
                                                            );
                                                        }
                                                        if (soloLocationEffect === "医务室") {
                                                            return (
                                                                <Button
                                                                    onClick={handleMedicalOpen}
                                                                    disabled={isInteractionDisabled || showMiniGame || medicalUsed}
                                                                    className="h-14 rounded-xl border border-white/10 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-sm font-bold flex flex-col gap-1 text-white"
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <LocationIcon className="w-4 h-4" />
                                                                        {t('locationEffect.medical')}
                                                                    </div>
                                                                    <span className="text-[11px] text-white/90">
                                                                        {medicalUsed ? t('locationEffect.usedThisRound') : t('locationEffect.medicalDesc')}
                                                                    </span>
                                                                </Button>
                                                            );
                                                        }
                                                        if (soloLocationEffect === "仓库") {
                                                            return (
                                                                <Button
                                                                    onClick={handleWarehouseOxygen}
                                                                    disabled={isInteractionDisabled || showMiniGame || warehouseUsed}
                                                                    className="h-14 rounded-xl border border-white/10 bg-gradient-to-r from-indigo-700 to-slate-700 hover:from-indigo-600 hover:to-slate-600 text-sm font-bold flex flex-col gap-1 text-white"
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <LocationIcon className="w-4 h-4" />
                                                                        {t('locationEffect.warehouse')}
                                                                    </div>
                                                                    <span className="text-[11px] text-white/90">
                                                                        {warehouseUsed ? t('locationEffect.usedThisRound') : t('locationEffect.warehouseDesc')}
                                                                    </span>
                                                                </Button>
                                                            );
                                                        }
                                                        if (soloLocationEffect === "调度室") {
                                                            return (
                                                                <Button
                                                                    onClick={handleDispatchRoom}
                                                                    disabled={isInteractionDisabled || showMiniGame || dispatchUsed}
                                                                    className="h-14 rounded-xl border border-white/10 bg-gradient-to-r from-cyan-700 to-blue-700 hover:from-cyan-600 hover:to-blue-600 text-sm font-bold flex flex-col gap-1 text-white"
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <LocationIcon className="w-4 h-4" />
                                                                        {t('locationEffect.dispatch')}
                                                                    </div>
                                                                    <span className="text-[11px] text-white/90">
                                                                        {dispatchUsed ? t('locationEffect.usedThisRound') : t('locationEffect.dispatchDesc')}
                                                                    </span>
                                                                </Button>
                                                            );
                                                        }
                                                        if (soloLocationEffect === "休眠舱") {
                                                            return (
                                                                <Button
                                                                    onClick={handleStasisPod}
                                                                    disabled={isInteractionDisabled || showMiniGame || stasisUsed}
                                                                    className="h-14 rounded-xl border border-white/10 bg-gradient-to-r from-violet-700 to-purple-700 hover:from-violet-600 hover:to-purple-600 text-sm font-bold flex flex-col gap-1 text-white"
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <LocationIcon className="w-4 h-4" />
                                                                        {t('locationEffect.stasis')}
                                                                    </div>
                                                                    <span className="text-[11px] text-white/90">
                                                                        {stasisUsed ? t('locationEffect.usedThisRound') : t('locationEffect.stasisDesc')}
                                                                    </span>
                                                                </Button>
                                                            );
                                                        }
                                                        return null;  // fallback for unknown locations
                                                    })() : (
                                                        <Button
                                                            onClick={handleJoinSharedTask}
                                                            disabled={isInteractionDisabled || !myAlive || !me?.location || sameLocationCount < 2 || taskCooldown}
                                                            className="h-14 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-700 to-amber-600 hover:from-amber-600 hover:to-amber-500 text-sm font-bold flex flex-col gap-1 text-white"
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <Users className="w-4 h-4" />
                                                                {t('game.sharedTask')}
                                                            </div>
                                                            <span className="text-[11px] text-white/80">{t('sharedTask.eachPersonProgress')}</span>
                                                        </Button>
                                                    )}
                                                </div>
                                                {/* 验尸鹅特殊能力 - 横向滚动carousel */}
                                                {me?.role === "coroner_goose" && phase === "red_light" && (() => {
                                                    const playersAtLocation = jokerPlayers.filter(p => p.location === me.location && p.isAlive && p.sessionId !== me.sessionId);
                                                    const isAlone = playersAtLocation.length === 0;
                                                    if (!isAlone) return null;

                                                    // All revealed deaths (not just uninvestigated)
                                                    const revealedDeaths = jokerSnapshot?.deaths?.filter(d => d.revealed) ?? [];
                                                    // Has the coroner used their ability this round?
                                                    const usedThisRound = coronerEmptyChecked;

                                                    return (
                                                        <div className="space-y-2">
                                                            <div className="text-xs text-purple-400/80 pl-1">验尸调查</div>
                                                            <div className="flex gap-2 overflow-x-auto pb-1">
                                                                {revealedDeaths.length === 0 ? (
                                                                    <Button
                                                                        disabled
                                                                        className="h-10 px-4 rounded-lg bg-purple-500/20 text-purple-300/50 text-sm"
                                                                    >
                                                                        暂无死者
                                                                    </Button>
                                                                ) : (
                                                                    revealedDeaths.map(d => {
                                                                        const alreadyInvestigated = me.investigatedDeaths?.includes(d.sessionId);
                                                                        return (
                                                                            <Button
                                                                                key={d.sessionId}
                                                                                onClick={() => {
                                                                                    handleCoronerInvestigate(d.sessionId);
                                                                                    setCoronerEmptyChecked(true);
                                                                                }}
                                                                                disabled={usedThisRound || alreadyInvestigated}
                                                                                className={`h-10 px-3 rounded-lg text-sm flex items-center gap-2 flex-shrink-0 ${alreadyInvestigated
                                                                                    ? "bg-purple-500/10 text-purple-300/40"
                                                                                    : usedThisRound
                                                                                        ? "bg-purple-500/20 text-purple-300/50"
                                                                                        : "bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white"
                                                                                    }`}
                                                                            >
                                                                                <Avvvatars value={String(d.seat)} size={20} />
                                                                                <span>{d.name}</span>
                                                                                {alreadyInvestigated && <span className="text-xs opacity-60">已调查</span>}
                                                                            </Button>
                                                                        );
                                                                    })
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                                {taskCooldown && (
                                                    <div className="text-center text-xs text-amber-200/80">
                                                        {t('sharedTask.taskCooldown')} {taskCooldownSeconds}s
                                                    </div>
                                                )}
                                                {sharedTask && isSharedParticipant && sharedTask.status !== "resolved" && (
                                                    <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-3 text-center text-sm text-white/70">
                                                        {sharedTask.status === "waiting" && (
                                                            <div>
                                                                {t('sharedTask.waitingOthers')}
                                                                <div className="mt-1 text-xs text-white/50">
                                                                    {t('sharedTask.joined')} {sharedTask.joined.length}/{sharedTask.participants.length}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {sharedTask.status === "active" && (
                                                            <div className="space-y-2">
                                                                <div>{t('sharedTask.inProgress')} {sharedTimeLeft}s</div>
                                                                {sharedTask.type === "nine_grid" && mySharedGrid.length === 9 && (
                                                                    <>
                                                                        <div className="text-xs text-amber-300/90 bg-amber-500/10 px-2 py-1 rounded">{t('sharedTask.nineGridInstruction')}</div>
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
                                                                    </>
                                                                )}
                                                                {sharedTask.type === "digit_puzzle" && (
                                                                    <div className="space-y-2 pt-2">
                                                                        <div className="text-xs text-amber-300/90 bg-amber-500/10 px-2 py-1 rounded">{t('sharedTask.digitInstruction')}</div>
                                                                        {renderDigitSegments(myDigitSegments)}
                                                                        {myDigitSegments.length === 0 && (
                                                                            <div className="text-xs text-white/50">{t('sharedTask.noSegments')}</div>
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
                                                                            {t('sharedTask.selected')}{myDigitSelection ?? t('sharedTask.notSelected')}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {sharedTask.type === "nine_grid" && mySharedSelection !== undefined && (
                                                                    <div className="text-xs text-white/60">{t('sharedTask.waitingOtherPlayers')}</div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* 监工鹅特殊能力：调查任务贡献度 - 横向滚动carousel */}
                                    {me?.role === "overseer_goose" && phase === "red_light" && (() => {
                                        const playersAtLocation = jokerPlayers.filter(p => p.location === me.location && p.isAlive && p.sessionId !== me.sessionId);
                                        const isAlone = playersAtLocation.length === 0;
                                        if (!isAlone) return null;

                                        const otherPlayers = jokerPlayers.filter(p => p.sessionId && p.sessionId !== me.sessionId);
                                        const usedThisRound = overseerEmptyChecked;

                                        return (
                                            <div className="space-y-2">
                                                <div className="text-xs text-cyan-400/80 pl-1">任务贡献度调查</div>
                                                <div className="flex gap-2 overflow-x-auto pb-1">
                                                    {otherPlayers.length === 0 ? (
                                                        <Button
                                                            disabled
                                                            className="h-10 px-4 rounded-lg bg-cyan-500/20 text-cyan-300/50 text-sm"
                                                        >
                                                            暂无可调查目标
                                                        </Button>
                                                    ) : (
                                                        otherPlayers.map(p => (
                                                            <Button
                                                                key={p.sessionId}
                                                                onClick={() => {
                                                                    handleOverseerInvestigate(p.sessionId!);
                                                                    setOverseerEmptyChecked(true);
                                                                }}
                                                                disabled={usedThisRound}
                                                                className={`h-10 px-3 rounded-lg text-sm flex items-center gap-2 flex-shrink-0 ${usedThisRound
                                                                    ? "bg-cyan-500/20 text-cyan-300/50"
                                                                    : "bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white"
                                                                    }`}
                                                            >
                                                                <Avvvatars value={String(p.seat)} size={20} />
                                                                <span>{p.name}</span>
                                                            </Button>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Players Nearby */}
                                    {me?.location && (
                                        <div className="space-y-3">
                                            <p className="text-xs font-medium text-white/40 uppercase tracking-widest pl-2">
                                                {t('game.nearbyPlayers')} - {t(`locations.${LOCATION_KEY_MAP[me.location]}`)}
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
                                                        {t('game.noOneHere')}
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
                                        {t('game.reportBody')}
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
                                        {t('meeting.title')}
                                    </h2>
                                    {/* 显示拉铃信息 */}
                                    <div className="mb-4 space-y-3">
                                        <div className="flex items-center justify-center gap-2 text-white/90 text-lg">
                                            <Siren className="w-5 h-5 text-blue-400" />
                                            {jokerSnapshot?.meeting?.triggerType === "system"
                                                ? <span>{t('meeting.systemTrigger')}</span>
                                                : (
                                                    <div className="flex items-center gap-2">
                                                        <Avvvatars value={String(jokerSnapshot?.meeting?.triggerPlayerSeat ?? "?")} size={24} />
                                                        <span>{jokerSnapshot?.meeting?.triggerPlayerName ?? t('game.player')} {t('meeting.playerTrigger')}</span>
                                                    </div>
                                                )}
                                        </div>
                                        {(jokerSnapshot?.meeting?.deathCount ?? 0) > 0 && (
                                            <>
                                                <div className="flex items-center justify-center gap-2 text-red-400 text-base font-medium">
                                                    <Skull className="w-4 h-4" />
                                                    <span>{t('meeting.deathCount', { count: jokerSnapshot?.meeting?.deathCount })}</span>
                                                </div>
                                                {/* 显示死亡玩家列表 */}
                                                <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                                                    {jokerSnapshot?.deaths
                                                        .filter(d => d.revealed && d.round === jokerSnapshot.roundCount)
                                                        .map(d => (
                                                            <div key={d.sessionId} className="flex items-center gap-1.5 bg-red-500/20 px-2 py-1 rounded-lg border border-red-500/30">
                                                                <Avvvatars value={String(d.seat)} size={20} />
                                                                <span className="text-sm text-red-300">{d.name}</span>
                                                            </div>
                                                        ))}
                                                </div>
                                            </>
                                        )}
                                        {(jokerSnapshot?.meeting?.deathCount ?? 0) === 0 && (
                                            <div className="flex items-center justify-center gap-2 text-green-400/80 text-base">
                                                <CheckCircle2 className="w-4 h-4" />
                                                <span>{t('meeting.noDeaths')}</span>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-white/70 max-w-xs mx-auto">{t('meeting.discussWho')}</p>
                                    {isHost && (
                                        <div className="mt-6 flex items-center justify-center gap-3">
                                            <Button
                                                onClick={handleMeetingStartVote}
                                                disabled={isInteractionDisabled}
                                                className="h-12 px-5 bg-white text-black hover:bg-white/90"
                                            >
                                                {t('meeting.startVote')}
                                            </Button>
                                            <Button
                                                onClick={handleMeetingExtend}
                                                variant="outline"
                                                disabled={isInteractionDisabled}
                                                className="h-12 px-5 border-white/20 bg-white/10 text-white hover:bg-white/20"
                                            >
                                                {t('meeting.extend30s')}
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
                                                    <Hand className="w-5 h-5" /> {t('voting.castYourVote')}
                                                </CardTitle>
                                                {isHost && (
                                                    <Button
                                                        onClick={handleVotingExtend}
                                                        variant="outline"
                                                        disabled={isInteractionDisabled}
                                                        className="h-9 px-3 border-white/20 bg-white/10 text-white hover:bg-white/20"
                                                    >
                                                        {t('meeting.extend30s')}
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
                                                                onClick={() => handleVoteClick(p.sessionId!, p.name || `${t('game.player')}${p.seat}`)}
                                                                disabled={me?.hasVoted || isInteractionDisabled}
                                                                className={`w-full justify-between h-14 rounded-xl px-4 border ${me?.hasVoted ? "opacity-50 grayscale" : "hover:scale-[1.02]"
                                                                    } transition-all bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20`}
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <Avvvatars value={String(p.seat)} size={32} />
                                                                    <span>{p.name}</span>
                                                                    {p.sessionId === me?.sessionId && (
                                                                        <Badge className="bg-white/10 text-white/60 border-white/10 hover:bg-white/10">
                                                                            {t('voting.self')}
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                <div className="text-xs text-white/30 uppercase tracking-wider">{t('voting.vote')}</div>
                                                            </Button>
                                                        ))}
                                                </div>
                                            </ScrollArea>

                                            <div className="pt-4 border-t border-white/10 mt-4">
                                                <Button
                                                    onClick={() => handleVoteClick(null, t('voting.abstain'))}
                                                    variant="ghost"
                                                    className="w-full text-white/50 hover:text-white hover:bg-white/5 flex items-center gap-2"
                                                    disabled={me?.hasVoted || isInteractionDisabled}
                                                >
                                                    <SkipForward className="w-4 h-4" />
                                                    {t('voting.abstain')}
                                                </Button>
                                            </div>

                                            {me?.hasVoted && (
                                                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mt-4 p-4 bg-green-500/20 border border-green-500/30 rounded-xl text-center">
                                                    <span className="text-green-300 font-bold flex items-center justify-center gap-2">
                                                        <Vote className="w-5 h-5 fill-current" /> {t('voting.recorded')}
                                                    </span>
                                                    {myVoteLabel && (
                                                        <div className="text-xs text-white/70 mt-2">
                                                            {t('voting.yourChoice')}{myVoteLabel}
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
                                                <Avvvatars value={String(executedPlayer?.seat ?? "?")} size={120} />
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
                                                    {executedPlayer?.name}
                                                    {executedPlayer?.seat ? `（${t('game.seat')}${executedPlayer.seat}）` : ""}
                                                </h3>
                                                <p className="text-red-400 font-mono uppercase tracking-widest text-lg">
                                                    {t('execution.roleIs')} {jokerSnapshot.execution.executedRole
                                                        ? t(`roles.${jokerSnapshot.execution.executedRole}`)
                                                        : t('common.unknown')}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-8 bg-white/5 rounded-3xl border border-white/10">
                                            <p className="text-xl text-white/70 italic">
                                                {t('execution.tieOrAbstain')}
                                                <br />
                                                <span className="font-bold text-white not-italic mt-2 block">{t('execution.noOneEjected')}</span>
                                            </p>
                                        </div>
                                    )}
                                    {jokerSnapshot.voting && (
                                        <div className="mt-8">
                                            <Card className="bg-black/20 backdrop-blur-xl border-white/10 text-left">
                                                <CardHeader>
                                                    <CardTitle className="text-sm uppercase tracking-widest text-white/50">{t('execution.votingResults')}</CardTitle>
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
                                                                        {votes} {t('voting.votes')}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        <div className="flex items-center justify-between p-3 rounded-lg border border-white/10 bg-white/5">
                                                            <div className="flex items-center gap-3">
                                                                <span className="font-medium text-white">{t('voting.abstain')}</span>
                                                            </div>
                                                            <span className="font-mono text-white/80">
                                                                {jokerSnapshot.voting.skipCount} {t('voting.votes')}
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
                                                {t(`roles.${jokerSnapshot.gameResult.winner}`)}{t('gameOver.wins')}
                                            </h1>
                                        </motion.div>
                                        <p className="text-white/60 text-lg">{t(`gameOver.reason.${jokerSnapshot.gameResult.reason}`)}</p>
                                    </div>

                                    <Card className="bg-black/20 backdrop-blur-xl border-white/10 text-left">
                                        <CardHeader>
                                            <CardTitle className="text-sm uppercase tracking-widest text-white/50">{t('gameOver.roleReveal')}</CardTitle>
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
                                                            className={`flex justify-between items-center p-3 rounded-lg border ${ROLE_CARD_STYLES[p.role ?? "goose"].card}`}
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <Avvvatars value={String(p.seat)} size={32} />
                                                                <span className="font-medium text-white">{p.name}</span>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <Badge variant="outline" className={ROLE_CARD_STYLES[p.role ?? "goose"].badge}>
                                                                    {t(`roles.${p.role ?? "goose"}`)}
                                                                </Badge>
                                                                <Badge className={p.isAlive ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/30 hover:bg-emerald-500/30" : "bg-red-500/20 text-red-200 border-red-500/30 hover:bg-red-500/30"}>
                                                                    {p.isAlive ? t('gameOver.alive') : t('gameOver.dead')}
                                                                </Badge>
                                                            </div>
                                                        </motion.div>
                                                    ))}
                                                </div>
                                            </ScrollArea>
                                        </CardContent>
                                    </Card>

                                    <div className="flex gap-3">
                                        <Button
                                            onClick={() => setShowReview(true)}
                                            variant="outline"
                                            size="lg"
                                            className="flex-1 h-14 text-lg font-bold rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20"
                                        >
                                            <Eye className="w-5 h-5 mr-2" />{t('gameOver.review')}
                                        </Button>
                                        {isHost && (
                                            <Button onClick={handleResetGame} size="lg" className="flex-1 h-14 text-lg font-bold rounded-xl bg-white text-black hover:bg-white/90">
                                                <RotateCcw className="w-5 h-5 mr-2" />{t('gameOver.playAgain')}
                                            </Button>
                                        )}
                                    </div>
                                </motion.div>
                            )}

                        </motion.div>
                    </AnimatePresence>
                </ScrollArea>
            </div >

            {/* Mini-Game Overlay */}
            <AnimatePresence>
                {
                    showMiniGame && currentGameType && (
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
                    )
                }
            </AnimatePresence >
            <Dialog open={showMedicalDialog} onOpenChange={setShowMedicalDialog}>
                <DialogContent className="bg-slate-950/95 text-white border-white/10">
                    <DialogHeader>
                        <DialogTitle>{t('locationEffect.medical')}</DialogTitle>
                        <DialogDescription className="text-white/60">
                            {t('medical.selectPlayer')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2">
                        {medicalTargets.map(target => (
                            <Button
                                key={target.sessionId}
                                onClick={() => handleMedicalSelect(target.sessionId!)}
                                className="justify-between bg-white/5 border border-white/10 hover:bg-white/10"
                            >
                                <div className="flex items-center gap-2">
                                    <Avvvatars value={String(target.seat)} size={24} />
                                    <span className="font-medium text-white">
                                        {target.name || `${t('game.player')}${target.seat}`}
                                    </span>
                                </div>
                                <span className="text-xs text-white/60">{t('game.seat')} {target.seat}</span>
                            </Button>
                        ))}
                        {medicalTargets.length === 0 && (
                            <div className="text-center text-sm text-white/50">{t('medical.noTargets')}</div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
            {/* Monitor Location Selection Dialog */}
            <Dialog open={showMonitorLocationDialog} onOpenChange={setShowMonitorLocationDialog}>
                <DialogContent className="bg-slate-950/95 text-white border-white/10">
                    <DialogHeader>
                        <DialogTitle>{t('locationEffect.monitor')}</DialogTitle>
                        <DialogDescription className="text-white/60">
                            {t('monitor.selectLocation')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2">
                        {(jokerSnapshot?.activeLocations ?? []).filter(loc => loc !== '监控室').map(loc => {
                            const LocationIcon = LOCATION_ICONS[loc];
                            return (
                                <Button
                                    key={loc}
                                    onClick={() => handleMonitorLocationSelect(loc)}
                                    className="justify-between bg-white/5 border border-white/10 hover:bg-white/10"
                                >
                                    <div className="flex items-center gap-2">
                                        <LocationIcon className="w-5 h-5" />
                                        <span className="font-medium text-white">
                                            {t(`locations.${LOCATION_KEY_MAP[loc]}`)}
                                        </span>
                                    </div>
                                </Button>
                            );
                        })}
                    </div>
                </DialogContent>
            </Dialog>
            {/* Review Dialog */}
            <Dialog open={showReview} onOpenChange={setShowReview}>
                <DialogContent className="bg-slate-950/95 text-white border-white/10 max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Eye className="w-5 h-5" />
                            {t('gameOver.reviewTitle')}
                        </DialogTitle>
                        <DialogDescription className="text-white/60">
                            {t('gameOver.reviewDescription')}
                        </DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="flex-1 pr-4">
                        <JokerGameReview
                            deaths={jokerSnapshot?.deaths ?? []}
                            votingHistory={jokerSnapshot?.votingHistory ?? []}
                            players={jokerPlayers}
                            locationHistory={jokerSnapshot?.locationHistory}
                            taskContributionBySession={jokerSnapshot?.round?.taskContributionBySession}
                        />
                    </ScrollArea>
                </DialogContent>
            </Dialog>
            {/* Vote Confirmation Dialog */}
            <Dialog open={!!pendingVoteTarget} onOpenChange={(open) => !open && setPendingVoteTarget(null)}>
                <DialogContent className="bg-slate-950/95 text-white border-white/10 max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Vote className="w-5 h-5" />
                            {t('voting.confirmTitle', '确认投票')}
                        </DialogTitle>
                        <DialogDescription className="text-white/60">
                            {pendingVoteTarget?.sessionId === null
                                ? t('voting.confirmAbstain', '确定要弃票吗？')
                                : t('voting.confirmVoteFor', { name: pendingVoteTarget?.name ?? '' })}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex gap-3 pt-2">
                        <Button
                            variant="outline"
                            className="flex-1 border-white/20 bg-white/10 text-white hover:bg-white/20"
                            onClick={() => setPendingVoteTarget(null)}
                        >
                            {t('common.cancel', '取消')}
                        </Button>
                        <Button
                            className="flex-1 bg-white text-black hover:bg-white/90"
                            onClick={handleVoteConfirm}
                        >
                            {t('common.confirm', '确认')}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
            {ConfirmDialogElement}
            <Toaster position="top-center" richColors theme="dark" />
        </div >
    );
}
