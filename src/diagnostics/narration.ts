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

// ⚠ 边界不能靠「两侧是不是汉字」判。中文没有词边界：
// 「只见**米尔**抱着球」里 `见` 也是汉字，按那条规则会被判成「不算点名」。
// 第一版就是这么写的，当场把真阳性也否掉了。
//
// 精确的问法是：**这次出现是不是被某个更长的已知名字盖住了**。
// 「米尔德丽德·罗德里格斯」里的「米尔」是被盖住的；
// 「只见米尔抱着球」里的不是。已知名单调用方给得出来（模组 NPC + 本局调查员），
// 所以不必猜。

/**
 * 名字里可用来指认的片段：全名，以及「·」分出来的各截。
 * 括号补充（「食尸鬼（可选）」）先剥掉。
 */
export function nameParts(name: string): string[] {
  const bare = name.replace(/[（(].*?[）)]/g, "").trim();
  const parts = [bare, ...bare.split("·")].map((s) => s.trim());
  return [...new Set(parts)].filter((s) => s.length >= 2);
}

/**
 * `text` 里有没有真的**点到**这个名字。
 *
 * 关键是边界：片段两侧若还连着汉字，那就是**另一个名字**。
 *   「米尔德丽德·罗德里格斯」里的「米尔」不是「米尔·特里坎」
 *   「特里坎家」里的「特里坎」是地名不是人名 —— 但这条留给调用方判，
 *   本函数只负责「这几个字是不是被更长的名字包着」。
 *
 * 全名（含「·」）不做边界检查：它本身已经足够长、足够独特。
 */
export function mentionsName(
  text: string,
  part: string,
  /** 别的已知名字（本局调查员、其它 NPC）。用来排除「被更长的名字盖住」的误认 */
  longerNames: readonly string[] = [],
): boolean {
  if (!part || part.length < 2) return false;

  // 先算出「被别的名字占用」的区间
  const covered: [number, number][] = [];
  for (const other of longerNames) {
    if (other === part || !other.includes(part)) continue;
    let f = 0;
    for (;;) {
      const at = text.indexOf(other, f);
      if (at < 0) break;
      covered.push([at, at + other.length]);
      f = at + other.length;
    }
  }

  let from = 0;
  for (;;) {
    const at = text.indexOf(part, from);
    if (at < 0) return false;
    const inside = covered.some(([s, e]) => at >= s && at + part.length <= e);
    if (!inside) return true; // 有一处是干净的提及
    from = at + part.length;
  }
}

/**
 * 把一组名字摊成所有可指认的写法。
 *
 * ⚠ 排除名单**必须摊开**：叙述里用的常常是短名。
 * 实跑踩到过 —— 调查员是「米尔德丽德·罗德里格斯」，而序章写的是
 * 「**米尔德丽德**下意识地攥紧了……」（不带姓）。
 * 排除名单只放全名时，这一处匹配不上，于是 NPC「米尔·特里坎」的「米尔」
 * 被判成提前泄漏 —— 判据又一次认错人。
 */
export function knownNameVariants(names: readonly string[]): string[] {
  return [...new Set(names.flatMap(nameParts))];
}

export interface NameLeak {
  sceneId: string;
  npc: string;
  hit: string;
}

export interface LeakScene {
  id: string;
  npcIds?: readonly string[];
  openingAtmosphere?: string;
}
export interface LeakNpc { id: string; name: string }

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
  const allNames = knownNameVariants([...npcs.map((n) => n.name), ...extraNames]);
  for (const scene of scenes) {
    const opening = scene.openingAtmosphere;
    if (!opening) continue;
    for (const npcId of scene.npcIds ?? []) {
      const npc = npcs.find((n) => n.id === npcId);
      if (!npc) continue;
      const own = new Set(nameParts(npc.name));
      const longer = allNames.filter((n) => !own.has(n));
      const hit = nameParts(npc.name).find((p) => mentionsName(opening, p, longer));
      if (hit) out.push({ sceneId: scene.id, npc: npc.name, hit });
    }
  }
  return out;
}
