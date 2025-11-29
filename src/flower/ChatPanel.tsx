// src/flower/ChatPanel.tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import "tippy.js/dist/tippy.css";
import Avvvatars from "avvvatars-react";
import { Send, MessageSquareOff, ArrowDown, Mic, MicOff, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ChatMessage, ChatMention, FlowerPlayerState, FlowerPhase } from "./types";
import { getSessionId } from "../realtime/socket";
import { motion, AnimatePresence } from "framer-motion";

// --- 辅助函数 ---
const cleanName = (name: string | undefined) => name?.replace(/\u200B/g, "") || "";

// --- 类型定义 ---

declare global {
    interface Window {
        __mentionKeyHandler?: (event: KeyboardEvent) => boolean;
    }
}

interface ChatPanelProps {
    messages: ChatMessage[];
    players: FlowerPlayerState[];
    onSendMessage: (content: string, mentions: ChatMention[]) => Promise<{ ok: boolean; error?: string }>;
    mySessionId: string;
    connected?: boolean; // 新增 connected 属性
    isNight?: boolean;
    phase?: FlowerPhase;
    currentSpeakerSeat?: number | null;
    onPassTurn?: () => void;
}

interface MentionListProps {
    items: FlowerPlayerState[];
    command: (props: { id: string | number; label: string }) => void;
}

// --- 提及列表组件 (MentionList) ---
const MentionList = ({ items, command }: MentionListProps) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const selectItem = useCallback((index: number) => {
        const item = items[index];
        if (item) {
            command({ id: item.seat, label: cleanName(item.name) });
        }
    }, [items, command]);

    useEffect(() => setSelectedIndex(0), [items]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "ArrowUp") {
                setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
                return true;
            }
            if (event.key === "ArrowDown") {
                setSelectedIndex((prev) => (prev + 1) % items.length);
                return true;
            }
            if (event.key === "Enter") {
                selectItem(selectedIndex);
                return true;
            }
            return false;
        };

        window.__mentionKeyHandler = handleKeyDown;
        return () => { window.__mentionKeyHandler = undefined; };
    }, [selectedIndex, items, selectItem]);

    if (items.length === 0) return null;

    return (
        <div className="bg-popover border text-popover-foreground rounded-md shadow-md p-1 min-w-[140px] overflow-hidden">
            {items.map((item, index) => (
                <button
                    key={item.seat}
                    className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer outline-none transition-colors",
                        index === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                    )}
                    onClick={() => selectItem(index)}
                >
                    <Avvvatars value={cleanName(item.name)} size={20} style="shape" />
                    <span className="flex-1 text-left truncate font-medium">{cleanName(item.name)}</span>
                    <span className="text-xs text-muted-foreground opacity-70">#{item.seat}</span>
                </button>
            ))}
        </div>
    );
};

