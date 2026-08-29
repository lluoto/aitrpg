// 意图解析的两处静默回落改成如实上报（任务 1）。
//
// 起因：实跑 30 回合里有 6 次意图判错（≈20%）。intent.ts 的两处 catch 原先都
// 是哑的（console.warn 整行被注释掉）——"LLM 答错了"和"LLM 一直在失败"在外部
// 完全无法区分，判错率无从归因。改成 log.warn("intent", ...) 带上原因，
// 行为（照常回落 regex）不变，只是让回退变得可观测。
//
// ⚠ 这个文件动的是模块级单例 `_llmClient`（intent-llm-wiring.test.ts 同款警告），
// 每条用例后必须还原，否则会影响其它测试文件的意图解析行为。

import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { setIntentLLM } from "../llm/intent";
import { log } from "../log";
import type { ActionIntent } from "../types";

// 直接 import 触发模块加载，拿到 parseIntent（不经 GameSession，避免拉一整个会话）
import { parseIntent } from "../llm/intent";

function fakeClient(chat: () => Promise<string>) {
  return { chat, chatStream: async function* () {} } as any;
}

beforeEach(() => {
  setIntentLLM(null);
});
afterEach(() => {
  setIntentLLM(null); // 还原单例，别影响别的测试文件
});

describe("parseIntent 的静默回落改成 log.warn（任务1：只做可观测性，不改行为）", () => {
  test("**正确**：LLM 调用抛异常 → 有一条 warn，含原因；仍然照常回落 regex", async () => {
    const warnSpy = spyOn(log, "warn");
    setIntentLLM(fakeClient(async () => { throw new Error("ECONNREFUSED 测试用异常原因"); }));
    const result: ActionIntent = await parseIntent("攻击哥布林");

    // 行为不变：网络异常时仍然拿到 regex 兜底的结果，不是抛出/挂起
    expect(result.action).toBe("attack");
    // 可观测性：至少一条 warn，且带上了异常原因（不是空话）
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls;
    const scopes = calls.map((c: any[]) => c[0]);
    expect(scopes).toContain("intent");
    const messages = calls.map((c: any[]) => c[1] as string).join("\n");
    expect(messages).toContain("ECONNREFUSED 测试用异常原因");
    warnSpy.mockRestore(); // 检查完毕再还原，别在还没读 mock.calls 前就清了它
  });

  test("**正确**：LLM 返回非法 JSON → 有一条 warn，含原文片段；仍然照常回落 regex", async () => {
    const warnSpy = spyOn(log, "warn");
    setIntentLLM(fakeClient(async () => "这不是合法JSON，只是一段普通文字"));
    const result: ActionIntent = await parseIntent("攻击哥布林");

    expect(result.action).toBe("attack");
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls;
    const scopes = calls.map((c: any[]) => c[0]);
    expect(scopes).toContain("intent");
    const messages = calls.map((c: any[]) => c[1] as string).join("\n");
    expect(messages).toContain("这不是合法JSON");
    warnSpy.mockRestore();
  });

  test("**错误行为红线**：LLM 正常返回合法 JSON → 一条 warn 都没有（别把正常路径也刷屏）", async () => {
    const warnSpy = spyOn(log, "warn");
    setIntentLLM(fakeClient(async () => JSON.stringify({ action: "attack", target: "哥布林" })));
    const result: ActionIntent = await parseIntent("攻击哥布林");

    expect(result.action).toBe("attack");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test("**文本相似但合法**：没配置 LLM（regex-only 路径）也不该报 warn——静默回落只指 LLM 失败的那两处，不是"
    + "泛化到所有走 regex 的路径", async () => {
    const warnSpy = spyOn(log, "warn");
    setIntentLLM(null);
    const result: ActionIntent = await parseIntent("攻击哥布林");

    expect(result.action).toBe("attack");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ── 修 A · 任务 1：围栏解析收敛到 extractJson，intent.ts 的裸 parse 是根因 ──
//
// analysis/sim/2026-08-28-barn-a-acceptance.md 第 11 回合中止：LLM 正确判定
// {"action":"talk","target":"菲碧",…}，但裹在 ```json 围栏里；intent.ts 曾经
// `JSON.parse(raw.trim())` 直接抛异常，静默回落 parseIntentRegex，
// regex 里贪婪的 /追/ 命中"追问"，一次对话请求变成一次追逐判定。
describe("围栏包裹的合法 JSON 必须解析成功（正例，用实跑原文的形状）", () => {
  test("**关键回归**：裹在 ```json 围栏里的合法意图 JSON，解析成功且不回落 regex", async () => {
    const warnSpy = spyOn(log, "warn");
    // 形状取自实跑事故原文：LLM 判对了（talk），但裹了围栏。
    setIntentLLM(fakeClient(async () =>
      '```json\n{"action":"talk","target":"菲碧"}\n```'
    ));
    const result: ActionIntent = await parseIntent("林娜追问菲碧，加比是否提过维森酒吧");

    // 判据本身：必须是 talk，绝不能因为围栏解析失败而回落 regex 判成 chase。
    expect(result.action).toBe("talk");
    expect(result.action).not.toBe("chase");
    expect(result.target).toBe("菲碧");
    // 围栏解析成功，不该有任何 warn（回落 regex 才会报 warn）。
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test("光秃秃的 ``` 围栏（不带 json 标注）同样解析成功", async () => {
    setIntentLLM(fakeClient(async () => '```\n{"action":"move","target":"特里坎家"}\n```'));
    const result: ActionIntent = await parseIntent("走到特里坎家");
    expect(result.action).toBe("move");
    expect(result.target).toBe("特里坎家");
  });

  test("不裹围栏的裸 JSON 仍然照常解析（没有回归）", async () => {
    setIntentLLM(fakeClient(async () => JSON.stringify({ action: "look" })));
    const result: ActionIntent = await parseIntent("环顾四周");
    expect(result.action).toBe("look");
  });
});
