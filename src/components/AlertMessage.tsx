// src/components/AlertMessage.tsx
import { useState, useCallback } from "react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

    const alert = useCallback((options: string | AlertOptions) => {
        if (typeof options === "string") {
            setConfig({ description: options, title: "提示" });
        } else {
            setConfig({ title: "提示", ...options });
        }
        setIsOpen(true);
    }, []);

    const AlertDialogComponent = () => (
        <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{config.title || "提示"}</AlertDialogTitle>
                    <AlertDialogDescription>{config.description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogAction onClick={() => setIsOpen(false)}>
                        {config.confirmText || "确定"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );

    return { alert, AlertDialogComponent };
}
