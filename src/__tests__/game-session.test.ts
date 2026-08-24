// GameSession 集成测试 — 全流程离线模式（MockLLM）
// bun test src/__tests__/game-session.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";
import { CareerFileStore } from "../character/career-file";
import type { CharacterSnapshot } from "../character/career";
import * as fs from "fs";
import * as path from "path";

let session: GameSession;

beforeEach(() => {
  // 确保每个测试获得新的 GameSession（cosmic-horror, 无 archetype, 默认 LLM key → MockLLM）
  // 将环境变量临时置空触发 MockLLM
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  session = new GameSession("test-session", "cosmic-horror", {
    apiKey: "sk-placeholder",
    baseUrl: "http://localhost:9999",
    model: "mock",
    maxTokens: 1024,
    temperature: 0.7,
  }, undefined, "调查员");
});

// ============================================================
// 会话生命周期
// ============================================================

describe("GameSession 生命周期", () => {
  it("创建会话后有有效 ID 和回合数", () => {
    expect(session.id).toBe("test-session");
    expect(session.round).toBe(0);
  });

  it("getSummary 返回基本信息", () => {
    const summary = session.getSummary();
    expect(summary.id).toBe("test-session");
    expect(summary.ruleset).toBe("cosmic-horror");
    expect(summary.round).toBe(0);
  });

  it("新会话玩家在场", () => {
    const state = session.getState();
    expect(state.player.name).toBe("调查员");
    expect(state.player.hp).toBeGreaterThan(0);
  });
});

// ============================================================
// 基础交互
// ============================================================

describe("基础交互", () => {
  it("观察返回场景描述", async () => {
    const res = await session.act("观察");
    expect(res.narrative).toBeDefined();
    expect(res.narrative.length).toBeGreaterThan(0);
    expect(res.events.length).toBeGreaterThan(0);
  });

  it("帮助返回操作指南", async () => {
    const res = await session.act("帮助");
    expect(res.narrative).toContain("操作指南");
  });

  it("状态返回角色信息（无角色时返回提示）", async () => {
    const res = await session.act("状态");
    // 无角色推送给 turnMessages, narrative 可能为空
    // 验证 events 中有内容即可
    expect(res.events.length).toBeGreaterThan(0);
    const statusEvent = res.events.find(e => e.speaker === "系统");
    expect(statusEvent).toBeDefined();
    expect(statusEvent!.content.length).toBeGreaterThan(0);
  });

  it("背包返回物品信息", async () => {
    // 原先只断言 `narrative` 存在 —— 那个字段永远存在，等于没验。
    // 实跑：空背包时叙述是「你的背包里空空如也」。
    const res = await session.act("背包");
    expect(res.narrative).toContain("背包");
    expect(res.events.some((e) => e.content.includes("背包"))).toBe(true);
  });

  it("每回合 ID 递增", async () => {
    await session.act("观察");
    expect(session.round).toBe(1);
    await session.act("观察");
    expect(session.round).toBe(2);
  });
});

// ============================================================
// 移动
// ============================================================

describe("移动", () => {
  it("移动到谷仓", async () => {
    const res = await session.act("移动到谷仓");
    expect(res.state.scene).toBe("barn_interior");
  });

  it("去地下室会给出移动叙述", async () => {
    // 需要先进入谷仓才能到地下室
    await session.act("移动到谷仓");
    const res = await session.act("去地下室");
    // 原注释写「可能 locked，不应崩溃」，于是只验没崩。
    // 实跑：叙述是「你走向了地下室。」—— 移动叙述是稳定给出的，可判。
    expect(res.narrative).toContain("地下室");
  });
});

// ============================================================
// SAN 检定
// ============================================================

describe("SAN 检定", () => {
  it("SAN 检定返回结果", async () => {
    const res = await session.act("SAN检定");
    const sanEvent = res.events.find(e => e.content.includes("SAN"));
    expect(sanEvent).toBeDefined();
  });

  it("理智检定返回结果", async () => {
    const res = await session.act("理智检定");
    const sanEvent = res.events.find(e => e.content.includes("SAN"));
    expect(sanEvent).toBeDefined();
  });

  it("多次 SAN 检定后 SAN 值下降", async () => {
    // SAN 不在 getState() 里，它由 getSanity() 单独返回。
    // 原先读的是 state.sanity?.currentSAN ?? 55 —— 那个字段从来不存在，
    // 两边都落到兜底的 55，断言退化成 55 <= 55，SAN 就算纹丝不动也照样通过。
    const sanBefore = session.getSanity().currentSAN;

    // 多次检定
    for (let i = 0; i < 10; i++) {
      await session.act("SAN检定");
    }

    const sanAfter = session.getSanity().currentSAN;
    expect(sanAfter).toBeLessThanOrEqual(sanBefore);
  });
});