const SpeakingOrderHeader = ({
    phase,
    currentSpeakerSeat,
    players,
    mySessionId,
    onPassTurn
}: {
    phase?: FlowerPhase;
    currentSpeakerSeat?: number | null;
    players: FlowerPlayerState[];
    mySessionId: string;
    onPassTurn?: () => void;
}) => {
    if (phase !== "day_discussion" && phase !== "day_vote" && phase !== "day_last_words") return null;

    const isVote = phase === "day_vote";
    const isLastWords = phase === "day_last_words";
    const currentSpeaker = players.find(p => p.seat === currentSpeakerSeat);
    const isMyTurn = currentSpeaker?.sessionId === mySessionId;

    return (
        <div className="relative z-20 bg-orange-50/90 backdrop-blur-sm border-b border-orange-100 p-2 flex items-center justify-between min-h-[3.5rem] transition-colors duration-300">
            <div className="flex items-center gap-3 overflow-hidden">
                <div className="bg-orange-100 p-1.5 rounded-full text-orange-600 flex-shrink-0">
                    {isVote ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 animate-pulse" />}
                </div>

                <AnimatePresence mode="wait">
                    {isVote ? (
                        <motion.div
                            key="vote-phase"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="flex flex-col"
                        >
                            <span className="text-sm font-bold text-gray-700">发言结束</span>
                            <span className="text-xs text-gray-500">请进行投票</span>
                        </motion.div>
                    ) : (
                        <motion.div
                            key={currentSpeakerSeat ?? "unknown"}
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            className="flex items-center gap-2"
                        >
                            {currentSpeaker ? (
                                <>
                                    <Avvvatars value={cleanName(currentSpeaker.name)} size={28} style="shape" />
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-gray-800 flex items-center gap-1">
                                            {cleanName(currentSpeaker.name)}
                                            <span className="text-[10px] font-normal bg-orange-100 text-orange-700 px-1 rounded">#{currentSpeaker.seat}</span>
                                        </span>
                                        <span className="text-[10px] text-orange-600 font-medium">
                                            {isMyTurn ? "轮到你了！" : isLastWords ? "发表遗言..." : "正在发言..."}
                                        </span>
                                    </div>
                                </>
                            ) : (
                                <span className="text-sm text-gray-500">等待发言...</span>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {!isVote && isMyTurn && (
                <Button
                    size="sm"
                    onClick={onPassTurn}
                    className="bg-orange-500 hover:bg-orange-600 text-white shadow-md animate-in fade-in zoom-in duration-300 flex items-center gap-1 px-3"
                >
                    结束发言
                </Button>
            )}
        </div>
    );
};

// --- 主组件 ---
export function ChatPanel({ messages, players, onSendMessage, mySessionId, connected = true, isNight = false, phase, currentSpeakerSeat, onPassTurn }: ChatPanelProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [isSending, setIsSending] = useState(false);
    const [editorContent, setEditorContent] = useState("");
    const sendMessageRef = useRef<(() => void) | null>(null);

    // 使用 ref 来存储 players，打破 useEditor 的依赖链
    // 解决 players 更新导致编辑器重置（无法输入/发送）的问题
    const playersRef = useRef(players);
    useEffect(() => {
        playersRef.current = players;
    }, [players]);

    const [isAtBottom, setIsAtBottom] = useState(true);
    const [lastReadTimestamp, setLastReadTimestamp] = useState(0);

    // 滚动监听
    const handleScroll = useCallback(() => {
        if (!scrollRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        const isBottom = scrollHeight - scrollTop - clientHeight < 50;
        setIsAtBottom(isBottom);

        if (isBottom && messages.length > 0) {
            // 如果滚动到底部，更新最后阅读时间
            setLastReadTimestamp(Math.max(lastReadTimestamp, messages[messages.length - 1].timestamp));
        }
    }, [messages, lastReadTimestamp]);

    // 自动滚动到底部
    useEffect(() => {
        if (isAtBottom && scrollRef.current) {
            // 使用 setTimeout 确保 DOM 已更新
            setTimeout(() => {
                if (scrollRef.current) {
                    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
            }, 0);

            // 如果自动滚动了，也更新阅读状态
            if (messages.length > 0) {
                setLastReadTimestamp(prev => Math.max(prev, messages[messages.length - 1].timestamp));
            }
        }
    }, [messages, isAtBottom]);

    // Tiptap 编辑器配置
    const editor = useEditor({
        extensions: [
            StarterKit,
            Placeholder.configure({
                placeholder: "输入消息... (@提及玩家)",
                emptyEditorClass: "is-editor-empty before:content-[attr(data-placeholder)] before:text-muted-foreground before:float-left before:pointer-events-none before:h-0",
            }),
            Mention.configure({
                HTMLAttributes: {
                    class: "mention-capsule",
                },
                suggestion: {
                    char: '@',
                    allowSpaces: true,
                    allowedPrefixes: null, // 允许在任何字符后触发 @，包括紧跟 mention 后
                    items: ({ query }) => {
                        const q = query.toLowerCase();
                        // 使用 ref 获取最新的 players
                        return playersRef.current
                            .filter(p => (p.sessionId || p.isBot) && p.sessionId !== getSessionId())
                            .filter(p => cleanName(p.name).toLowerCase().includes(q) || String(p.seat).includes(q))
                            .slice(0, 9);
                    },
                    command: ({ editor, range, props }) => {
                        // 使用 ProseMirror transaction 直接操作
                        const { state, view } = editor;
                        const { schema } = state;

                        // 暂时不删除 @，只替换查询文本
                        // range.from 是查询文本的开始
                        const from = range.from;
                        const to = range.to;

                        // 检查 @ 前面是否是 mention 节点
                        // @ 的位置是 from - 1，所以我们要检查 from - 1 的前面
                        const $atPos = state.doc.resolve(from - 1);
                        const nodeBefore = $atPos.nodeBefore;
                        const isPreviousMention = nodeBefore?.type.name === 'mention';

                        // 创建 mention 节点
                        const mentionNode = schema.nodes.mention.create(props);

                        const tr = state.tr;

                        if (isPreviousMention) {
                            // 如果前面是 mention，先在 @ 前面插入一个空格
                            // @ 的位置是 from - 1
                            tr.insert(from - 1, schema.text(' '));
                            // 插入空格后，原来的内容向后移动了 1 位
                            // 替换查询文本 (from + 1 到 to + 1)
                            tr.replaceWith(from + 1, to + 1, mentionNode);
                        } else {
                            // 否则直接替换查询文本
                            tr.replaceWith(from, to, mentionNode);
                        }

                        view.dispatch(tr);
                    },
                    render: () => {
                        let component: ReactRenderer;
                        let popup: TippyInstance[];

                        return {
                            onStart: (props) => {
                                // 如果没有匹配项（例如只有自己），MentionList 返回 null，此时不应该显示 tippy
                                if (props.items.length === 0) return;

                                component = new ReactRenderer(MentionList, {
                                    props,
                                    editor: props.editor,
                                });

                                if (!props.clientRect) return;

                                popup = tippy("body", {
                                    getReferenceClientRect: props.clientRect as () => DOMRect,
                                    appendTo: () => document.body,
                                    content: component.element,
                                    showOnCreate: true,
                                    interactive: true,
                                    trigger: "manual",
                                    placement: "top-start",
                                    arrow: false,
                                    offset: [0, 8],
                                });
                            },
                            onUpdate(props) {
                                if (!component || !popup) return;
                                component.updateProps(props);
                                if (!props.clientRect) return;
                                popup[0].setProps({
                                    getReferenceClientRect: props.clientRect as () => DOMRect,
                                });
                            },
                            onKeyDown(props) {
                                if (props.event.key === "Escape") {
                                    popup?.[0].hide();
                                    return true;
                                }
                                if (window.__mentionKeyHandler) {
                                    return window.__mentionKeyHandler(props.event);
                                }
                                return false;
                            },
                            onExit() {
                                popup?.[0].destroy();
                                component?.destroy();
                            },
                        };
                    },
                },
            }),
        ],
        editorProps: {
            attributes: {
                class: "prose prose-sm focus:outline-none min-h-[44px] max-h-32 overflow-y-auto px-4 py-3 text-[1rem]",
                enterkeyhint: "send",
            },
            handleKeyDown: (view: any, event: any) => {
                // Handle Enter key to send message
                if (event.key === 'Enter' && !event.shiftKey) {
                    // If mention popup is open, let it handle the Enter key
                    if (window.__mentionKeyHandler) {
                        const handled = window.__mentionKeyHandler(event);
                        if (handled) {
                            return true;
                        }
                    }

                    event.preventDefault();
                    // Trigger send message using ref
                    if (sendMessageRef.current) {
                        sendMessageRef.current();
                    }
                    return true;
                }

                if (event.key === 'Backspace') {
                    const { state, dispatch } = view;
                    const { selection } = state;
                    const { empty, $from } = selection;

                    if (empty) {
                        const nodeBefore = $from.nodeBefore;
                        if (nodeBefore && nodeBefore.type.name === 'mention') {
                            // 我们正在删除一个 mention
                            const mentionSize = nodeBefore.nodeSize;
                            const mentionPos = $from.pos - mentionSize;

                            const $mentionPos = state.doc.resolve(mentionPos);
                            const nodeBeforeMention = $mentionPos.nodeBefore;

                            // 检查 mention 前面是否有一个空格,且空格前面是另一个 mention
                            if (nodeBeforeMention && nodeBeforeMention.text === ' ' && nodeBeforeMention.nodeSize === 1) {
                                const spacePos = mentionPos - 1;
                                const $spacePos = state.doc.resolve(spacePos);
                                const nodeBeforeSpace = $spacePos.nodeBefore;

                                if (nodeBeforeSpace && nodeBeforeSpace.type.name === 'mention') {
                                    // [mention] [mention]| -> 删除空格和当前的 mention
                                    if (dispatch) {
                                        dispatch(state.tr.delete(spacePos, $from.pos));
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                }
                return false;
            }
        },
        onUpdate: ({ editor }) => {
            setEditorContent(editor.getText());
        },
    }, []); // 依赖项为空，确保编辑器只创建一次

    // 监听连接状态，控制编辑器可编辑性
    useEffect(() => {
        if (editor) {
            editor.setEditable(connected);
        }
    }, [editor, connected]);

    const handleSendMessage = useCallback(async () => {
        if (!editor || isSending || !connected) return;

        const text = editor.getText().trim();
        if (!text) return;

        setIsSending(true);

        const textContent = text;
        const mentions: ChatMention[] = [];
        editor.getJSON().content?.forEach((node) => {
            if (node.type === "paragraph" && node.content) {
                node.content.forEach((innerNode: any) => {
                    if (innerNode.type === "mention" && innerNode.attrs) {
                        mentions.push({
                            seat: Number(innerNode.attrs.id),
                            name: innerNode.attrs.label
                        });
                    }
                });
            }
        });

        const uniqueMentions = Array.from(new Map(mentions.map(m => [m.seat, m])).values());

        const result = await onSendMessage(textContent, uniqueMentions);

        if (result.ok) {
            editor.commands.clearContent();
        }
        setIsSending(false);
    }, [editor, isSending, connected, onSendMessage]);

    // Update ref to allow keyboard handler to call this function
    useEffect(() => {
        sendMessageRef.current = handleSendMessage;
    }, [handleSendMessage]);

    const renderMessageContent = useCallback((msg: ChatMessage) => {
        if (!msg.mentions || msg.mentions.length === 0) return msg.content;

        const content = msg.content;
        const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const names = msg.mentions.map(m => `@${escapeRegExp(m.name)}`).join("|");

        if (!names) return msg.content;

        const regex = new RegExp(`(${names})`, "g");
        const split = content.split(regex);

        return split.map((part, i) => {
            const isMention = msg.mentions.some(m => `@${m.name}` === part);
            if (isMention) {
                return (
                    <span key={i} className="mx-0.5 inline-block bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded text-xs font-medium align-middle">
                        {part}
                    </span>
                );
            }
            return part;
        });
    }, []);

    const formatTime = (ts: number) => new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

    const unreadCount = messages.filter(m => m.timestamp > lastReadTimestamp).length;

    const scrollToBottom = () => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    };

    return (
        <div className={cn(
            "flex flex-col h-full border rounded-xl overflow-hidden shadow-sm relative transition-colors duration-500",
            isNight ? "bg-black/20 border-white/10" : "bg-white/20 border-gray-200"
        )}>
            <SpeakingOrderHeader
                phase={phase}
                currentSpeakerSeat={currentSpeakerSeat}
                players={players}
                mySessionId={mySessionId}
                onPassTurn={onPassTurn}
            />
            <ScrollArea
                ref={scrollRef}
                className="flex-1 p-4"
                onScroll={handleScroll}
            >
                <div className="space-y-6 pb-2">
                    {messages.length === 0 && (
                        <div className={cn("flex flex-col items-center justify-center h-40 text-sm opacity-60", isNight ? "text-white/50" : "text-muted-foreground")}>
                            <MessageSquareOff className="h-10 w-10 mb-2 stroke-1" />
                            <p>聊天室暂无消息</p>
                        </div>
                    )}

                    {messages.map((msg, idx) => {
                        const isMe = msg.sessionId === mySessionId;
                        const showTime = idx === 0 || (msg.timestamp - messages[idx - 1].timestamp > 3 * 60 * 1000);
                        const isSystem = !msg.sessionId;

                        if (isSystem) {
                            return (
                                <div key={msg.id} className="flex justify-center my-4">
                                    <span className="bg-gray-200/60 text-gray-500 text-xs px-3 py-1 rounded-full">
                                        {msg.content}
                                    </span>
                                </div>
                            );
                        }

                        const isUnread = msg.timestamp > lastReadTimestamp;
                        const showUnreadDivider = isUnread && (idx === 0 || messages[idx - 1].timestamp <= lastReadTimestamp);

                        // Dynamic name lookup
                        const senderPlayer = players.find(p => p.sessionId === msg.sessionId);
                        const displayName = senderPlayer ? cleanName(senderPlayer.name) : cleanName(msg.senderName);

                        return (
                            <div key={msg.id} className="space-y-2">
                                {showUnreadDivider && (
                                    <div className="flex items-center justify-center my-4 opacity-80">
                                        <div className="h-px bg-red-200 flex-1"></div>
                                        <span className="px-3 text-[10px] text-red-400 font-medium bg-[#F5F7FB]">新消息</span>
                                        <div className="h-px bg-red-200 flex-1"></div>
                                    </div>
                                )}
                                {showTime && (
                                    <div className="flex justify-center">
                                        <span className={cn(
                                            "text-[10px] px-2 py-0.5 rounded-sm",
                                            isNight ? "text-white/60 bg-white/10" : "text-gray-400 bg-gray-100"
                                        )}>
                                            {formatTime(msg.timestamp)}
                                        </span>
                                    </div>
                                )}

                                <div className={cn("flex gap-3", isMe ? "flex-row-reverse" : "flex-row")}>
                                    {/* 头像 */}
                                    <div className="flex-shrink-0 flex flex-col justify-end">
                                        <Avvvatars value={displayName} size={36} style="shape" />
                                    </div>

                                    {/* 气泡主体 */}
                                    <div className={cn("flex flex-col max-w-[75%]", isMe ? "items-end" : "items-start")}>
                                        {/* 昵称和座次 (自己和别人的都显示) */}
                                        <div className={cn(
                                            "flex items-center gap-1 mb-1",
                                            isMe ? "mr-1 flex-row-reverse" : "ml-1 flex-row"
                                        )}>
                                            <span className={cn("text-xs font-medium", isNight ? "text-white/70" : "text-gray-500")}>{displayName}</span>
                                            <span className={cn("text-[10px] px-1 rounded", isNight ? "text-white/50 bg-white/10" : "text-gray-400 bg-gray-100")}>#{msg.senderSeat}</span>
                                        </div>

                                        <div
                                            className={cn(
                                                "px-4 py-2.5 text-[15px] leading-relaxed shadow-sm break-words relative min-w-[3rem]",
                                                isMe
                                                    ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm"
                                                    : cn(
                                                        "rounded-2xl rounded-tl-sm border",
                                                        isNight
                                                            ? "bg-white/10 text-white border-white/10"
                                                            : "bg-white text-gray-800 border-gray-100"
                                                    )
                                            )}
                                        >
                                            {renderMessageContent(msg)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </ScrollArea>

            {/* 新消息提示悬浮按钮 */}
            {!isAtBottom && unreadCount > 0 && (
                <button
                    onClick={scrollToBottom}
                    className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-white hover:bg-gray-200 text-black text-xs px-3 py-1.5 rounded-full shadow-md z-20 flex items-center gap-1.5 transition-all animate-in fade-in slide-in-from-bottom-2 cursor-pointer"
                >
                    <ArrowDown className="w-3 h-3" />
                    <span>{unreadCount} 条新消息</span>
                </button>
            )}

            {/* 底部输入栏 */}
            <div className={cn("border-t p-3 flex items-end gap-2 relative z-10", isNight ? "bg-black/40 border-white/10" : "bg-white border-gray-200")}>
                <div className={cn(
                    "flex-1 border rounded-2xl focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all overflow-hidden",
                    isNight ? "bg-white/5 border-white/10 text-white focus-within:bg-black/40" : "bg-gray-50 border-gray-200 focus-within:bg-white",
                    !connected && "opacity-60 cursor-not-allowed"
                )}>
                    <EditorContent editor={editor} />
                </div>
                <Button
                    onClick={handleSendMessage}
                    disabled={!connected || !editor || !editorContent.trim() || isSending}
                    size="icon"
                    className={cn(
                        "h-11 w-11 rounded-full flex-shrink-0 transition-all shadow-sm",
                        (!connected || !editor || !editorContent.trim() || isSending) ? "bg-gray-200 text-gray-400" : "bg-primary hover:bg-primary/90"
                    )}
                >
                    <Send className="h-5 w-5 ml-0.5" />
                </Button>
            </div>

            <style>{`
        .ProseMirror p { margin: 0; }
        .mention-capsule {
          color: #2563eb;
          background-color: #eff6ff;
          border-radius: 0.375rem;
          padding: 0.1rem 0.3rem;
          margin: 0 2px;
          font-size: 0.9em;
          font-weight: 600;
          display: inline-block;
          border: 1px solid rgba(37, 99, 235, 0.1);
          vertical-align: baseline;
        }
        .ProseMirror { caret-color: hsl(var(--primary)); }
        .is-editor-empty:before { color: #9ca3af; pointer-events: none; }
        /* 禁用状态下隐藏 placeholder */
        .ProseMirror[contenteditable="false"] { color: #9ca3af; }
        .tippy-box {
            background-color: transparent !important;
            box-shadow: none !important;
            border: none !important;
        }
      `}</style>
        </div>
    );
}