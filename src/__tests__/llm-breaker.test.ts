// 熔断要能自愈。
//
// 起因是读一局的诊断日志：整局只有两行，第二行是「LLM 已熔断（之前连接失败）」。
// 追进去发现熔断标志是 **static 且永不恢复** 的：没有冷却、没有半开，
// `resetDefeat()` 只有两个诊断脚本在调，生产代码一次都没调过。
//
// `server.ts` 是长期进程 —— 一次网络抖动就让整个进程往后所有会话退回模板，
// 而且是跨会话的：一个人连不上，把所有人的 LLM 一起带走。

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { LLMClient } from "../llm/client";

const CFG = {
  // 指向一个必然连不上的地址：要的就是「连接失败」而不是超时。
  apiKey: "sk-x", baseUrl: "http://127.0.0.1:1", model: "m",
  maxTokens: 16, temperature: 0,
};

const client = () => new LLMClient(CFG);
const MSG = [{ role: "user" as const, content: "hi" }];

/**
 * 返回「这一次是真去连了，还是被熔断挡下了」。
 *
 * ⚠ 不能用 `toContain("连接失败")` 区分这两件事：熔断的报错原文是
 *   **「LLM 已熔断（之前连接失败）」——它本身就含「连接失败」**。
 *   第一版测试正是这么写的，六条全绿，而把熔断改成永不恢复的变异
 *   **一条都没红** —— 断言等于没写。
 */
async function attempt(): Promise<"短路" | "真去连了" | "没抛"> {
  try { await client().chat(MSG); } catch (e) {
    return /已熔断/.test((e as Error).message) ? "短路" : "真去连了";
  }
  return "没抛";
}

describe("LLM 熔断", () => {
  beforeEach(() => { LLMClient.resetDefeat(); });
  afterEach(() => {
    LLMClient.resetDefeat();
    delete process.env.LLM_BREAKER_COOLDOWN_MS;
  });

  test("**正确**：连接失败会跳闸，后续调用立刻短路", async () => {
    process.env.LLM_BREAKER_COOLDOWN_MS = "30000";
    expect(await attempt()).toBe("真去连了");
    expect(await attempt()).toBe("短路");
  });

  test("**错误行为的红线**：冷却到点后必须自愈，不能永久熔断", async () => {
    // 改之前 `_defeated = true` 永不复位，这条会一直是「短路」。
    process.env.LLM_BREAKER_COOLDOWN_MS = "0";
    expect(await attempt()).toBe("真去连了"); // 跳闸
    expect(await attempt()).toBe("真去连了"); // 冷却已过 → 半开放行
  });

  test("**正确**：半开时再失败要重新跳闸，而不是从此一直放行", async () => {
    process.env.LLM_BREAKER_COOLDOWN_MS = "0";
    expect(await attempt()).toBe("真去连了");
    process.env.LLM_BREAKER_COOLDOWN_MS = "30000";
    expect(await attempt()).toBe("真去连了"); // 半开这次用长冷却，失败后重新跳闸
    expect(await attempt()).toBe("短路");
  });

  test("**干扰输入**：冷却时长非法时回落到默认值，不能变成永不熔断", async () => {
    process.env.LLM_BREAKER_COOLDOWN_MS = "不是数字";
    expect(await attempt()).toBe("真去连了");
    expect(await attempt()).toBe("短路");
  });

  test("**错误行为的红线**：流式调用也要看同一个熔断", async () => {
    // 原先 `chatStream` 一开头不查熔断 —— 同一个熔断两条路两种待遇。
    process.env.LLM_BREAKER_COOLDOWN_MS = "30000";
    await attempt();
    let msg = "(没抛)";
    try {
      for await (const _ of client().chatStream(MSG)) { /* 不该走到这 */ }
    } catch (e) { msg = (e as Error).message; }
    expect(/已熔断/.test(msg)).toBe(true);
  });

  test("**正确**：resetDefeat 立即清掉熔断", async () => {
    process.env.LLM_BREAKER_COOLDOWN_MS = "30000";
    await attempt();
    expect(await attempt()).toBe("短路");
    LLMClient.resetDefeat();
    expect(await attempt()).toBe("真去连了");
  });
});