// ============================================================
// 考察
// ============================================================

describe("考察", () => {
  it("调查物体触发调查检查", async () => {
    // 实跑：叙述是「调查检查 大失败！」——「触发了检查」可判，不必只验没崩。
    const res = await session.act("调查");
    expect(res.narrative).toContain("调查检查");
  });

  it("侦查房间触发侦查检查", async () => {
    // ⚠ 断言字面要照抄实现。我第一版写「侦查检定」，红了 ——
    //   实际输出是「侦查检**查**」（`${skillDisplay}检查 ${resultText}。`）。
    //   终端把中文 mojibake 成一片问号，看不出差别，最后是打码位才认出来的：
    //   4fa6 67e5 68c0 67e5 = 侦 查 检 查。
    //   顺带记一笔：CoC 的行话是「检定」，这里全写成了「检查」——
    //   要统一是文案决定，不在这轮顺手改。
    const res = await session.act("侦查房间");
    expect(res.narrative).toContain("侦查检查");
  });

  it("阅读某物给出翻阅叙述", async () => {
    const res = await session.act("阅读日记");
    expect(res.narrative).toContain("翻阅");
    expect(res.narrative).toContain("日记");
  });
});

// ============================================================
// 战斗
// ============================================================

describe("战斗（CoC 模式）", () => {
  it("攻击操作不崩溃", async () => {
    const res = await session.act("攻击敌人");
    // 可能无目标, 但不应抛异常
    expect(res).toBeDefined();
  });

  it("战斗后 round 递增", async () => {
    const roundBefore = session.round;
    await session.act("攻击敌人");
    expect(session.round).toBeGreaterThan(roundBefore);
  });

  it("逃跑成功", async () => {
    const res = await session.act("逃跑");
    expect(res.narrative).toContain("逃跑");
  });
});

// ============================================================
// 死亡
// ============================================================

describe("死亡处理", () => {
  it("死亡后操作返回死亡消息", async () => {
    session.dead = true;
    const res = await session.act("观察");
    expect(res.dead).toBe(true);
    expect(res.events.length).toBeGreaterThan(0);
    const deathEvent = res.events.find(e => e.content.includes("死"));
    expect(deathEvent).toBeDefined();
  });
});

// ============================================================
// CoC 装填弹药
// ============================================================

describe("CoC 装填弹药", () => {
  it("装填指令不崩溃", async () => {
    const res = await session.act("装填 .38左轮");
    expect(res).toBeDefined();
  });

  // ⚠ 这条原先叫「装填后状态显示弹药」，断言只有 `expect(res.narrative).toBeDefined()`。
  //   实跑之后发现**它许诺的事根本不存在**：
  //     · 测试自己压根没执行「装填」
  //     · `状态` 的输出只有 职业 / HP / SAN，没有任何弹药
  //     · game-session 里**没有弹药状态** —— 全文只有两处提到弹药，
  //       一处是帮助文本，一处是 handleReload 里那句「弹药已补满」。
  //       也就是说 `装填` 只是打印一句话，什么都没记。
  //
  //   所以改成断言**真实发生的事**，标题也跟着改。要真做弹药，
  //   得先有状态可记 —— 那是功能，不是这轮清理该顺手加的。
  it("状态显示职业与 HP/SAN（弹药目前不在状态里）", async () => {
    // 没角色时 `状态` 只会说「尚未创建角色」—— 前提得先建立，
    // 否则断言的是另一条分支（这也是上一轮「休息触发成长」那条踩过的坑）。
    // 名字别带「弹药」二字 —— 会把下面那条 not.toContain 绊倒。
    // （第一版就是这么红的：角色名叫「弹药测试员」，状态里当然含「弹药」。）
    await session.act("创建角色 investigator 周文");
    const res = await session.act("状态");
    const text = res.events.map((e) => e.content).join(" ");
    expect(text).toContain("HP");
    expect(text).toContain("SAN");
    expect(text).not.toContain("弹药");
  });

  it("**错误行为的红线**：状态里不得出现 [object Object]", async () => {
    // 把上面那条断言写实之后，实跑输出里看见了 `DB:[object Object]`。
    // `calcDamageBonus(str, siz)` 返回的是 `{ db, build }` 对象，
    // 而状态行直接把它插进了模板串 —— 玩家看到的就是这七个字。
    // 顺带：build 在那儿又按 STR+SIZ 手算了一遍，同一件事两套算法，
    // 而对象里本来就带着 build。删掉手算那份，用返回值。
    await session.act("创建角色 investigator 周文");
    const res = await session.act("状态");
    const text = res.events.map((e) => e.content).join(" ");
    expect(text).not.toContain("[object Object]");
    expect(text).toMatch(/DB:\s*[+-]?\d*d?\d/); // 形如 DB:+1d4 / DB:0
  });
});

