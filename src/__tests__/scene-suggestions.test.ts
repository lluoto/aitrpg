// P3 行动锚点：GET /suggestions 必须反映真实场景，而不是回四条写死文案。
//
// 实跑 2026-08-30-barn-natural-play.md：玩家在维森酒吧卡了 24 回合。保镖
// 说“名单早让老板锁进抽屉了”，但老板和抽屉都不存在；玩家换四种问法都
// 没推进，最后拿到 Normal End。引擎其实有 6 条可发现线索和一个真实在场
// 的酒吧保镖，问题是玩家没有办法知道什么行动可行。
//
// 前端会把每条 suggestions 字符串原样 submitAction(s)，所以这是强约束：
// 建议必须是可执行自由文本，不是“这里还有没查过的东西”这种描述句。本组
// 的 round-trip 判据逐条把真实 suggestions 再喂回 act()，防止退化。
//
// bun test src/__tests__/scene-suggestions.test.ts

import { describe, it, expect } from "bun:test";
import { GameSession } from "../api/game-session";
import { runSuggestions } from "../api/server";
import { parseIntent } from "../llm/intent";

const CFG = {
  apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
  model: "mock", maxTokens: 128, temperature: 0,
};

async function barnAt(scene: string): Promise<GameSession & Record<string, any>> {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  // p1 要有真实角色卡，才能用 pcId 路由；无 archetype 的构造分支是空壳 p1，
  // 见 game-session-run-harness.test.ts 多 PC helper 的同一限制。
  const session: any = new GameSession(`suggestions-${Math.random()}`, "cosmic-horror", CFG, "investigator", "甲");
  await session.act("加载模组 普瑞米尔的谷仓");
  session.movePlayerToScene(scene);
  return session;
}

function systemText(res: Awaited<ReturnType<GameSession["act"]>>): string {
  return res.events.filter((e) => e.speaker === "系统").map((e) => e.content).join("\n");
}

describe("真实场景行动锚点", () => {
  it("维森酒吧：只展示真实在场 NPC、真实出口和可执行搜索动作，不泄露未发现线索名称", async () => {
    const session = await barnAt("维森酒吧");
    const suggestions = session.getSuggestions("p1");
    const undiscovered = session.investigation.getUndiscoveredSceneClues("维森酒吧", "p1");

    expect(undiscovered.length).toBeGreaterThan(0); // 判据确实是在有内容的真实场景量
    expect(suggestions.some((s) => s.startsWith("仔细搜查这里"))).toBe(true);
    expect(suggestions).toContain("与 酒吧保镖 交谈");
    expect(suggestions).toContain("前往 普瑞米尔");
    for (const clueId of undiscovered) {
      const clue = (session.investigation as any).clueTypes.get(clueId);
      const text = suggestions.join("\n");
      expect(text).not.toContain(clueId);
      // displayName 是玩家侧名字；id 不泄露还不够，不能把「酒吧预订记录」
      // 这种名字换个字段塞进去假装没剧透。
      if (clue?.displayName) expect(text).not.toContain(clue.displayName);
    }
  });

  it("同一真实场景按 PC 查私密线索：p1 全部发现后只环顾，p2 仍得到仔细搜查", async () => {
    const session = await barnAt("维森酒吧");
    await session.act("创建队友 乙 investigator");
    const p1Undiscovered = session.investigation.getUndiscoveredSceneClues("维森酒吧", "p1");
    expect(p1Undiscovered.length).toBeGreaterThan(0);
    for (const clueId of p1Undiscovered) session.investigation.markDiscovered(clueId, "p1");

    const p1Suggestions = session.getSuggestions("p1");
    const p2Suggestions = session.getSuggestions("p2");
    expect(p1Suggestions).toContain("环顾四周");
    expect(p1Suggestions).not.toContain("仔细搜查这里");
    expect(p2Suggestions.some((s) => s.startsWith("仔细搜查这里"))).toBe(true);
    expect(p1Suggestions).not.toEqual(p2Suggestions);
  });

  it("空场景/无出口场景不崩也不编造行动", async () => {
    const session = await barnAt("特里坎家");
    session.world.registerScene("empty-anchor-test", "空场景");
    (session as any).movePlayerToScene("empty-anchor-test");
    expect(session.getSuggestions("p1")).toEqual(["环顾四周"]);
  });
});

