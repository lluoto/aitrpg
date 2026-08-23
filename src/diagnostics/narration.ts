// 叙述质量的判据：**这段话有没有用角色还拿不到的信息**。
//
// 起因是实跑开场里的一句：
//   「循声望去，只见**米尔·特里坎**正抱着篮球站在院里……」
// 调查员刚走到门口、还没见过任何人 —— 不可能知道这孩子叫什么。
// 旁白替他们作弊了。这类毛病肉眼极难发现：名字读起来很自然，
// 而写模组的人自己当然知道那是谁。
//
// ⚠ 判据第一版直接 `text.includes("米尔")`，当场报了个假阳性 ——
// 那一局的调查员叫**米尔德丽德**·罗德里格斯。子串匹配认错人，
// 正是这轮反复在修的同一种病，这次出在判据自己身上。
// 所以名字比对必须看**边界**，而且这一份要被测试与探针共用，
// 各写一份迟早会漂。

// 名字比对的实现挪到了 `play/names.ts` —— **生产代码也要用**：
// 车卡生成的 PC 背景不能撞上模组 NPC 的名字。
// 一份数据两套解析是这轮反复在修的病，名字比对不能重蹈覆辙。
export { nameParts, mentionsName, knownNameVariants, namesPerson } from "../play/names";
import { namesPerson } from "../play/names";

interface NameLeak {
  sceneId: string;
  npc: string;
  hit: string;
}

interface LeakScene {
  id: string;
  npcIds?: readonly string[];
  openingAtmosphere?: string;
}
interface LeakNpc { id: string; name: string }

/**
 * 场景的开场氛围里，提前点了哪些**本场景 NPC** 的名字。
 *
 * 只查本场景的 NPC：提到一个不在场的人（「门口贴着写给艾德里安的便条」）
 * 是合法叙述，那是线索不是穿帮。
 */
export function namesLeakedInOpening(
  scenes: readonly LeakScene[],
  npcs: readonly LeakNpc[],
  /** 本局调查员等**不在模组里**的名字。少了它，「米尔德丽德」会被当成「米尔」 */
  extraNames: readonly string[] = [],
): NameLeak[] {
  const out: NameLeak[] = [];
  // 比对逻辑在 `play/names.ts` 的 namesPerson —— 运行时那道闸门用的是同一个函数。
  // 判据和生产各写一份，迟早会漂到只有一边判得出来。
  const allNames = [...npcs.map((n) => n.name), ...extraNames];
  for (const scene of scenes) {
    const opening = scene.openingAtmosphere;
    if (!opening) continue;
    for (const npcId of scene.npcIds ?? []) {
      const npc = npcs.find((n) => n.id === npcId);
      if (!npc) continue;
      const hit = namesPerson(opening, npc.name, allNames);
      if (hit) out.push({ sceneId: scene.id, npc: npc.name, hit });
    }
  }
  return out;
}
