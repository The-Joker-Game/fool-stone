// src/joker/components/JokerGameReview.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skull, Vote, Users } from "lucide-react";
import type { JokerDeathRecord, JokerVotingRoundRecord, JokerPlayerState, JokerRole, JokerLocation } from "../types";
import Avvvatars from "avvvatars-react";
import { JokerVotingGraph } from "./JokerVotingGraph";

interface JokerGameReviewProps {
    deaths: JokerDeathRecord[];
    votingHistory: JokerVotingRoundRecord[];
    players: JokerPlayerState[];
    locationHistory?: Record<number, Record<JokerLocation, number[]>>;
}

const ROLE_LABELS: Record<JokerRole, string> = {
    duck: "鸭子",
    goose: "鹅",
    dodo: "呆呆鸟",
    hawk: "老鹰",
};

const ROLE_COLORS: Record<JokerRole, string> = {
    duck: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    goose: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    dodo: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    hawk: "bg-blue-500/20 text-blue-300 border-blue-500/30",
};

type TimelineEvent =
    | { type: "round_start"; round: number }
    | { type: "location_summary"; round: number; locations: Record<JokerLocation, number[]> }
    | { type: "death"; death: JokerDeathRecord }
    | { type: "voting"; voting: JokerVotingRoundRecord };

