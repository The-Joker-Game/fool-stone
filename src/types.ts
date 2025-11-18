export type Stone = '金'|'木'|'水'|'火'|'土'|'贤'|'愚';
export const STONES: Stone[] = ['金','木','水','火','土','贤','愚'];
export type Phase = 'select'|'cast'|'end';

// Screen Wake Lock API 类型定义
export type WakeLockSentinel = {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
};

export interface Player { id: string; name: string; isFool?: boolean; }
export interface Score { pub: number; sec: number; }
export interface Pick { playerId: string; flask: number; stone: Stone; }
export interface FinalRankRow {
  playerId: string;
  name: string;
  pub: number;
  sec: number;
  total: number;
  place: number;
  reward: number;
}

export interface Game {
  id: string;
  seed: string;
  round: number;
  players: Player[];
  order: string[];                         // 本回合顺位
  scores: Record<string, Score>;
  hands: Record<string, Stone | null>;
  phase: Phase;

  flasks: Record<number, Stone>;           // 可选烧瓶
  discarded: number[];                     // 被弃的烧瓶号
  picks: Pick[];                           // 已选记录（5 条即选完）
  initialHolder: Record<Stone, string|null>; // 本回合石头初始持有者
  logs: string[];                          // 公开日志
  castIdx: number;                         // 施法顺序指针（占位）
  omenStone?: Stone | null;
}

export interface GameSnapshot {
  game: Game | null;
  endThreshold: number;
  isOver: boolean;
  finalRanks: FinalRankRow[] | null;
  flaskMap: Record<number, Stone> | null;
  nextFlaskMap: Record<number, Stone> | null;
  foolPrankUsed: boolean;
  roundStartScores: Record<string, Score> | null;
}
