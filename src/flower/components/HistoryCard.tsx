import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import type { FlowerHistoryRecord, FlowerPlayerState } from "../types";
import { VotingGraph } from "./VotingGraph";
import { Moon, Sun, Skull, MicOff, Gavel, Eye } from "lucide-react";

interface HistoryCardProps {
    record: FlowerHistoryRecord;
    players: FlowerPlayerState[];
    mySeat: number;
    isNight: boolean;
}

export function HistoryCard({ record, players, mySeat, isNight }: HistoryCardProps) {
    const themeClass = isNight
        ? "bg-black/40 border-white/10 text-white backdrop-blur-md"
        : "bg-white/60 border-black/10 text-slate-800 backdrop-blur-md";

    const myAction = record.night.actions.find((a) => a.actorSeat === mySeat);
    const deaths = record.night.result.deaths;
    const muted = record.night.result.mutedSeats;

    return (
        <Card className={`${themeClass} mb-4 overflow-hidden shadow-sm`}>
            <CardHeader className="pb-2 border-b border-white/5">
                <CardTitle className="text-base flex items-center justify-between">
                    <span>第 {record.dayCount} 天</span>
                    <span className="text-xs font-normal opacity-60">
                        {record.day ? "已结束" : "进行中"}
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                {/* Night Section */}
                <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium opacity-80 mb-2">
                        <Moon className="w-4 h-4 text-blue-400" />
                        <span>夜晚阶段</span>
                    </div>

                    {/* My Action */}
                    {myAction && (
                        <div className={`text-sm p-2 rounded ${isNight ? "bg-blue-500/20" : "bg-blue-100"}`}>
                            <div className="flex items-center gap-2 mb-1">
                                <Eye className="w-3 h-3" />
                                <span className="font-bold">我的行动</span>
                            </div>
                            <div>
                                使用了 <Badge variant="outline" className={`text-[10px] h-5 px-1 ${isNight ? "border-white/50 text-white" : "border-black/20 text-slate-700"}`}>{myAction.role}</Badge>
                                {myAction.targetSeat && (
                                    <span className="ml-1">→ 座位 {myAction.targetSeat}</span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Night Results */}
                    <div className="space-y-1 text-sm">
                        {deaths.length > 0 ? (
                            <div className="flex items-start gap-2">
                                <Skull className="w-4 h-4 text-red-500 mt-0.5" />
                                <div>
                                    <span className="opacity-70">死亡：</span>
                                    {deaths.map(d => (
                                        <Badge key={d.seat} variant="destructive" className="mr-1 text-[10px] h-5 px-1">
                                            {d.seat}号
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 opacity-60">
                                <Skull className="w-4 h-4" />
                                <span>平安夜，无人死亡</span>
                            </div>
                        )}

                        {muted.length > 0 && (
                            <div className="flex items-start gap-2">
                                <MicOff className="w-4 h-4 text-yellow-500 mt-0.5" />
                                <div>
                                    <span className="opacity-70">被禁言：</span>
                                    {muted.map(seat => (
                                        <Badge key={seat} variant="secondary" className={`mr-1 text-[10px] h-5 px-1 ${isNight ? "bg-white/20 text-white" : "bg-black/10 text-slate-800"}`}>
                                            {seat}号
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Day Section */}
                {record.day && (
                    <div className={`p-4 border-t ${isNight ? "border-white/10" : "border-black/5"}`}>
                        <div className="flex items-center gap-2 text-sm font-medium opacity-80 mb-3">
                            <Sun className="w-4 h-4 text-orange-400" />
                            <span>白天投票</span>
                        </div>

                        {/* Voting Graph */}
                        {record.day.votes.length > 0 ? (
                            <div className="mb-4">
                                <VotingGraph
                                    players={players}
                                    votes={record.day.votes}
                                    isNight={isNight}
                                />
                            </div>
                        ) : (
                            <div className="text-sm opacity-50 mb-2">无投票记录</div>
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
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
