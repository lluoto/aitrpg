// 开发C·任务1：定下哪套是真相。
//
// 仓库里同时存在三套结局表示：
//   1. END_NARRATIONS（EndNarration[]，barn-of-premier.ts）—— 判定真相，
//      唯一声明式、能被机器求值的一份。
//   2. Ending[]（ModuleData.endings，buildEndings() 产出）—— 展示/派生
//      文本，自由文本，不可求值。ModuleData.endings 是必填字段（摄取
//      管线也要用），不删除整个字段，但 id 集合必须与 END_NARRATIONS
//      一致——这条判据就是防止两份未来悄悄长出矛盾的唯一保险。
//   3. MythosModule.endings（ModuleEnding[]，conditionText 自由文本，
//      premiers_barn.ts 数据）—— GameSession 自由跑团路径用的遗留模组
//      格式，同样只有展示文本。原先会被复制进 host.moduleEndings 这个
//      Map，但那个 Map 从建出来就没有任何读者——已经删掉那次复制。
//
// bun test src/__tests__/module-endings-consistency.test.ts

import { describe, it, expect } from "bun:test";
import { BARN_OF_PREMIER, END_NARRATIONS } from "../module/barn-of-premier";
import { MODULE_PREMIERS_BARN } from "../rules/custom-modules/premiers_barn";
import { MythosModuleLoader, type MythosModuleHost } from "../rules/mythos-module";
import type { MessageType } from "../agent/types";

function idSet(arr: Array<{ id: string }>): Set<string> {
  return new Set(arr.map((e) => e.id));
}

describe("三套结局表示的 id 集合必须一致——防止判定真相与展示文本悄悄长出矛盾", () => {
  it("**正确**：ModuleData.endings（展示文本）的 id 集合与 END_NARRATIONS（判定真相）完全一致", () => {
    const truthIds = idSet(END_NARRATIONS);
    const displayIds = idSet(BARN_OF_PREMIER.endings);
    expect(displayIds).toEqual(truthIds);
  });

  it("**正确**：MythosModule.endings（遗留模组的展示文本）的 id 集合与 END_NARRATIONS 完全一致", () => {
    const truthIds = idSet(END_NARRATIONS);
    const legacyIds = idSet(MODULE_PREMIERS_BARN.endings ?? []);
    expect(legacyIds).toEqual(truthIds);
  });

  it("**错误行为红线**：id 集合缺一个就必须报错——不是「大致相似就算过」", () => {
    const truthIds = idSet(END_NARRATIONS);
    // 构造一份缺了 "bad" 的展示文本集合，模拟判定端加了结局、展示端忘了同步
    const drifted = new Set([...truthIds].filter((id) => id !== "bad"));
    expect(drifted).not.toEqual(truthIds);
  });
});

describe("host.moduleEndings 这个只写不读的注册表已经删除", () => {
  function createMockHost(): MythosModuleHost & { registeredScenes: string[] } {
    const registeredScenes: string[] = [];
    return {
      mythosSpells: new Map(),
      knownMythosSpells: [],
      sceneItems: new Map(),
      itemDescriptions: new Map(),
      world: {
        upsertEntity(_e: any) { /* mock */ },
        logEvent(_p: any) { /* mock */ },
      },
      addMessage(_s: string, _c: string, _t: MessageType) { /* mock */ },
      activeRuleset: "cosmic-horror",
      currentRound: 1,
      registeredScenes,
    } as any;
  }

  it("**正确**：加载带 endings 的模组后，host 上不再出现 moduleEndings 字段", () => {
    const host = createMockHost();
    const loader = new MythosModuleLoader(host);
    // MODULE_PREMIERS_BARN 确实带 endings 数据（真实模组，不是构造夹具）
    expect((MODULE_PREMIERS_BARN.endings ?? []).length).toBeGreaterThan(0);
    loader.import(MODULE_PREMIERS_BARN);
    expect((host as any).moduleEndings).toBeUndefined();
  });

  it("**目标行为错误的对照**：模组的 endings 数据本身没有被删掉（只是不再复制进一个没人读的 Map）", () => {
    expect((MODULE_PREMIERS_BARN.endings ?? []).map((e) => e.id).sort()).toEqual(
      [...idSet(END_NARRATIONS)].sort(),
    );
  });
});
