import { useState } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Wifi,
    WifiOff,
    Pencil,
    Moon,
    Sun,
    ChevronDown,
    ChevronUp,
    ClockAlert
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
import type { FlowerRole, FlowerPhase, FlowerGameResult } from "../flower/types";

// Constants duplicated from FlowerRoom.tsx to ensure self-containment
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
    day_last_words: "发表遗言",
    game_over: "游戏结束",
};

const RoleIcon = ({ myRole }: { myRole: string }) => {
    const Icon = ROLE_ICONS[myRole];
    return Icon ? <Icon className="w-4 h-4" /> : null;
};

interface GameStatusCardProps {
    connected: boolean;
    roomCode: string | null;
    myRole: FlowerRole | null;
    isNight: boolean;
    name: string;
    flowerPhase: FlowerPhase;
    flowerDayCount: number;
    gameResult: FlowerGameResult | null;
    notificationType: 'vote' | 'night' | 'other';
    timeLeft: number;
    isMyTurn: boolean;
    onEditName: () => void;
}

export function GameStatusCard({
    connected,
    roomCode,
    myRole,
    isNight,
    name,
    flowerPhase,
    flowerDayCount,
    gameResult,
    notificationType,
    timeLeft,
    isMyTurn,
    onEditName
}: GameStatusCardProps) {
    const [isCollapsed, setIsCollapsed] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem("flower-card-collapsed");
            return saved === "true";
        }
        return false;
    });

    const toggleCollapsed = (collapsed: boolean) => {
        setIsCollapsed(collapsed);
        localStorage.setItem("flower-card-collapsed", String(collapsed));
    };

    const themeClass = isNight
        ? "bg-black/40 border-white/10 text-white"
        : "bg-white/80 border-black/10 text-black";

    const mutedTextClass = isNight ? "text-white/50" : "text-black/50";
    const flowerPhaseText = PHASE_TEXT_MAP[flowerPhase] || flowerPhase;

    // Notification content logic
    const renderNotification = () => {
        if (isMyTurn) {
            return (
                <motion.div
                    animate={{ opacity: [1, 0.2, 1] }}
                    transition={{ duration: 0.2, repeat: 4 }}
                    className="font-bold text-red-500"
                >
                    轮到你发言了
                </motion.div>
            );
        }
        if (notificationType === 'vote') {
            return (
                <div className="font-medium text-red-500 flex items-center gap-2">
                    {timeLeft > 0 ? `投票倒计时: ${timeLeft}s` : (
                        <>
                            <ClockAlert className="w-4 h-4" />
                            <span>倒计时结束</span>
                        </>
                    )}
                </div>
            );
        }
        if (notificationType === 'night') {
            return (
                <div className="font-medium text-red-500 flex items-center gap-2">
                    {timeLeft > 0 ? `黑夜倒计时: ${timeLeft}s` : (
                        <>
                            <ClockAlert className="w-4 h-4" />
                            <span>倒计时结束</span>
                        </>
                    )}
                </div>
            );
        }
        return (
            <div className={`text-sm ${isNight ? "text-white/30" : "text-black/50"}`}>
                {flowerPhase === "game_over"
                    ? "游戏结束"
                    : "暂无消息"
                }
            </div>
        );
    };

    const renderCollapsedNotification = () => {
        // Game over result - highest priority
        if (flowerPhase === "game_over" && gameResult) {
            const resultColor = gameResult.winner === "good"
                ? "text-green-600"
                : gameResult.winner === "bad"
                    ? "text-red-600"
                    : "text-gray-400";
            const resultText = gameResult.winner === "good"
                ? "好人胜利"
                : gameResult.winner === "bad"
                    ? "坏人胜利"
                    : "平局";
            return <span className={`${resultColor} font-bold text-sm`}>{resultText}</span>;
        }

        // Other notifications
        if (isMyTurn) return <span className="text-red-500 font-bold">轮到你发言</span>;
        if (notificationType === 'vote' && timeLeft > 0) return <span className="text-red-500 font-bold">{timeLeft}s</span>;
        if (notificationType === 'vote' && timeLeft <= 0) return <ClockAlert className="w-4 h-4 text-red-500" />;
        if (notificationType === 'night' && timeLeft > 0) return <span className="text-red-500 font-bold">{timeLeft}s</span>;
        if (notificationType === 'night' && timeLeft <= 0) return <ClockAlert className="w-4 h-4 text-red-500" />;
        return null;
    };

    return (
        <Card className={`w-full shadow-lg transition-all duration-300 ${themeClass}`}>
            <motion.div layout className="overflow-hidden">
                {/* Header / Collapsed View */}
                <div className="relative">
                    {isCollapsed ? (
                        // Collapsed View
                        <div className="flex items-center justify-between h-14 px-4">
                            {/* Left: Phase Info */}
                            <motion.div
                                layoutId="phase-info"
                                className="flex items-center gap-2 flex-1 min-w-0"
                            >
                                {flowerPhase === "night_actions" ? (
                                    <Moon className="h-4 w-4 text-indigo-200 flex-shrink-0" />
                                ) : flowerPhase === "day_vote" ? (
                                    <Sun className="h-4 w-4 text-orange-500 flex-shrink-0" />
                                ) : (
                                    <div className="w-4 h-4 flex-shrink-0" /> // Placeholder for alignment
                                )}
                                <span className="font-bold whitespace-nowrap">第{flowerDayCount}天</span>
                                <span className="truncate text-sm opacity-80">{flowerPhaseText}</span>
                            </motion.div>

                            {/* Center: Notification (Collapsed) */}
                            <motion.div
                                layoutId={flowerPhase === "game_over" && gameResult ? "game-result" : "notification"}
                                className="flex-shrink-0 mx-2"
                            >
                                {renderCollapsedNotification()}
                            </motion.div>

                            {/* Right: Role & Toggle */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                                {myRole && (
                                    <motion.div layoutId="role-badge">
                                        <Badge variant="outline" className={`flex items-center gap-1 px-2 ${isNight ? "text-white border-white/30" : "border-black/30"}`}>
                                            <RoleIcon myRole={myRole} />
                                            <span className="hidden sm:inline text-xs">{myRole}</span>
                                        </Badge>
                                    </motion.div>
                                )}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => toggleCollapsed(false)}
                                >
                                    <ChevronDown className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ) : (
                        // Expanded Header
                        <CardHeader className="pb-2 pt-4 px-4">
                            <div className="flex items-center gap-2">
                                {connected ? (
                                    <Wifi className="h-4 w-4 text-green-600" />
                                ) : (
                                    <WifiOff className="h-4 w-4 text-destructive" />
                                )}
                                <CardTitle className="text-lg md:text-xl">挪子的花蝴蝶</CardTitle>

                                <div className="ml-auto flex items-center gap-2">
                                    {myRole && (
                                        <motion.div layoutId="role-badge">
                                            <Badge variant="outline" className={`flex items-center gap-1.5 backdrop-sm ${isNight ? "text-white border-black/50 bg-white/50" : "border-black/50 bg-white/50"
                                                }`}>
                                                <RoleIcon myRole={myRole} />
                                                <span>{myRole}</span>
                                            </Badge>
                                        </motion.div>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() => toggleCollapsed(true)}
                                    >
                                        <ChevronUp className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                    )}
                </div>

                {/* Expanded Content Body */}
                <AnimatePresence>
                    {!isCollapsed && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                        >
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
                                                    onClick={onEditName}
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
                                                <motion.div layoutId="game-result">
                                                    <div className={`text-xs ${mutedTextClass}`}>对局结果</div>
                                                    <div className={`font-bold text-lg ${gameResult.winner === "good" ? "text-green-600" : gameResult.winner === "bad" ? "text-red-600" : "text-gray-400"}`}>
                                                        {gameResult.winner === "good" ? "好人胜利" : gameResult.winner === "bad" ? "坏人胜利" : "平局"}
                                                    </div>
                                                </motion.div>
                                                <div>
                                                    <div className={`text-xs ${mutedTextClass}`}>原因</div>
                                                    <div className="text-sm font-medium leading-tight line-clamp-2" title={gameResult.reason}>{gameResult.reason}</div>
                                                </div>
                                            </>
                                        ) : (
                                            <motion.div layoutId="phase-info" className="flex flex-col justify-center space-y-2">
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
                                            </motion.div>
                                        )}
                                    </div>
                                </div>

                                {/* Notification Row */}
                                <motion.div
                                    layoutId="notification"
                                    className="mt-4 pt-3 border-t border-white/10 flex justify-center items-center min-h-[24px]"
                                >
                                    {renderNotification()}
                                </motion.div>
                            </CardContent>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </Card>
    );
}
