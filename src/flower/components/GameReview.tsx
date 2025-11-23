import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gavel, Moon, Sun, Skull, MicOff } from "lucide-react";
import { VotingGraph } from "./VotingGraph";
import type { FlowerHistoryRecord, FlowerPlayerState, FlowerVoteEntry, FlowerRole } from "../types";

interface GameReviewProps {
    history: FlowerHistoryRecord[];
    players: FlowerPlayerState[];
}

export function GameReview({ history, players }: GameReviewProps) {
    // Sort history chronologically (Day 1 -> Day N)
    const sortedHistory = [...history].sort((a, b) => a.dayCount - b.dayCount);

    // Initialize role map with original roles
    // We create a map of seat -> role for each step of the history
    let currentRoleMap = new Map<number, FlowerRole | null>();
    players.forEach(p => {
        currentRoleMap.set(p.seat, p.originalRole || p.role);
    });

    return (
        <div className="space-y-6">
            {sortedHistory.map((record) => {
                // 1. Snapshot for Night Phase (before upgrades)
                const playersForNight = players.map(p => ({
                    ...p,
                    role: currentRoleMap.get(p.seat) ?? p.role
                }));

                // Convert night actions to vote entries for VotingGraph
                const nightVotes: FlowerVoteEntry[] = record.night.actions
                    .filter((a) => a.targetSeat != null)
                    .map((a) => ({
                        voterSeat: a.actorSeat,
                        targetSeat: a.targetSeat!,
                        submittedAt: a.submittedAt,
                        source: "dark",
                    }));

                // 2. Apply upgrades immediately after Night Phase (so Day Phase sees new roles)
                if (record.night.result.upgrades.length > 0) {
                    record.night.result.upgrades.forEach(u => {
                        currentRoleMap.set(u.seat, u.toRole);
                    });
                }

                // 3. Snapshot for Day Phase (after upgrades)
                const playersForDay = players.map(p => ({
                    ...p,
                    role: currentRoleMap.get(p.seat) ?? p.role
                }));

                // 4. Apply DAY upgrades (if any)
                if (record.day?.upgrades && record.day.upgrades.length > 0) {
                    record.day.upgrades.forEach(u => {
                        currentRoleMap.set(u.seat, u.toRole);
                    });
                }

                return (
                    <Card key={record.dayCount} className="backdrop-blur-sm bg-white/50 text-slate-900 border-white/40 shadow-sm overflow-hidden">
                        <CardHeader className="pb-2 border-b border-slate-200/50">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <span className="opacity-80">第 {record.dayCount} 天</span>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            {/* Night Phase */}
                            <div className="p-4 border-b border-slate-200/50 bg-slate-50/50">
                                <div className="flex items-center gap-2 mb-3 text-indigo-600">
                                    <Moon className="w-4 h-4" />
                                    <span className="font-medium">夜晚行动</span>
                                </div>

                                {nightVotes.length > 0 ? (
                                    <div className="mb-4">
                                        <VotingGraph players={playersForNight} votes={nightVotes} isNight={false} showRole={true} />
                                    </div>
                                ) : (
                                    <div className="text-sm opacity-50 mb-4 text-center py-4">无行动记录</div>
                                )}

                                {/* Night Results */}
                                <div className="space-y-2 text-sm">
                                    <div className="flex items-center gap-2">
                                        <Skull className="w-4 h-4 text-red-500" />
                                        <span className="opacity-70">死亡名单：</span>
                                        {record.night.result.deaths.length > 0 ? (
                                            <div className="flex gap-1 flex-wrap">
                                                {record.night.result.deaths.map((d) => (
                                                    <Badge key={d.seat} variant="destructive" className="h-5 px-2 text-[10px]">
                                                        {d.seat}号
                                                    </Badge>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="opacity-80">平安夜</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <MicOff className="w-4 h-4 text-gray-500" />
                                        <span className="opacity-70">被禁言：</span>
                                        {record.night.result.mutedSeats.length > 0 ? (
                                            <div className="flex gap-1 flex-wrap">
                                                {record.night.result.mutedSeats.map((seat) => (
                                                    <Badge key={seat} variant="secondary" className="h-5 px-2 text-[10px] bg-gray-200 text-gray-700 border border-gray-300">
                                                        {seat}号
                                                    </Badge>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="opacity-80">无</span>
                                        )}
                                    </div>
                                    {/* Show upgrades if any */}
                                    {record.night.result.upgrades.length > 0 && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-purple-600 font-bold">↑</span>
                                            <span className="opacity-70">身份继承：</span>
                                            <div className="flex gap-1 flex-wrap">
                                                {record.night.result.upgrades.map((u, idx) => (
                                                    <Badge key={idx} variant="outline" className="h-5 px-2 text-[10px] border-purple-500 text-purple-700 bg-purple-50">
                                                        {u.seat}号 ({u.fromRole} → {u.toRole})
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Day Phase */}
                            {record.day && (
                                <div className="p-4 bg-orange-50/30">
                                    <div className="flex items-center gap-2 mb-3 text-orange-600">
                                        <Sun className="w-4 h-4" />
                                        <span className="font-medium">白天投票</span>
                                    </div>

                                    {record.day.votes.length > 0 ? (
                                        <div className="mb-4">
                                            <VotingGraph players={playersForDay} votes={record.day.votes} isNight={false} showRole={true} />
                                        </div>
                                    ) : (
                                        <div className="text-sm opacity-50 mb-4 text-center py-4">无投票记录</div>
                                    )}

                                    {/* Execution Result */}
                                    <div className="flex items-center gap-2 text-sm">
                                        <Gavel className="w-4 h-4 text-red-500" />
                                        <span className="opacity-70">处决结果：</span>
                                        {record.day.execution ? (
                                            <div className="flex items-center">
                                                <span className="font-bold text-red-500">
                                                    座位 {record.day.execution.seat} 被处决
                                                </span>
                                                {record.day.execution.isBadSpecial ? (
                                                    <Badge variant="destructive" className="ml-2 h-5 px-2 text-[10px] shadow-sm">
                                                        坏特殊
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="ml-2 h-5 px-2 text-[10px] border-green-500/50 text-green-600 bg-green-500/5">
                                                        非坏特殊
                                                    </Badge>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="opacity-80">无人被处决</span>
                                        )}
                                    </div>

                                    {/* Show day upgrades if any */}
                                    {record.day.upgrades && record.day.upgrades.length > 0 && (
                                        <div className="flex items-center gap-2 mt-2 text-sm">
                                            <span className="text-purple-600 font-bold">↑</span>
                                            <span className="opacity-70">身份继承：</span>
                                            <div className="flex gap-1 flex-wrap">
                                                {record.day.upgrades.map((u, idx) => (
                                                    <Badge key={idx} variant="outline" className="h-5 px-2 text-[10px] border-purple-500 text-purple-700 bg-purple-50">
                                                        {u.seat}号 ({u.fromRole} → {u.toRole})
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
