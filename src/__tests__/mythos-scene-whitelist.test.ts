// 模组摄取把文档小标题注册成了场景（任务 2 —— 这是那次毁局的根因）。
//
// 起因：mythos-module.ts 的 import() 曾经有一行
//   if (module.hooks) for (const h of module.hooks) if (h.condition) referencedScenes.add(h.condition);
// 把每条 hook 的 condition 无条件当场景注册。hook 的 condition 只是"触发条件"
// （可以是场景 id，也可以是道具名/典籍名——on_read_tome 类型的 hook 就是），
// 从来就不该等同于地点。谷仓模组实测：22 个真场景硬是被灌成了 39 个，混进去
// 的 17 条里有「主要_npc」「结局」「可选」这种一眼是文档小标题抽取管线漏进
// 来的东西。移动候选池取全量已注册场景，于是「查看餐桌、披萨盒」能被判定
// 送到「可能的敌人类」。
//
// 判据按"来源"而不是字符特征：地点 = 被声明（sceneDescriptions）∪ 被引用
// （npc/item/tome/clue 的 sceneId）∪ 被出口连接（module.exits 的 key 与
// target）。这里独立重算一遍这个公式（不是直接调用生产代码里的私有逻辑），
// 用来交叉验证 import() 的行为与设计意图一致，而不只是"跑过就算数"。

import { describe, it, expect } from "bun:test";
import {
  MythosModuleLoader,
  INNSMOUTH_MODULE,
  ARKHAM_LIBRARY_MODULE,
  PREMIERS_BARN_MODULE,
  type MythosModule,
  type MythosModuleHost,
} from "../rules/mythos-module";
import { MODULE_PREMIERS_BARN } from "../rules/custom-modules/premiers_barn";
import type { MessageType } from "../agent/types";

/** 独立重算白名单：sceneDescriptions ∪ npc/item/tome/clue 的 sceneId ∪ module.exits（key+target）。 */
function expectedWhitelist(m: MythosModule): Set<string> {
  const s = new Set<string>();
  if (m.sceneDescriptions) for (const sid of Object.keys(m.sceneDescriptions)) s.add(sid);
  if (m.npcs) for (const n of m.npcs) if (n.sceneId && n.sceneId !== "unknown") s.add(n.sceneId);
  if (m.items) for (const it of m.items) if (it.sceneId && it.sceneId !== "unknown") s.add(it.sceneId);
  if (m.tomes) for (const t of m.tomes) if (t.sceneId && t.sceneId !== "unknown") s.add(t.sceneId);
  if (m.clues) for (const c of m.clues) if (c.scene && c.scene !== "unknown") s.add(c.scene);
  if (m.exits) for (const [sid, list] of Object.entries(m.exits)) {
    s.add(sid);
    for (const e of list) s.add(e.target);
  }
  return s;
}

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
    registerScene(sceneId: string, _displayName: string, _description?: string) {
      registeredScenes.push(sceneId);
    },
    addMessage(_s: string, _c: string, _t: MessageType) { /* mock */ },
    activeRuleset: "cosmic-horror",
    currentRound: 1,
    registeredScenes,
  } as any;
}

// 谷仓模组实测混进去的 14 个非地点（文档小标题/hook narration 条件，来自
// on_read_tome / 结构化章节标题，不是可移动到的场景）。
// 步骤 2a-1 后 "奇怪的卡片" 从 sceneDescriptions 删除（它是 clue_card，不是地点），
// 加入此列表：它仍在 hooks 里，但不在 sceneDescriptions/exits 里，故不被注册。
const BARN_GARBAGE = [
  "在小镇内询问路人", "绑架犯的报道", "关于艾米丽难产的事件",
  "抽屉里的关于_号农场的转购协议", "与背景", "可选",
  "艾德里安会在外围布置_3_种陷阱", "与米戈的战斗", "关于缸中脑最后的去向",
  "结局", "主要_npc", "可能的敌人类", "以下的法术则视情况让_mi_go_使用",
  "奇怪的卡片", // 步骤 2a-1：线索，非地点，已从 sceneDescriptions 删除
];

describe("模组场景注册按来源判定白名单，不把 hook.condition 当场景（任务2）", () => {
  it("**正确**：谷仓模组注册场景数 → 24（步骤 2a-1/2a-2 后奇怪的卡片/菲碧_特里坎不再注册）", () => {
    const host = createMockHost();
    const loader = new MythosModuleLoader(host);
    loader.import(MODULE_PREMIERS_BARN);
    const unique = new Set(host.registeredScenes);
    expect(unique.size).toBe(24);
  });

  it("**错误行为红线**：14 个非地点一个都不在注册结果里", () => {
    const host = createMockHost();
    const loader = new MythosModuleLoader(host);
    loader.import(MODULE_PREMIERS_BARN);
    const unique = new Set(host.registeredScenes);
    for (const garbage of BARN_GARBAGE) {
      expect(unique.has(garbage)).toBe(false);
    }
  });

  it("**正确**：真地点一个都没丢——报亭只靠 exits 才在白名单里，仍然注册成功", () => {
    const host = createMockHost();
    const loader = new MythosModuleLoader(host);
    loader.import(MODULE_PREMIERS_BARN);
    const unique = new Set(host.registeredScenes);
    for (const real of ["报亭", "特里坎家", "加比的拖车房", "维森酒吧", "谷仓形建筑", "建筑内"]) {
      expect(unique.has(real)).toBe(true);
    }
  });

  it("**文本相似但合法**：注册结果与独立重算的白名单公式完全一致（不是巧合对上）", () => {
    const host = createMockHost();
    const loader = new MythosModuleLoader(host);
    loader.import(MODULE_PREMIERS_BARN);
    const unique = new Set(host.registeredScenes);
    expect(unique).toEqual(expectedWhitelist(MODULE_PREMIERS_BARN));
  });

  it("**边界**：内置模组（印斯茅斯/阿卡姆/谷仓精简版）场景数没有异常下跌——与独立重算的白名单公式一致", () => {
    for (const m of [INNSMOUTH_MODULE, ARKHAM_LIBRARY_MODULE, PREMIERS_BARN_MODULE]) {
      const host = createMockHost();
      const loader = new MythosModuleLoader(host);
      loader.import(m);
      const unique = new Set(host.registeredScenes);
      expect(unique).toEqual(expectedWhitelist(m));
      // 这几个模组的 hook.condition 用的是规范场景 id（本来就在白名单里），
      // 唯二例外是 on_read_tome 类型 hook 的 condition 是典籍名不是场景
      // （"扎多克的低语"/"塞拉伊诺断章"）——旧代码会把它们也错当场景注册，
      // 属于同一个 bug 的另一处实例，修完顺带一起没了，不是回归。
      expect(unique.has("扎多克的低语")).toBe(false);
      expect(unique.has("塞拉伊诺断章")).toBe(false);
    }
  });

  it("hook 本身仍然照常注册（narration 是 lore，没有被一起丢掉）", () => {
    const registeredHooks: any[] = [];
    const host = createMockHost();
    (host as any).registerHook = (h: any) => registeredHooks.push(h);
    const loader = new MythosModuleLoader(host);
    loader.import(MODULE_PREMIERS_BARN);
    expect(registeredHooks.length).toBeGreaterThan(0);
    // 关键是 hooks 数组本身完整过了 registerHook，不因为改了场景白名单就被截断
    expect(registeredHooks.length).toBe(MODULE_PREMIERS_BARN.hooks?.length ?? 0);
  });
});
