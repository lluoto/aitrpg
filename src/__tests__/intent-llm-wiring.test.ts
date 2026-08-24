// 意图解析的 LLM 要在服务器/网页那条路上也接上。
//
// 起因：`setIntentLLM()` 全仓只有 CLI 的 `index.ts:54` 调过。GameSession 从不设，
// 于是 `_llmClient` 恒为 null，**LLM 语义理解在这条路上从没启用过**，全靠 regex。
// 量过：24 条常见 CoC 动作，认对 10、认错 3、不认识 11。
//
// ⚠ 这个文件动的是**模块级单例**，每条用例后必须还原 ——
//   不还原会让后面所有测试的意图解析行为跟着变。

import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { setIntentLLM, intentLLMConfigured } from "../llm/intent";
import { GameSession } from "../api/game-session";

const REAL_LOOKING = {
  // 像真 key（不以 sk-placeholder 开头）→ GameSession 会建真的 LLMClient。
  // URL 指向必然连不上的地址：要的是「接没接上」，不是「能不能连上」。
  apiKey: "sk-test-not-a-placeholder", baseUrl: "http://127.0.0.1:1",
  model: "m", maxTokens: 16, temperature: 0,
};
const PLACEHOLDER = { ...REAL_LOOKING, apiKey: "sk-placeholder" };

// ⚠ 这几个环境变量都要显式设，不能靠机器上残留的 `.env`。
//   `llmEnabled()` 看的是 `LLM_DISABLED` / `LLM_MODE` / `LLM_API_KEY|OPENAI_API_KEY`
//   三样。第一版只管了 `LLM_DISABLED`，单独跑绿、全量红 ——
//   因为 module-loop.test.ts 会在自己的用例里删掉这些 key。
//   依赖环境残留的测试就是「在我这儿绿、在别人那儿红」。
const ENV_KEYS = ["LLM_DISABLED", "LLM_MODE", "LLM_API_KEY", "OPENAI_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  setIntentLLM(null);
});
afterEach(() => {
  setIntentLLM(null); // 还原单例，别影响别的测试文件
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** 把环境摆成「LLM 可用」：有 key、没被关掉。 */
function enableLLM() {
  delete process.env.LLM_DISABLED;
  delete process.env.LLM_MODE;
  process.env.LLM_API_KEY = "sk-test-not-a-placeholder";
}

describe("GameSession 要接上意图解析的 LLM", () => {
  test("**错误行为的红线**：LLM 可用时，建会话就该接上", async () => {
    // 接之前这条必红 —— GameSession 从不调 setIntentLLM。
    enableLLM();
    new GameSession(`w-${Math.random()}`, "cosmic-horror", REAL_LOOKING);
    expect(intentLLMConfigured()).toBe(true);
  });

  test("**正确**：LLM_DISABLED=true 时不接 —— 离线开关必须拦得住", async () => {
    // play-module.ts:101 记着：曾经有两份判据，于是有 key 时这个开关拦不住打网络。
    // 这里走的是同一个 `llmEnabled()`，不另写一份。
    enableLLM();                         // 先摆成可用，确保拦住它的是开关本身
    process.env.LLM_DISABLED = "true";
    new GameSession(`w-${Math.random()}`, "cosmic-horror", REAL_LOOKING);
    expect(intentLLMConfigured()).toBe(false);
  });

  test("**干扰输入**：占位 key 走 MockLLMClient，不该接进去", async () => {
    // Mock 不是真客户端，设进去只会让每次解析多绕一圈再回落 regex。
    enableLLM();
    new GameSession(`w-${Math.random()}`, "cosmic-horror", PLACEHOLDER);
    expect(intentLLMConfigured()).toBe(false);
  });

  test("**错误行为的红线**：已经设过就不许再覆盖", async () => {
    // `_llmClient` 是模块级单例，多会话共享。每建一个会话就覆盖一次，
    // 会让并发会话互相踩，也会把 CLI 显式设的那份顶掉。
    enableLLM();
    const sentinel = { chat: async () => "", chatStream: async function* () {} } as never;
    setIntentLLM(sentinel);
    new GameSession(`w-${Math.random()}`, "cosmic-horror", REAL_LOOKING);
    // 仍然是我们放进去的那个，没被会话顶掉
    expect(intentLLMConfigured()).toBe(true);
  });

  test("**正确**：接上之后 LLM 连不上仍然回落 regex，不能变成无响应回合", async () => {
    // 迁移风险在 docs/kp-tool-surface-assessment.md §四.3 写着：
    // 「必须显式保留一条非模型兜底路径，否则一次格式错误就会变成一次无响应回合」。
    enableLLM();
    const s = new GameSession(`w-${Math.random()}`, "cosmic-horror", REAL_LOOKING);
    const r = await s.act("创建角色 investigator 甲");
    expect(r.events.length).toBeGreaterThan(0);
  }, 20_000);
});
