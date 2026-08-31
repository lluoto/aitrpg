// 开发·意图与约束补漏 任务3，缺口 A——GameSession 端到端接线验收。
//
// kp-narration-constraint.test.ts 已经直接单测 KPAgent.narrateOutcome
// 本身的重生成/兜底行为（给定正确的 undiscoveredClueKeys，命中约束会
// 重生成、干净就不动）；这份文件验证 game-session.ts:2092 那个真实调用
// 点确实把这份数据算对、传过去了——接线本身也可能漏掉（漏传、传错
// 场景、算错 key），只测 KPAgent 单体测不出来。
//
// bun test src/__tests__/kp-narration-constraint-wiring.test.ts

import { describe, it, expect } from "bun:test";
import { GameSession } from "../api/game-session";

const CFG = {
  apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
  model: "mock", maxTokens: 128, temperature: 0,
};

function makeSession(id: string): GameSession & Record<string, any> {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession(id, "cosmic-horror", CFG, "investigator", "甲") as any;
}

describe("currentUndiscoveredClueKeys()：喂给叙事约束的数据算得对不对", () => {
  it("中控室：包含线索展示名与拆分出的简称（冰箱/储物柜/拉杆一类）", async () => {
    const session = makeSession(`clue-keys-${Math.random()}`) as any;
    await session.act("加载模组 普瑞米尔的谷仓");
    session.movePlayerToScene("中控室");
    const keys: string[] = session.currentUndiscoveredClueKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k: string) => k.includes("冰箱"))).toBe(true);
    expect(keys.some((k: string) => k.includes("储物柜"))).toBe(true);
  });

  it("全部线索都已发现后返回空数组——不会拿一批已经不存在的对象名继续拦叙事", async () => {
    const session = makeSession(`clue-keys-discovered-${Math.random()}`) as any;
    await session.act("加载模组 普瑞米尔的谷仓");
    session.movePlayerToScene("中控室");
    const real = Math.random;
    Math.random = () => 0;
    try {
      await session.act("检查冰箱", "p1");
      await session.act("拉一下拉杆", "p1");
    } finally { Math.random = real; }
    const keys: string[] = session.currentUndiscoveredClueKeys();
    expect(keys).toEqual([]);
  });

  it("没有加载任何模组时返回空数组，不报错", () => {
    const session = makeSession(`clue-keys-nomodule-${Math.random()}`) as any;
    expect(() => session.currentUndiscoveredClueKeys()).not.toThrow();
  });
});

describe("act() 里 narrateOutcome 的真实调用点确实带上了 sceneId/undiscoveredClueKeys", () => {
  it("接住真实调用参数：第 4 个参数是包含 sceneId 与 undiscoveredClueKeys 数组的对象", async () => {
    const session = makeSession(`kp-wiring-spy-${Math.random()}`) as any;
    // 不加载模组：绕开对象名门（那条门只在 registeredModules.length > 0
    // 时触发），确保这句自由文本真的落到 narrateOutcome——与
    // message-history.test.ts「落入 KP 叙述路径」用的是同一类输入。
    let capturedOpts: any = undefined;
    const originalNarrate = session.kp.narrateOutcome.bind(session.kp);
    session.kp.narrateOutcome = async (...args: any[]) => {
      capturedOpts = args[3];
      return originalNarrate(...args);
    };

    await session.act("我对着空气哼了一段没人听过的调子");

    expect(capturedOpts).toBeDefined();
    expect(typeof capturedOpts.sceneId).toBe("string");
    expect(Array.isArray(capturedOpts.undiscoveredClueKeys)).toBe(true);
  });

  it("在中控室时，真实调用点传的 undiscoveredClueKeys 与 currentUndiscoveredClueKeys() 算出来的一致", async () => {
    const session = makeSession(`kp-wiring-spy-scene-${Math.random()}`) as any;
    await session.act("加载模组 普瑞米尔的谷仓");
    session.movePlayerToScene("中控室");

    let capturedOpts: any = undefined;
    const originalNarrate = session.kp.narrateOutcome.bind(session.kp);
    session.kp.narrateOutcome = async (...args: any[]) => {
      capturedOpts = args[3];
      return originalNarrate(...args);
    };

    // "翻找" 在 clue-match.ts 的 ENTRY_VERB_PREFIX 表里、但不在
    // intent.ts 自己的 skill_check 动词表里——intent 判 unknown，落到
    // 对象名门；去掉动词与"这里"这个指代词之后不剩任何内容，
    // decideClueMatch 判 fallback（不是"提到了对象但没匹配上"的
    // deny），原样放行到 narrateOutcome，而不会被 applyClueDecision
    // 的 deny 分支提前拦截。
    await session.act("翻找这里");

    expect(capturedOpts).toBeDefined();
    expect(capturedOpts.undiscoveredClueKeys).toEqual(session.currentUndiscoveredClueKeys());
    expect(capturedOpts.undiscoveredClueKeys.length).toBeGreaterThan(0);
  });
});
