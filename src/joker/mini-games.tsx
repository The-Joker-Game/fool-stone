// src/joker/mini-games.tsx
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, Check, Timer } from "lucide-react";

export type MiniGameType = "wire" | "memory" | "cardSwipe" | "shapeSort" | "reaction";

interface MiniGameProps {
    onComplete: () => void;
    onClose: () => void;
}

// Random game selector
export function getRandomGame(): MiniGameType {
    const games: MiniGameType[] = ["wire", "memory", "cardSwipe", "shapeSort", "reaction"];
    return games[Math.floor(Math.random() * games.length)];
}

// Countdown timer hook
function useCountdown(seconds: number, onTimeout: () => void) {
    const [timeLeft, setTimeLeft] = useState(seconds);

    useEffect(() => {
        if (timeLeft <= 0) {
            onTimeout();
            return;
        }
        const timer = setTimeout(() => setTimeLeft(t => t - 1), 1000);
        return () => clearTimeout(timer);
    }, [timeLeft, onTimeout]);

    return timeLeft;
}

// ============ 1. Wire Connect Game ============
const WIRE_COLORS = [
    { name: "红", hex: "#ef4444", bg: "bg-red-500" },
    { name: "蓝", hex: "#3b82f6", bg: "bg-blue-500" },
    { name: "绿", hex: "#22c55e", bg: "bg-green-500" },
    { name: "黄", hex: "#eab308", bg: "bg-yellow-500" },
];

const ROW_HEIGHT = 44;
const DOT_SIZE = 32;

export function WireConnectGame({ onComplete, onClose }: MiniGameProps) {
    const [connections, setConnections] = useState<Record<number, number>>({});
    const [draggingFrom, setDraggingFrom] = useState<number | null>(null);
    const [rightOrder] = useState(() => [...Array(4).keys()].sort(() => Math.random() - 0.5));
    const [containerWidth, setContainerWidth] = useState(200);
    const containerRef = useRef<HTMLDivElement>(null);
    const timeLeft = useCountdown(15, onClose);

    // Measure container width
    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.contentRect.width > 0) {
                    setContainerWidth(entry.contentRect.width);
                }
            }
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    const handleLeftClick = (idx: number) => {
        if (connections[idx] !== undefined) {
            // Remove existing connection
            const newConns = { ...connections };
            delete newConns[idx];
            setConnections(newConns);
            setDraggingFrom(idx);
        } else {
            setDraggingFrom(idx);
        }
    };

    const handleRightClick = (idx: number) => {
        if (draggingFrom !== null) {
            const newConns = { ...connections, [draggingFrom]: idx };
            setConnections(newConns);
            setDraggingFrom(null);

            // Check if all connected correctly
            if (Object.keys(newConns).length === 4) {
                const allCorrect = Object.entries(newConns).every(
                    ([left, right]) => rightOrder[Number(right)] === Number(left)
                );
                if (allCorrect) onComplete();
            }
        }
    };

    const getY = (index: number) => index * ROW_HEIGHT + ROW_HEIGHT / 2;
    const totalHeight = 4 * ROW_HEIGHT;
    const middleWidth = containerWidth - 80; // Account for left/right columns

    return (
        <GameContainer title="连接电线" timeLeft={timeLeft} onClose={onClose}>
            <p className="text-white/50 text-xs text-center mb-2">
                {draggingFrom !== null ? `选择右侧的${WIRE_COLORS[draggingFrom].name}色接口` : "点击左侧颜色开始连接"}
            </p>
            <div ref={containerRef} className="flex items-stretch relative" style={{ height: totalHeight }}>
                {/* Left Column */}
                <div className="flex-none relative" style={{ width: 40 }}>
                    {WIRE_COLORS.map((color, idx) => (
                        <motion.button
                            key={`left-${idx}`}
                            whileTap={{ scale: 0.9 }}
                            onClick={() => handleLeftClick(idx)}
                            className={`absolute left-0 rounded-full border-2 transition-all ${draggingFrom === idx ? 'ring-2 ring-white ring-offset-2 ring-offset-black scale-110' : ''
                                } ${connections[idx] !== undefined ? 'opacity-60' : ''}`}
                            style={{
                                top: getY(idx) - DOT_SIZE / 2,
                                width: DOT_SIZE,
                                height: DOT_SIZE,
                                backgroundColor: color.hex,
                                borderColor: color.hex
                            }}
                        />
                    ))}
                </div>

                {/* Middle: SVG Bezier Curves */}
                <div className="flex-1 relative">
                    <svg
                        className="absolute inset-0 pointer-events-none"
                        width={middleWidth}
                        height={totalHeight}
                        viewBox={`0 0 ${middleWidth} ${totalHeight}`}
                        style={{ overflow: "visible" }}
                    >
                        {Object.entries(connections).map(([left, right]) => {
                            const leftIdx = Number(left);
                            const rightIdx = Number(right);
                            const startY = getY(leftIdx);
                            const endY = getY(rightIdx);

                            // Bezier curve control points
                            const startX = 0;
                            const endX = middleWidth;
                            const cp1X = middleWidth * 0.4;
                            const cp2X = middleWidth * 0.6;

                            const pathData = `M ${startX} ${startY} C ${cp1X} ${startY}, ${cp2X} ${endY}, ${endX} ${endY}`;
                            const isCorrect = rightOrder[rightIdx] === leftIdx;

                            return (
                                <motion.path
                                    key={`wire-${left}`}
                                    d={pathData}
                                    fill="none"
                                    stroke={WIRE_COLORS[leftIdx].hex}
                                    strokeWidth={4}
                                    strokeLinecap="round"
                                    initial={{ pathLength: 0, opacity: 0 }}
                                    animate={{ pathLength: 1, opacity: isCorrect ? 1 : 0.8 }}
                                    transition={{ duration: 0.3 }}
                                />
                            );
                        })}
                    </svg>
                </div>

                {/* Right Column */}
                <div className="flex-none relative" style={{ width: 40 }}>
                    {rightOrder.map((colorIdx, idx) => {
                        const isConnected = Object.values(connections).includes(idx);
                        return (
                            <motion.button
                                key={`right-${idx}`}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleRightClick(idx)}
                                className={`absolute right-0 rounded-full border-2 transition-all ${draggingFrom !== null && !isConnected ? 'animate-pulse' : ''
                                    } ${isConnected ? 'opacity-60' : ''}`}
                                style={{
                                    top: getY(idx) - DOT_SIZE / 2,
                                    width: DOT_SIZE,
                                    height: DOT_SIZE,
                                    backgroundColor: WIRE_COLORS[colorIdx].hex,
                                    borderColor: WIRE_COLORS[colorIdx].hex
                                }}
                            />
                        );
                    })}
                </div>
            </div>
        </GameContainer>
    );
}

