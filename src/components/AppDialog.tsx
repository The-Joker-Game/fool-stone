import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import React from "react";

interface AppDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: React.ReactNode;
    description?: React.ReactNode;
    children?: React.ReactNode;
    footer?: React.ReactNode;
    isNight?: boolean;
    className?: string;
}

export function AppDialog({
    open,
    onOpenChange,
    title,
    description,
    children,
    footer,
    isNight = false,
    className,
}: AppDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    "sm:max-w-md transition-colors duration-300",
                    isNight
                        ? "backdrop-blur-sm bg-gray-900/80 text-white border-white/20"
                        : "backdrop-blur-sm bg-white/80 text-slate-900 border-white/40",
                    className
                )}
            >
                <DialogHeader>
                    <DialogTitle className={cn(isNight ? "text-white" : "")}>{title}</DialogTitle>
                    {description && (
                        <DialogDescription className={cn(isNight ? "text-white/70" : "")}>
                            {description}
                        </DialogDescription>
                    )}
                </DialogHeader>
                {children}
                {footer && (
                    <DialogFooter className="sm:justify-between flex-col gap-2 sm:gap-0">
                        {footer}
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}
