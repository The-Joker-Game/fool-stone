export type RoomCode = string; // "1000" - "9999"

export type Player = {
  id: string;          // 例如 "P1" "P2" ...
  name: string;
  sessionId: string;   // 浏览器本地保存，用于重连
  isHost: boolean;
  online: boolean;
};

import { FlowerSnapshot } from "./game-flower/types.js";

export type FoolStoneSnapshot = {
  // 直接把你前端的可序列化状态做一份快照
  engine?: undefined; // Discriminate from FlowerSnapshot
  game: unknown;
  isOver: boolean;
  finalRanks: Array<Record<string, unknown>> | null;
  flaskMap: Record<number, string> | null;
  nextFlaskMap: Record<number, string> | null;
  foolPrankUsed: boolean;
  roundStartScores: Record<string, unknown> | null;
  omenStone?: string | null;
  chatMessages?: Array<unknown>;
  updatedAt?: number;
};

export type Snapshot = FoolStoneSnapshot | FlowerSnapshot;

export type Room = {
  code: RoomCode;
  hostSocketId: string | null;
  players: Player[];
  snapshot: Snapshot | null;
  version: number;          // 每次房主提交 +1，用于防乱序
  createdAt: number;
  maxPlayers: number;       // 先默认 5，未来支持 6
};
