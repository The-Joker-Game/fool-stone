import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import ts from "typescript";

// Lightweight TS loader to import the engine without a full build
async function importEngine() {
  const srcPath = path.resolve("realtime-server/src/game-flower/engine.ts");
  let code = fs.readFileSync(srcPath, "utf8");
  // Stub out updateBotGuesses to avoid extra deps at runtime
  code = code.replace('import { updateBotGuesses } from "./bot-state.js";', "const updateBotGuesses = () => {};");

  const output = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
    },
  });

  const dataUrl = `data:text/javascript;base64,${Buffer.from(output.outputText).toString("base64")}`;
  return import(dataUrl);
}

const { passTurn, updateSpeakerStatus } = await importEngine();

function makePlayer(seat) {
  return {
    seat,
    sessionId: `s${seat}`,
    name: `P${seat}`,
    role: null,
    originalRole: null,
    isAlive: true,
    isReady: true,
    isHost: false,
    isBot: false,
    isMutedToday: false,
    hasVotedToday: false,
    voteTargetSeat: null,
    darkVoteTargetSeat: null,
    nightAction: null,
    needleCount: 0,
    totalNeedleCount: 0,
    pendingNeedleDeath: false,
    flags: {},
  };
}

function baseSnapshot() {
  const now = Date.now();
  return {
    engine: "flower",
    roomCode: "9999",
    hostSessionId: null,
    phase: "day_discussion",
    dayCount: 1,
    players: [makePlayer(1), makePlayer(2), makePlayer(3)],
    night: { submittedActions: [], lastActions: [], result: null },
    day: {
      speechOrder: [1, 2],
      currentSpeakerIndex: 0,
      voteOrder: [],
      votes: [],
      tally: {},
      pendingExecution: null,
      lastWords: null,
      speakerStatus: { seat: 1, state: "awaiting" },
    },
    history: [],
    logs: [],
    chatMessages: [],
    updatedAt: now,
    deadline: now + 30_000,
  };
}

test("speaker confirmation sets typing state and logs", () => {
  const snap = baseSnapshot();
  const res = updateSpeakerStatus(snap, 1, "typing");
  assert.ok(res.ok);
  assert.equal(snap.day.speakerStatus?.seat, 1);
  assert.equal(snap.day.speakerStatus?.state, "typing");
  assert.ok(snap.logs.some((l) => l.text.includes("开始发言")));
});

test("speaker confirmation rejects wrong seat", () => {
  const snap = baseSnapshot();
  const res = updateSpeakerStatus(snap, 2, "typing");
  assert.equal(res.ok, false);
});

test("passTurn advances speaker and resets to awaiting", () => {
  const snap = baseSnapshot();
  snap.day.speakerStatus = { seat: 1, state: "typing" };
  const res = passTurn(snap);
  assert.ok(res.ok);
  assert.equal(snap.day.currentSpeakerIndex, 1);
  assert.deepEqual(snap.day.speakerStatus, { seat: 2, state: "awaiting" });
});

test("passTurn after last speaker enters vote and clears speakerStatus", () => {
  const snap = baseSnapshot();
  snap.day.currentSpeakerIndex = 1;
  snap.day.speakerStatus = { seat: 2, state: "typing" };
  const res = passTurn(snap);
  assert.ok(res.ok);
  assert.equal(snap.phase, "day_vote");
  assert.equal(snap.day.speakerStatus, null);
});
