// 「玩家这句话对到场景里哪条线索」——判据本身。
//
// 照 src/diagnostics/phrasing.ts（移动匹配的同类判据）的形状做：这仓库在
// 模糊匹配上栽过——第一版 phrasing 判据「12 种说法里 8 种含完整地名 →
// 100%」，看着像匹配很好，实际只测了最简单的情形。线索匹配的数据形状更
// 不规整（32 条里只有 5 条带 "/" 分隔位置和动作，其余 27 条是自由文本），
// 误匹配率不能靠肉眼估计，必须有判据。
//
// 用例分三类，各有各的判据（与 phrasing.ts 完全对应）：
//   positive   给了能唯一定位到某条线索的提示 → 必须选中它
//   negative   提示明确排除了某条线索，同时点名了另一条 → 必须不选中被排除的
//   ambiguous  提示同时对应场景里两条以上线索 → 必须报"需要问清楚"，不能猜
//
// 纯函数，不碰模组也不碰引擎，可以拿构造出来的结果做正反夹具。

/** 用例的三种性质 */
type CluePhraseKind = "positive" | "negative" | "ambiguous";

export interface CluePhraseCase {
  /** 稳定标识，报告里按它归类 */
  id: string;
  kind: CluePhraseKind;
  /** 人读的说明 */
  desc: string;
  /** 玩家说的那句话 */
  said: string;
  /**
   * 期望命中的线索 id。
   * positive 必填；negative 选填（"别搜 A 那边，我要看 B"时填 B）；
   * ambiguous 必须为 null。
   */
  wantClueId: string | null;
  /** 明确不该被选中的线索 id。只有 negative 用 */
  forbidClueId?: string | null;
}

/** 匹配引擎对一句话的处理结果 */
export interface CluePhraseOutcome {
  /** 精确命中的线索 id；null = 没命中或命中多个 */
  chosenClueId: string | null;
  /** 命中多个候选时，这些候选的 id 列表 */
  ambiguousIds: string[];
  /**
   * 哪些候选的匹配键出现在这句话里。
   * 没有这一项，判据只能说"没对上"，说不出为什么——见 phrasing.ts 的
   * 同一句注释：一个键都没命中、命中了别处的键、还是好几条都命中靠顺序
   * 抢先，是完全不同的三种毛病。
   */
  matched?: { clueId: string; key: string }[];
  /**
   * matchSceneClues 是不是在"输入本身没有位置/对象信号"这条路径上早退的
   * （见 clue-match.ts 的 ClueMatchTrace.noSignal）。这条早退发生在
   * `matched` 被填充**之前**，所以 `matched.length === 0` 既可能是"真的
   * 一个键都没命中"（no-key，缺同义词），也可能是"压根没打算找键"
   * （no-signal，正确行为）——两件事结构上长得一样，只能靠这个显式标记
   * 分开，不能靠猜。调用方（跑分脚本/测试）必须把
   * matchSceneClues() 返回的 `trace.noSignal` 原样转发到这里，不能自己
   * 编一个 —— 编的话这个字段就没有意义了。
   */
  noSignal?: boolean;
  /**
   * 走完整生产决策路径（decideClueMatch，见 clue-match.ts）时的决策类型。
   *
   * ⚠ 只给直接调 matchSceneClues() 的用例留空——那些用例本来就有实质
   * 信号，两层短路都不会触发，decideClueMatch 的结果与 matchSceneClues
   * 一致，不影响判据。"a-裸动词"这类用例必须带上它：生产对裸动词从
   * decideClueMatch 的入口短路就返回 fallback，压根不会走到
   * matchSceneClues 内部——若只调 matchSceneClues() 直接测，判的是生产
   * 从不会执行到的一条路（判据全绿、行为却是它想禁止的那个，见
   * diag-clue-phrasing.ts 头注释）。
   */
  decisionKind?: "resolve" | "ask" | "deny" | "fallback";
}

