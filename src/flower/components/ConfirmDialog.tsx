// src/components/ConfirmDialog.tsx
import { useState, useCallback } from "react";
import { AppDialog } from "./AppDialog.tsx";
import { Button } from "@/components/ui/button.tsx";

interface ConfirmOptions {
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    variant?: "default" | "destructive";
}

export function useConfirm(isNight: boolean = false) {
    const [isOpen, setIsOpen] = useState(false);
    const [config, setConfig] = useState<ConfirmOptions>({
        title: "",
        description: "",
    });
    const [resolvePromise, setResolvePromise] = useState<((value: boolean) => void) | null>(null);

    const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
        setConfig(options);
        setIsOpen(true);
        return new Promise<boolean>((resolve) => {
            setResolvePromise(() => resolve);
        });
    }, []);

    const handleConfirm = useCallback(() => {
        if (resolvePromise) {
            resolvePromise(true);
            setResolvePromise(null);
        }
        setIsOpen(false);
    }, [resolvePromise]);

    const handleCancel = useCallback(() => {
        if (resolvePromise) {
            resolvePromise(false);
            setResolvePromise(null);
        }
        setIsOpen(false);
    }, [resolvePromise]);

    const ConfirmDialogElement = (
        <AppDialog
            open={isOpen}
            onOpenChange={setIsOpen}
            title={config.title}
            description={config.description}
            isNight={isNight}
            footer={
                <div className="flex flex-col gap-2 w-full">
                    <Button
                        onClick={handleConfirm}
                        className={
                            (config.variant === "destructive"
                                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                : isNight
                                    ? "bg-white text-black hover:bg-white/90"
                                    : "") + " w-full"
                        }
                    >
                        {config.confirmText || "确认"}
                    </Button>
                    <Button
                        variant="outline"
                        onClick={handleCancel}
                        className={(isNight ? "bg-transparent border-white/20 text-white hover:bg-white/10 hover:text-white" : "bg-white hover:bg-slate-100 text-slate-900 border-slate-200") + " w-full"}
                    >
                        {config.cancelText || "取消"}
                    </Button>
                </div>
            }
        />
    );

    return { confirm, ConfirmDialogElement };
}
