import { useMemo, useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import Avvvatars from "avvvatars-react";
import type { FlowerPlayerState, FlowerVoteEntry } from "../types";

interface VotingGraphProps {
    players: FlowerPlayerState[];
    votes: FlowerVoteEntry[];
    isNight: boolean;
    showRole?: boolean;
}

export function VotingGraph({ players, votes, isNight, showRole = false }: VotingGraphProps) {
    const [hoveredState, setHoveredState] = useState<{ seat: number; side: "voter" | "target" } | null>(null);
    const [focusedState, setFocusedState] = useState<{ seat: number; side: "voter" | "target" } | null>(null);
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

    // 1. Group votes by target
    // Map<targetSeat, voterSeats[]>
    const votesByTarget = useMemo(() => {
        const map = new Map<number, number[]>();
        votes.forEach((v) => {
            const list = map.get(v.targetSeat) || [];
            list.push(v.voterSeat);
            map.set(v.targetSeat, list);
        });
        return map;
    }, [votes]);

    // 2. Identify all participants
    const voterSeats = useMemo(() => {
        const set = new Set<number>();
        votes.forEach((v) => set.add(v.voterSeat));
        return Array.from(set).sort((a, b) => a - b);
    }, [votes]);

    const targetSeats = useMemo(() => {
        return Array.from(votesByTarget.keys()).sort((a, b) => a - b);
    }, [votesByTarget]);

    // 3. Layout constants
    const ROW_HEIGHT = showRole ? 70 : 60; // Increase height if showing role
    const AVATAR_SIZE = 32;
    const COLUMN_WIDTH = 70; // Width for the vertical item

    // Calculate total height based on the longer list
    const totalHeight = Math.max(voterSeats.length, targetSeats.length) * ROW_HEIGHT;

    // Helper to get Y position for a seat in a list
    const getY = (index: number) => index * ROW_HEIGHT + ROW_HEIGHT / 2;

    // Helper to get player info
    const getPlayer = (seat: number) => players.find((p) => p.seat === seat);

    // Determine the active state for visualization (focus takes precedence over hover)
    const activeState = focusedState || hoveredState;

    const handleItemClick = (seat: number, side: "voter" | "target") => {
        if (focusedState?.seat === seat && focusedState?.side === side) {
            setFocusedState(null); // Toggle off
        } else {
            setFocusedState({ seat, side });
        }
    };

    return (
        <div className={`w-full ${isNight ? "text-white" : "text-slate-800"}`}>
            <div
                className="flex w-full items-stretch relative"
                style={{ height: totalHeight + 20, padding: "10px 0" }}
            >
                {/* Left Column: Voters */}
                <div className="flex-none relative" style={{ width: COLUMN_WIDTH }}>
                    {voterSeats.map((seat, index) => {
                        const player = getPlayer(seat);

                        // Logic:
                        // If active (hover/focus) this voter -> highlight self
                        // If active a target -> highlight if this voter voted for that target
                        const isHovered = activeState?.side === "voter" && activeState.seat === seat;
                        const isRelated = activeState?.side === "target" && votes.some(v => v.targetSeat === activeState.seat && v.voterSeat === seat);

                        const shouldDim = activeState !== null && !isHovered && !isRelated;
                        const isFocused = focusedState?.side === "voter" && focusedState.seat === seat;

                        return (
                            <div
                                key={`voter-${seat}`}
                                className={`absolute left-0 w-full flex flex-col items-center justify-center gap-1 transition-opacity duration-200 cursor-pointer ${shouldDim ? "opacity-30" : "opacity-100"}`}
                                style={{ top: getY(index) - ROW_HEIGHT / 2, height: ROW_HEIGHT }}
                                onMouseEnter={() => setHoveredState({ seat, side: "voter" })}
                                onMouseLeave={() => setHoveredState(null)}
                                onClick={() => handleItemClick(seat, "voter")}
                            >
                                <div className={`relative rounded-full transition-all duration-200 ${isFocused ? "ring-2 ring-offset-2 ring-indigo-500 ring-offset-transparent" : ""}`}>
                                    <Avvvatars value={player?.name || `Seat ${seat}`} size={AVATAR_SIZE} style="shape" />
                                    <div className="absolute -bottom-1 -right-1 bg-gray-700 text-white text-[10px] px-1 rounded-full leading-tight">
                                        {seat}
                                    </div>
                                </div>
                                <div className="text-[10px] truncate max-w-full opacity-70 text-center px-1">
                                    {player?.name || `玩家${seat}`}
                                </div>
                                {showRole && player?.role && (
                                    <div className="text-[10px] font-bold text-indigo-600 -mt-1">
                                        {player.role}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Middle: SVG Connections (Flex) */}
                <div ref={middleRef} className="flex-1 relative min-w-[40px]">
                    <svg
                        className="absolute inset-0 pointer-events-none"
                        width={middleWidth}
                        height={totalHeight}
                        viewBox={`0 0 ${middleWidth} ${totalHeight}`}
                        style={{ overflow: "visible" }}
                    >
                        <defs>
                            <linearGradient id="gradient-line" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor={isNight ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)"} />
                                <stop offset="100%" stopColor={isNight ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)"} />
                            </linearGradient>
                        </defs>
                        {votes.map((vote, i) => {
                            const voterIndex = voterSeats.indexOf(vote.voterSeat);
                            const targetIndex = targetSeats.indexOf(vote.targetSeat);

                            if (voterIndex === -1 || targetIndex === -1) return null;

                            const startY = getY(voterIndex);
                            const endY = getY(targetIndex);

                            // Bezier curve control points
                            const startX = 0;
                            const endX = middleWidth;
                            const cp1X = middleWidth * 0.5;
                            const cp2X = middleWidth * 0.5;

                            const pathData = `M ${startX} ${startY} C ${cp1X} ${startY}, ${cp2X} ${endY}, ${endX} ${endY}`;

                            // Highlight logic:
                            // 1. Active voter: highlight their vote
                            // 2. Active target: highlight votes targeting them
                            const isHighlighted =
                                (activeState?.side === "voter" && activeState.seat === vote.voterSeat) ||
                                (activeState?.side === "target" && activeState.seat === vote.targetSeat);

                            const isDimmed = activeState !== null && !isHighlighted;

                            return (
                                <motion.path
                                    key={`link-${vote.voterSeat}-${vote.targetSeat}`}
                                    d={pathData}
                                    fill="none"
                                    stroke={isNight ? "white" : "black"}
                                    strokeWidth={isHighlighted ? 3 : 1.5}
                                    strokeOpacity={isHighlighted ? 0.8 : isDimmed ? 0.05 : 0.2}
                                    initial={{ pathLength: 0, opacity: 0 }}
                                    animate={{ pathLength: 1, opacity: 1 }}
                                    transition={{ duration: 0.5, delay: i * 0.05 }}
                                />
                            );
                        })}
                    </svg>
                </div>

                {/* Right Column: Targets */}
                <div className="flex-none relative" style={{ width: COLUMN_WIDTH }}>
                    {targetSeats.map((seat, index) => {
                        const player = getPlayer(seat);
                        const voteCount = votesByTarget.get(seat)?.length || 0;

                        // Logic:
                        // If active this target -> highlight self
                        // If active a voter -> highlight if that voter voted for this target
                        const isHovered = activeState?.side === "target" && activeState.seat === seat;
                        const isRelated = activeState?.side === "voter" && votes.some(v => v.voterSeat === activeState.seat && v.targetSeat === seat);

                        const shouldDim = activeState !== null && !isHovered && !isRelated;
                        const isFocused = focusedState?.side === "target" && focusedState.seat === seat;

                        return (
                            <div
                                key={`target-${seat}`}
                                className={`absolute right-0 w-full flex flex-col items-center justify-center gap-1 transition-opacity duration-200 cursor-pointer ${shouldDim ? "opacity-30" : "opacity-100"}`}
                                style={{ top: getY(index) - ROW_HEIGHT / 2, height: ROW_HEIGHT }}
                                onMouseEnter={() => setHoveredState({ seat, side: "target" })}
                                onMouseLeave={() => setHoveredState(null)}
                                onClick={() => handleItemClick(seat, "target")}
                            >
                                <div className={`relative rounded-full transition-all duration-200 ${isFocused ? "ring-2 ring-offset-2 ring-indigo-500 ring-offset-transparent" : ""}`}>
                                    <Avvvatars value={player?.name || `Seat ${seat}`} size={AVATAR_SIZE} style="shape" />
                                    <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full shadow-sm z-20">
                                        {voteCount}
                                    </div>
                                    <div className="absolute -bottom-1 -right-1 bg-gray-700 text-white text-[10px] px-1 rounded-full leading-tight z-10">
                                        {seat}
                                    </div>
                                </div>
                                <div className="text-[10px] truncate max-w-full opacity-70 text-center px-1">
                                    {player?.name || `玩家${seat}`}
                                </div>
                                {showRole && player?.role && (
                                    <div className="text-[10px] font-bold text-indigo-600 -mt-1">
                                        {player.role}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