/**
 * 一条用例没通过，是哪一类没通过。
 *
 * 五类的修法完全不同，混在一个"命中率"里等于知道有病不知道病在哪：
 *   no-signal   输入本身没有可区分的位置/对象信号（裸动词一类）→
 *               **不用修**——这是正确行为，matchSceneClues 老实报了
 *               "该问不该猜"，用例本身就不该指望它精确命中（应该改标成
 *               ambiguous 用例，见 diag-clue-phrasing.ts 的用例生成）
 *   no-key      给了信号但一个键都没命中 → 切词/简称方式太窄，缺同义词
 *   rival-only  只命中了别的候选的键 → 子串比对认错了人
 *   ambiguous   自己和别处都命中 → 靠候选顺序抢先（本判据设计上不该有这类，
 *               matchSceneClues 命中多个时诚实报 ambiguous 而不是抢一个）
 *   forced-hit  选对了但引擎把它标成了"多个候选之一"，不是精确命中
 *
 * ⚠ no-signal 必须先判——它和 no-key 结构上都长成 `matched.length === 0`，
 * 唯一的区别是 matchSceneClues 有没有走到"尝试找键"这一步。原先没有这个
 * 显式标记时，判据只能靠 `matched.length === 0` 猜，把"输入没给信号"
 * （正确行为）误诊成"匹配方式太窄"（no-key，暗示该加同义词）——实测 26
 * 条失败里 14 条带着这个错误处方，照它去"修"正好会把上一轮刚加上的
 * 拒绝猜测行为改回去。
 */
type CluePhraseFailKind = "no-signal" | "no-key" | "rival-only" | "ambiguous" | "forced-hit" | "other";

export function classifyClueFailure(c: CluePhraseCase, o: CluePhraseOutcome): CluePhraseFailKind {
  if (o.noSignal) return "no-signal";
  const matched = o.matched;
  if (!matched) return "other";
  const want = c.wantClueId;
  const hitSelf = want !== null && matched.some((m) => m.clueId === want);
  const hitRival = matched.some((m) => m.clueId !== want);
  if (matched.length === 0) return "no-key";
  if (hitSelf && hitRival) return "ambiguous";
  if (!hitSelf && hitRival) return "rival-only";
  if (hitSelf && o.chosenClueId !== want) return "forced-hit";
  return "other";
}

type ClueVerdict = "pass" | "fail";

interface ClueJudgement {
  verdict: ClueVerdict;
  /** 失败原因；通过时为空串 */
  why: string;
  /** 是否计入"目标命中率"的分母 */
  countsTowardHitRate: boolean;
}

/**
 * 判一条用例。
 *
 * 三类判据必须不同，否则又是一版"全绿或全红"的假指标：
 *   - positive 要的是"精确选中它"（不是命中多个候选之一）
 *   - negative 要的是"没选中被排除的那个"
 *   - ambiguous 要的是"引擎没有擅自挑一个"——报出多个候选（真的有歧义）
 *     或压根没命中（没给够信号）都算老实，唯独不能精确选中某一个
 */