// ============================================================
// CoC 燃运
// ============================================================

describe("CoC 燃运", () => {
  it("燃运5 攻击不崩溃", async () => {
    const res = await session.act("燃运5 攻击敌人");
    expect(res).toBeDefined();
  });

  // ⚠ 这条原先叫「燃运过多被拒绝」，只断言 res 存在。实跑之后发现
  //   **它许诺的拒绝根本没发生**：「燃运999 攻击敌人」这句压根没被识别成命令，
  //   narrative 停在上一条的内容，事件里只有原样回显的输入。
  //
  //   幸运不足的拒绝逻辑是有的（`💫 幸运不足！`），但走的是意图解析出
  //   `luckSpend` 的攻击路径 —— 「燃运999」这种写法解析不出来。
  //   究竟该支持哪种写法是产品决定，不在这轮顺手改；先让测试说实话。
  it("「燃运999 攻击敌人」这种写法目前解析不出燃运意图", async () => {
    const res = await session.act("燃运999 攻击敌人");
    expect(res.events.some((e) => e.content.includes("燃运999"))).toBe(true);
    expect(res.events.some((e) => e.content.includes("幸运不足"))).toBe(false);
  });
});

// ============================================================
// CoC 急救
// ============================================================

describe("CoC 急救", () => {
  it("急救伤口不崩溃", async () => {
    const res = await session.act("急救伤口");
    expect(res).toBeDefined();
  });

  it("包扎伤势不崩溃", async () => {
    const res = await session.act("包扎伤势");
    expect(res).toBeDefined();
  });
});

// ============================================================
// CoC 推动检定
// ============================================================

describe("CoC 推动检定", () => {
  it("直接推动无待检定时不崩溃", async () => {
    const res = await session.act("推动");
    expect(res).toBeDefined();
  });
});

// ============================================================
// D&D 模式
// ============================================================

describe("D&D 5e 模式", () => {
  let dndSession: GameSession;

  beforeEach(() => {
    dndSession = new GameSession("dnd-test", "dnd5e", {
      apiKey: "sk-placeholder",
      baseUrl: "http://localhost:9999",
      model: "mock",
      maxTokens: 1024,
      temperature: 0.7,
    }, "fighter", "战士甲");
  });

  it("D&D 模式状态不显示 SAN", async () => {
    const res = await dndSession.act("状态");
    expect(res.narrative).toContain("AC:");
    expect(res.narrative).not.toContain("SAN:");
  });

  it("D&D 豁免检定不崩溃", async () => {
    const res = await dndSession.act("体质豁免");
    expect(res).toBeDefined();
    const saveEvent = res.events.find(e => e.content.includes("豁免"));
    expect(saveEvent).toBeDefined();
  });

  it("D&D 豁免显示正确结构", async () => {
    const res = await dndSession.act("力量豁免对抗毒素");
    const saveEvent = res.events.find(e => e.content.includes("豁免"));
    expect(saveEvent).toBeDefined();
    // 力量豁免对抗毒素 -> 通用 pattern (豁免+对抗毒素) 先匹配 -> CON 豁免
    expect(saveEvent!.content).toMatch(/豁免/);
  });

  it("D&D 战斗不崩溃", async () => {
    const res = await dndSession.act("攻击哥布林");
    expect(res).toBeDefined();
  });
});

// ============================================================
// CoC 追逐
// ============================================================

