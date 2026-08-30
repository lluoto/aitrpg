// 开发·GameSession 确定性跑局装置 —— 任务2验收。
//
// 背景：自由跑团路径（GameSession）的多回合行为回归此前只能靠 LLM 代理
// 跑模拟，而模拟 prompt 已连续三次污染读数（写死 30 回合导致噪音、没设
// 输入长度下限导致假"0次判错"、误禁必需命令、指错日志文件）。剧本杀路径
// 已有 runSeeded()（run-harness.ts）复用 withSeededRandom 做确定性回归，
// 但它是"选项驱动"（引擎给选项、decide() 随机挑）——GameSession 是自由
// 输入驱动，没有选项可挑，所以装置改为吃一份输入脚本
// （runGameSessionScript()，见 game-session-run-harness.ts 头注释）。
//
// 本文件只钉三件事（任务描述指定）：①移动计时（相邻1跳 vs 跨图多跳
// 推进不同）②复合句回问（"前往X，然后做Y"触发回问；回答后正确执行；
// 判对的输入不因此变成回问——回归）③脱离结局（显式离开→确认→结局；
// 验证 todo-34 的场景 id 桥接修复，脚本能走到 True End）。
// 不测：LLM 意图判错率/叙述质量——那仍然只有真实 LLM 模拟能测。
//
// bun test src/__tests__/game-session-run-harness.test.ts

import { describe, it, expect } from "bun:test";
import { GameSession } from "../api/game-session";
import { runGameSessionScript, type GameSessionScriptStep } from "../diagnostics/game-session-run-harness";
import { END_NARRATIONS } from "../module/barn-of-premier";

function makeSession(id: string): GameSession {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession(id, "cosmic-horror", {
    apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 1024, temperature: 0.7,
  }, undefined, "调查员");
}

/**
 * 多 PC 脚本用——p1 必须带 archetype（"创建角色"走过真实建卡）才能被
 * act(input, "p1") 按 pcId 路由：空壳 p1（无 archetype 构造）根本不在
 * `characters` Map 里，传 pcId="p1" 会被判成 unknown_target 直接拒绝
 * （实测过，见 pendingConfirm 认人那组用例的注释）。
 */
function makeMultiPcSession(id: string): GameSession {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession(id, "cosmic-horror", {
    apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 1024, temperature: 0.7,
  }, "investigator", "甲");
}

const LOAD_MODULE: GameSessionScriptStep = { input: "加载模组 普瑞米尔的谷仓" };
const OPTS = { seed: 20260830, timeoutMs: 30_000, maxSteps: 100 };

describe("确定性：同 seed+同脚本跑两次，逐回合输出完全相同，draws 也相同", () => {
  it("两次独立会话（各自加载模组+移动+侦查）产生逐字相同的快照序列", async () => {
    const script: GameSessionScriptStep[] = [
      LOAD_MODULE,
      { input: "侦查" },
      { input: "前往加比的拖车房" },
      { input: "侦查" },
    ];

    const a = await runGameSessionScript(makeSession("determinism-a"), script, OPTS);
    const b = await runGameSessionScript(makeSession("determinism-b"), script, OPTS);

    expect(a.threw).toBe(false);
    expect(b.threw).toBe(false);
    expect(a.steps.length).toBe(script.length);
    expect(a.draws).toBe(b.draws);
    // 逐回合比较：场景/回合数/游戏时间/叙述/事件全部相同（会话 id 不同不影响这些字段）。
    for (let i = 0; i < a.steps.length; i++) {
      expect(a.steps[i].scene).toBe(b.steps[i].scene);
      expect(a.steps[i].round).toBe(b.steps[i].round);
      expect(a.steps[i].gameTime).toEqual(b.steps[i].gameTime);
      expect(a.steps[i].narrative).toBe(b.steps[i].narrative);
      expect(a.steps[i].events).toEqual(b.steps[i].events);
    }
  });

  it("不同 seed 在会触发掷骰的步骤上产生不同结果（seed 真的在控制骰子）", async () => {
    // 「侦查」触发 spot_hidden 检定，掷骰结果依赖 Math.random。
    const script: GameSessionScriptStep[] = [LOAD_MODULE, { input: "侦查" }];
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const narratives = new Set<string>();
    for (const seed of seeds) {
      const r = await runGameSessionScript(makeSession(`seed-diff-${seed}`), script, { ...OPTS, seed });
      expect(r.threw).toBe(false);
      narratives.add(r.steps[r.steps.length - 1].narrative);
    }
    // 8 个不同种子里至少要出现 2 种不同的结果，否则 seed 根本没有在控制骰子。
    expect(narratives.size).toBeGreaterThan(1);
  });
});

