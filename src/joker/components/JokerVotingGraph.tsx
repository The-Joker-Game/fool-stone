// src/joker/components/JokerVotingGraph.tsx
import { useMemo, useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import Avvvatars from "avvvatars-react";
import type { JokerPlayerState, JokerVoteEntry, JokerRole } from "../types";
import { useTranslation } from "react-i18next";
import { GiDuck, GiGoose, GiChicken, GiEagleHead } from "react-icons/gi";

interface JokerVotingGraphProps {
    players: JokerPlayerState[];
    votes: JokerVoteEntry[];
    showRole?: boolean;
}

// Removed ROLE_LABELS, using translation instead

const ROLE_COLORS: Record<JokerRole, string> = {
    duck: "bg-orange-500 text-white border-orange-600",
    goose: "bg-emerald-500 text-white border-emerald-600",
    dodo: "bg-purple-500 text-white border-purple-600",
    hawk: "bg-blue-500 text-white border-blue-600",
    // Special goose roles
    vigilante_goose: "bg-emerald-600 text-white border-emerald-700",
    sheriff_goose: "bg-emerald-600 text-white border-emerald-700",
    coroner_goose: "bg-emerald-600 text-white border-emerald-700",
    overseer_goose: "bg-emerald-600 text-white border-emerald-700",
    // Special duck roles
    poisoner_duck: "bg-orange-600 text-white border-orange-700",
    saboteur_duck: "bg-orange-600 text-white border-orange-700",
    // Neutral birds
    falcon: "bg-blue-600 text-white border-blue-700",
    woodpecker: "bg-blue-600 text-white border-blue-700",
};

const ROLE_ICONS: Record<JokerRole, React.ElementType> = {
    duck: GiDuck,
    goose: GiGoose,
    dodo: GiChicken,
    hawk: GiEagleHead,
    // Special goose roles
    vigilante_goose: GiGoose,
    sheriff_goose: GiGoose,
    coroner_goose: GiGoose,
    overseer_goose: GiGoose,
    // Special duck roles
    poisoner_duck: GiDuck,
    saboteur_duck: GiDuck,
    // Neutral birds
    falcon: GiEagleHead,
    woodpecker: GiEagleHead,
};

export function JokerVotingGraph({ players, votes, showRole = false }: JokerVotingGraphProps) {
    const { t } = useTranslation();
    const [hoveredState, setHoveredState] = useState<{ sessionId: string; side: "voter" | "target" } | null>(null);
    const [focusedState, setFocusedState] = useState<{ sessionId: string; side: "voter" | "target" } | null>(null);
    const [middleWidth, setMiddleWidth] = useState(100);
    const middleRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!middleRef.current) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.contentRect.width > 0) {
                    setMiddleWidth(entry.contentRect.width);
                }
            }
        });
        observer.observe(middleRef.current);
        return () => observer.disconnect();
    }, []);

    // Get player info by sessionId
    const getPlayer = (sessionId: string | null) =>
        players.find((p) => p.sessionId === sessionId);

    // 1. Group votes by target (only non-skip votes)
    const votesByTarget = useMemo(() => {
        const map = new Map<string, string[]>();
        votes.forEach((v) => {
            if (v.targetSessionId) {
                const list = map.get(v.targetSessionId) || [];
                list.push(v.voterSessionId);
                map.set(v.targetSessionId, list);
            }
        });
        return map;
    }, [votes]);

    // 2. Identify all participants
    const voterSessionIds = useMemo(() => {
        const list: string[] = [];
        votes.forEach((v) => {
            if (!list.includes(v.voterSessionId)) {
                list.push(v.voterSessionId);
            }
        });
        // Sort by seat
        return list.sort((a, b) => {
            const seatA = getPlayer(a)?.seat ?? 99;
            const seatB = getPlayer(b)?.seat ?? 99;
            return seatA - seatB;
        });
    }, [votes, players]);

    const targetSessionIds = useMemo(() => {
        const list = Array.from(votesByTarget.keys());
        return list.sort((a, b) => {
            const seatA = getPlayer(a)?.seat ?? 99;
            const seatB = getPlayer(b)?.seat ?? 99;
            return seatA - seatB;
        });
    }, [votesByTarget, players]);

    // Count skips
    const skipCount = useMemo(() => {
        return votes.filter(v => v.targetSessionId === null).length;
    }, [votes]);

    // 3. Layout constants
    const ROW_HEIGHT = 48;
    const AVATAR_SIZE = 28;
    const COLUMN_WIDTH = 60;

    // Calculate total height based on the longer list (include skip row if there are skips)
    const totalRows = Math.max(voterSessionIds.length, targetSessionIds.length + (skipCount > 0 ? 1 : 0));
    const totalHeight = totalRows * ROW_HEIGHT;

    // Helper to get Y position for an index
    const getY = (index: number) => index * ROW_HEIGHT + ROW_HEIGHT / 2;

    // Determine the active state for visualization
    const activeState = focusedState || hoveredState;

    const handleItemClick = (sessionId: string, side: "voter" | "target") => {
        if (focusedState?.sessionId === sessionId && focusedState?.side === side) {
            setFocusedState(null);
        } else {
            setFocusedState({ sessionId, side });
        }
    };

    if (voterSessionIds.length === 0) {
        return <div className="text-center text-white/50 py-4 text-sm">{t('voting.noVotes')}</div>;
    }

    return (
        <div className="w-full text-white">
            <div
                className="flex w-full items-stretch relative"
                style={{ height: totalHeight + 16, padding: "8px 0" }}
            >
                {/* Left Column: Voters */}
                <div className="flex-none relative" style={{ width: COLUMN_WIDTH }}>
                    {voterSessionIds.map((sessionId, index) => {
                        const player = getPlayer(sessionId);

                        const isHovered = activeState?.side === "voter" && activeState.sessionId === sessionId;
                        const isRelated = activeState?.side === "target" &&
                            votes.some(v => v.targetSessionId === activeState.sessionId && v.voterSessionId === sessionId);

                        const shouldDim = activeState !== null && !isHovered && !isRelated;
                        const isFocused = focusedState?.side === "voter" && focusedState.sessionId === sessionId;

                        return (
                            <div
                                key={`voter-${sessionId}`}
                                className={`absolute left-0 w-full flex flex-col items-center justify-center gap-0.5 transition-opacity duration-200 cursor-pointer ${shouldDim ? "opacity-30" : "opacity-100"}`}
                                style={{ top: getY(index) - ROW_HEIGHT / 2, height: ROW_HEIGHT }}
                                onMouseEnter={() => setHoveredState({ sessionId, side: "voter" })}
                                onMouseLeave={() => setHoveredState(null)}
                                onClick={() => handleItemClick(sessionId, "voter")}
                            >
                                <div className={`relative rounded-full transition-all duration-200 ${isFocused ? "ring-2 ring-offset-1 ring-blue-500 ring-offset-transparent" : ""}`}>
                                    <Avvvatars value={String(player?.seat || sessionId)} size={AVATAR_SIZE} />
                                    {showRole && player?.role && (
                                        <div className={`absolute -bottom-1 -right-1 p-0.5 rounded-full border ${ROLE_COLORS[player.role]} z-20 bg-gray-900`}>
                                            {(() => {
                                                const Icon = ROLE_ICONS[player.role];
                                                return <Icon className="w-2.5 h-2.5" />;
                                            })()}
                                        </div>
                                    )}
                                </div>
                                <div className="text-[9px] truncate max-w-full opacity-70 text-center px-0.5">
                                    {player?.name || t('game.player')}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Middle: SVG Connections */}
                <div ref={middleRef} className="flex-1 relative min-w-[30px]">
                    <svg
                        className="absolute inset-0 pointer-events-none"
                        width={middleWidth}
                        height={totalHeight}
                        viewBox={`0 0 ${middleWidth} ${totalHeight}`}
                        style={{ overflow: "visible" }}
                    >
                        {votes.filter(v => v.targetSessionId !== null).map((vote, i) => {
                            const voterIndex = voterSessionIds.indexOf(vote.voterSessionId);
                            const targetIndex = targetSessionIds.indexOf(vote.targetSessionId!);

                            if (voterIndex === -1 || targetIndex === -1) return null;

                            const startY = getY(voterIndex);
                            const endY = getY(targetIndex);

                            // Bezier curve control points
                            const startX = 0;
                            const endX = middleWidth;
                            const cp1X = middleWidth * 0.5;
                            const cp2X = middleWidth * 0.5;

                            const pathData = `M ${startX} ${startY} C ${cp1X} ${startY}, ${cp2X} ${endY}, ${endX} ${endY}`;

                            const isHighlighted =
                                (activeState?.side === "voter" && activeState.sessionId === vote.voterSessionId) ||
                                (activeState?.side === "target" && activeState.sessionId === vote.targetSessionId);

                            const isDimmed = activeState !== null && !isHighlighted;

                            return (
                                <motion.path
                                    key={`link-${vote.voterSessionId}-${vote.targetSessionId}`}
                                    d={pathData}
                                    fill="none"
                                    stroke="white"
                                    strokeWidth={isHighlighted ? 2.5 : 1.5}
                                    strokeOpacity={isHighlighted ? 0.8 : isDimmed ? 0.05 : 0.25}
                                    initial={{ pathLength: 0, opacity: 0 }}
                                    animate={{ pathLength: 1, opacity: 1 }}
                                    transition={{ duration: 0.4, delay: i * 0.03 }}
                                />
                            );
                        })}
                    </svg>
                </div>

                {/* Right Column: Targets */}
                <div className="flex-none relative" style={{ width: COLUMN_WIDTH }}>
                    {targetSessionIds.map((sessionId, index) => {
                        const player = getPlayer(sessionId);
                        const voteCount = votesByTarget.get(sessionId)?.length || 0;

                        const isHovered = activeState?.side === "target" && activeState.sessionId === sessionId;
                        const isRelated = activeState?.side === "voter" &&
                            votes.some(v => v.voterSessionId === activeState.sessionId && v.targetSessionId === sessionId);

                        const shouldDim = activeState !== null && !isHovered && !isRelated;
                        const isFocused = focusedState?.side === "target" && focusedState.sessionId === sessionId;

                        return (
                            <div
                                key={`target-${sessionId}`}
                                className={`absolute right-0 w-full flex flex-col items-center justify-center gap-0.5 transition-opacity duration-200 cursor-pointer ${shouldDim ? "opacity-30" : "opacity-100"}`}
                                style={{ top: getY(index) - ROW_HEIGHT / 2, height: ROW_HEIGHT }}
                                onMouseEnter={() => setHoveredState({ sessionId, side: "target" })}
                                onMouseLeave={() => setHoveredState(null)}
                                onClick={() => handleItemClick(sessionId, "target")}
                            >
                                <div className={`relative rounded-full transition-all duration-200 ${isFocused ? "ring-2 ring-offset-1 ring-blue-500 ring-offset-transparent" : ""}`}>
                                    <Avvvatars value={String(player?.seat || sessionId)} size={AVATAR_SIZE} />
                                    {showRole && player?.role && (
                                        <div className={`absolute -bottom-1 -right-1 p-0.5 rounded-full border ${ROLE_COLORS[player.role]} z-30 bg-gray-900`}>
                                            {(() => {
                                                const Icon = ROLE_ICONS[player.role];
                                                return <Icon className="w-2.5 h-2.5" />;
                                            })()}
                                        </div>
                                    )}
                                    <div className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[8px] w-3.5 h-3.5 flex items-center justify-center rounded-full shadow-sm z-20">
                                        {voteCount}
                                    </div>
                                </div>
                                <div className="text-[9px] truncate max-w-full opacity-70 text-center px-0.5">
                                    {player?.name || t('game.player')}
                                </div>
                            </div>
                        );
                    })}
                    {/* Skip row */}
                    {skipCount > 0 && (
                        <div
                            className="absolute right-0 w-full flex flex-col items-center justify-center gap-0.5 opacity-60"
                            style={{ top: getY(targetSessionIds.length) - ROW_HEIGHT / 2, height: ROW_HEIGHT }}
                        >
                            <div className="w-7 h-7 rounded-full bg-gray-500/30 flex items-center justify-center">
                                <span className="text-[10px] text-white/70">{t('voting.abstainLabel')}</span>
                            </div>
                            <div className="text-[9px] text-white/50">{skipCount} {t('voting.votes')}</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
