// 五项开发（第二轮）·任务3：检定失败要能被玩家读出来。
//
// 问题 A：线索路（resolveSceneClueMatch 的 resolve/fallback/ask/deny 四个
// 分支）全部提前 return，够不到通用检定路的骰子播报，同一句"侦查X"走
// 哪条路决定了看不看得见骰子。
// 问题 B：上一轮把"匹配不上"与"检定失败"的措辞改成两句不同的话，通过了
// 单测（断言"字符串不同"），但实跑报告仍判"玩家不知道是场景无物还是
// 检定失败"——单测测的是"两句话不同"，实跑测的是"读者分不分得清"，
// 两者不一致时以读者为准，这条算没修完。
//
// 方案：①+②。①线索路失败时也播骰子（🎲 …d100=…→失败），格式与通用
// 检定路一致；②骰子播报本身就是"检定结果"的明确表述，不依赖玩家记住
// 两句话哪句代表哪种含义。只改可见性与措辞，不改判定逻辑（成功率、
// 目标值、线索归属一律不动）。
//
// bun test src/__tests__/clue-check-failure-visible.test.ts

import { describe, it, expect } from "bun:test";
import { GameSession } from "../api/game-session";

const CFG = {
  apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
  model: "mock", maxTokens: 512, temperature: 0.7,
};

async function arenaAt(sceneName: string) {
  const session: any = new GameSession(`t3b-${Math.random()}`, "cosmic-horror", CFG, undefined, "调查员");
  await session.act("创建角色 investigator 甲");
  await session.act("加载模组 普瑞米尔的谷仓");
  session.movePlayerToScene(sceneName);
  return session as GameSession & Record<string, any>;
}

/** 判据：这条输出是否含"区分性信息"——检定结果（d100 骰子）或明确的检定失败表述。 */
function hasDistinguishingCheckInfo(text: string): boolean {
  return /d100\s*=\s*\d+/.test(text) || /检定/.test(text);
}

describe("问题A：线索路检定失败也能看见骰子", () => {
  it("**正确**：提示对上了线索但骰子没过 → 输出含 d100 骰子信息（🎲 …检定 d100=… → 失败）", async () => {
    const session = await arenaAt("加比的拖车房");
    const real = Math.random;
    Math.random = () => 0.999; // 逼技能检定大概率失败
    try {
      const res = await session.act("侦查床底");
      expect(res.narrative).toMatch(/d100\s*=\s*\d+/);
      expect(res.narrative).toContain("🎲");
      expect(res.narrative).toContain("失败");
    } finally { Math.random = real; }
  });

  it("**目标行为错误的对照**：检定成功时输出一个字不变——不多出骰子行，不改措辞", async () => {
    const session = await arenaAt("加比的拖车房");
    const real = Math.random;
    Math.random = () => 0; // 逼成功
    try {
      const res = await session.act("侦查床底");
      expect(res.narrative).not.toContain("🎲");
      expect(res.narrative).toMatch(/手枪/); // 成功揭示文本原样
    } finally { Math.random = real; }
  });

  it("**错误行为红线**：通用检定路（无场景线索时的裸检定）与线索路失败，两者都能看见骰子——不是只有一条路播报", async () => {
    // 通用路的骰子播报本来就只进 events（msg() 里的那条），不进 narrative
    // （lastNarrative 只是一句摘要，见 handleSkillCheck 原有实现）——这条
    // 红线守住的是"两条路都有骰子播报"，不是两条路的字段落点一致。
    const session: any = new GameSession(`t3b-generic-${Math.random()}`, "cosmic-horror", CFG);
    await session.act("创建角色 investigator 甲");
    const res = await session.act("侦查一下四周");
    const eventsText = res.events.map((e: any) => e.content).join("\n");
    expect(eventsText).toContain("🎲");
  });
});

describe("问题B：匹配不上 vs 检定失败，两种'没找到'读者能分辨（不只是字符串不同）", () => {
  it("**正确**：检定失败的输出含区分性信息（d100 或「检定」字样），匹配不上的输出不含", async () => {
    const sFail = await arenaAt("加比的拖车房");
    const real = Math.random;
    let checkFailNarrative = "";
    let noMatchNarrative = "";
    try {
      Math.random = () => 0.999;
      checkFailNarrative = (await sFail.act("侦查床底")).narrative;

      const sNoMatch = await arenaAt("加比的拖车房");
      Math.random = () => 0; // 排除"实际是检定失败"的可能——衣柜没有对应线索，走的是匹配层拒绝
      noMatchNarrative = (await sNoMatch.act("侦查衣柜")).narrative;
    } finally { Math.random = real; }

    expect(hasDistinguishingCheckInfo(checkFailNarrative)).toBe(true);
    expect(hasDistinguishingCheckInfo(noMatchNarrative)).toBe(false);
  });

  it("**文本相似但合法**：两句话本身仍然不同（上一轮的判据没有被推翻，只是不够，这里是加强不是替换）", async () => {
    const sFail = await arenaAt("加比的拖车房");
    const real = Math.random;
    try {
      Math.random = () => 0.999;
      const checkFail = await sFail.act("侦查床底");
      const sNoMatch = await arenaAt("加比的拖车房");
      Math.random = () => 0;
      const noMatch = await sNoMatch.act("侦查衣柜");
      expect(checkFail.narrative).not.toBe(noMatch.narrative);
    } finally { Math.random = real; }
  });
});
