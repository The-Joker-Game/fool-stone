// src/joker/components/JokerGameReview.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skull, Vote, Users, BarChart3, ThumbsUp } from "lucide-react";
import type { JokerDeathRecord, JokerVotingRoundRecord, JokerPlayerState, JokerRole, JokerLocation } from "../types";
import Avvvatars from "avvvatars-react";
import { JokerVotingGraph } from "./JokerVotingGraph";
import { useTranslation } from "react-i18next";

interface JokerGameReviewProps {
    deaths: JokerDeathRecord[];
    votingHistory: JokerVotingRoundRecord[];
    players: JokerPlayerState[];
    locationHistory?: Record<number, Record<JokerLocation, number[]>>;
    taskContributionBySession?: Record<string, number>;
}


const ROLE_COLORS: Record<JokerRole, string> = {
    // 🦢 Goose faction - Blue
    goose: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    vigilante_goose: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    sheriff_goose: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    coroner_goose: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    overseer_goose: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    // 🦆 Duck faction - Red
    duck: "bg-red-500/20 text-red-300 border-red-500/30",
    poisoner_duck: "bg-red-500/20 text-red-300 border-red-500/30",
    saboteur_duck: "bg-red-500/20 text-red-300 border-red-500/30",
    // 🐦 Neutral faction - Yellow/Amber
    dodo: "bg-amber-500/20 text-amber-200 border-amber-400/30",
    hawk: "bg-amber-500/20 text-amber-200 border-amber-400/30",
    woodpecker: "bg-amber-500/20 text-amber-200 border-amber-400/30",
};

const LOCATION_KEY_MAP: Record<JokerLocation, string> = {
    "厨房": "kitchen",
    "医务室": "medical",
    "发电室": "power",
    "监控室": "monitor",
    "仓库": "warehouse",
    "调度室": "dispatch",
    "休眠舱": "stasis",
};

type TimelineEvent =
    | { type: "round_start"; round: number }
    | { type: "location_summary"; round: number; locations: Record<JokerLocation, number[]> }
    | { type: "death"; death: JokerDeathRecord }
    | { type: "voting"; voting: JokerVotingRoundRecord };