export function JokerGameReview({ deaths, votingHistory, players, locationHistory }: JokerGameReviewProps) {
    const getPlayerSeat = (sessionId: string | null) => {
        if (!sessionId) return 0;
        const player = players.find(p => p.sessionId === sessionId);
        return player?.seat || 0;
    };

    const getPlayerName = (sessionId: string | null) => {
        if (!sessionId) return "未知";
        const player = players.find(p => p.sessionId === sessionId);
        return player?.name || `玩家${player?.seat || "?"}`;
    };

    // 格式化死亡描述
    const formatDeathDescription = (death: JokerDeathRecord): string => {
        if (death.reason === "kill" && death.killerSeat) {
            const killerLoc = death.killerLocation ? `（${death.killerLocation}）` : "";
            const victimLoc = death.location ? `（${death.location}）` : "";
            return `${death.killerSeat}号${killerLoc} 击杀 ${death.seat}号${victimLoc}`;
        }
        if (death.reason === "oxygen") {
            return `${death.seat}号 缺氧而死`;
        }
        if (death.reason === "foul") {
            const loc = death.location ? `（${death.location}）` : "";
            return `${death.seat}号${loc} 犯规死亡`;
        }
        if (death.reason === "vote") {
            return `${death.seat}号 被投票淘汰`;
        }
        return `${death.seat}号 死亡`;
    };

    // Build timeline
    const maxRound = Math.max(
        ...deaths.map(d => d.round),
        ...votingHistory.map(v => v.round),
        0
    );

    const timeline: TimelineEvent[] = [];

    for (let round = 1; round <= maxRound; round++) {
        // Round header
        timeline.push({ type: "round_start", round });

        // Location summary for this round
        const roundLocations = locationHistory?.[round];
        if (roundLocations && Object.keys(roundLocations).length > 0) {
            timeline.push({ type: "location_summary", round, locations: roundLocations });
        }

        // Deaths (excluding vote deaths)
        const roundDeaths = deaths
            .filter(d => d.round === round && d.reason !== "vote")
            .sort((a, b) => a.at - b.at);

        for (const death of roundDeaths) {
            timeline.push({ type: "death", death });
        }

        // Voting
        const roundVoting = votingHistory.find(v => v.round === round);
        if (roundVoting) {
            timeline.push({ type: "voting", voting: roundVoting });
        }
    }

    if (timeline.length === 0) {
        return (
            <div className="text-center text-white/50 py-8">暂无复盘数据</div>
        );
    }

    return (
        <div className="space-y-4">
            {timeline.map((event, idx) => {
                if (event.type === "round_start") {
                    return (
                        <div key={`round-${event.round}`} className="flex items-center gap-3 pt-2">
                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 border border-white/20">
                                <span className="text-sm font-bold text-white/80">{event.round}</span>
                            </div>
                            <div className="flex-1 h-px bg-white/10" />
                            <span className="text-xs text-white/40 uppercase tracking-wider">第 {event.round} 轮</span>
                            <div className="flex-1 h-px bg-white/10" />
                        </div>
                    );
                }

                if (event.type === "location_summary") {
                    const locations = event.locations;
                    return (
                        <Card key={`loc-${idx}`} className="bg-slate-500/5 backdrop-blur-xl border-slate-500/20">
                            <CardContent className="p-3">
                                <div className="flex items-center gap-2 mb-2 text-sm text-white/70">
                                    <Users className="w-4 h-4" />
                                    <span>场所分布</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    {Object.entries(locations).map(([loc, seats]) => (
                                        seats.length > 0 && (
                                            <div key={loc} className="flex items-center justify-between bg-white/5 px-2 py-1 rounded">
                                                <span className="text-white/60">{loc}</span>
                                                <span className="text-white/90 font-mono">
                                                    {seats.join(", ")}号
                                                </span>
                                            </div>
                                        )
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    );
                }

                if (event.type === "death") {
                    const death = event.death;
                    const description = formatDeathDescription(death);

                    return (
                        <Card key={`death-${idx}`} className="bg-red-500/5 backdrop-blur-xl border-red-500/20">
                            <CardContent className="p-3">
                                <div className="flex items-center gap-3">
                                    <div className="flex-shrink-0">
                                        <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center">
                                            <Skull className="w-3 h-3 text-red-400" />
                                        </div>
                                    </div>
                                    <span className="text-sm text-white/90">{description}</span>
                                </div>
                            </CardContent>
                        </Card>
                    );
                }

                if (event.type === "voting") {
                    const round = event.voting;
                    const executedName = round.executedSessionId
                        ? getPlayerName(round.executedSessionId)
                        : null;
                    const executedSeat = round.executedSessionId
                        ? getPlayerSeat(round.executedSessionId)
                        : 0;
                    const executedLabel = executedName
                        ? `${executedSeat ? `${executedSeat}号 ` : ""}${executedName}`
                        : null;

                    return (
                        <Card key={`vote-${idx}`} className="bg-blue-500/5 backdrop-blur-xl border-blue-500/20">
                            <CardHeader className="p-3 pb-2">
                                <CardTitle className="text-sm flex items-center gap-2 text-blue-300">
                                    <Vote className="w-4 h-4" />
                                    会议投票
                                    {round.reason && (
                                        <Badge
                                            variant="outline"
                                            className={
                                                round.reason === "vote"
                                                    ? "bg-red-500/20 text-red-300 border-red-500/30"
                                                    : round.reason === "tie"
                                                        ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                                                        : "bg-gray-500/20 text-gray-300 border-gray-500/30"
                                            }
                                        >
                                            {round.reason === "vote" && executedLabel
                                                ? `${executedLabel} 被淘汰`
                                                : round.reason === "tie"
                                                    ? "平票"
                                                    : "弃票过多"}
                                        </Badge>
                                    )}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-3 pt-0">
                                <JokerVotingGraph
                                    players={players}
                                    votes={round.votes}
                                    showRole={true}
                                />
                                {round.executedRole && (
                                    <div className="pt-2 mt-2 border-t border-white/10">
                                        <div className="flex items-center gap-2 justify-center text-sm">
                                            <Avvvatars value={String(executedSeat)} size={18} />
                                            <span className="text-white/70">{executedName}</span>
                                            <span className="text-white/40">的身份是</span>
                                            <Badge variant="outline" className={ROLE_COLORS[round.executedRole]}>
                                                {ROLE_LABELS[round.executedRole]}
                                            </Badge>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                }

                return null;
            })}
        </div>
    );
}
