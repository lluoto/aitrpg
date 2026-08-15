import { describe, expect, test } from "bun:test";
import { GameSession } from "../api/game-session";
import { COC_SKILL_BASES } from "../character/coc-character";

/**
 * HTTP 会话建卡必须走 CoC 建卡器。
 *
 * 此前会话用通用的 CharacterFactory.generate()，它把属性写成 D&D 六项固定 10
 * （strength/dexterity/constitution/intelligence/wisdom/charisma），既缺 CoC 必需的
 * size/power/appearance/education，也从不填 skillValues。后果是每次技能检定都读不到
 * 调查员的真实技能，只能落到各调用点自己的兜底常量，职业与技能分配对判定毫无影响。
 *
 * 注意 CLI（index.ts）与 play-module 一直走的是正确的 createCoCCharacter，
 * 只有前端连的 HTTP 路径没接上。
 */
const LLM = {
  apiKey: "sk-placeholder",
  baseUrl: "http://localhost:9999",
  model: "mock",
  maxTokens: 1024,
  temperature: 0.7,
};

describe("CoC 会话建卡接线", () => {
  const newInvestigator = (id: string) =>
    new GameSession(id, "cosmic-horror", undefined, "investigator", "调查员");

  test("调查员拥有 CoC 七项核心属性，而非 D&D 六项", () => {
    const char = newInvestigator("coc-wiring-attrs").activeCharacter;

    for (const attr of ["strength", "constitution", "size", "dexterity", "appearance", "intelligence", "power", "education"]) {
      expect(char.attributes[attr]).toBeGreaterThan(0);
    }
    // CoC 属性是 1-99 百分制，不是 D&D 的 3-18；固定 10 说明根本没生成
    expect(char.attributes.power).toBeGreaterThan(18);
  });

  test("技能值已分配，spot_hidden 不低于基础值 25", () => {
    const char = newInvestigator("coc-wiring-skills").activeCharacter;

    expect(char.skillValues).toBeDefined();
    expect(Object.keys(char.skillValues).length).toBeGreaterThan(0);
    expect(char.skillValues["spot_hidden"]).toBeGreaterThanOrEqual(COC_SKILL_BASES["spot_hidden"]!);
  });

  test("派生数据齐备：幸运、信用评级、HP 按 CoC 公式", () => {
    const char = newInvestigator("coc-wiring-derived").activeCharacter;

    expect(char.luck).toBeGreaterThan(0);
    expect(char.creditRating).toBeGreaterThan(0);
    // CoC: HP = (CON + SIZ) / 10，D&D 的 baseHp + (CON-10)/2 会给出 12
    expect(char.maxHp).toBe(Math.floor((char.attributes.constitution + char.attributes.size) / 10));
  });

  // 建卡填对了技能值，不代表检定查得到：intent 用的是通用词汇（perception /
  // investigation），CoC 角色卡的键是 spot_hidden。词汇对不上时技能分配等于没有。
  test.each([
    ["侦查", "perception"],
    ["调查", "investigation"],
  ])("「%s」检定用角色卡上的 spot_hidden，而不是兜底值", async (input) => {
    process.env.LLM_API_KEY = "";
    process.env.OPENAI_API_KEY = "";
    const session = new GameSession(`coc-wiring-${input}`, "cosmic-horror", LLM, "investigator", "调查员");
    const expected = session.activeCharacter.skillValues["spot_hidden"];

    // 场景没有已注册线索，检定会走通用分支而非线索解析分支
    await session.act(input);

    expect(JSON.stringify(session.getHistory())).toContain(`目标=${expected}%`);
  });

  // CoC 7e：初始 SAN 等于 POW。SanityEngine 的构造参数本来就叫 pow，
  // 会话却一直传死值 50——角色卡上的 POW 对理智毫无影响。
  test("初始 SAN 等于角色卡的 POW", () => {
    const session = newInvestigator("coc-wiring-san");

    expect(session.sanity.state.currentSAN).toBe(session.activeCharacter.attributes.power);
  });

  test("面板读到的 HP 与角色卡一致（世界实体已按 CoC 值建立）", () => {
    const session = newInvestigator("coc-wiring-entity");
    const char = session.activeCharacter;

    // 兜底值是 12/12；读到 12 而角色卡不是 12，说明实体没跟着角色卡建
    expect(session.getState().player.maxHp).toBe(char.maxHp);
  });
});
