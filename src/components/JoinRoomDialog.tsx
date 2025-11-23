// src/components/JoinRoomDialog.tsx
import { useState, useCallback } from "react";
import { AppDialog } from "./AppDialog";
import { Button } from "@/components/ui/button";
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSlot,
} from "@/components/ui/input-otp";



function JoinRoomContent({
    defaultValue,
    onConfirm,
    onCancel,
    isNight
}: {
    defaultValue: string,
    onConfirm: (val: string) => void,
    onCancel: () => void,
    isNight: boolean
}) {
    const [value, setValue] = useState(defaultValue);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && value.length === 4) {
            onConfirm(value);
        }
    };

    return (
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
            <div className="flex flex-col gap-2 w-full">
                <Button
                    type="button"
                    className={isNight ? "bg-white text-black hover:bg-white/90 w-full" : "w-full"}
                    onClick={() => onConfirm(value)}
                    disabled={value.length !== 4}
                >
                    加入房间
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

export function useJoinRoomDialog(isNight: boolean = false) {
    const [isOpen, setIsOpen] = useState(false);
    const [defaultValue, setDefaultValue] = useState("");
    const [resolvePromise, setResolvePromise] = useState<((value: string | null) => void) | null>(null);

    const showDialog = useCallback((initialValue: string = ""): Promise<string | null> => {
        setDefaultValue(initialValue);
        setIsOpen(true);
        return new Promise<string | null>((resolve) => {
            setResolvePromise(() => resolve);
        });
    }, []);

    const handleConfirm = useCallback((roomCode: string) => {
        if (resolvePromise) {
            resolvePromise(roomCode);
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

    const JoinRoomDialogElement = (
        <AppDialog
            open={isOpen}
            onOpenChange={(open) => {
                if (!open) handleCancel();
                setIsOpen(open);
            }}
            title="加入房间"
            description="请输入四位房间号"
            isNight={isNight}
        >
            <JoinRoomContent
                defaultValue={defaultValue}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                isNight={isNight}
            />
        </AppDialog>
    );

    return { showJoinRoomDialog: showDialog, JoinRoomDialogElement };
}