export function JokerGameReview({ deaths, votingHistory, players, locationHistory, taskContributionBySession }: JokerGameReviewProps) {
    const { t } = useTranslation();
    const getPlayerSeat = (sessionId: string | null) => {
        if (!sessionId) return 0;
        const player = players.find(p => p.sessionId === sessionId);
        return player?.seat || 0;
    };

    const getPlayerName = (sessionId: string | null) => {
        if (!sessionId) return t('common.unknown');
        const player = players.find(p => p.sessionId === sessionId);
        return player?.name || `${t('game.player')}${player?.seat || "?"}`;
    };

    // Format death description
    const formatDeathDescription = (death: JokerDeathRecord): string => {
        if (death.reason === "kill" && death.killerSeat) {
            const killerLoc = death.killerLocation ? `（${t(`locations.${LOCATION_KEY_MAP[death.killerLocation]}`)}）` : "";
            const victimLoc = death.location ? `（${t(`locations.${LOCATION_KEY_MAP[death.location]}`)}）` : "";
            return t('review.killedBy', { killerSeat: death.killerSeat, killerLoc, victimSeat: death.seat, victimLoc });
        }
        if (death.reason === "poison") {
            const loc = death.location ? `（${t(`locations.${LOCATION_KEY_MAP[death.location]}`)}）` : "";
            return `${death.seat}号${loc}被毒杀`;
        }
        if (death.reason === "oxygen") {
            return t('review.oxygenDeath', { seat: death.seat });
        }
        if (death.reason === "foul") {
            const loc = death.location ? `（${t(`locations.${LOCATION_KEY_MAP[death.location]}`)}）` : "";
            return t('review.foulDeath', { seat: death.seat, loc });
        }
        if (death.reason === "suicide") {
            const loc = death.location ? `（${t(`locations.${LOCATION_KEY_MAP[death.location]}`)}）` : "";
            return `${death.seat}号${loc}自杀`;
        }
        if (death.reason === "vote") {
            return t('review.votedOut', { seat: death.seat });
        }
        return t('review.died', { seat: death.seat });
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
            <div className="text-center text-white/50 py-8">{t('review.noData')}</div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Task Contribution Chart */}
            {(() => {
                const contributions = players
                    .filter(p => p.sessionId)
                    .map(p => ({
                        player: p,
                        contribution: taskContributionBySession?.[p.sessionId!] ?? 0
                    }))
                    .sort((a, b) => b.contribution - a.contribution);

                const maxContribution = Math.max(...contributions.map(c => c.contribution), 1);
                const totalContribution = contributions.reduce((sum, c) => sum + c.contribution, 0);

                const topContribution = contributions[0]?.contribution ?? 0;

                return (
                    <Card className="bg-black/30 backdrop-blur-xl border-emerald-500/30">
                        <CardHeader className="pb-2 pt-3 px-4">
                            <CardTitle className="flex items-center justify-between text-base">
                                <div className="flex items-center gap-2 text-emerald-300">
                                    <BarChart3 className="w-5 h-5" />
                                    {t('review.taskContribution')}
                                </div>
                                <span className="text-sm text-white/50">
                                    {t('review.total')}: {totalContribution.toFixed(1)}%
                                </span>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-4">
                            <div className="space-y-3">
                                {contributions.map(({ player, contribution }, index) => {
                                    // Bar width relative to max contribution for visual comparison
                                    const barWidth = maxContribution > 0 ? (contribution / maxContribution) * 100 : 0;
                                    const isTopContributor = index === 0 && topContribution > 0;

                                    return (
                                        <div key={player.sessionId} className="space-y-1">
                                            {/* Player info row */}
                                            <div className="flex items-center justify-between text-sm">
                                                <div className="flex items-center gap-2">
                                                    <Avvvatars value={String(player.seat)} size={20} />
                                                    <span className={isTopContributor ? "text-amber-400 font-bold" : "text-white/90 font-medium"}>
                                                        {player.name}
                                                    </span>
                                                    {isTopContributor && <ThumbsUp className="w-4 h-4 text-amber-400" />}
                                                </div>
                                                <span className="text-emerald-400 font-mono font-bold tabular-nums">
                                                    +{contribution.toFixed(1)}%
                                                </span>
                                            </div>
                                            {/* Bar - no background, just the colored bar */}
                                            <div
                                                className="h-3 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                                                style={{ width: `${barWidth}%` }}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                );
            })()}

            {timeline.map((event, idx) => {
                if (event.type === "round_start") {
                    return (
                        <div key={`round-${event.round}`} className="flex items-center gap-3 pt-2">
                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 border border-white/20">
                                <span className="text-sm font-bold text-white/80">{event.round}</span>
                            </div>
                            <div className="flex-1 h-px bg-white/10" />
                            <span className="text-xs text-white/40 uppercase tracking-wider">{t('review.round', { round: event.round })}</span>
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
                                    <span>{t('review.locationDistribution')}</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    {Object.entries(locations).map(([loc, seats]) => (
                                        seats.length > 0 && (
                                            <div key={loc} className="flex items-center justify-between bg-white/5 px-2 py-1 rounded">
                                                <span className="text-white/60">{t(`locations.${LOCATION_KEY_MAP[loc as JokerLocation]}`)}</span>
                                                <span className="text-white/90 font-mono">
                                                    {seats.join(", ")}{t('review.seatNumber')}
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
                                    {t('review.votingMeeting')}
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
                                                ? t('review.eliminated', { player: executedLabel })
                                                : round.reason === "tie"
                                                    ? t('review.tie')
                                                    : t('review.tooManyAbstain')}
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
                                            <span className="text-white/40">{t('review.roleWas')}</span>
                                            <Badge variant="outline" className={ROLE_COLORS[round.executedRole]}>
                                                {t(`roles.${round.executedRole}`)}
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
