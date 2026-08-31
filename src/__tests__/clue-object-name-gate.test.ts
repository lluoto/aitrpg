// 开发·对象名通向线索 任务1验收（核心，方案 c）。
//
// 背景：analysis/sim/2026-08-31-barn-completion-attempt.md，25 回合真正
// 玩下去的实跑，走到中控室后被 clue_control_supplies「冰箱与储物柜」堵死。
// 模组数据写着"储物柜没有上锁，里面有十几瓶备用的氧气罐。冰箱里则是一些
// 袋装流食"，玩家说"打开冰箱与储物柜"，但意图解析判成 unknown（"打开"
// 不在 intent.ts 的识别表里），落到 LLM 叙事，LLM 编了"里面空荡荡的"——
// 叙事否认了模组事实，且不可逆（玩家看到"空的"就不会再开第二次），
// Good End 就此堵死。
//
// 根因不是匹配器，是动词门：hasSearchIntent 要求简称紧邻表内动词，
// "打开""看看""拉一下""翻"都不在表里。继续加词填不满——换判据：
// 场景里未发现线索的名字/唯一简称就是"这儿的东西"，玩家提到了就该走
// 线索解析，动词不再是唯一的门。
//
// bun test src/__tests__/clue-object-name-gate.test.ts

import { describe, it, expect } from "bun:test";
import { GameSession } from "../api/game-session";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import { decideClueMatch, type ClueMatchCandidate } from "../investigation/clue-match";

const CFG = {
  apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
  model: "mock", maxTokens: 128, temperature: 0,
};

function makeSession(id: string): GameSession & Record<string, any> {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession(id, "cosmic-horror", CFG, "investigator", "甲") as any;
}

function toCandidate(clue: { id: string; name: string; findMethods: { description: string }[] }): ClueMatchCandidate {
  return { id: clue.id, texts: [clue.name, ...clue.findMethods.map((f) => f.description)] };
}

const controlRoom = BARN_OF_PREMIER.scenes.find((s) => s.id === "control_room")!;
const controlGroup = controlRoom.clues.map(toCandidate);
const trailer = BARN_OF_PREMIER.scenes.find((s) => s.id === "gabi_trailer")!;
const trailerGroup = trailer.clues.map(toCandidate);

describe("真实输入：动词不在任何一份表里，照样走到线索解析", () => {
  it.each([
    "打开冰箱与储物柜",
    "打开冰箱",
    "看看储物柜",
    "拉一下拉杆",
  ])("「%s」不是 fallback/deny，是明确的匹配结果", (said) => {
    const decision = decideClueMatch(said, controlGroup);
    expect(decision.kind).not.toBe("deny");
    expect(decision.kind).not.toBe("fallback");
  });

  it("「打开冰箱与储物柜」精确命中 clue_control_supplies", () => {
    expect(decideClueMatch("打开冰箱与储物柜", controlGroup)).toEqual({ kind: "resolve", clueId: "clue_control_supplies" });
  });

  it("「打开冰箱」「看看储物柜」都精确命中 clue_control_supplies", () => {
    expect(decideClueMatch("打开冰箱", controlGroup)).toEqual({ kind: "resolve", clueId: "clue_control_supplies" });
    expect(decideClueMatch("看看储物柜", controlGroup)).toEqual({ kind: "resolve", clueId: "clue_control_supplies" });
  });

  it("「拉一下拉杆」精确命中 clue_control_lever", () => {
    expect(decideClueMatch("拉一下拉杆", controlGroup)).toEqual({ kind: "resolve", clueId: "clue_control_lever" });
  });

  it("「陆川去翻中控室的储物柜」走到线索解析（不是 deny/fallback），即使两条候选都沾边而报 ask，仍然是正确行为——问不该猜", () => {
    const decision = decideClueMatch("陆川去翻中控室的储物柜", controlGroup);
    expect(["resolve", "ask"]).toContain(decision.kind);
  });
});

describe("回归：既有识别的动词行为不变", () => {
  it("「检查冰箱」「搜查储物柜」依旧精确命中 clue_control_supplies", () => {
    expect(decideClueMatch("检查冰箱", controlGroup)).toEqual({ kind: "resolve", clueId: "clue_control_supplies" });
    expect(decideClueMatch("搜查储物柜", controlGroup)).toEqual({ kind: "resolve", clueId: "clue_control_supplies" });
  });
});

describe("边界：不是所有提及都算搜", () => {
  it("「我把冰箱推开挡住门」不触发线索发现（当障碍物用，不是在搜）", () => {
    expect(decideClueMatch("我把冰箱推开挡住门", controlGroup).kind).toBe("deny");
  });

  it("「藏到储物柜后面」不触发线索发现（当藏身处用，不是在搜）", () => {
    expect(decideClueMatch("藏到储物柜后面", controlGroup).kind).toBe("deny");
  });
});

describe("回归：方案 B（deny 收窄）保持不变——明确指向此处没有的东西仍然 deny", () => {
  it("拖车房搜「保险柜」（任何线索都没提过）依旧 deny", () => {
    expect(decideClueMatch("检查保险柜", trailerGroup).kind).toBe("deny");
  });
});

describe("端到端：GameSession 里走一遍，Good End 必需线索真的被发现", () => {
  it("intent.action 判成 unknown 的「打开冰箱与储物柜」，clue_control_supplies 真的被发现，叙述不再说「空的」", async () => {
    const session = makeSession(`obj-gate-e2e-${Math.random()}`);
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("中控室");
    const real = Math.random;
    Math.random = () => 0; // 逼检定成功
    try {
      const res = await session.act("打开冰箱与储物柜", "p1");
      expect(res.narrative).not.toContain("空荡荡");
      expect(res.narrative).not.toBe("你采取了行动。周围的环境似乎因此产生了微妙的变化——空气流动的方向变了，阴影更深了。");
      expect(session.investigation.isDiscoveredBy("clue_control_supplies", "p1")).toBe(true);
    } finally { Math.random = real; }
  });

  it("「拉一下拉杆」同样端到端可用（不是 clue_control_supplies 专属修复）", async () => {
    const session = makeSession(`obj-gate-lever-${Math.random()}`);
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("中控室");
    const real = Math.random;
    Math.random = () => 0;
    try {
      await session.act("拉一下拉杆", "p1");
      expect(session.investigation.isDiscoveredBy("clue_control_lever", "p1")).toBe(true);
    } finally { Math.random = real; }
  });

  it("回归：「陆川觉得很紧张」（unknown，不提场景对象）不触发任何线索发现，正常走 LLM 叙事", async () => {
    const session = makeSession(`obj-gate-unrelated-${Math.random()}`);
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("中控室");
    const res = await session.act("陆川觉得很紧张", "p1");
    expect(session.investigation.isDiscoveredBy("clue_control_supplies", "p1")).toBe(false);
    expect(session.investigation.isDiscoveredBy("clue_control_lever", "p1")).toBe(false);
    expect(res.error).toBeUndefined();
  });

  it("回归：skill_check 路径（检查冰箱）继续正常工作，不受新增的 unknown 门影响", async () => {
    const session = makeSession(`obj-gate-skillcheck-${Math.random()}`);
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("中控室");
    const real = Math.random;
    Math.random = () => 0;
    try {
      await session.act("检查冰箱", "p1");
      expect(session.investigation.isDiscoveredBy("clue_control_supplies", "p1")).toBe(true);
    } finally { Math.random = real; }
  });
});
