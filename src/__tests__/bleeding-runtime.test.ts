// 流血在**一局里**真的掉血了没有。
//
// 上面那份单测证明规则层对，这一份证明它被接上了 ——
// 两件事分开测，因为接之前规则层的单测也是全绿的：
// `processBleeding()` 写得好好的，只是从来没人调用。
// 「函数对」和「函数会被跑到」是两个命题。

import { describe, test, expect } from "bun:test";
import { GameSession } from "../api/game-session";
import { newStatus } from "../rules/status-effects";

const CFG = {
  apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
  model: "mock", maxTokens: 512, temperature: 0.7,
};

/** 往世界里放一个带流血状态的实体，然后推回合 */
function seed(session: GameSession, status: string[]) {
  const w = (session as unknown as { world: { upsertEntity: (e: unknown) => void } }).world;
  w.upsertEntity({
    id: "victim", name: "受伤者", type: "npc",
    hp: 20, maxHp: 20, ac: 10, status, position: "tavern",
  });
}

function hpOf(session: GameSession): number {
  const w = (session as unknown as { world: { getCurrentState: () => { entities: Record<string, { hp: number }> } } }).world;
  return w.getCurrentState().entities["victim"]!.hp;
}

function statusOf(session: GameSession): string[] {
  const w = (session as unknown as { world: { getCurrentState: () => { entities: Record<string, { status: string[] }> } } }).world;
  return w.getCurrentState().entities["victim"]!.status;
}

describe("流血每回合真的掉血", () => {
  test("**错误行为的红线**：带流血状态推一回合，HP 必须下降", async () => {
    // 接之前这条必红：标签在，但没有任何东西读它。
    const s = new GameSession("bleed-1", "cosmic-horror", CFG);
    seed(s, [newStatus("bleeding")]);
    const before = hpOf(s);
    await s.act("看看四周");
    expect(hpOf(s)).toBeLessThan(before);
  });

  test("**正确**：流血会到期，不是永远掉血", async () => {
    const s = new GameSession("bleed-2", "cosmic-horror", CFG);
    seed(s, [newStatus("bleeding")]); // 默认 3 回合
    for (let i = 0; i < 5; i++) await s.act("等待");
    expect(statusOf(s).some((x) => x.startsWith("流血"))).toBe(false);
  });

  test("**错误行为的红线**：没有限时状态的实体不得平白掉血", async () => {
    // 只测「会掉血」是不够的：一个每回合无差别扣血的实现也能过上面那条。
    const s = new GameSession("bleed-3", "cosmic-horror", CFG);
    seed(s, []);
    const before = hpOf(s);
    await s.act("看看四周");
    expect(hpOf(s)).toBe(before);
  });

  test("**干扰输入**：别人的裸标签既不掉血也不被清掉", async () => {
    const s = new GameSession("bleed-4", "cosmic-horror", CFG);
    seed(s, ["重伤:左臂", "疯狂"]);
    const before = hpOf(s);
    await s.act("看看四周");
    expect(hpOf(s)).toBe(before);
    expect(statusOf(s)).toContain("重伤:左臂");
    expect(statusOf(s)).toContain("疯狂");
  });

  test("**干扰输入**：已经倒下的人不再结算流血", async () => {
    // 这一掷决定的是「还会不会更糟」，人已经躺下就没什么可决定的
    //（同 needsMajorWoundCheck 的口径）。
    const s = new GameSession("bleed-5", "cosmic-horror", CFG);
    const w = (s as unknown as { world: { upsertEntity: (e: unknown) => void } }).world;
    w.upsertEntity({
      id: "victim", name: "受伤者", type: "npc",
      hp: 0, maxHp: 20, ac: 10, status: [newStatus("bleeding")], position: "tavern",
    });
    await s.act("看看四周");
    expect(hpOf(s)).toBe(0);
    // 状态没被推进 —— 倒下的人身上标签原样留着
    expect(statusOf(s).some((x) => x.startsWith("流血"))).toBe(true);
  });
});
