// 开发·三档约束 阶段7 任务①：艾德里安的 secrets 曾经写反。
//
// mythos-module.ts:1061 曾写 secrets: ["意识到被米-戈欺骗"]——与原文
// （section_01:15-18「完全没有意识到自己完全是被利用了」）和
// barn-of-premier.ts True End 第2行（"艾德里安直到瘫痪在病床上，都没有
// 意识到自己不过是被利用的工具"）直接矛盾。
//
// 这不只是数据错误：secrets 会原样注入 NPC Agent 的系统提示
// （npc-agent.ts:43「你的秘密（绝不主动透露）: ${npc.secrets.join...}」），
// 写反了会让扮演艾德里安的 LLM 表现得像个知情者——是可玩性缺陷。
//
// 本文件钉住两件事：① 数据本身不再声称"知情"；② 与 True End 叙事互相
// 印证同一个事实（他不知道自己被利用），不是本文件自己编的期望值。
//
// bun test src/__tests__/npc-secret-truth-consistency.test.ts

import { describe, it, expect } from "bun:test";
import { PREMIERS_BARN_MODULE } from "../rules/mythos-module";
import { END_NARRATIONS } from "../module/barn-of-premier";

function adrianSecrets(): string[] {
  const npc = PREMIERS_BARN_MODULE.npcs?.find((n: any) => n.id === "adrian_estrom");
  expect(npc).toBeDefined();
  return (npc as any).personality.secrets as string[];
}

describe("艾德里安（adrian_estrom）的 secrets 不得声称他知道自己被米-戈欺骗", () => {
  it("**错误行为红线**：不含「意识到」+「欺骗」这类知情表述", () => {
    const secrets = adrianSecrets();
    for (const s of secrets) {
      const claimsAwareness = s.includes("意识到") && (s.includes("欺骗") || s.includes("骗"));
      expect(claimsAwareness).toBe(false);
    }
  });

  it("**正确**：secrets 的内容与原文一致——他至今不知道自己被利用", () => {
    const secrets = adrianSecrets();
    const joined = secrets.join("");
    // 原文（section_01:15-18）与 True End 第2行的共同事实：他"没有意识到"
    // 自己被利用/被欺骗——不是断言具体措辞，是断言"不知道"这个方向没写反。
    expect(joined).toMatch(/没有意识到|不知道|至今.*(利用|欺骗)/);
  });

  it("与 True End 叙事互相印证：两处都确认艾德里安直到最后都不知情", () => {
    const trueEnd = END_NARRATIONS.find((e) => e.id === "true")!;
    const trueEndText = trueEnd.lines.join("");
    expect(trueEndText).toContain("没有意识到自己不过是被利用的工具");
    // secrets 不能与 True End 的这个事实反着说。
    const secrets = adrianSecrets();
    const secretsText = secrets.join("");
    const secretsContradict = secretsText.includes("意识到") && secretsText.includes("欺骗");
    expect(secretsContradict).toBe(false);
  });
});