describe("① 移动计时：相邻 1 跳 vs 跨图多跳推进不同", () => {
  it("跨图移动（特里坎家→维修间，8 跳）比相邻移动（特里坎家→加比的拖车房，1 跳）推进更多时间", async () => {
    const adjacentScript: GameSessionScriptStep[] = [LOAD_MODULE, { input: "前往加比的拖车房" }];
    const farScript: GameSessionScriptStep[] = [LOAD_MODULE, { input: "前往维修间" }];

    const adjacent = await runGameSessionScript(makeSession("move-cost-adjacent"), adjacentScript, OPTS);
    const far = await runGameSessionScript(makeSession("move-cost-far"), farScript, OPTS);
    expect(adjacent.threw).toBe(false);
    expect(far.threw).toBe(false);

    const beforeAdjacent = adjacent.steps[0].gameTime; // 加载模组那一步之后
    const afterAdjacent = adjacent.steps[1].gameTime;
    const beforeFar = far.steps[0].gameTime;
    const afterFar = far.steps[1].gameTime;

    expect(beforeAdjacent).toEqual(beforeFar); // 两组起点相同
    expect(afterAdjacent).not.toEqual(afterFar); // 终点必须不同

    const periodOrder = ["dawn", "morning", "noon", "afternoon", "dusk", "evening", "night", "late_night"];
    const totalTicks = (gt: { day: number; period: string }) =>
      (gt.day - 1) * 24 + periodOrder.indexOf(gt.period) * 3;
    const adjacentAdvance = totalTicks(afterAdjacent) - totalTicks(beforeAdjacent);
    const farAdvance = totalTicks(afterFar) - totalTicks(beforeFar);
    expect(farAdvance).toBeGreaterThan(adjacentAdvance);
    expect(far.steps[1].scene).toBe("维修间");
    expect(adjacent.steps[1].scene).toBe("加比的拖车房");
  });
});

describe("② 复合句回问：触发/回答后正确执行/判对的输入不变成回问（回归）", () => {
  it("复合句触发回问，回答目的地后移动成功且脚本能继续往下走", async () => {
    const script: GameSessionScriptStep[] = [
      LOAD_MODULE,
      { input: "检查加比的拖车房里的床底和柜子，看有没有藏东西。" }, // 触发回问
      { input: "加比的拖车房" }, // 回答目的地
      { input: "侦查" }, // 脚本能继续往下走，不卡住
    ];
    const r = await runGameSessionScript(makeSession("compound-reask"), script, OPTS);
    expect(r.threw).toBe(false);
    const askStep = r.steps[1];
    const sysReplies = askStep.events.filter((e) => e.speaker === "系统").map((e) => e.content).join("\n");
    expect(sysReplies).toContain("你是要先去");
    expect(askStep.scene).toBe("特里坎家"); // 还没真的移动
    const movedStep = r.steps[2];
    expect(movedStep.scene).toBe("加比的拖车房"); // 回答后真的移动了
    const finalStep = r.steps[3];
    expect(finalStep.events.length).toBeGreaterThan(0); // 没有卡住
  });

  it("回归：move 动作本就不受影响，判对的输入不会因为本装置的存在而变成回问", async () => {
    const script: GameSessionScriptStep[] = [
      LOAD_MODULE,
      { input: "陈岳带大家前往加比的拖车房，准备从日常物品里寻找线索。" },
    ];
    const r = await runGameSessionScript(makeSession("compound-reask-regression"), script, OPTS);
    expect(r.threw).toBe(false);
    const moveStep = r.steps[1];
    expect(moveStep.scene).toBe("加比的拖车房"); // 直接移动，没有被拦下来问话
    const sysReplies = moveStep.events.filter((e) => e.speaker === "系统").map((e) => e.content).join("\n");
    expect(sysReplies).not.toContain("你是要先去");
  });
});

describe("③ 脱离结局：显式离开→确认→结局，脚本能走到 True End（验证 todo-34 场景 id 桥接修复）", () => {
  it("发现日记与老文件、到过维修间后显式离开并确认，得到 True End", async () => {
    const session = makeSession("departure-true-end");
    const script: GameSessionScriptStep[] = [
      LOAD_MODULE,
      { input: "前往维修间" },
    ];
    const r1 = await runGameSessionScript(session, script, OPTS);
    expect(r1.threw).toBe(false);
    expect(r1.steps[1].scene).toBe("维修间");

    // 直接标记发现两条 True End 所需线索（跨模块耦合不属于本装置要驱动的
    // 内容——脚本驱动的是 act()，不是内部数据结构；这里与
    // scene-id-bridge.test.ts 用同一种手法构造前置状态）。
    session.investigation.markDiscovered("clue_bedroom_diary", "p1");
    session.investigation.markDiscovered("clue_bedroom_old_doc", "p1");

    const departScript: GameSessionScriptStep[] = [
      { input: "我们决定离开这里，结束这次调查" },
      { input: "确定" },
    ];
    const r2 = await runGameSessionScript(session, departScript, OPTS);
    expect(r2.threw).toBe(false);
    expect(r2.steps[1].dead).toBe(true);

    const trueEndNarration = END_NARRATIONS.find((e) => e.id === "true")!;
    expect(r2.steps[1].narrative).toBe(trueEndNarration.lines.join("\n"));
  });
});

