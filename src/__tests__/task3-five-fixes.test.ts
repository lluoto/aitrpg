// 五项开发·任务3：小修五连（都在 game-session.ts，一趟做完）。
//
// 3a party 要带每人的状态；3b 移动成功后 narrative 陈旧；3c 未知职业应当
// 4xx 不是 500；3d 两种"没找到"要能分辨；3e 目标解析没剥中文标点。
//
// bun test src/__tests__/task3-five-fixes.test.ts

import { describe, it, expect } from "bun:test";
import { GameSession } from "../api/game-session";

const CFG = {
  apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
  model: "mock", maxTokens: 512, temperature: 0.7,
};

async function arenaAt(sceneName: string) {
  const session: any = new GameSession(`t3-${Math.random()}`, "cosmic-horror", CFG, undefined, "调查员");
  await session.act("创建角色 investigator 甲");
  await session.act("加载模组 普瑞米尔的谷仓");
  session.movePlayerToScene(sceneName);
  return session as GameSession & Record<string, any>;
}

// ============================================================
// 3a party 要带每人的状态
// ============================================================
describe("3a：getState().party 带每人的 hp/maxHp/status/san/maxSan", () => {
  it("**正确**：两个 PC，各自的 hp/san 与 world.getEntity / PartyMember.san 一致", async () => {
    const s: any = new GameSession(`t3a1-${Math.random()}`, "cosmic-horror", CFG);
    await s.act("创建角色 investigator 甲");
    await s.act("创建队友 乙 investigator");

    // p2 受伤：直接改世界实体的 hp，模拟"谁受伤了"这个此前查不到的事实
    const ent2 = s.world.getEntity("p2");
    ent2.hp = Math.max(0, ent2.hp - 5);
    ent2.status = ["流血"];
    s.world.upsertEntity(ent2);

    const st = s.getState();
    const p1 = st.party.find((m: any) => m.pcId === "p1");
    const p2 = st.party.find((m: any) => m.pcId === "p2");
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();

    const worldP1 = s.world.getEntity("p1");
    const worldP2 = s.world.getEntity("p2");
    expect(p1.hp).toBe(worldP1.hp);
    expect(p1.maxHp).toBe(worldP1.maxHp);
    expect(p2.hp).toBe(worldP2.hp);
    expect(p2.maxHp).toBe(worldP2.maxHp);
    expect(p2.status).toEqual(["流血"]);

    const partyMap: Map<string, any> = s.party;
    expect(p1.san).toBe(partyMap.get("p1").san.state.currentSAN);
    expect(p1.maxSan).toBe(partyMap.get("p1").san.state.maxSAN);
    expect(p2.san).toBe(partyMap.get("p2").san.state.currentSAN);
  });

  it("**错误行为红线**：p2 受伤后，p1 的状态不受影响——不能把伤挂错人头上", async () => {
    const s: any = new GameSession(`t3a2-${Math.random()}`, "cosmic-horror", CFG);
    await s.act("创建角色 investigator 甲");
    await s.act("创建队友 乙 investigator");
    const ent2 = s.world.getEntity("p2");
    const p1FullHp = s.world.getEntity("p1").hp;
    ent2.hp = 1;
    s.world.upsertEntity(ent2);

    const st = s.getState();
    const p1 = st.party.find((m: any) => m.pcId === "p1");
    const p2 = st.party.find((m: any) => m.pcId === "p2");
    expect(p2.hp).toBe(1);
    expect(p1.hp).toBe(p1FullHp); // 没被 p2 的伤连累
  });

  it("**文本相似但合法**：player 单数字段没被这次改动动过——仍然只反映 active PC", async () => {
    const s: any = new GameSession(`t3a3-${Math.random()}`, "cosmic-horror", CFG);
    await s.act("创建角色 investigator 甲");
    await s.act("创建队友 乙 investigator");
    const st = s.getState();
    expect(st.player.name).toBe(s.characters.get("p1").name); // 仍是 p1（active）
  });
});

// ============================================================
// 3b 移动成功后 narrative 陈旧
// ============================================================
describe("3b：移动成功后 lastNarrative 不再沿用上一轮", () => {
  it("**正确**：从维森酒吧移动去特里坎家，narrative 提到特里坎家，state.scene 真的变了", async () => {
    const session = await arenaAt("维森酒吧");
    const before = session.getState().scene;
    const res = await session.act("去特里坎家");
    expect(res.narrative).toContain("特里坎家");
    expect(res.state.scene).not.toBe(before);
  });

  it("**错误行为红线**：移动后 narrative 不能还停留在移动前的场景名上", async () => {
    const session = await arenaAt("维森酒吧");
    // 直接钉死"移动前"的陈旧内容，不依赖上一句叙事恰好提没提场景名——
    // 这样红线只测"移动成功是否如实设了新的 narrative"这一件事。
    (session as any).lastNarrative = "你还在维森酒吧里，周围弥漫着烟酒味。";
    const res = await session.act("去特里坎家");
    expect(res.narrative).not.toContain("维森酒吧");
    expect(res.narrative).toContain("特里坎家");
  });
});