export function judgeCluePhrase(c: CluePhraseCase, o: CluePhraseOutcome): ClueJudgement {
  if (c.kind === "ambiguous") {
    // 带 decisionKind 的用例（走完整的 decideClueMatch 决策路径，见
    // diag-clue-phrasing.ts 的"a-裸动词"）：按决策类型判，能分清
    // "fallback（设计如此——没给信号，静默取候选首条，不是匹配失败）"
    // 与"resolve（本该 ask/fallback 却抢答了）"这两种完全不同的情况，
    // 而不是笼统地看 chosenClueId 是不是 null。ask/deny/fallback 都算诚实
    // （没有擅自精确选中一个），只有 resolve 才是真的抢答。
    if (o.decisionKind) {
      if (o.decisionKind !== "resolve") return { verdict: "pass", why: "", countsTowardHitRate: false };
      return {
        verdict: "fail",
        why: `歧义/无信号输入却精确选中了「${o.chosenClueId}」——擅自挑了一个（decisionKind=resolve，本该 fallback/ask）`,
        countsTowardHitRate: false,
      };
    }
    // ⚠ 这里曾经要求 ambiguousIds.length >= 2 才算过——但"没给任何位置
    // 提示"（比如裸的"侦查"）合法的诚实结果是"压根没命中"（chosen=null 且
    // ambiguousIds 为空），不是"报出多个候选"。matchSceneClues() 不看
    // "有没有给提示"这件事——那是调用方 resolveSceneClueMatch 的职责
    // （said 太短就回落旧行为，不会走到这里）。把"没命中"也当失败，等于
    // 拿匹配器没有的职责去考它，是判据自己的设计错误，不是匹配器的问题——
    // 这条判据本身就被诊断脚本抓到过一次假红，见 diag-clue-phrasing.ts。
    // 真正该守住的只有一件事：不能精确选中某一个（chosenClueId 必须为 null）。
    //
    // 没有 decisionKind 时才走这条老路径（当前所有 ambiguous 用例都会带
    // decisionKind，这支是给未来可能不经过 decideClueMatch 的用例兜底，
    // 不是活跃路径）。
    if (o.chosenClueId === null) return { verdict: "pass", why: "", countsTowardHitRate: false };
    return {
      verdict: "fail",
      why: `歧义/无信号输入却精确选中了「${o.chosenClueId}」——擅自挑了一个`,
      countsTowardHitRate: false,
    };
  }

  if (c.kind === "negative") {
    if (c.forbidClueId && c.forbidClueId === c.wantClueId) {
      return {
        verdict: "fail",
        why: `用例本身不成立：被排除的和要找的是同一条线索「${c.wantClueId}」`,
        countsTowardHitRate: false,
      };
    }
    if (c.forbidClueId && o.chosenClueId === c.forbidClueId) {
      return {
        verdict: "fail",
        why: `话里明确排除了「${c.forbidClueId}」，仍被选中`,
        countsTowardHitRate: false,
      };
    }
    if (c.wantClueId && o.chosenClueId !== c.wantClueId) {
      return {
        verdict: "fail",
        why: `应命中「${c.wantClueId}」，实命中「${o.chosenClueId ?? "(null)"}」`,
        countsTowardHitRate: false,
      };
    }
    return { verdict: "pass", why: "", countsTowardHitRate: false };
  }

  // positive
  if (o.chosenClueId !== c.wantClueId) {
    return {
      verdict: "fail",
      why: `应命中「${c.wantClueId}」，实命中「${o.chosenClueId ?? "(null)"}」${o.ambiguousIds.length > 0 ? `（报成歧义：${o.ambiguousIds.join("/")}）` : ""}`,
      countsTowardHitRate: true,
    };
  }
  return { verdict: "pass", why: "", countsTowardHitRate: true };
}

interface ClueTally {
  hit: number;
  total: number;
}

export interface CluePhraseReport {
  byId: Map<string, { kind: CluePhraseKind; desc: string; tally: ClueTally }>;
  /** 只统计 positive */
  hitRate: ClueTally;
  negative: ClueTally;
  ambiguous: ClueTally;
  failKinds: Map<CluePhraseFailKind, number>;
  failures: string[];
}

export function newCluePhraseReport(): CluePhraseReport {
  return {
    byId: new Map(),
    hitRate: { hit: 0, total: 0 },
    negative: { hit: 0, total: 0 },
    ambiguous: { hit: 0, total: 0 },
    failKinds: new Map(),
    failures: [],
  };
}

export function addCluePhraseResult(
  report: CluePhraseReport,
  c: CluePhraseCase,
  o: CluePhraseOutcome,
  context = "",
): ClueJudgement {
  const j = judgeCluePhrase(c, o);
  const slot = report.byId.get(c.id) ?? { kind: c.kind, desc: c.desc, tally: { hit: 0, total: 0 } };
  slot.tally.total++;
  if (j.verdict === "pass") slot.tally.hit++;
  report.byId.set(c.id, slot);

  const bucket =
    c.kind === "positive" ? report.hitRate : c.kind === "negative" ? report.negative : report.ambiguous;
  bucket.total++;
  if (j.verdict === "pass") bucket.hit++;

  if (j.verdict === "fail") {
    const kind = c.kind === "ambiguous" ? "other" : classifyClueFailure(c, o);
    report.failKinds.set(kind, (report.failKinds.get(kind) ?? 0) + 1);
    report.failures.push(`[${c.kind}/${c.id}·${kind}]${context ? " " + context : ""} 「${c.said}」→ ${j.why}`);
  }
  return j;
}

export function pct(t: ClueTally): string {
  return t.total === 0 ? "n/a" : `${((t.hit / t.total) * 100).toFixed(1)}%`;
}
