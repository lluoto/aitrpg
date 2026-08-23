// 「玩家这句话能不能对到他想去的地方」——**判据本身**。
//
// 上一版的错法（review-request 第 6 条）：12 种说法里 8 种都含完整地名，
// 跑出 100%；补进会掉的用例之后是 66.9%。用例没有区分力，不是匹配有多好。
//
// 更隐蔽的第二个错：「换个地方看看」「去那边」这种句子**根本没指定目标**。
// 把它们算进「目标命中率」的分母，等于要求引擎读心；分子永远是 0，
// 指标看着很难看，却什么也没度量。这类输入唯一能要求的是：
// 引擎必须**承认自己是替玩家挑的**（forced=true），别装成玩家自己选的。
//
// 于是用例分三类，各有各的判据：
//   positive   话里唯一确定了一个目标 → 必须选中它，且 forced=false
//   negative   话里明确排除了某个目标 → 必须不选中它（顺带：说了要去哪就得去哪）
//   ambiguous  话里没有唯一目标        → 必须 forced=true，不进命中率
//
// 纯函数，不碰模组也不碰引擎，因此可以拿构造出来的结果做正反夹具。

/** 用例的三种性质。它决定用哪条判据，也决定进不进命中率分母 */
type PhraseKind = "positive" | "negative" | "ambiguous";

export interface PhraseCase {
  /** 稳定标识，报告里按它归类 */
  id: string;
  kind: PhraseKind;
  /** 人读的说明 */
  desc: string;
  /** 玩家说的那句话 */
  said: string;
  /**
   * 期望到达的场景 id。
   * positive 必填；negative 选填（「别去 A，去 B」时填 B）；ambiguous 必须为 null。
   */
  wantSceneId: string | null;
  /** 明确**不该**被选中的场景 id。只有 negative 用 */
  forbidSceneId?: string | null;
}

/** 引擎对一句话的处理结果 */
export interface PhraseOutcome {
  /** 引擎最终选中的目标场景 id；null = 没有可走的连接 */
  chosenSceneId: string | null;
  /** 引擎是否承认「没听清，我替你挑的」 */
  forced: boolean;
  /**
   * 哪些连接的匹配键出现在这句话里（按候选顺序）。
   * 没有这一项，判据只能说「没对上」，说不出**为什么**。
   */
  matched?: { targetSceneId: string; key: string }[];
}

/**
 * 一条用例没通过，是**哪一类**没通过。
 *
 * 三类的修法完全不同，混在一个「命中率」里等于知道有病不知道病在哪：
 *   no-key      一个键都没命中 → 缺同义词/简称，匹配方式本身太窄
 *   rival-only  只命中了别人的键 → 子串比对认错了人（重叠地名、否定）
 *   ambiguous   自己和别人都命中 → 靠列表顺序抢先，换个顺序就翻车
 *   forced-hit  目标对了但引擎自己标了替选 → 是蒙对的，不是听懂的
 */
type PhraseFailKind = "no-key" | "rival-only" | "ambiguous" | "forced-hit" | "other";

export function classifyFailure(c: PhraseCase, o: PhraseOutcome): PhraseFailKind {
  const matched = o.matched;
  if (!matched) return "other";
  const want = c.wantSceneId;
  const hitSelf = want !== null && matched.some((m) => m.targetSceneId === want);
  const hitRival = matched.some((m) => m.targetSceneId !== want);
  if (matched.length === 0) return "no-key";
  if (hitSelf && hitRival) return "ambiguous";
  if (!hitSelf && hitRival) return "rival-only";
  if (hitSelf && o.forced) return "forced-hit";
  return "other";
}

type PhraseVerdict = "pass" | "fail";

interface PhraseJudgement {
  verdict: PhraseVerdict;
  /** 失败原因；通过时为空串。报告直接引用，不再另行拼装 */
  why: string;
  /** 这条是否计入「目标命中率」的分母 */
  countsTowardHitRate: boolean;
}

/**
 * 判一条用例。
 *
 * ⚠ 三类的判据**必须不同**，否则就是上一版那种「全绿或全红」的假指标：
 *   - positive 要的是「选对了且不是替选的」
 *   - negative 要的是「没选中被排除的那个」——这条与连接顺序无关，
 *     正是「别去警察局，去维森酒吧」在连接表里警察局排前面时会掉的那条
 *   - ambiguous 要的是「承认替选」，选到哪儿都不算错
 */