describe("CoC 追逐", () => {
  let chaseSession: GameSession;

  beforeEach(() => {
    process.env.LLM_API_KEY = "";
    process.env.OPENAI_API_KEY = "";
    chaseSession = new GameSession("chase-test", "cosmic-horror", {
      apiKey: "sk-placeholder",
      baseUrl: "http://localhost:9999",
      model: "mock",
      maxTokens: 1024,
      temperature: 0.7,
    }, undefined, "调查员");
  });

  it("追逐指令不崩溃", async () => {
    // 先进入战斗状态，然后逃跑启动追逐
    const res = await chaseSession.act("追");
    // 可能无激活追逐，但不抛异常
    expect(res).toBeDefined();
  });

  it("跑触发追逐行动", async () => {
    // 原先只断言 res 存在。实跑：叙述是「追逐: 你成功拉开了距离！」——
    // 「触发追逐」这件事是可判的，没有理由只验没崩。
    const res = await chaseSession.act("跑");
    expect(res.narrative).toContain("追逐");
  });

  it("没有战斗时「逃跑」直接脱离，不启动追逐", async () => {
    // 原标题带着「如果有战斗」的条件却不建立那个条件，断言也只验没崩。
    // 实跑：无战斗时叙述是「你转身逃跑，迅速脱离了战斗」。
    // 有战斗那一支要另立用例、先把战斗打起来，不是在这条里含糊带过。
    const res = await chaseSession.act("逃跑");
    expect(res.narrative).toContain("脱离");
  });

  it("多次追逐回合不崩溃", async () => {
    // 测试多个"跑"回合
    for (let i = 0; i < 5; i++) {
      const res = await chaseSession.act("跑");
      expect(res).toBeDefined();
    }
  });
});

// ============================================================
// CoC 技能成长
// ============================================================

describe("CoC 技能成长", () => {
  let growthSession: GameSession;

  beforeEach(() => {
    process.env.LLM_API_KEY = "";
    process.env.OPENAI_API_KEY = "";
    growthSession = new GameSession("growth-test", "cosmic-horror", {
      apiKey: "sk-placeholder",
      baseUrl: "http://localhost:9999",
      model: "mock",
      maxTokens: 1024,
      temperature: 0.7,
    }, undefined, "调查员");
  });

  it("调查失败后 skillMarks 记录存在", async () => {
    // 多次调查以累积失败
    for (let i = 0; i < 10; i++) {
      await growthSession.act("调查尸体");
    }
    // skillMarks 对象应存在（可能为空取决于所有检定都通过了）
    expect(growthSession.skillMarks).toBeDefined();
    expect(typeof growthSession.skillMarks).toBe("object");
  });

  it("休息时触发技能成长检定", async () => {
    // 先累积足够的失败次数
    for (let i = 0; i < 6; i++) {
      await growthSession.act("调查书桌");
    }
    // 休息应该触发技能成长
    // ⚠ 这条原先是**空心的**：filter 出成长消息却不看它，只断言
    //   `res.events.length > 0`，注释写「可能有成长消息（取决于随机检定结果）」。
    //   实测 10 次休息**一次都没有**成长消息 —— 不是随机，是**前提没建立**：
    //   CoC 7e 的规则是「技能检定**失败**才留成长标记」（见 game-session
    //   记录标记那一处），而这个测试休息之前从没失败过任何检定。
    //   也就是说它断言的那件事根本不会发生，只是断言写得太松没露馅。
    //
    //   把前提补上：`handleRest` 在没有 activeCharacter 时会**直接早退**
    //   （它连成长那一段都到不了），所以先建角色，再塞一个成长标记。
    await growthSession.act("创建角色 investigator 成长测试员");
    growthSession.skillGrowthMarks.push("spot_hidden");
    const res = await growthSession.act("休息");
    const growthEvents = res.events.filter(
      e => e.content.includes("技能成长") || e.content.includes("成长检查")
    );
    expect(growthEvents.length).toBeGreaterThan(0);
    // 结算完标记要清空，否则下次休息会拿同一个标记再涨一次
    expect(growthSession.skillGrowthMarks).toEqual([]);
  });
});

// ============================================================
// 故事生成器集成
// ============================================================
describe("故事生成器集成", () => {
  it("生成故事替换世界场景和实体", async () => {
    const res = await session.act("生成故事");
    expect(res).toBeDefined();
    const allContent = res.events.map(e => e.content).join(" ");
    expect(allContent).toContain("新故事已生成");
    expect(allContent).toContain("场景");
    // 场景数应 > 0
    expect(session["sceneDisplayNames"]).toBeDefined();
    expect(Object.keys(session["sceneDisplayNames"]).length).toBeGreaterThan(1);
    // 别名应存在
    expect(Object.keys(session["sceneAliases"]).length).toBeGreaterThan(1);
  });

  it("生成故事后观察有场景描述", async () => {
    await session.act("生成故事");
    const lookRes = await session.act("观察");
    expect(lookRes.narrative).toBeDefined();
    expect(lookRes.narrative.length).toBeGreaterThan(0);
  });

  it("多次生成不会抛异常", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await session.act("生成故事");
      expect(res).toBeDefined();
    }
  });
});

