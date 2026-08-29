// 开发 A · 任务 4/5 验收 —— 脱离判定 + 确认门 + 结局播报 + 终态。
//
// bun test src/__tests__/module-departure-flow.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";
import { isExplicitLeaveIntent, isConfirmReply, MODULE_ENDING_SUPPORT } from "../play/module-departure";

function makeSession(): GameSession {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession("departure-test", "cosmic-horror", {
    apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 1024, temperature: 0.7,
  }, undefined, "调查员");
}

// ── 判据单测：显式离开意图 / 确认回复 ──────────────────────────

describe("isExplicitLeaveIntent —— 只认明确表达，不靠解析失败反推", () => {
  it("**应报**：明确表达离开/结束调查的句子", () => {
    expect(isExplicitLeaveIntent("我们决定离开这里")).toBe(true);
    expect(isExplicitLeaveIntent("结束这次调查，回家吧")).toBe(true);
    expect(isExplicitLeaveIntent("放弃调查，返回家乡")).toBe(true);
    expect(isExplicitLeaveIntent("任务结束，收工回家")).toBe(true);
  });

  it("**不应报**：本仓真实踩过的误判样本——纯调查句不该被当成离开", () => {
    // 实跑真事：这句话被 LLM 判成过"move"，intent.target 却是空字符串
    // （analysis/sim/2026-08-28-barn-long-input-abort.md）。就算被判成
    // move 且解析不出目标，这句话本身也绝不该被判定为"要离开"。
    expect(isExplicitLeaveIntent("陈岳查看餐桌、披萨盒和啤酒罐，找可能的留言或地址。")).toBe(false);
  });

  it("**不应报**：普通移动指令，即使目标解析失败", () => {
    expect(isExplicitLeaveIntent("前往一个含糊不清的地方")).toBe(false);
    expect(isExplicitLeaveIntent("走")).toBe(false);
    expect(isExplicitLeaveIntent("")).toBe(false);
  });
});

describe("isConfirmReply —— 只认清楚的肯定", () => {
  it("**应报**：常见肯定回复", () => {
    for (const s of ["确定", "确认", "是", "对", "走吧", "嗯", "好的", "好"]) {
      expect(isConfirmReply(s)).toBe(true);
    }
  });

  it("**不应报**：否定、含糊、或全新的一句话都按取消处理", () => {
    for (const s of ["不", "不要", "再等等", "我们再查一查", "不确定", "算了吧继续调查"]) {
      expect(isConfirmReply(s)).toBe(false);
    }
  });
});

// ── 集成：确认门的完整往返 ──────────────────────────────────

describe("确认门：显式离开 → 确认 → 进结局；不确认 → 留在原地、不消耗结局", () => {
  let session: GameSession;

  beforeEach(async () => {
    session = makeSession();
    await session.act("加载模组 普瑞米尔的谷仓");
  });

  it("显式离开请求会先问一句确认，不直接结束会话", async () => {
    const res = await session.act("我们决定离开这里，结束这次调查");
    expect(session.dead).toBe(false);
    const asked = res.events.some((e) => e.content.includes("确定要离开"));
    expect(asked).toBe(true);
  });

  it("确认后进入结局：会话置为终态（复用 dead，不造第三种终态）", async () => {
    await session.act("我们决定离开这里，结束这次调查");
    const res = await session.act("确定");
    expect(session.dead).toBe(true);
    expect(res.narrative.length).toBeGreaterThan(0);
  });

  it("不确认（含普通新行动）：留在原地，不消耗结局，会话继续", async () => {
    await session.act("我们决定离开这里，结束这次调查");
    const res = await session.act("我们再查一查");
    expect(session.dead).toBe(false);
    const cancelled = res.events.some((e) => e.content.includes("先留下"));
    expect(cancelled).toBe(true);
  });

  it(
    "**误判类输入不得触发结局**：纯调查句被判成移动、解析不出目标，" +
      "既不该问确认，也不该结束会话",
    async () => {
      const res = await session.act("陈岳查看餐桌、披萨盒和啤酒罐，找可能的留言或地址。");
      expect(session.dead).toBe(false);
      const asked = res.events.some((e) => e.content.includes("确定要离开"));
      expect(asked).toBe(false);
    },
  );

  it("模组内正常移动完全不受影响（既有行为的回归判据）", async () => {
    const res = await session.act("前往加比的拖车房");
    expect(session.dead).toBe(false);
    expect(session.getDisplayedScene()).toBe("加比的拖车房");
    const asked = res.events.some((e) => e.content.includes("确定要离开"));
    expect(asked).toBe(false);
  });
});

// ── 集成：结局判定与通用收场 ──────────────────────────────────

describe("确认离开后：谷仓早退 → Normal End 正文", () => {
  it("什么线索都没找到时早退，落到 Normal End（未受干涉的结果，不用另写文案）", async () => {
    const session = makeSession();
    await session.act("加载模组 普瑞米尔的谷仓");
    await session.act("我们决定离开这里，结束这次调查");
    const res = await session.act("确定");
    expect(session.dead).toBe(true);
    // Normal End 的文案来自 END_NARRATIONS，不是空播——narrative 有内容。
    expect(res.narrative.trim().length).toBeGreaterThan(0);
    expect(res.events.length).toBeGreaterThan(0);
  });
});

describe("确认离开后：无 endings 数据的模组走通用收场，不报错不空播", () => {
  it("阿卡姆档案检查目前没有登记结局支持——走通用收场", async () => {
    expect(MODULE_ENDING_SUPPORT["arkham_miskatonic"]).toBeUndefined();
    const session = makeSession();
    await session.act("加载模组 阿卡姆档案检查");
    await session.act("我们决定离开这里，结束这次调查");
    const res = await session.act("确定");
    expect(session.dead).toBe(true);
    expect(res.narrative.trim().length).toBeGreaterThan(0);
    expect(res.events.length).toBeGreaterThan(0);
  });

  it(
    "**变异检验**：给阿卡姆临时登记一份结局支持，确认它改走结局分支而不是通用收场",
    async () => {
      const fakeEnding = {
        traumaticClues: {},
        evaluateEnding: () => ({ id: "fake_ending", priority: 0, condition: { requiredClues: [] }, lines: ["【测试用假结局】临时登记验证分支切换。"] }),
        endLabels: { fake_ending: "假结局" },
        encounters: [],
        hubSceneId: "",
      };
      MODULE_ENDING_SUPPORT["arkham_miskatonic"] = fakeEnding as any;
      try {
        const session = makeSession();
        await session.act("加载模组 阿卡姆档案检查");
        await session.act("我们决定离开这里，结束这次调查");
        const res = await session.act("确定");
        expect(session.dead).toBe(true);
        const gotFakeEnding = res.events.some((e) => e.content.includes("测试用假结局"));
        expect(gotFakeEnding).toBe(true);
      } finally {
        delete MODULE_ENDING_SUPPORT["arkham_miskatonic"]; // 还原登记表，不污染其它测试
      }
    },
  );
});
