import { io } from "socket.io-client";

const code = process.argv[2];
const countArg = process.argv[3];
const targetCount = Number.isFinite(Number(countArg)) ? Math.max(1, Number(countArg)) : 9;
const endpoint = process.env.RT_URL || process.env.VITE_RT_URL || "ws://localhost:8787";

if (!code) {
  console.error("用法: node scripts/fillFlowerRoom.mjs <房间号> [人数, 默认9]");
  process.exit(1);
}

console.log(`准备在房间 ${code} 中自动加入 ${targetCount} 名测试玩家 (RT=${endpoint})`);

const bots = [];
let joined = 0;

function makeSessionId(idx) {
  return `bot_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 8)}`;
}

for (let i = 0; i < targetCount; i++) {
  const sessionId = makeSessionId(i);
  const name = `测试Bot-${i + 1}`;
  console.log(`创建 ${name} (session=${sessionId})`);
  const socket = io(endpoint, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });

  bots.push({ name, sessionId, socket });

  socket.on("connect", () => {
    socket.emit(
      "room:join",
      { code, name, sessionId },
      (resp = {}) => {
        if (!resp.ok) {
          console.error(`Bot ${name} 加入失败:`, resp.msg || "未知错误");
          socket.disconnect();
          return;
        }
        console.log(`Bot ${name} 已入座 (seat=${resp.me?.seat ?? "?"})`);
        joined += 1;
        socket.emit("room:ready", { code, sessionId, ready: true }, () => {});
        if (joined === targetCount) {
          console.log("所有测试玩家均已就位。按 Ctrl+C 退出并释放座位。");
        }
      }
    );
  });

  socket.on("disconnect", (reason) => {
    console.log(`Bot ${name} 断开 (${reason})`);
  });
}

setInterval(() => {}, 60_000);
