import { describe, expect, it } from "bun:test";
import { GameSession } from "../api/game-session";

const config = { apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 512, temperature: 0.7 };

async function loadedSession(label: string): Promise<GameSession> {
  const session = new GameSession(`module-data-npc-${label}`, "cosmic-horror", config, undefined, "调查员");
  await session.act("创建角色 investigator 甲");
  await session.act("加载模组 普瑞米尔的谷仓");
  return session;
}

describe("步骤 5C：ModuleData 叙事 NPC 进入自由跑团", () => {
  const cases = [
    { scene: "维森酒吧", npc: "前台", utterance: "和前台交谈" },
    { scene: "报亭", npc: "报亭老板", utterance: "跟报亭老板聊聊" },
    { scene: "霍姆斯医院", npc: "医护人员", utterance: "问问医护人员" },
  ];

  for (const entry of cases) {
    it(`${entry.npc} 在 ${entry.scene} 作为非战斗叙事 NPC 真实进入行动锚点并接受自然语言对话`, async () => {
      const session = await loadedSession(entry.npc);
      await session.act(`前往${entry.scene}`);
      expect(session.getSuggestions("p1")).toContain(`与 ${entry.npc} 交谈`);
      const response = await session.act(entry.utterance);
      expect(response.events.some((event) => event.speaker === entry.npc || event.speaker === "系统")).toBe(true);
    });
  }

  it("谷仓加载结果来自 direct ModuleData loader，而非旧 Mythos loader 标题", async () => {
    const session = new GameSession("module-data-npc-direct-marker", "cosmic-horror", config, undefined, "调查员");
    await session.act("创建角色 investigator 甲");
    const loaded = await session.act("加载模组 普瑞米尔的谷仓");
    const output = [loaded.narrative, ...loaded.events.map((event) => event.content)].join("\n");
    expect(output).toContain("【统一模组：普瑞米尔的谷仓】");
    expect(output).not.toContain("【剧本杀模组：普瑞米尔的谷仓】");
  });
});
