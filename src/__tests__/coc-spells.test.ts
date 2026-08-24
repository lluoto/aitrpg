// CoC 神话法术集成测试 — 离线模式（MockLLM）
// bun test src/__tests__/coc-spells.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";
import { MYTHOS_TOMES } from "../rules/mythos-expansion";


let session: GameSession;

beforeEach(() => {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  session = new GameSession("spell-test", "cosmic-horror", {
    apiKey: "sk-placeholder",
    baseUrl: "http://localhost:9999",
    model: "mock",
    maxTokens: 1024,
    temperature: 0.7,
  }, undefined, "调查员");
});

// ============================================================
// 神话典籍阅读
// ============================================================

describe("神话典籍阅读", () => {
  it("阅读死灵之书应触发 SAN 检定并学会法术", async () => {
    const res = await session.act("阅读死灵之书");
    expect(res).toBeDefined();

    // 应有 SAN 损失事件
    const sanEvent = res.events.find(e => e.content.includes("SAN"));
    expect(sanEvent).toBeDefined();

    // 应有学会法术的提示
    const learnEvent = res.events.find(e =>
      e.content.includes("学会") || e.content.includes("领悟") || e.content.includes("法术")
    );
    expect(learnEvent).toBeDefined();
  });

  it("两次阅读死灵之书不崩溃", async () => {
    const res1 = await session.act("阅读死灵之书");
    const res2 = await session.act("阅读死灵之书");
    expect(res1).toBeDefined();
    expect(res2).toBeDefined();
  });

  it("阅读全部 5 本典籍均触发 SAN 检定和 CM 成长", async () => {
    // 标题说「全部 5 本」，那就先确认典籍表真的是 5 本 ——
    // 手写的名单和真实数据分叉时，这条会红在该红的地方。
    expect(MYTHOS_TOMES.length).toBe(5);
    const allTomes = ["死灵之书", "无名祭祀书", "黄衣之王", "塞拉伊诺断章", "阿卡姆特集"];
    // 将额外典籍加入当前场景
    const items: string[] = (session as any).sceneItems.get("farm_exterior") ?? [];
    for (const t of allTomes) {
      if (!items.includes(t)) items.push(t);
    }

    for (const tome of allTomes) {
      const res = await session.act(`阅读${tome}`);
      // 消费事件列表（可能有 SAN + 系统两条事件）
      const content = res.events.map(e => e.content).join("\n");
      expect(content).toMatch(/SAN/);
      expect(content).toMatch(/克苏鲁神话技能提升/);
    }
  });

  it("阿卡姆特集无法术可学但触发 CM 成长", async () => {
    const items: string[] = (session as any).sceneItems.get("farm_exterior") ?? [];
    if (!items.includes("阿卡姆特集")) items.push("阿卡姆特集");

    const res = await session.act("阅读阿卡姆特集");
    const content = res.events.map(e => e.content).join("\n");
    expect(content).toMatch(/克苏鲁神话技能提升/);
    // 阿卡姆特集无法术，不应出现"学会了"字样
    expect(content).not.toMatch(/领悟/);
  });

  it("死灵之书阅读可选法术较多（7 个注册到 ensureSpellRegistered）", async () => {
    const items: string[] = (session as any).sceneItems.get("farm_exterior") ?? [];
    if (!items.includes("死灵之书")) items.push("死灵之书");

    const res = await session.act("阅读死灵之书");
    const content = res.events.map(e => e.content).join("\n");
    // 应有法术学习事件
    expect(content).toMatch(/法术|领悟/);
  });

  it("阅读时的典籍列举：场景中有典籍但未指定时列出", async () => {
    // 让场景中没有典籍，只保留普通物品
    // 先清除，再加入一个非典籍物品
    const items: string[] = (session as any).sceneItems.get("farm_exterior") ?? [];
    // 确保场景中至少有 1 个非典籍物品
    if (!items.includes("铁制钥匙")) items.push("铁制钥匙");
    // 移除所有典籍
    const toRemove = ["死灵之书", "无名祭祀书", "黄衣之王", "塞拉伊诺断章", "阿卡姆特集"];
    for (const t of toRemove) {
      const idx = items.indexOf(t);
      if (idx >= 0) items.splice(idx, 1);
    }
    // 读一个不在典籍表中的物品
    const res = await session.act("阅读铁制钥匙");
    // 不应提示"这里有典籍"，因为铁制钥匙不是典籍
    const content = res.events.map(e => e.content).join("\n");
    expect(content).not.toMatch(/这里有/);
  });
});

