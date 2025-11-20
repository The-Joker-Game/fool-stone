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
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Avvvatars from "avvvatars-react";
import { Check, X } from "lucide-react";
import type { FlowerPlayerState } from "@/flower/types";

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
            <DrawerContent>
                <div className="mx-auto w-full max-w-2xl">
                    <DrawerHeader>
                        <DrawerTitle>{title}</DrawerTitle>
                        {description && <DrawerDescription>{description}</DrawerDescription>}
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
                                        className={`cursor-pointer transition-all ${selectedSeat === null
                                            ? "ring-2 ring-primary bg-primary/5"
                                            : "hover:bg-accent"
                                            }`}
                                        onClick={() => setSelectedSeat(null)}
                                    >
                                        <CardContent className="p-4">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                                                        <X className="h-6 w-6 text-muted-foreground" />
                                                    </div>
                                                    <div>
                                                        <div className="font-medium">不选择目标</div>
                                                        <div className="text-sm text-muted-foreground">
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

                                {filteredPlayers.map((player) => (
                                    <Card
                                        key={`target-${player.seat}`}
                                        className={`cursor-pointer transition-all ${selectedSeat === player.seat
                                            ? "ring-2 ring-primary bg-primary/5"
                                            : "hover:bg-accent"
                                            }`}
                                        onClick={() => setSelectedSeat(player.seat)}
                                    >
                                        <CardContent className="p-4">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <Avvvatars
                                                        value={player.name || `座位${player.seat}`}
                                                        size={48}
                                                        style="shape"
                                                    />
                                                    <div>
                                                        <div className="font-medium">
                                                            {player.name || `玩家${player.seat}`}
                                                        </div>
                                                        <div className="text-sm text-muted-foreground">
                                                            座位 {player.seat}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {!player.isAlive && (
                                                        <Badge variant="destructive">已死亡</Badge>
                                                    )}
                                                    {player.isBot && (
                                                        <Badge variant="outline">BOT</Badge>
                                                    )}
                                                    {selectedSeat === player.seat && (
                                                        <Check className="h-5 w-5 text-primary" />
                                                    )}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}

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
                            <Button variant="outline" onClick={handleCancel} className="w-full">
                                取消
                            </Button>
                        </DrawerClose>
                    </DrawerFooter>
                </div>
            </DrawerContent>
        </Drawer>
    );
}