// ============================================================
// CoC 角色创建
// ============================================================

describe("CoC 角色创建", () => {
  it("职业列表返回职业信息", async () => {
    const res = await session.act("职业列表");
    expect(res.events.length).toBeGreaterThan(0);
    const event = res.events.find(e => e.content.includes("调查员职业"));
    expect(event).toBeDefined();
    expect(event!.content).toContain("考古学家");
  });

  it("创建角色（无职业参数）提示选择", async () => {
    const res = await session.act("创建角色");
    const event = res.events.find(e => e.content.includes("请指定职业"));
    expect(event).toBeDefined();
  });

  // ⚠ 下面这四条原先都是**空心的**：算出了要检查的 event，然后一行不看它，
  //   只 `expect(res).toBeDefined()` —— 一个永远为真的命题。
  //   测试名写着「成功」「提示不支持」，实际什么都没验。
  //
  //   是 tsc 的 noUnusedLocals 报出来的（`'event' is declared but its value is
  //   never read`）。它们照样计入 docs/test-baseline.json，
  //   而**测试条数是这个仓库唯一可靠的回归信号** —— 空心测试直接污染信号。
  //
  //   实跑确认过：这四个行为本来就是好的，断言写实就能过，没有一条需要迁就。

  it("创建角色 investigator 张三 成功", async () => {
    const res = await session.act("创建角色 investigator 张三");
    expect(res.events.some(e => e.content.includes("角色创建完成"))).toBe(true);
    expect(res.events.some(e => e.content.includes("张三"))).toBe(true);
  });

  it("创建角色后状态显示自定义姓名", async () => {
    await session.act("创建角色 investigator 张三");
    const statusRes = await session.act("状态");
    expect(statusRes.events.some(e => e.content.includes("张三"))).toBe(true);
  });

  it("D&D 模式下职业列表提示不支持", async () => {
    const dndSession = new GameSession("dnd-test", "dnd5e", {
      apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
      model: "mock", maxTokens: 1024, temperature: 0.7,
    });
    const res = await dndSession.act("职业列表");
    expect(res.events.some(e => e.content.includes("当前不是宇宙恐怖模式"))).toBe(true);
  });

  it("创建角色时指定非法职业提示选择", async () => {
    const res = await session.act("创建角色 nonexistent_job 测试");
    expect(res.events.some(e =>
      e.content.includes("请指定职业") || e.content.includes("创建失败"))).toBe(true);
    // 失败原因要说清是哪个职业名不认识，不能只说一句「失败了」
    expect(res.events.some(e => e.content.includes("nonexistent_job"))).toBe(true);
  });
});

// ============================================================
// CoC 商店购买/出售
// ============================================================

describe("CoC 商店购买/出售", () => {
  it("购买要说清是「没做商店」，而不是「这家店碰巧没货」", async () => {
    // ⚠ 原先断言的是「没有找到」，配套的实现回「当前商店可能没有此物品」。
    //   那句话把「商店尚未实现」说成了「换一家也许有」—— 玩家会去别处找，
    //   而哪儿都没有。桩可以「没做」，但不能报告一件没发生的事。
    const res = await session.act("购买 不存在的物品");
    const text = res.events.map(e => e.content).join("\n");
    expect(text).toContain("尚未实现");
    expect(text).not.toContain("当前商店可能没有");
  });

  it("购买空指令提示指定物品", async () => {
    const res = await session.act("购买");
    const event = res.events.find(e => e.content.includes("你想买什么"));
    expect(event).toBeDefined();
  });

  it("出售空指令提示指定物品", async () => {
    const res = await session.act("出售");
    const event = res.events.find(e => e.content.includes("你想卖什么"));
    expect(event).toBeDefined();
  });

  it("出售不存在的物品提示未找到", async () => {
    const res = await session.act("出售 不存在的东西");
    const event = res.events.find(e => e.content.includes("没有"));
    expect(event).toBeDefined();
  });

  it("D&D 模式下购买落到同一句——购买没有任何规则集判断", async () => {
    const dndSession = new GameSession("dnd-buy-test", "dnd5e", {
      apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
      model: "mock", maxTokens: 1024, temperature: 0.7,
    });
    const res = await dndSession.act("购买 手电筒");
    // ⚠ 这条原先叫「D&D 模式下购买提示不支持」。实跑回的是
    //   「「手电筒」没有找到。当前商店可能没有此物品。」—— **不是「不支持」**。
    //   看 handleBuy：它没有任何规则集判断，也没有商店，
    //   无论买什么、什么模式，都回同一句「没有找到」。购买/出售都是桩。
    //   （CoC 那套 CR 商店 SHOP_CATALOG / canBuyItem 从来没人调用，
    //     在死导出清理里删掉了；要做商店得从 git 历史里捞回来接上。）
    //   标题改成实情，别让它替一个不存在的行为背书。
    //   现在那句谎话（「当前商店可能没有此物品」）已换成直说没做，
    //   这条要钉的是**规则集不影响结果**这件事本身。
    expect(res.events.some((e) => e.content.includes("尚未实现"))).toBe(true);
  });
});