// ============================================================
// 剧本杀模组导入
// ============================================================

describe("剧本杀模组导入", () => {
  it("加载模组命令不崩溃", async () => {
    const res = await session.act("加载模组");
    expect(res).toBeDefined();
    const content = res.events.map(e => e.content).join("\n");
    // 应有可用模组列表或提示
    expect(content).toMatch(/模组|已加载/);
  });

  it("从自定义模组库加载模组后应注册法术并放置物品", async () => {
    const res = await session.act("加载模组 普瑞米尔的谷仓");
    expect(res).toBeDefined();
    const content = res.events.map(e => e.content).join("\n");
    expect(content).toMatch(/注册|放置|生成|已加载/);

    // 法术应已注册
    const spellMap: Map<string, any> = (session as any).mythosSpells;
    expect(spellMap.has("僵尸创造术")).toBe(true);
  });

  it("同一个模组不应重复加载", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    const res2 = await session.act("加载模组 普瑞米尔的谷仓");
    const content = res2.events.map(e => e.content).join("\n");
    expect(content).toMatch(/已导入/);
  });

  it("加载模组后应真的建成场景出口，而不是降级成一行警告", async () => {
    // 出口连接靠宿主提供数据库能力。宿主适配器少给这个能力时，
    // 加载器会把异常吞成 "⚠️ 场景出口连接失败"，模组场景之间从此走不通，
    // 而类型检查和其余用例都照样通过——所以这里必须直接盯住结果。
    const res = await session.act("加载模组 普瑞米尔的谷仓");
    const content = res.events.map(e => e.content).join("\n");
    expect(content).not.toMatch(/场景出口连接失败/);
    expect(content).toMatch(/构建 \d+ (?:条模组场景显式出口|个模组场景出口)/);
  });
});

// ============================================================
// 神话法术施放
// ============================================================

describe("神话法术施放", () => {
  it("未学会法术时施放给出提示", async () => {
    const res = await session.act("吟唱克苏鲁的咒语");
    expect(res).toBeDefined();
    expect(res.events.length).toBeGreaterThan(0);
    // 应有某种提示：未学会 / 未创建角色 / 不知
    const hasMessage = res.events.some(e =>
      e.content.includes("未学会") || e.content.includes("尚未") ||
      e.content.includes("不知") || e.content.includes("角色") ||
      e.content.includes("法术")
    );
    expect(hasMessage).toBe(true);
  });

  it("阅读后施放神话法术不崩溃", async () => {
    // 多次阅读死灵之书学会多个法术
    for (let i = 0; i < 5; i++) {
      await session.act("阅读死灵之书");
    }

    // 尝试各种法术调用，不应崩溃
    const casts = ["吟唱呼唤米戈的咒语", "吟唱放逐术的咒语", "吟唱克苏鲁之眼"];
    for (const castInput of casts) {
      const res = await session.act(castInput);
      expect(res).toBeDefined();
    }
  });

  it("非 CoC 模式下神话法术无法施放", async () => {
    const dndSession = new GameSession("dnd-spell-test", "dnd5e", {
      apiKey: "sk-placeholder",
      baseUrl: "http://localhost:9999",
      model: "mock",
      maxTokens: 1024,
      temperature: 0.7,
    }, "fighter", "战士甲");

    const res = await dndSession.act("吟唱米戈的咒语");
    const errEvent = res.events.find(e =>
      e.content.includes("仅支持") || e.content.includes("不支持")
    );
    expect(errEvent).toBeDefined();
  });
});

// ============================================================
// 放逐术效果
// ============================================================

describe("放逐术", () => {
  it("放逐术不崩溃", async () => {
    // 多次阅读直到学会法术
    for (let i = 0; i < 10; i++) {
      await session.act("阅读死灵之书");
    }

    // 驱逐咒语不崩溃
    const res = await session.act("驱逐米戈");
    expect(res).toBeDefined();
  });
});

// ============================================================
// D&D 法术不受影响
// ============================================================

describe("D&D 法术不受神话法术影响", () => {
  it("D&D 模式下施法仍正常运作", async () => {
    const dndSession = new GameSession("dnd-cast-test", "dnd5e", {
      apiKey: "sk-placeholder",
      baseUrl: "http://localhost:9999",
      model: "mock",
      maxTokens: 1024,
      temperature: 0.7,
    }, "wizard", "法师甲");

    // D&D 法术列表仍可用
    const res = await dndSession.act("法术列表");
    expect(res).toBeDefined();
  });
});