export function judgePhrase(c: PhraseCase, o: PhraseOutcome): PhraseJudgement {
  if (c.kind === "ambiguous") {
    return o.forced
      ? { verdict: "pass", why: "", countsTowardHitRate: false }
      : {
          verdict: "fail",
          why: `歧义输入却报 forced=false —— 引擎把替选伪装成玩家自己的选择（落到「${o.chosenSceneId ?? "(null)"}」）`,
          countsTowardHitRate: false,
        };
  }

  if (c.kind === "negative") {
    // 用例自身先要成立：被排除的和要去的不能是同一个地方。
    // 实际造出过「别去下水道，去下水道」—— 同一个场景挂了两条连接，
    // 干扰项按「别的连接」取就撞上了自己。这种用例判不出任何东西，
    // 必须**当成用例坏了**报出来，不能混进「反例通过率」当作引擎的失败。
    if (c.forbidSceneId && c.forbidSceneId === c.wantSceneId) {
      return {
        verdict: "fail",
        why: `用例本身不成立：被排除的和要去的是同一个场景「${c.wantSceneId}」`,
        countsTowardHitRate: false,
      };
    }
    if (c.forbidSceneId && o.chosenSceneId === c.forbidSceneId) {
      return {
        verdict: "fail",
        why: `话里明确排除了「${c.forbidSceneId}」，仍被选中`,
        countsTowardHitRate: false,
      };
    }
    if (c.wantSceneId && o.chosenSceneId !== c.wantSceneId) {
      return {
        verdict: "fail",
        why: `应到「${c.wantSceneId}」，实到「${o.chosenSceneId ?? "(null)"}」`,
        countsTowardHitRate: false,
      };
    }
    if (c.wantSceneId && o.forced) {
      return {
        verdict: "fail",
        why: `到了「${c.wantSceneId}」但标成替选（forced=true）—— 不是认出来的，是碰上的`,
        countsTowardHitRate: false,
      };
    }
    return { verdict: "pass", why: "", countsTowardHitRate: false };
  }

  // positive
  if (o.chosenSceneId !== c.wantSceneId) {
    return {
      verdict: "fail",
      why: `应到「${c.wantSceneId}」，实到「${o.chosenSceneId ?? "(null)"}」`,
      countsTowardHitRate: true,
    };
  }
  if (o.forced) {
    return {
      verdict: "fail",
      why: `目标对了但标成替选 —— 引擎是按分数蒙对的，不是听懂的`,
      countsTowardHitRate: true,
    };
  }
  return { verdict: "pass", why: "", countsTowardHitRate: true };
}

interface PhraseTally {
  hit: number;
  total: number;
}

export interface PhraseReport {
  /** 按 case.id 归并 */
  byId: Map<string, { kind: PhraseKind; desc: string; tally: PhraseTally }>;
  /** 只统计 positive —— ambiguous 不进分母是这次修的重点 */
  hitRate: PhraseTally;
  /** negative 的通过率单列 */
  negative: PhraseTally;
  /** ambiguous 的「老实承认率」单列 */
  ambiguous: PhraseTally;
  /** 失败按成因分类 —— 三类的修法完全不同 */
  failKinds: Map<PhraseFailKind, number>;
  failures: string[];
}

export function newPhraseReport(): PhraseReport {
  return {
    byId: new Map(),
    hitRate: { hit: 0, total: 0 },
    negative: { hit: 0, total: 0 },
    ambiguous: { hit: 0, total: 0 },
    failKinds: new Map(),
    failures: [],
  };
}

export function addPhraseResult(
  report: PhraseReport,
  c: PhraseCase,
  o: PhraseOutcome,
  /** 报告里要写的上下文，如「从 town_premier 出发」 */
  context = "",
): PhraseJudgement {
  const j = judgePhrase(c, o);
  const slot = report.byId.get(c.id) ?? { kind: c.kind, desc: c.desc, tally: { hit: 0, total: 0 } };
  slot.tally.total++;
  if (j.verdict === "pass") slot.tally.hit++;
  report.byId.set(c.id, slot);

  const bucket =
    c.kind === "positive" ? report.hitRate : c.kind === "negative" ? report.negative : report.ambiguous;
  bucket.total++;
  if (j.verdict === "pass") bucket.hit++;

  if (j.verdict === "fail") {
    const kind = c.kind === "ambiguous" ? "other" : classifyFailure(c, o);
    report.failKinds.set(kind, (report.failKinds.get(kind) ?? 0) + 1);
    report.failures.push(`[${c.kind}/${c.id}·${kind}]${context ? " " + context : ""} 「${c.said}」→ ${j.why}`);
  }
  return j;
}

export function pct(t: PhraseTally): string {
  return t.total === 0 ? "n/a" : `${((t.hit / t.total) * 100).toFixed(1)}%`;
}
