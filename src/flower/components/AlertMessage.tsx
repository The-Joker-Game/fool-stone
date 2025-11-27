// src/components/AlertMessage.tsx
import { useState, useCallback } from "react";
import { AppDialog } from "./AppDialog.tsx";
import { Button } from "@/components/ui/button.tsx";

interface AlertOptions {
    title?: string;
    description: string;
    confirmText?: string;
}

export function useAlert() {
    const [isOpen, setIsOpen] = useState(false);
    const [config, setConfig] = useState<AlertOptions>({
        description: "",
    });

    const [resolvePromise, setResolvePromise] = useState<(() => void) | null>(null);

    const alert = useCallback((options: string | AlertOptions) => {
        if (typeof options === "string") {
            setConfig({ description: options, title: "提示" });
        } else {
            setConfig({ title: "提示", ...options });
        }
        setIsOpen(true);
        return new Promise<void>((resolve) => {
            setResolvePromise(() => resolve);
        });
    }, []);

    const handleClose = useCallback(() => {
        setIsOpen(false);
        if (resolvePromise) {
            resolvePromise();
            setResolvePromise(null);
        }
    }, [resolvePromise]);

    const AlertDialogElement = (
        <AppDialog
            open={isOpen}
            onOpenChange={setIsOpen}
            title={config.title || "提示"}
            description={config.description}
            footer={
                <div className="flex flex-col w-full">
                    <Button onClick={handleClose} className="w-full">
                        {config.confirmText || "确定"}
                    </Button>
                </div>
            }
        />
    );

    return { alert, AlertDialogElement };
}
