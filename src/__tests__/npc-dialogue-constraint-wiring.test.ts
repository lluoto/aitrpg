// 开发·约束层补角色实体域 N9 任务 A——GameSession 端到端接线验收。
//
// todo-43 记过的缺口：ConstraintEngine.checkDialogue() 签名早就接受
// sceneId，但 npc-agent.ts 两处调用（respond/speakUp 内部的
// checkDialogueText）都没传，场景内容因此进不了约束判断。这份文件
// 验证 game-session.ts:handleTalk 这个真实调用点确实把 sceneId 传给
// 了 npcAgent.respond()——接线本身也可能漏掉（漏传/传错场景），
// 只测 NPCAgent 单体测不出来，与 kp-narration-constraint-wiring
// .test.ts:56 是同一类判据。
//
// bun test src/__tests__/npc-dialogue-constraint-wiring.test.ts

import { describe, it, expect } from "bun:test";
import { GameSession } from "../api/game-session";

const CFG = {
  apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
  model: "mock", maxTokens: 128, temperature: 0,
};

function makeSession(id: string): GameSession & Record<string, any> {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession(id, "cosmic-horror", CFG, "investigator", "甲") as any;
}

describe("handleTalk 里 npcAgent.respond() 的真实调用点确实带上了 sceneId", () => {
  it("接住真实调用参数：第 3 个参数是包含 sceneId 的对象，值等于 getDisplayedScene()", async () => {
    const session = makeSession(`npc-dialogue-wiring-${Math.random()}`) as any;
    await session.act("加载模组 普瑞米尔的谷仓");
    session.movePlayerToScene("维森酒吧");

    const npcAgent = session.registry.findAgentByName("酒吧保镖");
    expect(npcAgent).toBeDefined();
    let capturedOpts: any = undefined;
    const originalRespond = npcAgent.respond.bind(npcAgent);
    npcAgent.respond = async (...args: any[]) => {
      capturedOpts = args[2];
      return originalRespond(...args);
    };

    await session.act("跟酒吧保镖说话");

    expect(capturedOpts).toBeDefined();
    expect(typeof capturedOpts.sceneId).toBe("string");
    expect(capturedOpts.sceneId).toBe(session.getDisplayedScene());
  });
});