// ============ 2. Number Memory Game ============
export function NumberMemoryGame({ onComplete, onClose }: MiniGameProps) {
    const [phase, setPhase] = useState<"show" | "input">("show");
    const [targetNumber] = useState(() => String(Math.floor(1000 + Math.random() * 9000)));
    const [inputValue, setInputValue] = useState("");
    const timeLeft = useCountdown(12, onClose);

    useEffect(() => {
        const timer = setTimeout(() => setPhase("input"), 3000);
        return () => clearTimeout(timer);
    }, []);

    const handleKeyPress = (key: string) => {
        if (inputValue.length < 4) {
            const newValue = inputValue + key;
            setInputValue(newValue);
            if (newValue === targetNumber) {
                onComplete();
            }
        }
    };

    const handleBackspace = () => {
        setInputValue(v => v.slice(0, -1));
    };

    return (
        <GameContainer title="数字记忆" timeLeft={timeLeft} onClose={onClose}>
            {phase === "show" ? (
                <div className="text-center py-8">
                    <p className="text-white/50 text-sm mb-2">记住这个数字</p>
                    <div className="text-5xl font-mono font-bold tracking-widest text-white">
                        {targetNumber}
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="text-center">
                        <div className="text-3xl font-mono font-bold tracking-widest text-white h-12">
                            {inputValue.padEnd(4, "_").split("").join(" ")}
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, "⌫"].map((key, idx) => (
                            key !== null ? (
                                <Button
                                    key={idx}
                                    variant="outline"
                                    className="h-12 text-xl font-bold"
                                    onClick={() => key === "⌫" ? handleBackspace() : handleKeyPress(String(key))}
                                >
                                    {key}
                                </Button>
                            ) : <div key={idx} />
                        ))}
                    </div>
                </div>
            )}
        </GameContainer>
    );
}

