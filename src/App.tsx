// src/App.tsx
import OnlinePanel from './online/Panel';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGame, exportSnapshot as exportGameSnapshot, applySnapshot as applyGameSnapshot } from './store/game';
import { rt, getSessionId, type PresenceState } from './realtime/socket';
import './index.css';
import FlowerRoom from './FlowerRoom';
import type { WakeLockSentinel } from './types';


const CAST_ORDER = ['金', '木', '水', '火', '土', '贤', '愚'] as const;
type Stone = typeof CAST_ORDER[number];
type CastMode = 'show' | 'skip';

const isStone = (value: unknown): value is Stone =>
  typeof value === 'string' && (CAST_ORDER as readonly string[]).includes(value);

const isCastMode = (value: unknown): value is CastMode =>
  value === 'show' || value === 'skip';

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

function MainApp() {
  // —— 全局状态 —— //
  const g = useGame(s => s.game);
  const isOver = useGame(s => s.isOver);
  const finalRanks = useGame(s => s.finalRanks) ?? [];
  const endThreshold = useGame(s => s.endThreshold);
  const setEndThreshold = useGame(s => s.setEndThreshold);
  const flaskMap = useGame(s => s.flaskMap);
  const nextFlaskMap = useGame(s => s.nextFlaskMap);
  const foolPrankUsed = useGame(s => s.foolPrankUsed);
  const roundStartScores = useGame(s => s.roundStartScores);

  const flaskImageSrc = useCallback((no: number) => `/flasks/${no}.png`, []);

  // —— 屏幕常亮功能 —— //
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;

    const requestWakeLock = async () => {
      try {
        // 检查浏览器是否支持 Screen Wake Lock API
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
          console.log('Screen Wake Lock is active');

          // 监听页面可见性变化，当页面变为可见时重新请求唤醒锁
          const handleVisibilityChange = () => {
            if (wakeLock !== null && document.visibilityState === 'visible') {
              requestWakeLock();
            }
          };

          document.addEventListener('visibilitychange', handleVisibilityChange);

          // 当唤醒锁释放时记录日志
          wakeLock.addEventListener('release', () => {
            console.log('Screen Wake Lock was released');
          });
        } else {
          console.warn('Screen Wake Lock API is not supported in this browser');
        }
      } catch (err) {
        console.error('Failed to acquire screen wake lock:', err);
      }
    };

    // 请求屏幕常亮
    requestWakeLock();

    // 组件卸载时释放唤醒锁
    return () => {
      if (wakeLock !== null) {
        wakeLock.release();
        wakeLock = null;
      }
    };
  }, []);

  // —— 天象占卜（从 game 对象读取；第3回合起可能有值） —— //
  const omenStone = useGame((s) => {
    const game = s.game as (typeof s.game & { omenStone?: Stone | null }) | null;
    return (game?.omenStone ?? null) as Stone | null;
  });

  // —— 本地动作（仅真正执行本地状态变更；网络层在外层包一层） —— //
  const newGameLocal = useGame(s => s.newGame);
  const discardFlaskLocal = useGame(s => s.discardFlask);
  const pickFlaskLocal = useGame(s => s.pickFlask);
  const castStoneLocal = useGame(s => s.castStone);
  const nextCastLocal = useGame(s => s.nextCast);
  const foolPrankLocal = useGame(s => s.foolPrank);

  // —— 本地 UI 状态 —— //
  const [peekId, setPeekId] = useState<string | null>(null);
  const [woodTarget, setWoodTarget] = useState<string | null>(null);
  const [waterTargets, setWaterTargets] = useState<string[]>([]);
  const [fireTarget, setFireTarget] = useState<string | null>(null);
  const [names, setNames] = useState(['玩家1', '玩家2', '玩家3', '玩家4', '玩家5']);
  const [thresholdSel, setThresholdSel] = useState<number>(endThreshold);
  const [showRules, setShowRules] = useState(false);

  // —— 联机房间状态 —— //
  const [roomCode, setRoomCode] = useState<string | null>(rt.getRoom() ?? null);
  const [isHost, setIsHost] = useState<boolean>(rt.isHost());
  const inRoom = !!roomCode;
  const broadcastSnapshot = useCallback(async (targetSessionId?: string) => {
    if (!inRoom || !rt.isHost()) return;
    try {
      await rt.sendState(exportGameSnapshot(), targetSessionId);
    } catch (err) {
      console.error('广播快照失败', err);
    }
  }, [inRoom]);
  const runAndSync = useCallback(async (fn: () => void) => {
    fn();
    await broadcastSnapshot();
  }, [broadcastSnapshot]);
  const lastRequestedRef = useRef<string | null>(null);
  const [presenceState, setPresenceState] = useState<PresenceState | null>(() => rt.getPresence());

  useEffect(() => {
    // 简单轮询同步 rt 里的房间态（无需再写 subscribeRoom）
    const t = setInterval(() => {
      setRoomCode(rt.getRoom() ?? null);
      setIsHost(rt.isHost());
    }, 300);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const off = rt.subscribePresence((state) => {
      setPresenceState(state);
    });
    return () => off();
  }, []);

  const mySeat = useMemo(() => {
    if (!presenceState) return null;
    const me = presenceState.users.find(u => u.sessionId === getSessionId());
    return me?.seat ?? null;
  }, [presenceState]);
  const myPlayerId = useMemo(() => (mySeat ? `P${mySeat}` : null), [mySeat]);
  const canControlPlayer = useCallback((playerId: string) => !inRoom || isHost || playerId === myPlayerId, [inRoom, isHost, myPlayerId]);
  const isOwnPlayer = useCallback((playerId: string) => !inRoom || playerId === myPlayerId, [inRoom, myPlayerId]);
  const seatAssignments = useMemo(() => {
    if (!presenceState) return Array.from({ length: 5 }, () => null);
    return Array.from({ length: 5 }, (_, idx) => presenceState.users.find(u => u.seat === idx + 1) ?? null);
  }, [presenceState]);

  const myPlayerName = useMemo(() => {
    if (!g || !myPlayerId) return myPlayerId;
    const player = g.players.find(p => p.id === myPlayerId);
    return player?.name ?? myPlayerId;
  }, [g, myPlayerId]);

  useEffect(() => {
    if (!inRoom || !presenceState) return;
    const seatNames = Array.from({ length: 5 }, (_, idx) => {
      const user = presenceState.users.find(u => u.seat === idx + 1);
      return user?.name?.trim().length ? user.name : `座位${idx + 1}`;
    });
    const same = seatNames.length === names.length && seatNames.every((n, i) => n === names[i]);
    if (!same) {
      setNames(seatNames);
    }
  }, [inRoom, presenceState, names]);

  const onlineCount = presenceState?.users.length ?? 0;
  const missingPlayers = Math.max(0, 5 - onlineCount);
  const startDisabled = inRoom ? (!isHost || onlineCount < 5) : false;
  const startBtnClass = startDisabled
    ? 'inline-flex items-center justify-center px-4 py-2 rounded bg-gray-300 text-gray-600 cursor-not-allowed'
    : 'inline-flex items-center justify-center px-4 py-2 rounded bg-black text-white hover:bg-black/90';

  useEffect(() => {
    if (!inRoom || isHost) {
      if (!inRoom || isHost) lastRequestedRef.current = null;
      return;
    }
    const room = presenceState?.roomCode ?? roomCode;
    if (!room) return;
    if (lastRequestedRef.current === room) return;
    lastRequestedRef.current = room;
    rt.requestState();
  }, [inRoom, isHost, roomCode, presenceState?.roomCode]);

  // —— 收到最新快照时统一覆盖本地状态 —— //
  useEffect(() => {
    const off = rt.subscribeState((msg) => {
      if (!msg?.snapshot) return;
      if (msg.target && msg.target !== getSessionId()) return;
      if (msg.from && msg.from === getSessionId()) return;
      applyGameSnapshot(msg.snapshot);
      if (msg.snapshot.game?.players) {
        setNames(msg.snapshot.game.players.map(p => p.name));
      }
      if (typeof msg.snapshot.endThreshold === 'number') {
        setEndThreshold(msg.snapshot.endThreshold);
        setThresholdSel(msg.snapshot.endThreshold);
      }
    });
    return () => off();
  }, [setEndThreshold, setThresholdSel, setNames]);
  // —— 房主：收到 intent 时，代为执行并广播 —— //
  useEffect(() => {
    if (!inRoom || !isHost) return;
    const off = rt.subscribeIntent(async (msg) => {
      if (!rt.isHost()) return;
      if (msg.from && msg.from === getSessionId()) return;

      const payload = asRecord(msg.payload);

      try {
        switch (msg.action) {
          case 'newGame': {
            const incomingNames = payload?.names;
            const incomingThreshold = payload?.threshold;
            const finalNames = isStringArray(incomingNames) ? incomingNames : names;
            const finalThreshold = typeof incomingThreshold === 'number' ? incomingThreshold : thresholdSel;
            const seed = typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
            await runAndSync(() => {
              setNames(finalNames);
              setEndThreshold(finalThreshold);
              setThresholdSel(finalThreshold);
              newGameLocal(finalNames, seed);
            });
            break;
          }
          case 'discard': {
            const no = payload?.no;
            if (typeof no === 'number') {
              await runAndSync(() => discardFlaskLocal(no));
            }
            break;
          }
          case 'pick': {
            const no = payload?.no;
            if (typeof no === 'number') {
              await runAndSync(() => pickFlaskLocal(no));
            }
            break;
          }
          case 'nextCast': {
            await runAndSync(() => nextCastLocal());
            break;
          }
          case 'foolPrank': {
            await runAndSync(() => foolPrankLocal());
            break;
          }
          case 'cast': {
            const playerId = payload?.playerId;
            const stone = payload?.stone;
            const mode = payload?.mode;
            const targetA = payload?.a;
            const targetB = payload?.b;
            if (typeof playerId === 'string' && isStone(stone) && isCastMode(mode)) {
              const targetAId = typeof targetA === 'string' ? targetA : undefined;
              const targetBId = typeof targetB === 'string' ? targetB : undefined;
              await runAndSync(() => castStoneLocal(playerId, stone, mode, targetAId, targetBId));
            }
            break;
          }
        }
      } catch (err) {
        console.error('处理意图时同步失败', err);
      }
    });
    return () => off();
  }, [inRoom, isHost, names, thresholdSel, setNames, setEndThreshold, setThresholdSel, newGameLocal, discardFlaskLocal, pickFlaskLocal, nextCastLocal, foolPrankLocal, castStoneLocal, runAndSync]);

  useEffect(() => {
    if (!inRoom || !isHost) return;
    const off = rt.subscribeStateRequest(async (msg) => {
      if (!rt.isHost()) return;
      try {
        await broadcastSnapshot(msg.from);
      } catch (err) {
        console.error('响应快照请求失败', err);
      }
    });
    return () => off();
  }, [inRoom, isHost, broadcastSnapshot]);

  // —— 包装一层：根据房主/玩家决定是本地执行+广播，还是发意图 —— //
  const doNewGame = useCallback(async () => {
    if (!inRoom) {
      setEndThreshold(thresholdSel);
      newGameLocal(names);
      return;
    }
    if (isHost) {
      const seed = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      await runAndSync(() => {
        setEndThreshold(thresholdSel);
        setThresholdSel(thresholdSel);
        newGameLocal(names, seed);
      });
    } else {
      await rt.sendIntent('newGame', { names, threshold: thresholdSel });
    }
  }, [inRoom, isHost, thresholdSel, names, runAndSync, setEndThreshold, setThresholdSel, newGameLocal]);

  const discardFlask = useCallback(async (no: number) => {
    if (!inRoom) {
      discardFlaskLocal(no);
      return;
    }
    if (isHost) {
      await runAndSync(() => discardFlaskLocal(no));
    } else {
      await rt.sendIntent('discard', { no });
    }
  }, [inRoom, isHost, runAndSync, discardFlaskLocal]);

  const pickFlask = useCallback(async (no: number) => {
    if (!inRoom) {
      pickFlaskLocal(no);
      return;
    }
    if (isHost) {
      await runAndSync(() => pickFlaskLocal(no));
    } else {
      await rt.sendIntent('pick', { no });
    }
  }, [inRoom, isHost, runAndSync, pickFlaskLocal]);

  const nextCast = useCallback(async () => {
    if (!inRoom) {
      nextCastLocal();
      return;
    }
    if (isHost) {
      await runAndSync(() => nextCastLocal());
    } else {
      await rt.sendIntent('nextCast');
    }
  }, [inRoom, isHost, runAndSync, nextCastLocal]);

  const foolPrank = useCallback(async () => {
    if (!inRoom) {
      foolPrankLocal();
      return;
    }
    if (isHost) {
      await runAndSync(() => foolPrankLocal());
    } else {
      await rt.sendIntent('foolPrank');
    }
  }, [inRoom, isHost, runAndSync, foolPrankLocal]);

  const castStone = useCallback(async (playerId: string, stone: Stone, mode: CastMode, a?: string, b?: string) => {
    if (!inRoom) {
      castStoneLocal(playerId, stone, mode, a, b);
      return;
    }
    if (isHost) {
      await runAndSync(() => castStoneLocal(playerId, stone, mode, a, b));
    } else {
      await rt.sendIntent('cast', { playerId, stone, mode, a, b });
    }
  }, [inRoom, isHost, runAndSync, castStoneLocal]);

  // —— 日志自动滚动 —— //
  const logRef = useRef<HTMLDivElement | null>(null);
  const finalLogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [g?.logs.length]);
  useEffect(() => {
    if (finalLogRef.current) finalLogRef.current.scrollTop = finalLogRef.current.scrollHeight;
  }, [isOver, g?.logs.length]);

  // —— 选瓶后自动弹出“私密查看” —— //
  const lastPickCountRef = useRef(0);
  useEffect(() => {
    if (!g) return;
    const cur = g.picks.length;
    if (cur > lastPickCountRef.current) {
      const lastPick = g.picks[cur - 1];
      if (lastPick) {
        if (!inRoom) {
          setPeekId(lastPick.playerId);
        } else if (myPlayerId && lastPick.playerId === myPlayerId) {
          setPeekId(lastPick.playerId);
        }
      }
    }
    lastPickCountRef.current = cur;
  }, [g, inRoom, myPlayerId]);

  // —— 规则弹窗 —— //
  const RulesModal = () => (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={() => setShowRules(false)}
    >
      <div
        className="bg-white rounded-xl p-5 w-[90%] max-w-sm max-h-[80vh] overflow-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-lg font-bold mb-2">获取游戏规则</div>
        <p className="text-sm text-gray-700">
          关注 <b>「JokerGame愚人博弈」</b> 微信服务号，进入后台，文字回复 <b>愚者之石</b> 即可获得游戏规则。
        </p>
        <img
          src="/wechat-qrcode.jpg"
          alt="JokerGame愚人博弈 微信服务号二维码"
          className="w-40 h-40 mx-auto my-3 rounded"
        />
        <button
          className="w-full px-3 py-2 rounded border mt-2"
          onClick={() => setShowRules(false)}
        >
          我知道了
        </button>
      </div>
    </div>
  );

  // =========================
  //  终局画面
  // =========================
  if (isOver && g) {
    return (
      <div className="min-h-screen p-6 max-w-xl mx-auto space-y-4 bg-white">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">愚者之石 · 终局结算</h1>
          <button
            className="text-sm px-3 py-1 rounded border hover:bg-gray-50"
            onClick={() => setShowRules(true)}
          >
            获取规则
          </button>
        </div>
        <div className="text-sm text-gray-600">阈值：明分 ≥ {endThreshold}</div>

        <div className="p-3 border rounded space-y-4">
          <div>
            <div className="font-medium mb-2">复盘：最终烧瓶 → 炼金石</div>
            {flaskMap ? (
              <div className="grid grid-cols-7 gap-2 text-center">
                {Array.from({ length: 7 }, (_, i) => i + 1).map(n => (
                  <div key={n} className="border rounded p-2">
                    <div className="text-xs text-gray-500 flex items-center justify-center gap-1 leading-none">
                      <span>烧瓶</span>
                      <span className="tabular-nums">{n}</span>
                    </div>
                    <div className="text-lg font-bold">{flaskMap[n] ?? '-'}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-500">（无数据）</div>
            )}
          </div>

          <div>
            <div className="font-medium mb-2">身份与最终持有（最终回合分数变化）</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-1">玩家</th>
                  <th className="py-1">身份</th>
                  <th className="py-1">最终持有</th>
                  <th className="py-1">明分变化</th>
                  <th className="py-1">暗分变化</th>
                </tr>
              </thead>
              <tbody>
                {g.players.map(p => {
                  const role = p.isFool ? '愚者' : '贤者';
                  const stone = g.hands[p.id] ?? '—';
                  const cur = g.scores[p.id];
                  const base = roundStartScores?.[p.id] ?? { pub: 0, sec: 0 };
                  const dPub = cur.pub - base.pub;
                  const dSec = cur.sec - base.sec;
                  const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
                  return (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-1">{p.name}</td>
                      <td className="py-1">{role}</td>
                      <td className="py-1">{stone}</td>
                      <td className="py-1">{fmt(dPub)}</td>
                      <td className="py-1">{fmt(dSec)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {finalRanks.length > 0 && (
          <div className="p-3 border rounded">
            <div className="font-medium mb-2">最终排名</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-1">名次</th>
                  <th className="py-1">玩家</th>
                  <th className="py-1">明分</th>
                  <th className="py-1">暗分</th>
                  <th className="py-1">总分</th>
                  <th className="py-1">奖励</th>
                </tr>
              </thead>
              <tbody>
                {finalRanks.map((row) => (
                  <tr key={row.playerId} className="border-b last:border-0">
                    <td className="py-1">{row.place}</td>
                    <td className="py-1">{row.name}</td>
                    <td className="py-1">{row.pub}</td>
                    <td className="py-1">{row.sec}</td>
                    <td className="py-1 font-medium">{row.total}</td>
                    <td className="py-1">{row.reward}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button
          className="inline-flex items-center justify-center px-4 py-2 rounded bg-black text-white hover:bg-black/90"
          onClick={doNewGame}
        >
          再来一局（沿用当前玩家）
        </button>

        <div className="p-3 border rounded">
          <div className="font-medium mb-1">公开日志</div>
          <div ref={finalLogRef} className="max-h-72 overflow-auto px-2">
            <ol className="list-decimal list-inside space-y-1">
              {g.logs.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
          </div>
        </div>
        {showRules && <RulesModal />}
      </div>
    );
  }

  // =========================
  //  建局画面
  // =========================
  if (!g) {
    return (
      <div className="min-h-screen p-6 max-w-xl mx-auto space-y-4 bg-gray-50">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">愚者之石 · MVP</h1>
          <button
            className="text-sm px-3 py-1 rounded border hover:bg-gray-50"
            onClick={() => setShowRules(true)}
          >
            获取规则
          </button>
        </div>

        {/* 联机状态条 */}
        {roomCode && (
          <div className="p-2 rounded border bg-white text-sm">
            联机：房间 <b>{roomCode}</b>（{isHost ? '房主' : '玩家'}）
          </div>
        )}

        <p className="text-sm text-gray-600">先输入 5 位玩家名，选择终局阈值，然后开始对局。</p>

        <div className="grid grid-cols-5 gap-2">
          {names.map((n, i) => (
            <input
              key={i}
              className="border rounded p-2"
              value={n}
              onChange={e => setNames(v => v.map((x, ix) => (ix === i ? e.target.value : x)))}
              disabled={inRoom && !isHost}
            />
          ))}
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-700">终局阈值（明分 ≥ ）</label>
          <select
            className="border rounded px-2 py-1"
            value={thresholdSel}
            onChange={e => setThresholdSel(parseInt(e.target.value, 10))}
          >
            {[5, 6, 7, 8, 9, 10, 11, 12].map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        <button
          className={startBtnClass}
          disabled={startDisabled}
          onClick={doNewGame}
        >
          开始对局
        </button>

        {inRoom && isHost && onlineCount < 5 && (
          <div className="text-xs text-red-600">当前仅 {onlineCount}/5 位玩家在线，请等待所有玩家入局后再开始。</div>
        )}

        {inRoom && isHost && onlineCount >= 5 && (
          <div className="text-xs text-green-600">房间人数已满，可以开始对局。</div>
        )}

        {/* —— 联机面板（实验性） —— */}
        <div className="p-3 border rounded bg-white">
          <OnlinePanel />
        </div>

        {showRules && <RulesModal />}
      </div>
    );
  }

  // =========================
  //  对局中：公共信息
  // =========================
  const pickerIndex = g.picks.length;
  const currentPickerId = g.order[pickerIndex];
  const currentPickerName = g.players.find(p => p.id === currentPickerId)?.name ?? currentPickerId;
  const availableFlasks = Object.keys(g.flasks).map(n => Number(n)).sort((a, b) => a - b);
  const firstPickerId = g.order[0];
  const canDiscardNow = !inRoom || canControlPlayer(firstPickerId);
  const canPickNow = !inRoom || canControlPlayer(currentPickerId);

  const currentIndex = Math.min(g.castIdx, CAST_ORDER.length - 1);
  const currentStone = CAST_ORDER[currentIndex];

  const orderedPlayers = g.order.map((pid, idx) => {
    const p = g.players.find(x => x.id === pid)!;
    return { rank: idx + 1, player: p, seat: Number(p.id.replace('P', '')) };
  });

  const phaseLabel = g.phase === 'select' ? '炼金' : '施法';
  const phaseIsSelect = g.phase === 'select';

  return (
    <div className="min-h-screen p-6 max-w-xl mx-auto space-y-4 bg-white">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">愚者之石 · MVP</h1>
        <button
          className="text-sm px-3 py-1 rounded border hover:bg-gray-50"
          onClick={() => setShowRules(true)}
        >
          获取规则
        </button>
      </div>

      {/* 顶部信息：阈值/回合阶段 + 天象占卜 */}
      <div className="p-3 border rounded space-y-2">
        {roomCode && (
          <div className="text-xs text-gray-600">
            房间 <b>{roomCode}</b>（{isHost ? '房主' : '玩家'}）
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">终局阈值：明分 ≥ {endThreshold}</span>
          <span>
            回合：<b>{g.round}</b> 阶段：<b>{phaseLabel}</b>
          </span>
        </div>

        {g.round >= 3 && omenStone && (
          <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
            天象占卜：本回合【<b>{omenStone}</b>】效果增强（仅当回合有效）
          </div>
        )}
      </div>

      {presenceState && (
        <div className="p-3 border rounded space-y-2">
          <div className="font-medium text-sm">在线玩家（{onlineCount}/5）</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {seatAssignments.map((u, idx) => {
              const seatNo = idx + 1;
              const tags: string[] = [];
              if (u?.isHost) tags.push('房主');
              if (u && u.sessionId === getSessionId()) tags.push('我');
              return (
                <div key={seatNo} className="px-2 py-1 border rounded bg-white flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-xs text-gray-500">座位 {seatNo}</span>
                    <span className="truncate max-w-[8rem]">{u ? (u.name || '（未命名）') : '（空位）'}</span>
                  </div>
                  {tags.length > 0 && (
                    <span className="text-xs text-gray-500">{tags.join(' · ')}</span>
                  )}
                </div>
              );
            })}
          </div>
          {inRoom && mySeat && (
            <div className="text-xs text-gray-600">你的座位：<b>{mySeat}</b>（玩家 {myPlayerName ?? '—'}）</div>
          )}
          {isHost && onlineCount < 5 && (
            <div className="text-xs text-red-600">还有 {missingPlayers} 位玩家未入局，建议等待再继续。</div>
          )}
        </div>
      )}

      {/* 玩家回合顺位及明分 */}
      <div className="p-3 border rounded space-y-2">
        <div className="font-medium">玩家回合顺位及明分</div>
        <ul className="grid grid-cols-2 gap-2">
          {orderedPlayers.map(({ rank, player, seat }) => {
            const s = g.scores[player.id];
            const canOpen = !inRoom || (myPlayerId !== null && player.id === myPlayerId);
            const itemClass = canOpen
              ? "flex items-center justify-between border rounded px-2 py-1 cursor-pointer hover:bg-gray-50"
              : "flex items-center justify-between border rounded px-2 py-1 bg-gray-100 text-gray-500 cursor-not-allowed";
            return (
              <li
                key={player.id}
                className={itemClass}
                title={`顺位 ${rank}`}
                onClick={() => {
                  if (!canOpen) return;
                  setPeekId(player.id);
                  setWoodTarget(null);
                  setWaterTargets([]);
                  setFireTarget(null);
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-900 text-white text-xs shrink-0">{rank}</span>
                  <div className="flex flex-col min-w-0">
                    <span className="truncate">{player.name}</span>
                    <span className="text-[10px] text-gray-500">座位 {seat}</span>
                  </div>
                </div>
                <span className="ml-2 shrink-0">明 {s.pub}</span>
              </li>
            );
          })}
        </ul>
        <div className="text-sm text-gray-600">
          {phaseIsSelect
            ? '点击自己的名字查看个人信息。'
            : '点击自己的名字查看个人信息，若轮到你持有的炼金石，可发动技能，否则关闭弹窗。'}
        </div>
      </div>

      {/* 选瓶阶段 */}
      {g.phase === 'select' && (
        <div className="p-3 border rounded space-y-2">
          {g.discarded.length === 0 ? (
            <div>
              <div className="font-medium mb-2">
                请 <b>{g.players.find(p => p.id === g.order[0])?.name ?? '1号'}</b> 先弃 1 个烧瓶：
              </div>
              <div className="flex flex-wrap gap-2">
                {availableFlasks.map(no => (
                  <button
                    key={no}
                    type="button"
                    className={`flask-card ${canDiscardNow ? 'flask-card--active' : 'flask-card--disabled'}`}
                    disabled={!canDiscardNow}
                    onClick={() => { if (canDiscardNow) discardFlask(no); }}
                  >
                    <img src={flaskImageSrc(no)} alt={`烧瓶 ${no}`} loading="lazy" />
                    <span className="flask-card__label">{no}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="font-medium mb-2">轮到 <b>{currentPickerName}</b> 选烧瓶：</div>
              <div className="flex flex-wrap gap-2">
                {availableFlasks.map(no => (
                  <button
                    key={no}
                    type="button"
                    className={`flask-card ${canPickNow ? 'flask-card--active' : 'flask-card--disabled'}`}
                    disabled={!canPickNow}
                    onClick={() => { if (canPickNow) pickFlask(no); }}
                  >
                    <img src={flaskImageSrc(no)} alt={`烧瓶 ${no}`} loading="lazy" />
                    <span className="flask-card__label">{no}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 施法阶段：顺序第一行；当前+按钮第二行 */}
      {g.phase === 'cast' && (
        <div className="p-3 border rounded space-y-2">
          <div className="font-medium text-sm sm:text-base tracking-tight leading-tight">
            施法顺序：
            {CAST_ORDER.map((st, idx) => (
              <span key={st} className={idx === g.castIdx ? 'px-1 font-bold text-blue-600' : 'px-1'}>
                {st}{idx < CAST_ORDER.length - 1 ? '→' : ''}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">（当前：{currentStone}）</span>
            <button
              className={`px-3 py-2 border rounded ${isHost ? '' : 'cursor-not-allowed text-gray-400 bg-gray-100'}`}
              disabled={!isHost}
              onClick={() => { if (isHost) nextCast(); }}
            >
              跳过当前
            </button>
          </div>
        </div>
      )}

      {/* —— 私密查看对话框 —— */}
      {peekId && (() => {
        const player = g.players.find(p => p.id === peekId)!;
        const stone = g.hands[peekId] as Stone | undefined;
        const canCast = !phaseIsSelect && stone === currentStone && g.castIdx < CAST_ORDER.length;

        const isWood = canCast && stone === '木';
        const isWater = canCast && stone === '水';
        const isFire = canCast && stone === '火';
        const isEarth = canCast && stone === '土';
        const isSage = canCast && stone === '贤';
        const isFool = canCast && stone === '愚';

        const role = player.isFool ? '愚者' : '贤者';

        const locate = (map?: Record<number, string | undefined>) => {
          if (!map) return { sage: '-', fool: '-' };
          const entries = Object.entries(map);
          const s = entries.find(([, v]) => v === '贤')?.[0] ?? '-';
          const f = entries.find(([, v]) => v === '愚')?.[0] ?? '-';
          return { sage: s, fool: f };
        };
        const nowInfo = locate(flaskMap ?? undefined);
        const nextInfo = locate(nextFlaskMap ?? undefined);

        const myScore = g.scores[player.id];
        const myTotal = myScore.pub + myScore.sec;
        const canControlThis = isOwnPlayer(player.id);

        if (inRoom && !canControlThis) {
          return (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setPeekId(null)}>
              <div className="bg-white rounded-xl p-5 w-[90%] max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="text-lg font-bold mb-3">私密查看</div>
                <p className="text-sm text-gray-600 mb-4">这是 {player.name} 的私人信息，你无法查看或操作。</p>
                <button className="w-full px-3 py-2 rounded border" onClick={() => setPeekId(null)}>关闭</button>
              </div>
            </div>
          );
        }

        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setPeekId(null)}>
            <div className="bg-white rounded-xl p-5 w-[90%] max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="text-lg font-bold mb-2">私密查看</div>

              <div className="text-center my-6 space-y-1">
                <div className="text-4xl font-extrabold tracking-widest">{stone ?? '（尚未拿到）'}</div>
                <div className="text-gray-500">{player.name} 当前持有炼金石</div>
                <div className="text-xs text-gray-600">你的身份：<b>{role}</b></div>
                <div className="text-xs text-gray-600">你的分数：总 <b>{myTotal}</b>（明 <b>{myScore.pub}</b> / 暗 <b>{myScore.sec}</b>）</div>
              </div>

              {/* 愚者情报 */}
              {player.isFool && (
                <div className="mb-4 p-3 border rounded bg-yellow-50">
                  <div className="font-medium mb-1">愚者情报</div>
                  <div className="text-xs text-gray-700">
                    当前<b>烧瓶与炼金石的对应关系</b>：贤＠烧瓶 <b>{nowInfo.sage}</b>，愚＠烧瓶 <b>{nowInfo.fool}</b>
                  </div>
                  {nextFlaskMap ? (
                    <div className="text-xs text-gray-700 mt-1">
                      下回合（已捉弄后）<b>烧瓶与炼金石的对应关系</b>：贤＠烧瓶 <b>{nextInfo.sage}</b>，愚＠烧瓶 <b>{nextInfo.fool}</b>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 mt-1">下回合：未捉弄（默认沿用当前<b>对应关系</b>）</div>
                  )}
                  <button
                    className="mt-2 w-full px-3 py-2 rounded border disabled:opacity-50"
                    onClick={() => foolPrank()}
                    disabled={!canControlThis || foolPrankUsed || phaseIsSelect}
                    title={
                      phaseIsSelect
                        ? '炼金阶段不可使用愚者捉弄'
                        : (!canControlThis ? '你无法操作其他玩家的技能' : (foolPrankUsed ? '本局已使用过愚者捉弄' : '立刻随机打乱下回合的烧瓶与炼金石对应关系（整局仅限一次）'))
                    }
                  >
                    {foolPrankUsed ? '愚者捉弄（本局已使用）' : (phaseIsSelect ? '愚者捉弄（炼金阶段不可用）' : '愚者捉弄（打乱下回合对应关系）')}
                  </button>
                </div>
              )}

              {/* 炼金阶段：只渲染一个“我看完了”；施法阶段才渲染技能按钮 */}
              {phaseIsSelect ? (
                <button className="w-full px-3 py-2 rounded border" onClick={() => setPeekId(null)}>
                  我看完了
                </button>
              ) : (
                <>
                  {/* 木 */}
                  {isWood && (
                    <>
                      <div className="text-sm font-medium mb-2">选择一名玩家进行交换</div>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {g.players.filter(x => x.id !== player.id).map(o => (
                          <button
                            key={o.id}
                            className={`px-3 py-2 border rounded ${woodTarget === o.id ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'}`}
                            onClick={() => setWoodTarget(o.id)}
                          >
                            {o.name}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="flex-1 px-3 py-2 rounded bg-black text-white disabled:opacity-40"
                          disabled={!woodTarget}
                          onClick={() => { castStone(player.id, '木', 'show', woodTarget!); setPeekId(null); setWoodTarget(null); }}
                        >
                          发动（展示）
                        </button>
                        <button className="px-3 py-2 rounded border" onClick={() => setPeekId(null)}>我看完了</button>
                      </div>
                    </>
                  )}

                  {/* 水 */}
                  {isWater && (
                    <>
                      <div className="text-sm font-medium mb-2">选择两名玩家进行对调</div>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {g.players.filter(x => x.id !== player.id).map(o => (
                          <button
                            key={o.id}
                            className={`px-3 py-2 border rounded ${waterTargets.includes(o.id) ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'}`}
                            onClick={() => {
                              setWaterTargets(prev => {
                                if (prev.includes(o.id)) return prev.filter(x => x !== o.id);
                                if (prev.length >= 2) return prev;
                                return [...prev, o.id];
                              });
                            }}
                          >
                            {o.name}
                          </button>
                        ))}
                      </div>
                      <div className="text-xs text-gray-500 mb-2">已选：{waterTargets.length} / 2</div>
                      <div className="flex gap-2">
                        <button
                          className="flex-1 px-3 py-2 rounded bg-black text-white disabled:opacity-40"
                          disabled={waterTargets.length !== 2}
                          onClick={() => { castStone(player.id, '水', 'show', waterTargets[0], waterTargets[1]); setPeekId(null); setWaterTargets([]); }}
                        >
                          发动（展示）
                        </button>
                        <button className="px-3 py-2 rounded border" onClick={() => setPeekId(null)}>我看完了</button>
                      </div>
                    </>
                  )}

                  {/* 火 */}
                  {isFire && (
                    <>
                      <div className="text-sm font-medium mb-2">选择一名玩家进行灼烧</div>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {g.players.filter(x => x.id !== player.id).map(o => (
                          <button
                            key={o.id}
                            className={`px-3 py-2 border rounded ${fireTarget === o.id ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'}`}
                            onClick={() => setFireTarget(o.id)}
                          >
                            {o.name}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="flex-1 px-3 py-2 rounded bg-black text-white disabled:opacity-40"
                          disabled={!fireTarget}
                          onClick={() => { castStone(player.id, '火', 'show', fireTarget!); setPeekId(null); setFireTarget(null); }}
                        >
                          发动（展示）
                        </button>
                        <button className="px-3 py-2 rounded border" onClick={() => setPeekId(null)}>我看完了</button>
                      </div>
                    </>
                  )}

                  {/* 土 */}
                  {isEarth && (
                    <div className="space-y-2">
                      <div className="text-sm text-gray-600">只有本回合「土」的初始持有者可发动（+3 明分）。</div>
                      <div className="flex gap-2">
                        <button
                          className="flex-1 px-3 py-2 rounded bg-black text-white disabled:opacity-40"
                          disabled={g.initialHolder['土'] !== player.id}
                          title={g.initialHolder['土'] === player.id ? '' : '你不是本回合「土」的初始持有者'}
                          onClick={() => { castStone(player.id, '土', 'show'); setPeekId(null); }}
                        >
                          发动（展示）
                        </button>
                        <button className="px-3 py-2 rounded border" onClick={() => setPeekId(null)}>我看完了</button>
                      </div>
                    </div>
                  )}

                  {/* 贤 / 愚：不可展示 */}
                  {(isSage || isFool) && (
                    <div className="space-y-3">
                      <div className="text-sm text-gray-600">【{isSage ? '贤' : '愚'}】不可展示。请关闭弹窗，如需推进流程由主持人点击外部「跳过当前」。</div>
                      <button className="w-full px-3 py-2 rounded border" onClick={() => setPeekId(null)}>我看完了</button>
                    </div>
                  )}

                  {/* 金：普通展示 */}
                  {!isWood && !isWater && !isFire && !isEarth && !isSage && !isFool && canCast && (
                    <div className="flex gap-2">
                      <button className="flex-1 px-3 py-2 rounded bg-black text-white" onClick={() => { castStone(player.id, stone!, 'show'); setPeekId(null); }}>
                        发动（展示）
                      </button>
                      <button className="px-3 py-2 rounded border" onClick={() => setPeekId(null)}>我看完了</button>
                    </div>
                  )}

                  {!canCast && (
                    <button className="w-full px-3 py-2 rounded border" onClick={() => setPeekId(null)}>
                      我看完了
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* 公开日志 */}
      <div className="p-3 border rounded">
        <div className="font-medium mb-1">公开日志</div>
        <div ref={logRef} className="max-h-72 overflow-auto px-2">
          <ol className="list-decimal list-inside space-y-1">
            {g.logs.map((l, i) => (<li key={i}>{l}</li>))}
          </ol>
        </div>
      </div>

      {showRules && <RulesModal />}
    </div>
  );
}

export default function App() {
  if (typeof window !== 'undefined' && window.location.search.includes('flower')) {
    // URL 带 ?flower 就进入花蝴蝶调试页面
    return <FlowerRoom />;
  }
  // 默认走原来的愚者之石页面
  return <MainApp />;
}