describe("建议往返：真实 suggestions 原样回传 act()，均不报错、不触发复合句回问", () => {
  for (const scene of ["维森酒吧", "加比的拖车房", "特里坎家"]) {
    it(`${scene} 的每条建议都可直接执行`, async () => {
      // 每条单独建局：移动会改变场景，搜索可能改变发现状态；互相复用会把后
      // 一个 suggestion 的前置条件污染掉，无法证明“初始建议本身”可执行。
      const probe = await barnAt(scene);
      const suggestions = probe.getSuggestions("p1");
      expect(suggestions.length).toBeGreaterThan(0);

      for (const suggestion of suggestions) {
        const session = await barnAt(scene);
        const intent = await parseIntent(suggestion);
        const expectedAction = suggestion.startsWith("仔细搜查") ? "skill_check"
          : suggestion.startsWith("环顾") ? "look"
          : suggestion.startsWith("与 ") ? "talk"
          : "move";
        expect(intent.action).toBe(expectedAction);
        const res = await session.act(suggestion, "p1");
        expect(res.error).toBeUndefined();
        expect(systemText(res)).not.toContain("你是要先去");
        // 输入确实被本回合接收、不是空响应/结构化拒绝。
        expect(res.events.some((e) => e.type === "action" && e.content === suggestion)).toBe(true);
      }
    });
  }
});

describe("GET /suggestions 的 pcId 路由", () => {
  it("显式 p2 只读取 p2 的建议，不切换 activePlayerId；不传仍保持 active PC 行为", async () => {
    const session = await barnAt("维森酒吧");
    await session.act("创建队友 乙 investigator");
    const clues = session.investigation.getUndiscoveredSceneClues("维森酒吧", "p1");
    for (const clueId of clues) session.investigation.markDiscovered(clueId, "p1");
    expect(session.activePlayerId).toBe("p1");

    const forP2 = runSuggestions(session, "p2");
    expect(forP2.status).toBe(200);
    expect((forP2.body.suggestions as string[]).some((s) => s.startsWith("仔细搜查这里"))).toBe(true);
    expect(session.activePlayerId).toBe("p1"); // GET 是只读，不产生粘性切换

    const defaulted = runSuggestions(session, null);
    expect(defaulted.status).toBe(200);
    expect(defaulted.body.suggestions).toContain("环顾四周");
  });

  it("未知 ?pcId= 与 /history 同口径明确 404，不静默回空 suggestions", async () => {
    const session = await barnAt("维森酒吧");
    const result = runSuggestions(session, "p9");
    expect(result.status).toBe(404);
    expect(result.body.error).toBe("未知 pcId: p9");
  });
});

describe("战斗回归：四条建议逐字保持", () => {
  it("combatActive 时不混入场景锚点", async () => {
    const session = await barnAt("维森酒吧");
    session.combatActive = true;
    expect(session.getSuggestions("p1")).toEqual([
      "⚔️ 攻击敌人", "🛡️ 防御", "💊 使用物品", "🏃 撤退",
    ]);
  });
});

// 开发·对象名通向线索 任务4验收——行动锚点不把 NPC 当地点。
//
// 背景：premiers_barn.ts（rules/custom-modules 那份自定义模组，见
// todo-19"两份模组表示未统一"）的 nav 表把 NPC 也塞进了场景导航图当
// "目的地"——"特里坎家"的 exits 里有"菲碧_特里坎"/"米尔_特里坎"，纯粹
// 是给 on_enter_scene hook 一个可以挂描写的 condition key，不是真地点。
// 25 回合实跑（analysis/sim/2026-08-31-barn-completion-attempt.md）打出
// 过"前往 菲碧_特里坎"，人不是地方，玩家点了也走不到哪去。
describe("行动锚点不把 NPC 当地点（任务4）", () => {
  it("特里坎家：不出现「前往 菲碧_特里坎」「前往 米尔_特里坎」，但「与 X 交谈」和真地点都在", async () => {
    const session = await barnAt("特里坎家");
    const suggestions = session.getSuggestions("p1");
    for (const s of suggestions) {
      expect(s).not.toContain("菲碧_特里坎");
      expect(s).not.toContain("米尔_特里坎");
      expect(s).not.toMatch(/^前往 菲碧/);
      expect(s).not.toMatch(/^前往 米尔/);
    }
    expect(suggestions).toContain("与 菲碧·特里坎 交谈");
    expect(suggestions).toContain("与 米尔·特里坎 交谈");
    expect(suggestions).toContain("前往 加比的拖车房");
    expect(suggestions).toContain("前往 普瑞米尔");
  });

  it("普瑞米尔（NPC 过滤的判据不是「description 为空」）：农场外围、报亭这类真地点一个不少", async () => {
    const session = await barnAt("特里坎家");
    (session as any).movePlayerToScene("普瑞米尔");
    const suggestions = session.getSuggestions("p1");
    // 农场外围、报亭本身没写场景描述，跟"菲碧_特里坎"表面特征相似
    // （都是"平平无奇的字符串"），但它们是真场景，不该被 NPC 过滤误伤。
    expect(suggestions).toContain("前往 特里坎家");
    expect(suggestions).toContain("前往 报亭");
    expect(suggestions).toContain("前往 艾德里安的农场");
  });
});