// ============ 3. Color Sequence Game ============
const SEQUENCE_COLORS = [
    { name: "red", bg: "bg-red-500", hover: "hover:bg-red-400" },
    { name: "blue", bg: "bg-blue-500", hover: "hover:bg-blue-400" },
    { name: "green", bg: "bg-green-500", hover: "hover:bg-green-400" },
    { name: "yellow", bg: "bg-yellow-500", hover: "hover:bg-yellow-400" },
];

export function ColorSequenceGame({ onComplete, onClose }: MiniGameProps) {
    const [phase, setPhase] = useState<"show" | "input">("show");
    const [sequence] = useState(() =>
        Array.from({ length: 4 }, () => Math.floor(Math.random() * 4))
    );
    const [showIndex, setShowIndex] = useState(0);
    const [inputIndex, setInputIndex] = useState(0);
    const [activeColor, setActiveColor] = useState<number | null>(null);
    const timeLeft = useCountdown(15, onClose);

    // Show sequence phase
    useEffect(() => {
        if (phase !== "show") return;

        if (showIndex >= sequence.length) {
            setPhase("input");
            return;
        }

        setActiveColor(sequence[showIndex]);
        const timer1 = setTimeout(() => setActiveColor(null), 500);
        const timer2 = setTimeout(() => setShowIndex(i => i + 1), 700);

        return () => {
            clearTimeout(timer1);
            clearTimeout(timer2);
        };
    }, [phase, showIndex, sequence]);

    const handleColorClick = (colorIndex: number) => {
        if (phase !== "input") return;

        setActiveColor(colorIndex);
        setTimeout(() => setActiveColor(null), 200);

        if (colorIndex === sequence[inputIndex]) {
            if (inputIndex + 1 >= sequence.length) {
                onComplete();
            } else {
                setInputIndex(i => i + 1);
            }
        } else {
            // Wrong color, reset
            setInputIndex(0);
            setPhase("show");
            setShowIndex(0);
        }
    };

    return (
        <GameContainer title="颜色序列" timeLeft={timeLeft} onClose={onClose}>
            <div className="text-center mb-4">
                <p className="text-white/50 text-sm">
                    {phase === "show" ? "记住颜色顺序..." : `点击颜色 (${inputIndex + 1}/${sequence.length})`}
                </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
                {SEQUENCE_COLORS.map((color, idx) => (
                    <motion.button
                        key={color.name}
                        onClick={() => handleColorClick(idx)}
                        disabled={phase === "show"}
                        className={`h-20 rounded-xl transition-all ${color.bg} ${phase === "input" ? color.hover : ""} ${activeColor === idx ? "ring-4 ring-white scale-105" : ""
                            } ${phase === "show" ? "opacity-50" : ""}`}
                        whileTap={phase === "input" ? { scale: 0.95 } : {}}
                    />
                ))}
            </div>
        </GameContainer>
    );
}

// ============ 4. Shape Sort Game ============
const SHAPES = [
    { name: "circle", path: "M12 2a10 10 0 100 20 10 10 0 000-20z" },
    { name: "square", path: "M3 3h18v18H3z" },
    { name: "triangle", path: "M12 2L2 22h20L12 2z" },
];

