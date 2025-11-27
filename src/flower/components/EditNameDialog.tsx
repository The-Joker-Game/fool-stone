// src/components/EditNameDialog.tsx
import { useState, useEffect, useCallback } from "react";
import { AppDialog } from "./AppDialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";



function EditNameContent({
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

    // Reset value when defaultValue changes
    useEffect(() => {
        setValue(defaultValue);
    }, [defaultValue]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && value.trim()) {
            onConfirm(value.trim());
        }
    };

    return (
        <div className="py-4">
            <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="请输入昵称"
                className={`text-lg h-12 ${isNight ? "bg-black/20 border-white/20 text-white placeholder:text-white/40" : ""}`}
                autoFocus
            />
            <div className="w-full flex flex-col gap-2 mt-4">
                <Button
                    type="button"
                    className={isNight ? "bg-white text-black hover:bg-white/90 w-full" : "w-full"}
                    onClick={() => onConfirm(value.trim())}
                    disabled={!value.trim()}
                >
                    确定
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

export function useEditNameDialog(isNight: boolean = false) {
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

    const handleConfirm = useCallback((name: string) => {
        if (resolvePromise) {
            resolvePromise(name);
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

    const EditNameDialogElement = (
        <AppDialog
            open={isOpen}
            onOpenChange={(open) => {
                if (!open) handleCancel();
                setIsOpen(open);
            }}
            title="修改昵称"
            description="请输入新的昵称"
            isNight={isNight}
        >
            <EditNameContent
                defaultValue={defaultValue}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                isNight={isNight}
            />
        </AppDialog>
    );

    return { showEditNameDialog: showDialog, EditNameDialogElement };
}
