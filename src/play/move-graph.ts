// 移动代价：弱版邻接 + 按场景图跳数计时。
//
// 玩法裁决（开发 A · 任务 3）：目标只要在场景表内就能去，不要求与当前场景
// 有出口直连（"弱版邻接"）；但不是瞬移——代价按出口图上的**最短跳数**算，
// 1 跳等于 act() 每回合本来就会推进的那 1 tick，跳数更多才额外加时间。
//
// ⚠ 出口当**无向图**用：已核实 scenes.exits 49 条边里 48 条本就成对，
// 单向那 1 条是数据写法不是设计意图（一条门只能进不能出说不通）。
// 全图除「奇怪的卡片」（它是物品被误当场景注册，孤立无进出边）外连通，
// 最长 10 跳、平均 4.42 跳。
//
// 关于孤立/不可达目标：拒绝移动并说明，不编一个固定代价。跳数是从图上
// 量出来的事实，图上量不出到达方式时，编一个数字（不管多大）都是在编造
// 一个没有依据的移动方式；拒绝并如实说明「没有已知路线可达」，比编造
// 一个能到达的假象更诚实——这也是本仓反复在修的那类错误的反面。

export interface SceneGraphNode {
  readonly id: string;
  readonly exits: readonly { readonly target: string }[];
}

/**
 * 把 `WorldStateManager.listScenes()` 的结果建成无向邻接表。
 *
 * 图的节点集是**全部已注册场景**，不只是出现在某条边里的那些——
 * 否则「奇怪的卡片」这类零出口、且从未被别的场景当出口目标提到的场景，
 * 会被判成「压根不存在」而不是「存在但孤立」，两种情况在下游需要给
 * 不同的提示（前者是打错地名，后者是"这地方没有已知路线"）。
 */
export function buildSceneGraph(scenes: readonly SceneGraphNode[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const ensure = (id: string) => {
    let s = adj.get(id);
    if (!s) { s = new Set<string>(); adj.set(id, s); }
    return s;
  };
  for (const s of scenes) ensure(s.id);
  for (const s of scenes) {
    for (const e of s.exits) {
      ensure(s.id).add(e.target);
      ensure(e.target).add(s.id);
    }
  }
  return adj;
}

/**
 * BFS 最短跳数。
 *
 * 返回值：
 *   0    —— from === to（原地不动）
 *   null —— to 不在图里（场景压根没注册），或与 from 不在同一连通分量
 *           （孤立场景，图上量不出到达方式）——两种情况调用方都该拒绝移动，
 *           不必也不应该区分着报（对玩家来说都是"去不了"）。
 */
export function shortestHops(
  adj: ReadonlyMap<string, ReadonlySet<string>>,
  from: string,
  to: string,
): number | null {
  if (from === to) return 0;
  if (!adj.has(from) || !adj.has(to)) return null;

  const visited = new Set<string>([from]);
  let frontier: string[] = [from];
  let hops = 0;
  while (frontier.length > 0) {
    hops++;
    const next: string[] = [];
    for (const cur of frontier) {
      for (const nb of adj.get(cur) ?? []) {
        if (visited.has(nb)) continue;
        if (nb === to) return hops;
        visited.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return null; // 遍历完整个连通分量都没找到——不连通
}
