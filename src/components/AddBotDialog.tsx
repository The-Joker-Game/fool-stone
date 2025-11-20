import { useState } from "react";
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

interface AddBotDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (botName: string) => void;
    onCancel?: () => void;
}

export function AddBotDialog({
    open,
    onOpenChange,
    onConfirm,
    onCancel,
}: AddBotDialogProps) {
    const [name, setName] = useState("");

    const handleConfirm = () => {
        onConfirm(name);
        onOpenChange(false);
        setName(""); // Reset for next time
    };

    const handleCancel = () => {
        onCancel?.();
        onOpenChange(false);
        setName("");
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleConfirm();
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>添加机器人</DialogTitle>
                    <DialogDescription>
                        请输入机器人的昵称，留空则自动命名。
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-4">
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="机器人昵称（可选）"
                        autoFocus
                    />
                </div>
                <DialogFooter className="sm:justify-between">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancel}
                    >
                        取消
                    </Button>
                    <Button
                        type="button"
                        onClick={handleConfirm}
                    >
                        添加
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// Hook for using add bot dialog
export function useAddBotDialog() {
    const [isOpen, setIsOpen] = useState(false);
    const [resolvePromise, setResolvePromise] = useState<((value: string | null) => void) | null>(null);

    const showDialog = (): Promise<string | null> => {
        setIsOpen(true);
        return new Promise<string | null>((resolve) => {
            setResolvePromise(() => resolve);
        });
    };

    const handleConfirm = (botName: string) => {
        if (resolvePromise) {
            resolvePromise(botName);
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

    const AddBotDialogComponent = () => (
        <AddBotDialog
            open={isOpen}
            onOpenChange={setIsOpen}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
        />
    );

    return { showAddBotDialog: showDialog, AddBotDialogComponent };
}