// 开发·pendingConfirm 认人 —— 任务2验收（跨 PC 泄漏）。
//
// 背景：2026-08-30 实跑（会话 lcmj2joi）：回合 7 p1 说"回家汇报并问马克"
// 触发复合句回问（KP 在等确认要不要先移动过去），回合 8 p2 说"问菲碧
// 酒吧派对"——这句与 p1 的回问毫无关系，却被当成了回答，p1 的问题被
// 悄悄吃掉。根因：pendingConfirm 是会话级单字段，只记"有没有待确认"，
// 不记"是谁提的"。已裁决：compound-move 认人（Map<pcId, ...>，只有
// 触发它的那个 PC 能回答，其它 PC 照常行动 + 收到提醒）；leave 不认人
// （party 级决定，谁确认/取消都算数）——见 pendingCompoundMove/
// pendingLeaveConfirm 两个字段各自的注释。
describe("pendingConfirm 认人：compound-move 只认发起的 PC，leave 谁都能答", () => {
  it("p1 开门→p2 行动→p2 按自己的意图执行，不被当成对 p1 问题的回答；p1 随后再答仍然生效", async () => {
    const session = makeMultiPcSession("pending-confirm-cross-pc");
    const script: GameSessionScriptStep[] = [
      LOAD_MODULE,
      { input: "创建队友 乙 investigator" }, // p2，默认以 p1 身份发出这条指令
      { input: "检查加比的拖车房里的床底和柜子，看有没有藏东西。", pcId: "p1" }, // p1 开门
      { input: "陈岳跟菲碧打听一下加比最近的近况", pcId: "p2" }, // p2 无关行动
      { input: "加比的拖车房", pcId: "p1" }, // p1 回答
    ];
    const r = await runGameSessionScript(session, script, OPTS);
    expect(r.threw).toBe(false);

    const openStep = r.steps[2];
    expect(openStep.scene).toBe("特里坎家"); // 还没真的移动
    const openSys = openStep.events.filter((e) => e.speaker === "系统").map((e) => e.content).join("\n");
    expect(openSys).toContain("你是要先去");

    // 关键断言：p2 那一步没有被当成对 p1 问题的回答——
    // 场景没变（没有被 p2 的话误移动去加比的拖车房），且能看到
    // "p1 还有问题没答"的提醒，同时 p2 自己的行动（对话）正常执行了。
    const p2Step = r.steps[3];
    expect(p2Step.scene).toBe("特里坎家");
    const p2Sys = p2Step.events.filter((e) => e.speaker === "系统").map((e) => e.content).join("\n");
    expect(p2Sys).toContain("p1");
    expect(p2Sys).toContain("没有回答");
    const p2Action = p2Step.events.find((e) => e.type === "action" && e.content.includes("菲碧"));
    expect(p2Action).toBeDefined(); // p2 自己的输入被当成自己的行动记下了

    // p1 随后回答仍然生效：真的移动了。
    const answerStep = r.steps[4];
    expect(answerStep.scene).toBe("加比的拖车房");
  });

  it("p1 开门→p1 自己回答→正常生效（回归：不能因为加了认人就连同 PC 都答不了）", async () => {
    const session = makeMultiPcSession("pending-confirm-same-pc");
    const script: GameSessionScriptStep[] = [
      LOAD_MODULE,
      { input: "检查加比的拖车房里的床底和柜子，看有没有藏东西。", pcId: "p1" },
      { input: "加比的拖车房", pcId: "p1" },
    ];
    const r = await runGameSessionScript(session, script, OPTS);
    expect(r.threw).toBe(false);
    expect(r.steps[1].scene).toBe("特里坎家");
    expect(r.steps[2].scene).toBe("加比的拖车房");
  });

  it("leave 不认人：p1 开门，p2 确认，照样结束调查（party 级决定）", async () => {
    const session = makeMultiPcSession("pending-leave-any-pc");
    const script: GameSessionScriptStep[] = [
      LOAD_MODULE,
      { input: "创建队友 乙 investigator" },
      { input: "我们决定离开这里，结束这次调查", pcId: "p1" }, // p1 开门
      { input: "确定", pcId: "p2" }, // p2 确认——leave 不认人，这应当算数
    ];
    const r = await runGameSessionScript(session, script, OPTS);
    expect(r.threw).toBe(false);
    expect(r.steps[3].dead).toBe(true); // 真的结束了，没有因为"不是同一个人"被拒绝
  });
});
