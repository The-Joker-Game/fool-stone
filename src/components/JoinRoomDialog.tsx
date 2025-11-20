// src/components/JoinRoomDialog.tsx
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
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSlot,
} from "@/components/ui/input-otp";

interface JoinRoomDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultValue?: string;
    onConfirm: (roomCode: string) => void;
    onCancel?: () => void;
}

export function JoinRoomDialog({
    open,
    onOpenChange,
    defaultValue = "",
    onConfirm,
    onCancel,
}: JoinRoomDialogProps) {
    const [value, setValue] = useState(defaultValue);

    const handleConfirm = () => {
        if (value.length === 4) {
            onConfirm(value);
            onOpenChange(false);
        }
    };

    const handleCancel = () => {
        onCancel?.();
        onOpenChange(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && value.length === 4) {
            handleConfirm();
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>加入房间</DialogTitle>
                    <DialogDescription>
                        请输入四位房间号
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col items-center gap-4 py-4">
                    <InputOTP
                        maxLength={4}
                        value={value}
                        onChange={setValue}
                        onKeyDown={handleKeyDown}
                        autoFocus
                    >
                        <InputOTPGroup>
                            <InputOTPSlot index={0} />
                            <InputOTPSlot index={1} />
                            <InputOTPSlot index={2} />
                            <InputOTPSlot index={3} />
                        </InputOTPGroup>
                    </InputOTP>
                </div>
                <DialogFooter className="sm:justify-between flex-col gap-2">
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
                        disabled={value.length !== 4}
                    >
                        加入房间
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// Hook for using join room dialog
export function useJoinRoomDialog() {
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

    const handleConfirm = (roomCode: string) => {
        if (resolvePromise) {
            resolvePromise(roomCode);
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

    const JoinRoomDialogComponent = () => (
        <JoinRoomDialog
            open={isOpen}
            onOpenChange={setIsOpen}
            defaultValue={defaultValue}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
        />
    );

    return { showJoinRoomDialog: showDialog, JoinRoomDialogComponent };
}
