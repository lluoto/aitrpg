// 任务4：判据对齐生产路径。
//
// scripts/diag/diag-clue-phrasing.ts 的"a-裸动词"用例原先直接调
// matchSceneClues()，但生产路径（GameSession.resolveSceneClueMatch）对裸
// 动词从入口短路就返回 fallback，压根不会走到 matchSceneClues 内部——
// 判据测的是生产从不会执行到的一条路，报"歧义 10/10 全过"却掩盖了生产
// 实际在做的事（静默取候选首条）。
//
// 修法：把决策抽成纯函数 decideClueMatch()（clue-match.ts），
// GameSession.resolveSceneClueMatch 与诊断脚本共用同一份；诊断脚本据此
// 拿到真实的 "fallback" 结果，判据（clue-phrasing.ts 的 judgeCluePhrase）
// 据 decisionKind 分清"fallback（设计如此）"与"resolve（本该 ask/fallback
// 却抢答了）"。
//
// bun test src/__tests__/clue-match-decision-parity.test.ts

import { describe, it, expect } from "bun:test";
import { decideClueMatch, matchSceneClues, type ClueMatchCandidate } from "../investigation/clue-match";
import { judgeCluePhrase, type CluePhraseCase, type CluePhraseOutcome } from "../diagnostics/clue-phrasing";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import { GameSession } from "../api/game-session";

function toCandidate(clue: { id: string; name: string; findMethods: { description: string }[] }): ClueMatchCandidate {
  return { id: clue.id, texts: [clue.name, ...clue.findMethods.map((f) => f.description)] };
}

const multiClueScene = BARN_OF_PREMIER.scenes.find((s) => s.clues.length >= 2)!;
const group = multiClueScene.clues.map(toCandidate);

describe("decideClueMatch —— 纯函数，与生产/诊断脚本共用同一份决策", () => {
  it("**正确**：裸调查动词（无位置信号）→ fallback，不是 ask，也不是 resolve", () => {
    const decision = decideClueMatch("侦查", group);
    expect(decision.kind).toBe("fallback");
  });

  it("**正确**：完全空输入也是 fallback", () => {
    const decision = decideClueMatch("", group);
    expect(decision.kind).toBe("fallback");
  });

  it("**正确**：候选为空时无条件 fallback", () => {
    const decision = decideClueMatch("侦查卫生间", []);
    expect(decision.kind).toBe("fallback");
  });

  it("**目标行为错误的对照**：带具体位置信号的输入仍然正常派发给 matchSceneClues，行为不因这次重构而变", () => {
    // 用该场景真实的一条线索文本片段作为输入，直接命中
    const firstClue = multiClueScene.clues[0]!;
    const hint = firstClue.findMethods[0]?.description ?? firstClue.name;
    const direct = matchSceneClues(hint, group);
    const viaDecision = decideClueMatch(hint, group);
    if (direct.hit) {
      expect(viaDecision).toEqual({ kind: "resolve", clueId: direct.hit });
    } else if (direct.ambiguous.length > 0) {
      expect(viaDecision).toEqual({ kind: "ask", clueIds: direct.ambiguous });
    } else {
      expect(viaDecision.kind).toBe("deny");
    }
  });
});

describe("judgeCluePhrase —— 能分清 fallback（设计如此）与 resolve（抢答）", () => {
  const baseCase: CluePhraseCase = { id: "a-裸动词", kind: "ambiguous", desc: "", said: "侦查", wantClueId: null };

  it("**正确**：decisionKind=fallback 判过", () => {
    const outcome: CluePhraseOutcome = { chosenClueId: null, ambiguousIds: [], decisionKind: "fallback" };
    expect(judgeCluePhrase(baseCase, outcome).verdict).toBe("pass");
  });

  it("**正确**：decisionKind=ask（真歧义，问清楚）也判过", () => {
    const outcome: CluePhraseOutcome = { chosenClueId: null, ambiguousIds: ["a", "b"], decisionKind: "ask" };
    expect(judgeCluePhrase(baseCase, outcome).verdict).toBe("pass");
  });

  it("**错误行为红线**：decisionKind=resolve（抢答了）必须判不过，即使 chosenClueId 看起来合理", () => {
    const outcome: CluePhraseOutcome = { chosenClueId: "some_clue", ambiguousIds: [], decisionKind: "resolve" };
    const j = judgeCluePhrase(baseCase, outcome);
    expect(j.verdict).toBe("fail");
    expect(j.why).toContain("resolve");
  });
});

describe("端到端：GameSession 对裸动词的真实行为与判据现在测的一致", () => {
  const CFG = {
    apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
    model: "mock", maxTokens: 512, temperature: 0.7,
  };

  it("**正确**：裸「侦查」静默取候选首条（fallback），不问、不报错、不挂起", async () => {
    const session: any = new GameSession(`t4-${Math.random()}`, "cosmic-horror", CFG, undefined, "调查员");
    await session.act("创建角色 investigator 甲");
    await session.act("加载模组 普瑞米尔的谷仓");
    session.movePlayerToScene("加比的拖车房");
    const real = Math.random;
    Math.random = () => 0;
    try {
      const res = await session.act("侦查");
      // fallback 静默取首条：不是"需要说清楚具体想搜哪里"，也不是"这里没什么特别的"
      expect(res.narrative).not.toBe("需要说清楚具体想搜哪里/什么");
      expect(res.narrative).not.toBe("这里没什么特别的");
    } finally { Math.random = real; }
  });
});
