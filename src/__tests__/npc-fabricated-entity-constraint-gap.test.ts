// 约束层能不能拦住"NPC 编造模组里不存在的人/物"——用真实撞坑案例测。
//
// 背景：analysis/sim/2026-08-30-barn-natural-play.md:58 记录的真实
// 输出——「名单什么的早让老板锁进抽屉了，哪轮得到你翻。」——酒吧保镖
// 编出了模组数据里完全不存在的三样东西：老板、抽屉、名单。todo-43
// 已经明说"凭空发明的名词"这一半没做（它修的是"否认已知对象"那一半，
// narrative_denies_undiscovered_clue，scope 只管 narration，且专门处理
// "同一句话同时提到否认措辞+一个已知未发现线索的名字"这种模式，跟本
// 案例的形状不一样——这里不是否认已知线索，是凭空造出线索之外的新
// 实体）。
//
// ⚠ 这条测试记录的是【现状】，不是【规格】——不拦不代表"以后也不用拦"，
// 也不是这份测试认可这个行为，只是如实钉住"改动前是这样"，下次真的
// 去补这个域的时候，这条测试要么改成断言"拦得住"（判据升级），要么
// 被这份新判据取代，不能悄悄留着一份跟新行为对不上的旧断言。
//
// bun test src/__tests__/npc-fabricated-entity-constraint-gap.test.ts

import { describe, it, expect } from "bun:test";
import { applyConstraints } from "../agent/constraints";
import { checkDialogueText } from "../world/world-constraint";
import type { NPCPersonality } from "../agent/types";

// 照 bar_bouncer 真实数据搭的人格卡——knowledge/secrets 里都没有
// "老板"/"抽屉"/"名单"这几个词，它们是 LLM 纯凭空发明的，不是从
// npc.knowledge 泄露出来的（那种情况该由 checkSecretLeak 管，不是本条
// 要测的缺口）。
const BOUNCER: NPCPersonality = {
  name: "酒吧保镖",
  role: "酒吧保镖",
  personality: "话不多，态度强硬粗鲁。维持秩序，有人闹事就动手。",
  background: "维森酒吧的保安。",
  goals: ["维持酒吧秩序"],
  speech_style: "话不多，态度强硬粗鲁。",
  knowledge: ["不清楚客人的事，问了也白问——有事去问前台。"],
  secrets: [],
};

// 真实实跑抓到的原句，一字不改。
const FABRICATED_OUTPUT = "名单什么的早让老板锁进抽屉了，哪轮得到你翻。";

describe("约束层对「NPC 编造模组里不存在的人/物」的实际覆盖面（todo-41/todo-43 同一个缺口）", () => {
  it("**记录现状，不是期望行为**：applyConstraints 当前拦不住这句真实的编造内容", () => {
    const result = applyConstraints(FABRICATED_OUTPUT, BOUNCER, "neutral", 0);
    // 如实断言"当前不拦"——checkSecretLeak/checkKnowledgeBoundary/
    // checkAttitudeConsistency 三层都不认识"编造了模组里没有的实体"
    // 这件事本身，只认"泄露了 secrets 里的内容""用了越界表述词""基调
    // 跟情绪矛盾"，凭空造词不落在任何一条判据里。
    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.sanitized).toBe(FABRICATED_OUTPUT); // 原样通过，没有被改写
  });

  it("**记录现状，不是期望行为**：checkDialogueText（世界观约束）同样拦不住，传不传 sceneId 都一样", () => {
    // npc-agent.ts 两处调用点（respond/speakUp）都没传 sceneId（todo-43
    // 记录过这个既有缺口）——这里两种都测，证明即便补上 sceneId 参数，
    // 现有的 DEFAULT_CONSTRAINTS 域也没有一条认识"老板"/"抽屉"/"名单"
    // 这类词，不是"传参漏了"就能解决的，问题在域本身不存在。
    expect(checkDialogueText(FABRICATED_OUTPUT)).toBeNull();
    expect(checkDialogueText(FABRICATED_OUTPUT, "weisen_bar")).toBeNull();
  });

  it("**对照（约束层本身没有整体失效）**：同一条约束层确实能拦住它设计要拦的东西——时代错置词", () => {
    // 不是"约束层完全不工作"，是"这一类越界它没有对应的判据"——用一句
    // 真正会被拦的话做对照，证明上面两条测的是"这句话没被拦"，不是
    // "约束函数本身坏了返回值恒为空"。
    const anachronistic = "你可以用手机搜一下这个地址。";
    expect(checkDialogueText(anachronistic)).not.toBeNull();
  });

  it("**对照（secrets 泄露仍然会被拦）**：如果编造的内容恰好命中 npc 自己的 secrets，checkSecretLeak 这一档照样工作——本条测的缺口只在「凭空造词」，不是整个 secrets 机制失效", () => {
    const withSecret: NPCPersonality = { ...BOUNCER, secrets: ["之前有个贵客包场办狂欢派对，来的人都要登记"] };
    const leaking = "其实之前有个贵客包场办狂欢派对，来的人都要登记，我就随口一说。";
    const result = applyConstraints(leaking, withSecret, "neutral", 0);
    expect(result.passed).toBe(false);
    expect(result.warnings.some((w) => w.includes("秘密泄露"))).toBe(true);
  });
});