// ============================================================
// CoC 传承系统
// ============================================================

describe("CoC 传承系统", () => {
  it("传承指令（无子命令）显示说明", async () => {
    const res = await session.act("传承");
    const event = res.events.find(e => e.content.includes("传承系统"));
    expect(event).toBeDefined();
  });

  it("保存角色（无活跃角色时提示）", async () => {
    const res = await session.act("保存角色");
    const event = res.events.find(e => e.content.includes("没有活跃角色"));
    expect(event).toBeDefined();
  });

  it("传承列表（空时提示）", async () => {
    const res = await session.act("传承列表");
    const event = res.events.find(e => e.content.includes("暂无已保存的角色"));
    expect(event).toBeDefined();
  });

  it("读档（指定不存在的角色）提示未找到", async () => {
    const res = await session.act("读档 不存在的角色");
    const event = res.events.find(e => e.content.includes("未找到"));
    expect(event).toBeDefined();
  });
});

// ============================================================
// CoC 休息 HP 恢复（CoC RAW：需急救前置，周结算）
// ============================================================

describe("CoC 休息（RAW 周结算）", () => {
  it("未接受治疗时休息不恢复 HP", async () => {
    const restSession = new GameSession("rest-hp-test", "cosmic-horror", {
      apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
      model: "mock", maxTokens: 1024, temperature: 0.7,
    }, undefined, "调查员");
    await restSession.act("创建角色 investigator 张三");

    // 获取玩家当前 HP
    const state = restSession.world.getCurrentState();
    const player = state.entities["player"];
    const maxHp = player.maxHp;

    // 直接降低 HP
    restSession.world.getDatabase()
      .prepare("UPDATE entities SET hp = ? WHERE id = 'player'")
      .run(Math.floor(maxHp / 2));

    // 休息（未接受治疗 → 不应恢复 HP）
    const res = await restSession.act("休息");

    // 验证 HP 没有增加
    const afterState = restSession.world.getCurrentState();
    const afterPlayer = afterState.entities["player"];
    expect(afterPlayer.hp).toBe(Math.floor(maxHp / 2));

    // 应提示需要治疗
    const healEvent = res.events.find(e => e.content.includes("没有得到专业处理"));
    expect(healEvent).toBeDefined();
  });

  it("接受治疗后休息可恢复 CON/10 HP", async () => {
    const restSession = new GameSession("rest-hp-test2", "cosmic-horror", {
      apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
      model: "mock", maxTokens: 1024, temperature: 0.7,
    }, undefined, "调查员");
    await restSession.act("创建角色 investigator 张三");

    const state = restSession.world.getCurrentState();
    const player = state.entities["player"];
    const maxHp = player.maxHp;
    const halfHp = Math.floor(maxHp / 2);

    // 直接降低 HP
    restSession.world.getDatabase()
      .prepare("UPDATE entities SET hp = ? WHERE id = 'player'")
      .run(halfHp);

    // 标记已接受治疗
    restSession["_woundsTreated"] = true;

    // 休息
    const res = await restSession.act("休息");

    // 验证 HP 增加了
    const afterState = restSession.world.getCurrentState();
    const afterPlayer = afterState.entities["player"];
    expect(afterPlayer.hp).toBeGreaterThan(halfHp);
    expect(afterPlayer.hp).toBeLessThanOrEqual(maxHp);

    // 应包含愈合消息
    const healEvent = res.events.find(e => e.content.includes("愈合") || e.content.includes("HP") || e.content.includes("恢复"));
    expect(healEvent).toBeDefined();
  });

  it("满血时休息显示身体状况良好", async () => {
    const restSession2 = new GameSession("rest-hp-test3", "cosmic-horror", {
      apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
      model: "mock", maxTokens: 1024, temperature: 0.7,
    }, undefined, "调查员");
    await restSession2.act("创建角色 investigator 李四");
    const res = await restSession2.act("休息");

    // 满血时显示"身体状况良好"
    const refreshEvent = res.events.find(e => e.content.includes("身体状况良好"));
    expect(refreshEvent).toBeDefined();
  });

  it("模组结算可触发技能成长", async () => {
    const restSession3 = new GameSession("rest-hp-test4", "cosmic-horror", {
      apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
      model: "mock", maxTokens: 1024, temperature: 0.7,
    }, undefined, "调查员");
    await restSession3.act("创建角色 investigator 王五");

    // 先标记一个技能
    restSession3.skillGrowthMarks = ["fighting"];

    // 模组结算
    const res = await restSession3.act("模组结算");

    // 应有技能成长消息
    const growthEvent = res.events.find(e =>
      e.content.includes("技能成长") || e.content.includes("成长")
    );
    expect(growthEvent).toBeDefined();
  });

  it("无技能标记时技能成长提示无进步", async () => {
    const session = new GameSession("rest-hp-test5", "cosmic-horror", {
      apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
      model: "mock", maxTokens: 1024, temperature: 0.7,
    }, undefined, "调查员");
    await session.act("创建角色 investigator 赵六");

    // 清空 growth marks
    session.skillGrowthMarks = [];

    const res = await session.act("模组结算");

    // 应有"没有可结算的成长"提示
    const hintEvent = res.events.find(e =>
      e.content.includes("没有可结算的成长")
    );
    expect(hintEvent).toBeDefined();
  });
});

