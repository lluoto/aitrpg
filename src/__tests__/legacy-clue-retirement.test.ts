import { describe, expect, it } from "bun:test";
import { GameSession } from "../api/game-session";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";

const config = { apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 512, temperature: 0.7 };

async function loaded(label: string): Promise<GameSession> {
  const session = new GameSession(`legacy-clue-retirement-${label}`, "cosmic-horror", config, undefined, "调查员");
  await session.act("创建角色 investigator 甲");
  await session.act("加载模组 普瑞米尔的谷仓");
  return session;
}

function move(session: GameSession, scene: string): void {
  const method: unknown = Reflect.get(session, "movePlayerToScene");
  if (typeof method !== "function") throw new Error("movePlayerToScene unavailable");
  const moved = Reflect.apply(method, session, [scene]);
  if (moved !== true) throw new Error(`failed to move to ${scene}`);
}

describe("步骤 5C 收尾：legacy clueBindings 退出生产", () => {
  it("可文本匹配 id 不变；未发现列表只移除 clue_0..9；建议文本的唯一变化是特里坎家不再误提示搜查", async () => {
    const after = await loaded("after");
    const before = await loaded("before-simulated");
    for (const binding of BARN_OF_PREMIER.runtime?.clueBindings ?? []) {
      before.investigation.registerSceneClue(binding.scene, binding.clueType, binding.description, binding.sanCost);
    }

    expect(after.investigation.listModuleClueIds({ onlyWithMatchTexts: true }).sort()).toEqual(
      before.investigation.listModuleClueIds({ onlyWithMatchTexts: true }).sort(),
    );

    const scenes = ["特里坎家", "加比的拖车房", "维森酒吧", "与艾德里安的会面"];
    const legacyIds = new Set(Array.from({ length: 10 }, (_, index) => `clue_${index}`));
    for (const scene of scenes) {
      const afterIds = after.investigation.getUndiscoveredSceneClues(scene, "p1");
      const beforeIds = before.investigation.getUndiscoveredSceneClues(scene, "p1");
      const removed = beforeIds.filter((id) => !afterIds.includes(id));
      expect(removed.every((id) => legacyIds.has(id))).toBe(true);
      expect(afterIds.some((id) => legacyIds.has(id))).toBe(false);

      move(after, scene);
      move(before, scene);
      const afterSuggestions = after.getSuggestions("p1");
      const beforeSuggestions = before.getSuggestions("p1");
      if (scene === "特里坎家") {
        expect(beforeSuggestions).toContain("仔细搜查这里");
        expect(afterSuggestions).toContain("环顾四周");
      } else {
        expect(afterSuggestions).toEqual(beforeSuggestions);
      }
    }
  });

  it("10 条 legacy 内容均有 rich Clue 或叙事 NPC knowledge/secrets 承载", () => {
    const rich = new Map(BARN_OF_PREMIER.scenes.flatMap((scene) => scene.clues.map((clue) => [clue.id, `${clue.description}${clue.revelation}`])));
    const npcText = new Map(BARN_OF_PREMIER.npcs.map((npc) => [npc.id, [...npc.knowledge, ...npc.secrets].join("")]));
    const carriers: Record<string, { source: string; terms: string[] }> = {
      clue_0: { source: "phoebe_tricam", terms: ["叛逆", "十五岁", "半个多月", "照片"] },
      clue_1: { source: "phoebe_tricam", terms: ["没有看报纸", "不知道关于绑架犯"] },
      clue_2: { source: "clue_pistol_in_bag", terms: ["黑袋子", "1911手枪"] },
      clue_3: { source: "clue_drugs", terms: ["毒品", "足够定罪"] },
      clue_4: { source: "clue_card", terms: ["小卡片", "维森酒吧"] },
      clue_5: { source: "clue_bar_mass_booking", terms: ["包下了酒吧", "登记"] },
      clue_6: { source: "clue_bar_guest_identity", terms: ["艾德里安·埃斯特鲁姆", "困难成功"] },
      clue_7: { source: "clue_bar_ask_around", terms: ["幸运", "代价"] },
      clue_8: { source: "clue_adrian_psychoanalysis", terms: ["精神分析", "妻女"] },
      clue_9: { source: "adrian_estrum", terms: ["失踪案件", "Mi-Go联络术", "被Mi-Go欺骗"] },
    };
    expect(Object.keys(carriers)).toHaveLength(10);
    for (const [legacyId, carrier] of Object.entries(carriers)) {
      const text = rich.get(carrier.source) ?? npcText.get(carrier.source);
      if (!text) throw new Error(`missing carrier for ${legacyId}`);
      for (const term of carrier.terms) expect(text).toContain(term);
    }
  });
});
