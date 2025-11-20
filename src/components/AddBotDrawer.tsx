// src/components/AddBotDrawer.tsx
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
import { Input } from "@/components/ui/input";
import { Bot } from "lucide-react";

interface AddBotDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (botName: string) => void;
    onCancel?: () => void;
}

export function AddBotDrawer({
    open,
    onOpenChange,
    onConfirm,
    onCancel,
}: AddBotDrawerProps) {
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
        <Drawer open={open} onOpenChange={onOpenChange}>
            <DrawerContent>
                <div className="mx-auto w-full max-w-md">
                    <DrawerHeader>
                        <DrawerTitle className="flex items-center gap-2">
                            <Bot className="h-5 w-5" />
                            添加机器人
                        </DrawerTitle>
                        <DrawerDescription>
                            请输入机器人的昵称，留空则自动命名。
                        </DrawerDescription>
                    </DrawerHeader>

                    <div className="p-4 pb-0">
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="机器人昵称（可选）"
                            autoFocus
                            className="text-base"
                        />
                    </div>

                    <DrawerFooter>
                        <Button
                            onClick={handleConfirm}
                            className="w-full"
                        >
                            <Bot className="h-4 w-4 mr-2" />
                            添加机器人
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

// Hook for using add bot drawer
export function useAddBotDrawer() {
    const [isOpen, setIsOpen] = useState(false);
    const [resolvePromise, setResolvePromise] = useState<((value: string | null) => void) | null>(null);

    const showDrawer = (): Promise<string | null> => {
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

    const AddBotDrawerComponent = () => (
        <AddBotDrawer
            open={isOpen}
            onOpenChange={setIsOpen}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
        />
    );

    return { showAddBotDrawer: showDrawer, AddBotDrawerComponent };
}
