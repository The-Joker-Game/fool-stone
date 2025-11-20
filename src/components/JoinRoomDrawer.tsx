// src/components/JoinRoomDrawer.tsx
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
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSlot,
} from "@/components/ui/input-otp";
import { DoorOpen } from "lucide-react";

interface JoinRoomDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultValue?: string;
    onConfirm: (roomCode: string) => void;
    onCancel?: () => void;
}

export function JoinRoomDrawer({
    open,
    onOpenChange,
    defaultValue = "",
    onConfirm,
    onCancel,
}: JoinRoomDrawerProps) {
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
        <Drawer open={open} onOpenChange={onOpenChange}>
            <DrawerContent>
                <div className="mx-auto w-full max-w-md">
                    <DrawerHeader>
                        <DrawerTitle className="flex items-center gap-2">
                            <DoorOpen className="h-5 w-5" />
                            加入房间
                        </DrawerTitle>
                        <DrawerDescription>
                            请输入四位房间号
                        </DrawerDescription>
                    </DrawerHeader>

                    <div className="flex flex-col items-center gap-4 p-4 pb-0">
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
                        <p className="text-sm text-muted-foreground">
                            {value.length}/4 位已输入
                        </p>
                    </div>

                    <DrawerFooter>
                        <Button
                            onClick={handleConfirm}
                            disabled={value.length !== 4}
                            className="w-full"
                        >
                            <DoorOpen className="h-4 w-4 mr-2" />
                            加入房间
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

// Hook for using join room drawer
export function useJoinRoomDrawer() {
    const [isOpen, setIsOpen] = useState(false);
    const [defaultValue, setDefaultValue] = useState("");
    const [resolvePromise, setResolvePromise] = useState<((value: string | null) => void) | null>(null);

    const showDrawer = (initialValue: string = ""): Promise<string | null> => {
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

    const JoinRoomDrawerComponent = () => (
        <JoinRoomDrawer
            open={isOpen}
            onOpenChange={setIsOpen}
            defaultValue={defaultValue}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
        />
    );

    return { showJoinRoomDrawer: showDrawer, JoinRoomDrawerComponent };
}