// ============================================================
// CoC 状态显示 CoC 特有字段
// ============================================================

describe("CoC 状态显示 CoC 特有字段", () => {
  it("创建角色后状态显示 CR/DB/Build/Move/幸运/MP", async () => {
    const statusSession = new GameSession("status-coc-test", "cosmic-horror", {
      apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
      model: "mock", maxTokens: 1024, temperature: 0.7,
    }, undefined, "调查员");
    await statusSession.act("创建角色 investigator 张三");

    const res = await statusSession.act("状态");
    const event = res.events.find(e => e.speaker === "系统");
    expect(event).toBeDefined();

    // 验证姓名
    expect(event!.content).toContain("张三");
    // 验证 CoC 特有字段
    const cocFields = ["CR", "DB", "Build", "Move", "幸运", "MP"];
    for (const field of cocFields) {
      expect(event!.content).toContain(field);
    }
  });

  it("状态显示 SAN 和燃运信息", async () => {
    const statusSession2 = new GameSession("status-coc-test2", "cosmic-horror", {
      apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
      model: "mock", maxTokens: 1024, temperature: 0.7,
    }, undefined, "调查员");
    await statusSession2.act("创建角色 investigator 李四");

    const res = await statusSession2.act("状态");
    const event = res.events.find(e => e.speaker === "系统");
    expect(event).toBeDefined();

    // SAN 和燃运仅 CoC 模式显示
    expect(event!.content).toContain("SAN");
    expect(event!.content).toContain("燃运");
  });
});

// ============================================================
// 角色卡传承集成测试
// ============================================================

/**
 * 辅助：创建 GameSession 并在构造函数中立即生成角色（传 archetype）
 * 避免依赖 handleCreateCharacter 做延迟车卡
 */
function createSessionWithChar(id: string, charName: string, archetype: string = "investigator"): GameSession {
  return new GameSession(id, "cosmic-horror", {
    apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
    model: "mock", maxTokens: 1024, temperature: 0.7,
  }, archetype, charName);
}

/**
 * 辅助：创建独立的 CareerFileStore 测试目录
 */
function createTestStore(label: string): { store: CareerFileStore; dir: string } {
  const dir = path.join(import.meta.dir, `../../_test_career_${label}`);
  try { fs.rmSync(dir, { recursive: true }); } catch { /* 清理临时目录：不存在或被占用都无所谓，失败不影响正确性 */ }
  fs.mkdirSync(dir, { recursive: true });
  return { store: new CareerFileStore(dir), dir };
}

