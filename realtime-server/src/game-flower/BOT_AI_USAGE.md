# Bot AI 使用说明

## 概述

`bot-logic-ai.ts` 使用 Google Gemini API 来生成机器人的发言，替代原有的模板系统。

## 环境变量配置

在使用 AI 版本之前，需要设置环境变量：

```bash
export GEMINI_API_KEY=your_api_key_here
```

或者在 `.env` 文件中：
```
GEMINI_API_KEY=your_api_key_here
```

## 如何在 scheduler.ts 中使用

由于 AI 版本的函数是异步的（返回 `Promise<string>`），而原有的 `bot-logic.ts` 是同步的，需要在 `scheduler.ts` 中修改调用方式。

### 修改 scheduler.ts 导入

将：
```typescript
import {
    getBotNightActionTarget,
    getBotVoteTarget,
    generateBotSpeech,
    generateBotLastWords
} from "./bot-logic.js";
```

改为：
```typescript
import {
    getBotNightActionTarget,
    getBotVoteTarget
} from "./bot-logic.js";
import {
    generateBotSpeech,
    generateBotLastWords
} from "./bot-logic-ai.js";
```

### 修改发言生成部分（第121行附近）

将：
```typescript
// Generate speech
const speech = generateBotSpeech(currentSnap, currentSpeakerSeat);
```

改为：
```typescript
// Generate speech (async)
const speech = await generateBotSpeech(currentSnap, currentSpeakerSeat);
```

并且需要将整个 `setTimeout` 回调改为 `async`：
```typescript
const t = setTimeout(async () => {
    // ... existing code ...
    
    // Generate speech
    const speech = await generateBotSpeech(currentSnap, currentSpeakerSeat);
    
    // ... rest of the code ...
}, delay);
```

### 修改遗言生成部分（第182行附近）

同样将：
```typescript
// Generate speech
const speech = generateBotLastWords(currentSnap, currentSpeakerSeat);
```

改为：
```typescript
// Generate speech (async)
const speech = await generateBotLastWords(currentSnap, currentSpeakerSeat);
```

并将 `setTimeout` 回调改为 `async`。

## 功能说明

### generateBotSpeech

生成机器人的日常发言，会根据以下信息生成：
- 机器人的真实身份和声称身份
- 游戏当前状态（阶段、天数、存活人数等）
- 昨晚的死亡情况
- 对其他玩家的怀疑度评估
- 已知的身份信息（如警察查验结果）
- 行动历史
- 最近的聊天记录
- 当前投票情况

### generateBotLastWords

生成机器人的遗言，在玩家被投票出局后使用。

## 回退机制

如果 AI API 未配置或调用失败，函数会自动回退到简单的默认消息：
- `generateBotSpeech`: "我是好人，过。"
- `generateBotLastWords`: "我是好人，大家加油。"

## 注意事项

1. AI 调用是异步的，需要确保在异步上下文中调用
2. API 调用可能需要一些时间，建议增加延迟时间
3. 确保设置了正确的 `GEMINI_API_KEY` 环境变量
4. 如果 API 调用失败，会自动使用回退消息，不会中断游戏流程

