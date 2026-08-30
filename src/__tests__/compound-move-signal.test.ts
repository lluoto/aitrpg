// 开发·复合句检测对"顺带提到的地名"误报 —— 任务3验收。
//
// 背景：复合句回问（compound-move-reask.test.ts）此前对"整句里找到一个
// 有把握的地名"就触发回问，但地名经常只是**要找的东西的内容**，不是
// 目的地。实跑：
//   "陆川再次仔细检查餐桌和披萨盒的夹层，寻找能够指向维森酒吧的卡片或
//    地址。" → 误问"你是要先去「维森酒吧」吗？"
// 维森酒吧是线索指向的地方，不是这句话要去的地方。上一轮把这个问题框成
// "误报——该问哪个候选"（mentionedSceneNames 展示真实候选），但真正的
// 问题是"该不该问"——框架错了。
//
// 修法：hasMovementSignalNearMention()（src/play/scene-resolve.ts）—— 地名
// 旁边有没有"要去那儿"的信号：紧邻移动动词（复用 move-util 的
// hasMoveIntent），或紧跟"里/内"这类方位后缀（"检查 X 里的 Y"隐含"要在
// X 里面"，即使前面没有显式移动动词）。
//
// bun test src/__tests__/compound-move-signal.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";
import { hasMovementSignalNearMention } from "../play/scene-resolve";

// 四份实跑原文（两份来自 analysis/sim 报告），不自己编。
const MUST_TRIGGER_1 = "陆川带大家前往农场外围，沿着通往深处的道路寻找可疑足迹和废弃物。";
const MUST_TRIGGER_2 = "陆川带队返回特里坎家，把拖车房里发现的情况告诉菲碧。";
const MUST_NOT_TRIGGER_1 = "陆川再次仔细检查餐桌和披萨盒的夹层，寻找能够指向维森酒吧的卡片或地址。";
const MUST_NOT_TRIGGER_2 = "林娜向菲碧询问加比是否提过维森酒吧或者一场免费酒水的聚会。";

describe("hasMovementSignalNearMention：纯函数级，用实跑原文直接验证信号判定", () => {
  it("必须触发的两句：地名紧邻移动动词，判定为有信号", () => {
    // ⚠ MUST_TRIGGER_1 在本仓测试跑的 regex 兜底路径下 intent.action 解析成
    // "move"（不在 COMPOUND_ELIGIBLE_ACTIONS 白名单里，压根不会走到这段
    // 检测——这正是 R13 回归测试已经验过的分支）。真实 LLM 才会把它误判成
    // talk/skill_check 从而触发回问，这也是实跑报告里这句话真正出问题的
    // 路径。既然引擎层面在本仓离线测试环境下够不到这句话，直接测量这个
    // 判定函数本身对着真实原文的输出——这就是它在生产环境会被调用时
    // 拿到的输入，不是编出来的替代句。
    expect(hasMovementSignalNearMention(MUST_TRIGGER_1, "农场外围")).toBe(true); // 前往
    expect(hasMovementSignalNearMention(MUST_TRIGGER_2, "特里坎家")).toBe(true); // 返回
  });

  it("必须不触发的两句：地名前面不是移动动词、后面也不是方位后缀，判定为无信号", () => {
    expect(hasMovementSignalNearMention(MUST_NOT_TRIGGER_1, "维森酒吧")).toBe(false); // 指向…的卡片
    expect(hasMovementSignalNearMention(MUST_NOT_TRIGGER_2, "维森酒吧")).toBe(false); // 提过…或者
  });

  it("回归：紧跟方位后缀'里'同样算有信号，即使前面没有移动动词（检查 X 里的 Y）", () => {
    // 这正是 compound-move-reask.test.ts 里"必须触发"的另一类真实例子——
    // "检查"本身不是移动动词，但"加比的拖车房里的床底"隐含"人得在那里面"。
    expect(hasMovementSignalNearMention("检查加比的拖车房里的床底和柜子，看有没有藏东西。", "加比的拖车房")).toBe(true);
  });
});

function makeSession(): GameSession {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession("compound-move-signal-test", "cosmic-horror", {
    apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 1024, temperature: 0.7,
  }, undefined, "调查员");
}

function systemReplies(res: Awaited<ReturnType<GameSession["act"]>>): string {
  return res.events.filter((e) => e.speaker === "系统").map((e) => e.content).join("\n");
}

let session: GameSession;

beforeEach(async () => {
  session = makeSession();
  await session.act("加载模组 普瑞米尔的谷仓"); // 默认落在「特里坎家」
});

describe("端到端：两句必须不触发的实跑原文，在 regex 路径下确实命中白名单动作，且不触发回问", () => {
  it("MUST_NOT_TRIGGER_1（skill_check）：不触发回问，原意图正常执行", async () => {
    const res = await session.act(MUST_NOT_TRIGGER_1);
    expect(session.getDisplayedScene()).toBe("特里坎家"); // 没有被挪走
    expect(systemReplies(res)).not.toContain("你是要先去");
    expect(res.events.length).toBeGreaterThan(0); // 原意图确实执行了，没有卡住
  });

  it("MUST_NOT_TRIGGER_2（unknown）：不触发回问", async () => {
    const res = await session.act(MUST_NOT_TRIGGER_2);
    expect(session.getDisplayedScene()).toBe("特里坎家");
    expect(systemReplies(res)).not.toContain("你是要先去");
  });
});

describe("回归：既有判对的输入不因为本次收窄而改变判定", () => {
  it("R7（compound-move-reask.test.ts 已覆盖的必须触发用例）依旧触发：'返回特里坎家'", async () => {
    (session as any).movePlayerToScene("维森酒吧");
    const res = await session.act("陆川带队返回特里坎家，把拖车房里发现的情况告诉菲碧。");
    expect(session.getDisplayedScene()).toBe("维森酒吧"); // 还没真的移动，先问
    expect(systemReplies(res)).toContain("你是要先去");
  });

  it("'检查加比的拖车房里的床底和柜子'依旧触发（方位后缀信号，非移动动词信号）", async () => {
    const res = await session.act("检查加比的拖车房里的床底和柜子，看有没有藏东西。");
    expect(session.getDisplayedScene()).toBe("特里坎家");
    expect(systemReplies(res)).toContain("你是要先去「加比的拖车房」吗");
  });

  it("R2：纯对话（不提及任何场景名）依旧不触发", async () => {
    const res = await session.act("林娜向菲碧说明我们会认真调查，并询问加比最后提到的朋友和地点。");
    expect(systemReplies(res)).not.toContain("你是要先去");
  });

  it("R3/R8：move 动作本就不受影响（intent.action=move 不在白名单里）", async () => {
    const res = await session.act("陈岳带大家前往加比的拖车房，准备从日常物品里寻找线索。");
    expect(session.getDisplayedScene()).toBe("加比的拖车房");
    expect(systemReplies(res)).not.toContain("你是要先去");
  });
});