describe("角色卡传承集成", () => {
  it("创建角色后自动保存基线快照", () => {
    const session = createSessionWithChar("career-snap-test", "爱丽丝");
    expect(session.careerStore).not.toBeNull();
    const snap = session.careerStore!.getSnapshot("爱丽丝");
    expect(snap).not.toBeNull();
    expect(snap!.characterName).toBe("爱丽丝");
    expect(snap!.san).toBeGreaterThan(0);
    expect(snap!.skills).toBeDefined();
  });

  it("模组结算后 CareerEntry 被记录", async () => {
    const { store: careerStore, dir } = createTestStore("career_entry");
    const session = new GameSession("career-entry-test", "cosmic-horror", {
      apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
      model: "mock", maxTokens: 1024, temperature: 0.7,
    }, "investigator", "鲍勃");

    // 替换为独立 store
    session.careerStore = careerStore;
    // 重新拍快照
    const c = session.activeCharacter!;
    careerStore.saveSnapshot({
      characterName: "鲍勃",
      occupation: c.archetype,
      attributes: { ...c.attributes },
      skills: c.skillValues ? { ...c.skillValues } : {},
      san: session.sanity.state.currentSAN,
      maxSan: 99,
      cthulhuMythos: 0,
      hp: c.hp,
      maxHp: c.maxHp,
      creditRating: c.creditRating ?? 30,
      createdAt: new Date().toISOString(),
    });

    // 记录起点，再模拟 SAN 损失
    (session as any)._moduleStartByPC.set("p1", { san: session.sanity.state.currentSAN, cm: 0 });
    session.sanity.state.currentSAN -= 8;
    session.skillGrowthMarks = ["fighting"];

    const res = await session.act("模组结算");

    const entries = careerStore.getEntries("鲍勃");
    // 可能有多条（每轮 hooks 可能触发多次），确保至少 1 条
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const entry = entries.find(e => e.moduleName === "未知模组");
    expect(entry).toBeDefined();
    expect(entry!.sanChange).toBe(-8);
    expect(entry!.endingId).toBe("completed");

    const completeEvent = res.events.find(e => e.content.includes("模组完成"));
    expect(completeEvent).toBeDefined();

    try { fs.rmSync(dir, { recursive: true }); } catch { /* 清理临时目录：不存在或被占用都无所谓，失败不影响正确性 */ }
  });

  it("loadCareer 正确反映跨模组累积", async () => {
    const { store, dir } = createTestStore("career_load");

    // 模拟基线：保存 snapshot
    const base: CharacterSnapshot = {
      characterName: "查理",
      occupation: "侦探",
      attributes: { power: 60, education: 50 },
      skills: { "侦查": 60, "潜行": 40, "格斗": 50 },
      san: 60,
      maxSan: 99,
      cthulhuMythos: 0,
      hp: 12,
      maxHp: 12,
      creditRating: 30,
      createdAt: new Date().toISOString(),
    };
    store.saveSnapshot(base);

    // 添加 2 个模组完成记录
    store.addEntry({
      id: "ce_test_1", characterName: "查理",
      moduleId: "mod1", moduleName: "第一个模组",
      completedAt: new Date().toISOString(),
      endingId: "survived", endingName: "存活",
      sanChange: -10, cmChange: 3, reputationChange: 0,
      skillChanges: ["侦查→65"],
      rewardIds: ["reward1"],
      narrative: "完成第一个模组",
    });
    store.addEntry({
      id: "ce_test_2", characterName: "查理",
      moduleId: "mod2", moduleName: "第二个模组",
      completedAt: new Date().toISOString(),
      endingId: "true", endingName: "True End",
      sanChange: -5, cmChange: 2, reputationChange: 5,
      skillChanges: ["潜行→43"],
      rewardIds: ["reward2"],
      narrative: "完成第二个模组",
    });

    const allEntries = store.getEntries("查理");
    expect(allEntries.length).toBe(2);

    const career = store.loadCareer("查理");
    expect(career).not.toBeNull();
    expect(career!.totalModules).toBe(2);
    expect(career!.currentSan).toBe(45);  // 60 - 10 - 5
    expect(career!.currentCthulhuMythos).toBe(5);    // 0 + 3 + 2
    expect(career!.currentSkills["侦查"]).toBe(65);
    expect(career!.currentSkills["潜行"]).toBe(43);

    try { fs.rmSync(dir, { recursive: true }); } catch { /* 清理临时目录：不存在或被占用都无所谓，失败不影响正确性 */ }
  });

  it("不存在 careerStore 时模组结算不报错（向后兼容）", async () => {
    const session = new GameSession("career-none-test", "cosmic-horror", {
      apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
      model: "mock", maxTokens: 1024, temperature: 0.7,
    }, undefined, "张三");

    session.careerStore = null;
    session.skillGrowthMarks = ["fighting"];
    const res = await session.act("模组结算");
    expect(res.narrative).toBeDefined();
    expect(res.narrative).not.toContain("Error");
  });
});
