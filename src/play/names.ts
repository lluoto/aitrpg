// 名字比对：**这段话有没有真的点到某个名字**。
//
// 放在 `play/` 而不是 `diagnostics/`，因为生产代码也要用 ——
// 车卡生成的 PC 背景不能撞上模组 NPC 的名字（见 play-module 的
// `collidesWithModuleNames`）。判据与生产共用同一份，各写一份迟早会漂。
//
// ⚠ 边界不能靠「两侧是不是汉字」判。中文没有词边界：
// 「只见**米尔**抱着球」里 `见` 也是汉字，按那条规则真阳性也会被否掉。
// 精确的问法是：**这次出现是不是被某个更长的已知名字盖住了**。
// 「米尔德丽德·罗德里格斯」里的「米尔」是被盖住的；
// 「只见米尔抱着球」里的不是。已知名单调用方给得出来，不必猜。
//
// 这套规则是被打脸四次打出来的（米尔德丽德全名、米尔德丽德短名、
// 模组标题《普瑞米尔的谷仓》、以及「艾达」附近的「他」），
// 结论是：**开放文本上的中文短串匹配不可靠**，名单封闭时才判得准。

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
 * `longerNames` 是别的已知名字，用来排除「被更长的名字盖住」的误认。
 * 不给的话按字面算 —— 宁可按字面，也不靠猜边界。
 */
export function mentionsName(
  text: string,
  part: string,
  longerNames: readonly string[] = [],
): boolean {
  if (!part || part.length < 2) return false;

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
 * 「**米尔德丽德**下意识地攥紧了……」（不带姓），只放全名就匹配不上。
 */
export function knownNameVariants(names: readonly string[]): string[] {
  return [...new Set(names.flatMap(nameParts))];
}

/**
 * 这段话有没有点到 `person` 的名字 —— 点到了就返回命中的那一截，没有返回空串。
 *
 * 存在的理由是**运行时**要用：LLM 生成的场景过渡句印在 NPC 被介绍**之前**，
 * 它一旦叫出名字，旁白就替调查员作弊了（原样的毛病见本文件开头）。
 * 静态模组数据有测试守着，生成的文本以前没人查。
 *
 * `otherKnownNames` 给全（全场 NPC + 本局调查员），否则「米尔德丽德」
 * 会被当成「米尔」—— 那是这套规则被打脸的第一次。
 */
export function namesPerson(
  text: string,
  person: string,
  otherKnownNames: readonly string[] = [],
): string {
  const own = new Set(nameParts(person));
  const longer = knownNameVariants(otherKnownNames).filter((n) => !own.has(n));
  return nameParts(person).find((p) => mentionsName(text, p, longer)) ?? "";
}
