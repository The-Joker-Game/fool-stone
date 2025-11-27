// src/components/TargetSelectionDrawer.tsx
import { useState } from "react";
import {
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerDescription,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
} from "@/components/ui/drawer.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import Avvvatars from "avvvatars-react";
import { Check, X, Bot } from "lucide-react";
import type { FlowerPlayerState } from "@/flower/types.ts";

const isFakeBot = (name: string | undefined) => name?.endsWith("\u200B") ?? false;

interface TargetSelectionDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    players: FlowerPlayerState[];
    currentSelection?: number | null;
    onConfirm: (targetSeat: number | null) => void;
    disabled?: boolean;
    disabledMessage?: string;
    allowNoTarget?: boolean;
    filterPlayers?: (player: FlowerPlayerState) => boolean;
    isNight?: boolean;
}

export function TargetSelectionDrawer({
    open,
    onOpenChange,
    title,
    description,
    players,
    currentSelection,
    onConfirm,
    disabled = false,
    disabledMessage,
    allowNoTarget = false,
    filterPlayers,
    isNight = false,
}: TargetSelectionDrawerProps) {
    const [selectedSeat, setSelectedSeat] = useState<number | null>(currentSelection ?? null);

    const filteredPlayers = filterPlayers
        ? players.filter(filterPlayers)
        : players.filter(p => p.isAlive);

    const handleConfirm = () => {
        onConfirm(selectedSeat);
        onOpenChange(false);
    };

    const handleCancel = () => {
        setSelectedSeat(currentSelection ?? null);
        onOpenChange(false);
    };

    return (
        <Drawer open={open} onOpenChange={onOpenChange}>
            <DrawerContent className={isNight ? "backdrop-blur-sm bg-gray-900/80 text-white border-white/20" : "backdrop-blur-sm bg-white/80 text-slate-900 border-white/40"}>
                <div className="mx-auto w-full max-w-2xl">
                    <DrawerHeader>
                        <DrawerTitle>{title}</DrawerTitle>
                        {description && <DrawerDescription className={isNight ? "text-white/70" : ""}>{description}</DrawerDescription>}
                        {disabled && disabledMessage && (
                            <div className="text-sm text-destructive mt-2">
                                {disabledMessage}
                            </div>
                        )}
                    </DrawerHeader>

                    <div className="p-4 pb-0">
                        {disabled ? (
                            <div className="text-center py-8 text-muted-foreground">
                                {disabledMessage || "当前无法选择目标"}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto p-1">
                                {allowNoTarget && (
                                    <Card
                                        className={`cursor-pointer transition-all ${isNight ? "backdrop-blur-sm bg-white/10 border-white/20" : ""} ${selectedSeat === null
                                            ? "ring-2 ring-primary bg-primary/5"
                                            : isNight ? "hover:bg-white/20" : "hover:bg-accent"
                                            }`}
                                        onClick={() => setSelectedSeat(null)}
                                    >
                                        <CardContent className="p-4">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className={`h-12 w-12 rounded-full flex items-center justify-center ${isNight ? "bg-white/10" : "bg-muted"}`}>
                                                        <X className={`h-6 w-6 ${isNight ? "text-white/70" : "text-muted-foreground"}`} />
                                                    </div>
                                                    <div>
                                                        <div className={`font-medium ${isNight ? "text-white" : ""}`}>不选择目标</div>
                                                        <div className={`text-sm ${isNight ? "text-white/70" : "text-muted-foreground"}`}>
                                                            本回合不使用技能
                                                        </div>
                                                    </div>
                                                </div>
                                                {selectedSeat === null && (
                                                    <Check className="h-5 w-5 text-primary" />
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}

                                {filteredPlayers.map((player) => {
                                    const isFake = isFakeBot(player.name);
                                    const displayName = player.name?.replace(/\u200B/g, "") || `玩家${player.seat}`;
                                    return (
                                        <Card
                                            key={`target-${player.seat}`}
                                            className={`cursor-pointer transition-all ${isNight ? "backdrop-blur-sm bg-white/10 border-white/20" : ""} ${selectedSeat === player.seat
                                                ? "ring-2 ring-primary bg-primary/5"
                                                : isNight ? "hover:bg-white/20" : "hover:bg-accent"
                                                }`}
                                            onClick={() => setSelectedSeat(player.seat)}
                                        >
                                            <CardContent className="p-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <Avvvatars
                                                            value={displayName}
                                                            size={48}
                                                            style="shape"
                                                        />
                                                        <div>
                                                            <div className={`font-medium ${isNight ? "text-white" : ""}`}>
                                                                {displayName}
                                                            </div>
                                                            <div className={`text-sm ${isNight ? "text-white/70" : "text-muted-foreground"}`}>
                                                                座位 {player.seat}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {!player.isAlive && (
                                                            <Badge variant="destructive">已死亡</Badge>
                                                        )}
                                                        {(player.isBot || isFake) && (
                                                            <Badge variant="outline" className={`gap-1 ${isNight ? "text-white border-white/50" : ""}`}>
                                                                <Bot className="h-3 w-3" />
                                                                BOT
                                                            </Badge>
                                                        )}
                                                        {selectedSeat === player.seat && (
                                                            <Check className="h-5 w-5 text-primary" />
                                                        )}
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}

                                {filteredPlayers.length === 0 && (
                                    <div className="text-center py-8 text-muted-foreground">
                                        没有可选择的目标
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <DrawerFooter>
                        <Button
                            onClick={handleConfirm}
                            disabled={disabled || (!allowNoTarget && selectedSeat === null)}
                            className="w-full"
                        >
                            确认选择
                            {selectedSeat !== null && ` - 座位 ${selectedSeat}`}
                            {selectedSeat === null && allowNoTarget && " - 不使用技能"}
                        </Button>
                        <DrawerClose asChild>
                            <Button
                                variant="outline"
                                onClick={handleCancel}
                                className={`w-full ${isNight ? "bg-transparent text-white border-white/40 hover:bg-white/10 hover:text-white" : ""}`}
                            >
                                取消
                            </Button>
                        </DrawerClose>
                    </DrawerFooter>
                </div>
            </DrawerContent>
        </Drawer>
    );
}
