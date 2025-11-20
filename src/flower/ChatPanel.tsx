// src/flower/ChatPanel.tsx
import { useState, useRef, useEffect, useMemo } from "react";
import Avvvatars from "avvvatars-react";
import type { ChatMessage, ChatMention, FlowerPlayerState } from "./types";
import { getSessionId } from "../realtime/socket";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatPanelProps {
    messages: ChatMessage[];
    players: FlowerPlayerState[];
    onSendMessage: (content: string, mentions: ChatMention[]) => Promise<{ ok: boolean; error?: string }>;
    mySessionId: string;
}

export function ChatPanel({ messages, players, onSendMessage, mySessionId }: ChatPanelProps) {
    const [inputValue, setInputValue] = useState("");
    const [showMentionMenu, setShowMentionMenu] = useState(false);
    const [mentionSearchTerm, setMentionSearchTerm] = useState("");
    const [cursorPosition, setCursorPosition] = useState(0);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    // Scroll to bottom when new messages arrive
    useEffect(() => {
        if (chatContainerRef.current) {
            // Use a small timeout to ensure the DOM has updated with the new message
            setTimeout(() => {
                if (chatContainerRef.current) {
                    chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
                }
            }, 0);
        }
    }, [messages]);

    // Filter players for mention suggestions
    const mentionSuggestions = useMemo(() => {
        // 包含机器人玩家，但排除自己
        const activePlayers = players.filter(p => (p.sessionId || p.isBot) && p.sessionId !== getSessionId());
        if (!mentionSearchTerm) return activePlayers;
        const search = mentionSearchTerm.toLowerCase();
        return activePlayers.filter(
            p => p.name.toLowerCase().includes(search) || `${p.seat}`.includes(search)
        );
    }, [players, mentionSearchTerm]);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        const cursorPos = e.target.selectionStart || 0;

        setInputValue(value);
        setCursorPosition(cursorPos);

        // Check if user is typing @ for mentions
        const textBeforeCursor = value.slice(0, cursorPos);
        const lastAtSymbol = textBeforeCursor.lastIndexOf("@");

        if (lastAtSymbol !== -1 && lastAtSymbol === cursorPos - 1) {
            // Just typed @
            setShowMentionMenu(true);
            setMentionSearchTerm("");
        } else if (lastAtSymbol !== -1) {
            // Check if we're still in a mention context
            const textAfterAt = textBeforeCursor.slice(lastAtSymbol + 1);
            if (!/\s/.test(textAfterAt)) {
                setShowMentionMenu(true);
                setMentionSearchTerm(textAfterAt);
            } else {
                setShowMentionMenu(false);
            }
        } else {
            setShowMentionMenu(false);
        }
    };

    const insertMention = (player: FlowerPlayerState) => {
        const textBeforeCursor = inputValue.slice(0, cursorPosition);
        const textAfterCursor = inputValue.slice(cursorPosition);
        const lastAtSymbol = textBeforeCursor.lastIndexOf("@");

        if (lastAtSymbol !== -1) {
            const mentionText = `@${player.name} `;
            const newValue =
                inputValue.slice(0, lastAtSymbol) +
                mentionText +
                textAfterCursor;

            setInputValue(newValue);
            setShowMentionMenu(false);
            setMentionSearchTerm("");

            // Set cursor position after mention
            setTimeout(() => {
                if (inputRef.current) {
                    const newCursorPos = lastAtSymbol + mentionText.length;
                    inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
                    inputRef.current.focus();
                }
            }, 0);
        }
    };

    const extractMentions = (text: string): ChatMention[] => {
        const mentions: ChatMention[] = [];
        const mentionRegex = /@([^\s@]+)/g;
        let match;

        while ((match = mentionRegex.exec(text)) !== null) {
            const mentionName = match[1];
            // 匹配玩家时也包含机器人
            const player = players.find(p => p.name === mentionName && (p.sessionId || p.isBot));
            if (player) {
                mentions.push({ seat: player.seat, name: player.name });
            }
        }

        return mentions;
    };

    const handleSendMessage = async () => {
        const trimmedContent = inputValue.trim();
        if (!trimmedContent) return;

        const mentions = extractMentions(trimmedContent);
        const result = await onSendMessage(trimmedContent, mentions);

        if (result.ok) {
            setInputValue("");
            setShowMentionMenu(false);
            setMentionSearchTerm("");
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!showMentionMenu) {
                handleSendMessage();
            }
        } else if (e.key === "Escape") {
            setShowMentionMenu(false);
        }
    };

    const renderMessageContent = (message: ChatMessage) => {
        const parts: React.ReactNode[] = [];
        let lastIndex = 0;
        const mentionRegex = /@([^\s@]+)/g;
        let match;

        while ((match = mentionRegex.exec(message.content)) !== null) {
            // Add text before mention
            if (match.index > lastIndex) {
                parts.push(
                    <span key={`text-${lastIndex}`}>
                        {message.content.slice(lastIndex, match.index)}
                    </span>
                );
            }

            const mentionName = match[1];
            const isMentioned = message.mentions.some(m => m.name === mentionName);
            const player = players.find(p => p.name === mentionName);
            const isMe = player ? (player.sessionId === mySessionId || (player.isBot && !player.sessionId)) : false;

            parts.push(
                <Badge
                    key={`mention-${match.index}`}
                    variant={isMe ? "default" : isMentioned ? "secondary" : "outline"}
                    className={cn(
                        "inline-flex",
                        isMe && "bg-primary text-primary-foreground"
                    )}
                >
                    @{mentionName}
                </Badge>
            );

            lastIndex = match.index + match[0].length;
        }

        // Add remaining text
        if (lastIndex < message.content.length) {
            parts.push(
                <span key={`text-${lastIndex}`}>
                    {message.content.slice(lastIndex)}
                </span>
            );
        }

        return <>{parts}</>;
    };

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    };

    return (
        <Card className="w-full">
            <CardHeader>
                <CardTitle>聊天室</CardTitle>
                <CardDescription>使用 @ 提及其他玩家</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Messages Container */}
                <ScrollArea
                    ref={chatContainerRef}
                    className="h-[400px] pr-4"
                >
                    <div className="space-y-4">
                        {messages.length === 0 ? (
                            <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                                暂无消息，开始聊天吧！
                            </div>
                        ) : (
                            messages.map((message) => {
                                const isMyMessage = message.sessionId === mySessionId;
                                const isMentioned = message.mentions.some(
                                    m => {
                                        const player = players.find(p => p.seat === m.seat);
                                        return player ? (player.sessionId === mySessionId || (player.isBot && !player.sessionId)) : false;
                                    }
                                );

                                return (
                                    <div
                                        key={message.id}
                                        className={cn(
                                            "flex gap-3",
                                            isMyMessage && "flex-row-reverse"
                                        )}
                                    >
                                        {/* Avatar */}
                                        <div className="flex-shrink-0">
                                            <Avvvatars
                                                value={message.senderName}
                                                size={40}
                                                style="shape"
                                            />
                                        </div>

                                        {/* Message Content */}
                                        <div className={cn(
                                            "flex flex-col gap-1 max-w-[70%]",
                                            isMyMessage && "items-end"
                                        )}>
                                            <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                                                <span className="font-medium">{message.senderName}</span>
                                                <span>座位{message.senderSeat}</span>
                                                <span>{formatTime(message.timestamp)}</span>
                                            </div>
                                            <div
                                                className={cn(
                                                    "px-4 py-2 rounded-lg text-sm break-words inline-flex flex-wrap items-center gap-1",
                                                    isMyMessage
                                                        ? "bg-primary text-primary-foreground"
                                                        : isMentioned
                                                            ? "bg-yellow-50 border-2 border-yellow-300 dark:bg-yellow-950 dark:border-yellow-700"
                                                            : "bg-muted"
                                                )}
                                            >
                                                {renderMessageContent(message)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </ScrollArea>

                {/* Input Container */}
                <div className="relative space-y-2">
                    {/* Mention Suggestions */}
                    {showMentionMenu && mentionSuggestions.length > 0 && (
                        <Card className="absolute bottom-full left-0 right-0 mb-2 max-h-40 overflow-y-auto z-10">
                            <CardContent className="p-2">
                                {mentionSuggestions.map((player) => (
                                    <button
                                        key={player.seat}
                                        className="w-full px-3 py-2 text-left hover:bg-accent rounded-md flex items-center gap-3 transition-colors"
                                        onClick={() => insertMention(player)}
                                        type="button"
                                    >
                                        <Avvvatars
                                            value={player.name}
                                            size={32}
                                            style="shape"
                                        />
                                        <div className="flex flex-col">
                                            <span className="font-medium text-sm">{player.name}</span>
                                            <span className="text-xs text-muted-foreground">座位{player.seat}</span>
                                        </div>
                                    </button>
                                ))}
                            </CardContent>
                        </Card>
                    )}

                    <div className="flex gap-2">
                        <Textarea
                            ref={inputRef}
                            value={inputValue}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            placeholder="输入消息... (使用 @ 提及玩家)"
                            className="resize-none"
                            rows={2}
                        />
                        <Button
                            onClick={handleSendMessage}
                            disabled={!inputValue.trim()}
                            size="icon"
                            className="h-16 w-16 flex-shrink-0"
                        >
                            <Send className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
