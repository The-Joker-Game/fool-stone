// src/components/AddBotDialog.tsx
import { useState, useCallback } from "react";
import { AppDialog } from "./AppDialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";



function AddBotContent({
    onConfirm,
    onCancel,
    isNight
}: {
    onConfirm: (val: string) => void,
    onCancel: () => void,
    isNight: boolean
}) {
    const [name, setName] = useState("");

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            onConfirm(name);
            setName("");
        }
    };

    return (
        <div className="flex flex-col gap-4 py-4">
            <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="机器人昵称（可选）"
                className={isNight ? "bg-white/10 border-white/20 text-white placeholder:text-white/50" : ""}
                autoFocus
            />
            <div className="flex flex-col gap-2 w-full">
                <Button
                    type="button"
                    className={isNight ? "bg-white text-black hover:bg-white/90 w-full" : "w-full"}
                    onClick={() => {
                        onConfirm(name);
                        setName("");
                    }}
                >
                    添加
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className={(isNight ? "bg-transparent border-white/20 text-white hover:bg-white/10 hover:text-white" : "bg-white hover:bg-slate-100 text-slate-900 border-slate-200") + " w-full"}
                    onClick={onCancel}
                >
                    取消
                </Button>
            </div>
        </div>
    );
}

export function useAddBotDialog(isNight: boolean = false) {
    const [isOpen, setIsOpen] = useState(false);
    const [resolvePromise, setResolvePromise] = useState<((value: string | null) => void) | null>(null);

    const showDialog = useCallback((): Promise<string | null> => {
        setIsOpen(true);
        return new Promise<string | null>((resolve) => {
            setResolvePromise(() => resolve);
        });
    }, []);

    const handleConfirm = useCallback((botName: string) => {
        if (resolvePromise) {
            resolvePromise(botName);
            setResolvePromise(null);
        }
        setIsOpen(false);
    }, [resolvePromise]);

    const handleCancel = useCallback(() => {
        if (resolvePromise) {
            resolvePromise(null);
            setResolvePromise(null);
        }
        setIsOpen(false);
    }, [resolvePromise]);

    const AddBotDialogElement = (
        <AppDialog
            open={isOpen}
            onOpenChange={(open) => {
                if (!open) handleCancel();
                setIsOpen(open);
            }}
            title="添加人机"
            description="请输入机器人的昵称，留空则自动命名。"
            isNight={isNight}
        >
            <AddBotContent
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                isNight={isNight}
            />
        </AppDialog>
    );

    return { showAddBotDialog: showDialog, AddBotDialogElement };
}
