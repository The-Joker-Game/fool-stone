import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface EditNameDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultValue?: string;
    onConfirm: (name: string) => void;
    onCancel?: () => void;
    isNight?: boolean;
}

export function EditNameDialog({
    open,
    onOpenChange,
    defaultValue = "",
    onConfirm,
    onCancel,
    isNight = false,
}: EditNameDialogProps) {
    const [value, setValue] = useState(defaultValue);

    // Reset value when dialog opens with new default
    useEffect(() => {
        if (open) {
            setValue(defaultValue);
        }
    }, [open, defaultValue]);

    const handleConfirm = () => {
        if (value.trim()) {
            onConfirm(value.trim());
            onOpenChange(false);
        }
    };

    const handleCancel = () => {
        onCancel?.();
        onOpenChange(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && value.trim()) {
            handleConfirm();
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className={`sm:max-w-md ${isNight ? "backdrop-blur-sm bg-gray-900/80 text-white border-white/20" : "backdrop-blur-sm bg-white/80 text-slate-900 border-white/40"}`}>
                <DialogHeader>
                    <DialogTitle>修改昵称</DialogTitle>
                    <DialogDescription className={isNight ? "text-white/70" : ""}>
                        请输入新的昵称
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="请输入昵称"
                        className={`text-lg h-12 ${isNight ? "bg-black/20 border-white/20 text-white placeholder:text-white/40" : ""}`}
                        autoFocus
                    />
                </div>
                <DialogFooter className="sm:justify-between flex-col gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        className={isNight ? "bg-transparent text-white border-white/50 hover:bg-white/20 hover:text-white" : ""}
                        onClick={handleCancel}
                    >
                        取消
                    </Button>
                    <Button
                        type="button"
                        className={isNight ? "bg-white text-black hover:bg-white/90" : ""}
                        onClick={handleConfirm}
                        disabled={!value.trim()}
                    >
                        确定
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// Hook for using edit name dialog
export function useEditNameDialog(isNight: boolean = false) {
    const [isOpen, setIsOpen] = useState(false);
    const [defaultValue, setDefaultValue] = useState("");
    const [resolvePromise, setResolvePromise] = useState<((value: string | null) => void) | null>(null);

    const showDialog = (initialValue: string = ""): Promise<string | null> => {
        setDefaultValue(initialValue);
        setIsOpen(true);
        return new Promise<string | null>((resolve) => {
            setResolvePromise(() => resolve);
        });
    };

    const handleConfirm = (name: string) => {
        if (resolvePromise) {
            resolvePromise(name);
            setResolvePromise(null);
        }
        setIsOpen(false);
    };

    const handleCancel = () => {
        if (resolvePromise) {
            resolvePromise(null);
            setResolvePromise(null);
        }
        setIsOpen(false);
    };

    const EditNameDialogComponent = () => (
        <EditNameDialog
            open={isOpen}
            onOpenChange={setIsOpen}
            defaultValue={defaultValue}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            isNight={isNight}
        />
    );

    return { showEditNameDialog: showDialog, EditNameDialogComponent };
}