export function ShapeSortGame({ onComplete, onClose }: MiniGameProps) {
    const [placed, setPlaced] = useState<Record<string, boolean>>({});
    const [dragging, setDragging] = useState<string | null>(null);
    const timeLeft = useCountdown(12, onClose);

    const handleDragStart = (shape: string) => {
        setDragging(shape);
    };

    const handleDrop = (targetShape: string) => {
        if (dragging === targetShape) {
            const newPlaced = { ...placed, [targetShape]: true };
            setPlaced(newPlaced);
            if (Object.keys(newPlaced).length === 3) {
                onComplete();
            }
        }
        setDragging(null);
    };

    return (
        <GameContainer title="图形排序" timeLeft={timeLeft} onClose={onClose}>
            {/* Drop zones */}
            <div className="flex justify-center gap-4 mb-6">
                {SHAPES.map(shape => (
                    <div
                        key={`zone-${shape.name}`}
                        onClick={() => handleDrop(shape.name)}
                        className={`w-16 h-16 border-2 border-dashed rounded-lg flex items-center justify-center transition-colors ${placed[shape.name] ? 'border-green-500 bg-green-500/20' : 'border-white/30'
                            }`}
                    >
                        {placed[shape.name] && (
                            <svg viewBox="0 0 24 24" className="w-10 h-10 fill-green-500">
                                <path d={shape.path} />
                            </svg>
                        )}
                    </div>
                ))}
            </div>

            {/* Draggable shapes */}
            <div className="flex justify-center gap-4">
                {SHAPES.filter(s => !placed[s.name]).map(shape => (
                    <motion.button
                        key={`shape-${shape.name}`}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleDragStart(shape.name)}
                        className={`w-14 h-14 bg-white/10 rounded-lg flex items-center justify-center ${dragging === shape.name ? 'ring-2 ring-white' : ''
                            }`}
                    >
                        <svg viewBox="0 0 24 24" className="w-8 h-8 fill-white">
                            <path d={shape.path} />
                        </svg>
                    </motion.button>
                ))}
            </div>
            {dragging && (
                <p className="text-center text-white/50 text-sm mt-2">点击上方对应的框</p>
            )}
        </GameContainer>
    );
}

// ============ 5. Reaction Test Game ============
export function ReactionTestGame({ onComplete, onClose }: MiniGameProps) {
    const [phase, setPhase] = useState<"wait" | "ready" | "click" | "fail">("wait");
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const timeLeft = useCountdown(8, onClose);

    useEffect(() => {
        const delay = 1000 + Math.random() * 2000;
        timeoutRef.current = setTimeout(() => setPhase("ready"), delay);
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    const handleClick = () => {
        if (phase === "wait") {
            setPhase("fail");
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            setTimeout(() => {
                setPhase("wait");
                const delay = 1000 + Math.random() * 2000;
                timeoutRef.current = setTimeout(() => setPhase("ready"), delay);
            }, 1000);
        } else if (phase === "ready") {
            setPhase("click");
            onComplete();
        }
    };

    return (
        <GameContainer title="反应测试" timeLeft={timeLeft} onClose={onClose}>
            <motion.button
                onClick={handleClick}
                className={`w-full h-40 rounded-2xl flex items-center justify-center text-2xl font-bold transition-colors ${phase === "wait" ? 'bg-red-600' :
                    phase === "ready" ? 'bg-green-600' :
                        phase === "click" ? 'bg-green-400' :
                            'bg-orange-600'
                    }`}
            >
                {phase === "wait" && "等待..."}
                {phase === "ready" && "点击！"}
                {phase === "click" && <Check className="w-12 h-12" />}
                {phase === "fail" && "太早了！"}
            </motion.button>
        </GameContainer>
    );
}

// ============ Game Container ============
function GameContainer({
    title,
    timeLeft,
    onClose,
    children
}: {
    title: string;
    timeLeft: number;
    onClose: () => void;
    children: React.ReactNode;
}) {
    return (
        <Card className="bg-black/80 backdrop-blur-xl border-white/20">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-lg text-white flex items-center gap-2">
                    {title}
                </CardTitle>
                <div className="flex items-center gap-3">
                    <span className={`flex items-center gap-1 text-sm font-mono ${timeLeft <= 3 ? 'text-red-400' : 'text-white/60'}`}>
                        <Timer className="w-4 h-4" />
                        {timeLeft}s
                    </span>
                    <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                        <X className="w-4 h-4" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="relative">
                {children}
            </CardContent>
        </Card>
    );
}

// ============ Main Game Selector ============
export function MiniGame({ type, onComplete, onClose }: MiniGameProps & { type: MiniGameType }) {
    switch (type) {
        case "wire": return <WireConnectGame onComplete={onComplete} onClose={onClose} />;
        case "memory": return <NumberMemoryGame onComplete={onComplete} onClose={onClose} />;
        case "cardSwipe": return <ColorSequenceGame onComplete={onComplete} onClose={onClose} />;
        case "shapeSort": return <ShapeSortGame onComplete={onComplete} onClose={onClose} />;
        case "reaction": return <ReactionTestGame onComplete={onComplete} onClose={onClose} />;
    }
}