// ============================================================
// 3c 未知职业应当 4xx，不是 500
// ============================================================
describe("3c：未知职业走 { rejected }，不抛异常", () => {
  it("**正确**：未知职业不抛异常，返回 rejected 且带用法提示", () => {
    const s: any = new GameSession(`t3c1-${Math.random()}`, "cosmic-horror", CFG);
    let result: any;
    expect(() => { result = s.addPartyMember("林娜", "不存在的职业id"); }).not.toThrow();
    expect("rejected" in result).toBe(true);
    expect(result.rejected).toContain("创建队友");
    expect(result.rejected).toContain("职业列表");
  });

  it("**正确**：参数顺序写反（职业, 姓名）不抛异常，仍走 rejected", () => {
    const s: any = new GameSession(`t3c2-${Math.random()}`, "cosmic-horror", CFG);
    let result: any;
    // 「创建队友 记者 林娜」误把"记者"当 name、"林娜"当 archetype
    expect(() => { result = s.addPartyMember("记者", "林娜"); }).not.toThrow();
    expect("rejected" in result).toBe(true);
    expect(result.rejected).toContain("写反");
  });

  it("**正确**：中文职业名直接可用（不必知道内部英文 id）", () => {
    const s: any = new GameSession(`t3c3-${Math.random()}`, "cosmic-horror", CFG);
    const result: any = s.addPartyMember("林娜", "记者");
    expect("rejected" in result).toBe(false);
    expect(result.member.sheet).toBeDefined();
  });

  it("**目标行为错误的对照**：已知英文 id 仍然正常工作，没有被这次改动破坏", () => {
    const s: any = new GameSession(`t3c4-${Math.random()}`, "cosmic-horror", CFG);
    const result: any = s.addPartyMember("甲", "investigator");
    expect("rejected" in result).toBe(false);
  });

  it("**文本相似但合法**：文本命令「创建队友」走同一条路，未知职业不让整回合报错中断", async () => {
    const s: any = new GameSession(`t3c5-${Math.random()}`, "cosmic-horror", CFG);
    await s.act("创建角色 investigator 甲");
    const res = await s.act("创建队友 林娜 不存在的职业");
    expect(res.error).toBeUndefined(); // act() 本身没有异常冒出来
    const sysMsgs = res.events.filter((e: any) => e.type === "system").map((e: any) => e.content);
    expect(sysMsgs.some((c: string) => c.includes("职业列表") || c.includes("未知职业"))).toBe(true);
  });
});

// ============================================================
// 3d 两种"没找到"要能分辨
// ============================================================
describe("3d：匹配不上 vs 检定失败，两种'没找到'不能读起来一样", () => {
  it("**正确**：给了具体但对不上任何线索的提示 → '这里没什么特别的'（匹配层拒绝，没进检定）", async () => {
    const session = await arenaAt("加比的拖车房");
    const real = Math.random;
    Math.random = () => 0; // 掷骰恒定成功，排除"实际是检定失败"的可能
    try {
      const res = await session.act("侦查衣柜");
      expect(res.narrative).toBe("这里没什么特别的");
    } finally { Math.random = real; }
  });

  it("**正确**：提示对上了线索，但骰子没过 → 检定失败的措辞，且不等于'这里没什么特别的'", async () => {
    const session = await arenaAt("加比的拖车房");
    const real = Math.random;
    Math.random = () => 0.999; // 逼骰子接近满值，让技能检定大概率失败
    try {
      const res = await session.act("侦查床底");
      expect(res.narrative).not.toBe("这里没什么特别的");
      expect(res.narrative).toContain("没能看出什么名堂");
    } finally { Math.random = real; }
  });

  it("**错误行为红线**：两种'没找到'必须是不同的字符串——不能因为改措辞改出巧合相同", async () => {
    const session1 = await arenaAt("加比的拖车房");
    const real = Math.random;
    try {
      Math.random = () => 0;
      const noMatch = await session1.act("侦查衣柜");
      const session2 = await arenaAt("加比的拖车房");
      Math.random = () => 0.999;
      const checkFail = await session2.act("侦查床底");
      expect(noMatch.narrative).not.toBe(checkFail.narrative);
    } finally { Math.random = real; }
  });
});

// ============================================================
// 3e 目标解析没剥中文标点
// ============================================================
describe("3e：handleTalk 的目标解析剥掉首尾中文标点", () => {
  function makeMsgSink() {
    const messages: any[] = [];
    const msg = (s: string) => { messages.push(s); return messages.length; };
    return { messages, msg };
  }

  it("**正确**：target 带尾随逗号时，回显的 key 不再含逗号", async () => {
    const session = await arenaAt("普瑞米尔");
    const { messages, msg } = makeMsgSink();
    await (session as any).handleTalk({ action: "talk", target: "附近店铺，" } as any, "", [], msg);
    const joined = messages.join("\n");
    expect(joined).toContain("附近店铺");
    expect(joined).not.toContain("附近店铺，");
  });

  it("**目标行为错误的对照**：干净的 target（没有标点）行为不变，仍能正常报'没有这个人'", async () => {
    const session = await arenaAt("普瑞米尔");
    const { messages, msg } = makeMsgSink();
    await (session as any).handleTalk({ action: "talk", target: "路人甲" } as any, "", [], msg);
    const joined = messages.join("\n");
    expect(joined).toContain("路人甲");
  });

  it("**文本相似但合法**：中间夹标点的名字不受影响（只剥首尾，不剥中间）", async () => {
    const session = await arenaAt("普瑞米尔");
    const { messages, msg } = makeMsgSink();
    await (session as any).handleTalk({ action: "talk", target: "老王·二号" } as any, "", [], msg);
    const joined = messages.join("\n");
    expect(joined).toContain("老王·二号");
  });
});
