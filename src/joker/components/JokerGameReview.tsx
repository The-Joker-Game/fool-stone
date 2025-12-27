// src/joker/components/JokerGameReview.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skull, Vote, MapPin, Swords } from "lucide-react";
import type { JokerDeathRecord, JokerVotingRoundRecord, JokerPlayerState, JokerRole } from "../types";
import Avvvatars from "avvvatars-react";
import { JokerVotingGraph } from "./JokerVotingGraph";

interface JokerGameReviewProps {
    deaths: JokerDeathRecord[];
    votingHistory: JokerVotingRoundRecord[];
    players: JokerPlayerState[];
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

const DEATH_REASON_LABELS: Record<string, string> = {
    kill: "被击杀",
    foul: "犯规死亡",
    oxygen: "氧气耗尽",
    vote: "投票淘汰",
};

const DEATH_REASON_COLORS: Record<string, string> = {
    kill: "bg-red-500/20 text-red-300 border-red-500/30",
    foul: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    oxygen: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    vote: "bg-purple-500/20 text-purple-300 border-purple-500/30",
};

type TimelineEvent =
    | { type: "round_start"; round: number }
    | { type: "death"; death: JokerDeathRecord }
    | { type: "voting"; voting: JokerVotingRoundRecord };

export function JokerGameReview({ deaths, votingHistory, players }: JokerGameReviewProps) {
    // Helper to get player name by sessionId
    const getPlayerName = (sessionId: string | null) => {
        if (!sessionId) return "未知";
        const player = players.find(p => p.sessionId === sessionId);
        return player?.name || `玩家${player?.seat || "?"}`;
    };

    const getPlayerSeat = (sessionId: string | null) => {
        if (!sessionId) return 0;
        const player = players.find(p => p.sessionId === sessionId);
        return player?.seat || 0;
    };

    // Build timeline: group by round, showing deaths then voting for each round
    const maxRound = Math.max(
        ...deaths.map(d => d.round),
        ...votingHistory.map(v => v.round),
        0
    );

    const timeline: TimelineEvent[] = [];

    for (let round = 1; round <= maxRound; round++) {
        // Add round header
        timeline.push({ type: "round_start", round });

        // Get deaths for this round (excluding vote deaths which are part of voting)
        const roundDeaths = deaths
            .filter(d => d.round === round && d.reason !== "vote")
            .sort((a, b) => a.at - b.at);

        for (const death of roundDeaths) {
            timeline.push({ type: "death", death });
        }

        // Get voting for this round
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

                if (event.type === "death") {
                    const death = event.death;
                    const killerName = death.killerSessionId ? getPlayerName(death.killerSessionId) : null;

                    return (
                        <Card key={`death-${idx}`} className="bg-red-500/5 backdrop-blur-xl border-red-500/20">
                            <CardContent className="p-3">
                                <div className="flex items-start gap-3">
                                    <div className="flex-shrink-0 mt-0.5">
                                        <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                                            <Skull className="w-4 h-4 text-red-400" />
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <Avvvatars value={String(death.seat)} size={20} />
                                            <span className="font-medium text-white">{death.name}</span>
                                            <Badge variant="outline" className={ROLE_COLORS[death.role]}>
                                                {ROLE_LABELS[death.role]}
                                            </Badge>
                                            <Badge variant="outline" className={DEATH_REASON_COLORS[death.reason]}>
                                                {DEATH_REASON_LABELS[death.reason]}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-white/50">
                                            {death.location && (
                                                <span className="flex items-center gap-1">
                                                    <MapPin className="w-3 h-3" />
                                                    {death.location}
                                                </span>
                                            )}
                                            {killerName && (
                                                <span className="flex items-center gap-1">
                                                    <Swords className="w-3 h-3" />
                                                    凶手: {killerName}
                                                </span>
                                            )}
                                        </div>
                                    </div>
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
                                            {round.reason === "vote" && executedName
                                                ? `${executedName} 被淘汰`
                                                : round.reason === "tie"
                                                    ? "平票"
                                                    : "弃票过多"}
                                        </Badge>
                                    )}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-3 pt-0">
                                {/* Voting Graph with Bezier curves */}
                                <JokerVotingGraph
                                    players={players}
                                    votes={round.votes}
                                    showRole={true}
                                />

                                {/* Executed role reveal */}
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
