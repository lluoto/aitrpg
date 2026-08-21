import { describe, expect, test } from "bun:test";
import { PlayerAgent } from "../agent/player-agent";

function agent(): PlayerAgent {
  const pc = {
    name: "测试员",
    occupation: "记者",
    personality: "谨慎",
    backstory: "无",
    currentGoal: "查明真相",
    char: {},
  } as unknown as ConstructorParameters<typeof PlayerAgent>[0];
  return new PlayerAgent(pc);
}

describe("parseAction — agent 自报 intent", () => {
  test("按 JSON 读 action 与 intent", () => {
    const d = agent().parseAction(`{"action":"我翻找抽屉","intent":"search","target":"抽屉"}`);
    expect(d.action).toBe("我翻找抽屉");
    expect(d.intent).toBe("search");
    expect(d.targetName).toBe("抽屉");
  });

  test("「打开」不再被判成 combat", () => {
    // 这是促成这次改动的那条真 bug：关键词判别里「打开」含「打」，
    // 命中战斗词表 → 玩家开个门，引擎让他掏枪。
    // 自报 intent 之后这一类歧义整个消失。
    const d = agent().parseAction(
      `{"action":"我打开手电筒照向管道深处","intent":"investigate","target":"管道"}`,
    );
    expect(d.intent).toBe("investigate");
  });

  test("认不出的 intent 归 other，不回退去猜", () => {
    // 关键：这里**不能**退回关键词匹配。那正是这次要去掉的东西 ——
    // 猜一个错的比说「说不清」更糟。这句话里有「去」，
    // 一旦回退就会被判成 move。
    const d = agent().parseAction(`{"action":"我去看看那张卡片写了什么","intent":"ponder"}`);
    expect(d.intent).toBe("other");
  });

  test("带 ``` 围栏也能读", () => {
    const d = agent().parseAction("```json\n{\"action\":\"我开火\",\"intent\":\"combat\"}\n```");
    expect(d.intent).toBe("combat");
  });

  test("JSON 里没有 action 就不算数，退回关键词", () => {
    // 只有 intent 没有行动描述，KP 那边什么都念不出来。
    const d = agent().parseAction(`{"intent":"combat"} 我仔细检查那张卡片`);
    expect(d.intent).toBe("investigate");
    expect(d.action).toContain("我仔细检查那张卡片");
  });

  test("纯文本回复仍走关键词那条路", () => {
    // fallbackDecision 那一支、以及没走新 prompt 的调用方，回来的都是纯文本。
    const d = agent().parseAction("我问菲碧关于加比的事");
    expect(d.intent).toBe("talk");
    expect(d.action).toBe("我问菲碧关于加比的事");
  });

  test("技能名仍然从行动文字里认", () => {
    // 技能是专有名词，出现即命中，没有「打开/打」那种子串歧义，所以保留。
    const d = agent().parseAction(`{"action":"我用侦查仔细看那张卡片","intent":"investigate"}`);
    expect(d.skillToUse).toBe("侦查");
  });

  test("target 缺省时不产生 targetName 字段", () => {
    const d = agent().parseAction(`{"action":"我环顾四周","intent":"observe"}`);
    expect(d.targetName).toBeUndefined();
  });
});

describe("buildPrompt", () => {
  test("prompt 里写明了要 JSON 与全部 intent 取值", () => {
    // 谁要是把格式说明删了，模型就会退回纯文本，intent 又变成猜的。
    const p = agent().buildPrompt("你站在门口。", [], []);
    expect(p).toContain("JSON");
    for (const it of ["investigate", "search", "talk", "move", "combat", "observe", "use_item"]) {
      expect(p).toContain(it);
    }
  });

  test("线索仍然进 prompt", () => {
    // 「有线索后玩家自行决定行动」—— 线索是这个设计的前提，不能丢。
    const p = agent().buildPrompt("你站在门口。", ["门缝里透出光"], []);
    expect(p).toContain("门缝里透出光");
  });
});
