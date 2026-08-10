/**
 * WorldModelIntegrator 事实边界约束回归测试
 * =========================================
 *
 * 覆盖 2026-08 修复的模拟缺陷（LLM 叙事越权）：
 * - 场景描写是「静态事实清单」，禁止把静态状态脑补成事件因果
 *   （被褥凌乱 ≠ 挣扎/搏斗；玻璃破损 ≠ 闯入；痕迹 ≠ 血迹）
 * - 未列出/背景提及/失踪/被绑架/昏迷的角色不得自行现身
 * - 无确认在场 NPC 时，仅描写有原文依据的环境
 * - 场景描写存在时必须带「叙事输出最终约束」
 *
 * 运行：bun test src/__tests__/world-model-integrator.test.ts
 */

import { describe, it, expect } from "bun:test";
import { WorldModelIntegrator, type SceneContext } from "../world/world-model-integrator";
import { WorldModelLoader } from "../world/world-model-loader";

// 空 loader：不加载真实世界模型文件，保证测试确定性
function makeEmptyIntegrator(): WorldModelIntegrator {
  return new WorldModelIntegrator(new WorldModelLoader());
}

function baseCtx(overrides: Partial<SceneContext> = {}): SceneContext {
  return {
    sceneId: "test-scene",
    sceneName: "测试场景",
    keywords: ["谷仓"],
    presentNPCs: [],
    discoveredClues: [],
    round: 1,
    ...overrides,
  };
}

describe("WorldModelIntegrator 事实边界约束", () => {
  it("有场景描写时必须输出「事实边界」约束，禁止把静态状态脑补成因果", () => {
    const int = makeEmptyIntegrator();
    const ctx = baseCtx({
      sceneDescription: "被褥凌乱地堆在床上，窗玻璃有一道裂纹。",
    });
    const out = int.buildKPContext(ctx);
    expect(out).toContain("[模组场景描写]");
    expect(out).toContain("[事实边界]");
    // 核心约束：静态状态不代表成因，禁止脑补
    expect(out).toContain("不代表其成因");
    expect(out).toContain("挣扎、搏斗、绑架、闯入、血迹");
    expect(out).toContain("严格以原文列出的物品、状态和空间为闭世界");
  });

  it("有场景描写时必须输出「叙事输出最终约束」，且优先于世界模型联想", () => {
    const int = makeEmptyIntegrator();
    const ctx = baseCtx({
      sceneDescription: "谷仓内堆着干草，地面有杂乱的痕迹。",
    });
    const out = int.buildKPContext(ctx);
    expect(out).toContain("[叙事输出最终约束]");
    expect(out).toContain("不得新增原文未列出的气味、声音、天气、光线、时间、人物、动作或因果");
    expect(out).toContain("上述约束优先于世界模型参考与常识联想");
  });

  it("无场景描写时不输出「事实边界」与「最终约束」", () => {
    const int = makeEmptyIntegrator();
    const out = int.buildKPContext(baseCtx());
    expect(out).not.toContain("[事实边界]");
    expect(out).not.toContain("[叙事输出最终约束]");
    expect(out).not.toContain("[模组场景描写]");
  });

  it("无确认在场 NPC 时，禁止未列出角色现身，仅描写有原文依据的内容", () => {
    const int = makeEmptyIntegrator();
    const ctx = baseCtx({
      sceneDescription: "空荡的旅店大堂。",
    });
    const out = int.buildKPContext(ctx);
    expect(out).toContain("[在场角色]");
    expect(out).toContain("当前场景没有已确认在场的 NPC");
    expect(out).toContain("未列出的角色（包括仅在模组背景中提及、失踪、被绑架、昏迷或位于其他场景的角色）不得现身");
    expect(out).toContain("本轮仅描写有原文依据的环境与玩家可观察事实");
  });

  it("有确认在场 NPC（无权威人设卡）时，必须至少让一位 NPC 在场", () => {
    const int = makeEmptyIntegrator();
    const ctx = baseCtx({ presentNPCs: ["艾德里安"] });
    const out = int.buildKPContext(ctx);
    expect(out).toContain("[必须在叙事中呈现的在场 NPC]");
    expect(out).toContain("艾德里安");
    expect(out).toContain("务必让其中至少一位以举止、神态或言语方式在场");
  });

  it("有权威人设卡时，禁止失踪/昏迷/背景提及的角色自行现身", () => {
    const int = makeEmptyIntegrator();
    const ctx = baseCtx({
      presentNPCs: ["艾德里安"],
      npcProfiles: [
        {
          name: "艾德里安",
          role: "农场主",
          currentState: "昏迷不醒",
          background: "被发现时倒在谷仓地板上。",
        },
      ],
    });
    const out = int.buildKPContext(ctx);
    expect(out).toContain("[在场角色（权威人设，叙事必须遵守）]");
    expect(out).toContain("仅上述 NPC 已确认在当前场景中");
    expect(out).toContain("失踪、被绑架、昏迷或位于其他场景的角色，均不得自行现身");
    // 昏迷状态硬性约束
    expect(out).toContain("该角色当前处于「昏迷不醒」状态：严禁让该角色主动行动、正常说话或做出超出该状态的言行");
  });

  it("权威人设卡的年龄/性别硬性约束仍生效（不因解耦退化）", () => {
    const int = makeEmptyIntegrator();
    const ctx = baseCtx({
      presentNPCs: ["小艾米"],
      npcProfiles: [
        { name: "小艾米", age: 6, gender: "female", role: "失踪者的女儿" },
      ],
    });
    const out = int.buildKPContext(ctx);
    expect(out).toContain("6岁 · 女性");
    expect(out).toContain("未成年幼童：严禁描写为成年人或青少年");
    expect(out).toContain("女性角色：严禁以男性称谓/动作描写，代名词必须使用她");
  });
});
