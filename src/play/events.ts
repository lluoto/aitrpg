// 一局的**结构化事件流**。与 `say()` 的自然语言播报并行，互不替代。
//
// 为什么要有这一层：诊断脚本原先全靠正则去猜播报文本，反复出错 ——
//   · `❤ X HP n → 0` 认得出「打到 0 血」，认不出「重伤体质检定失败→昏迷」
//     （后者只有一句叙述，HP 那行写的是 n → 3）
//   · `【格斗】` 分不清是敌人还手还是玩家用了个叫「格斗」的技能
//   · `/惩罚骰/` 把环境、疲劳、伤势三种来源混成一堆
// 这些都不是正则没写好，是**信息在文本里本来就不存在**。补正则只会补出
// 下一个假阳性。所以把判据需要的那几件事显式说出来。
//
// 纪律：
//   1. 事件是**附加**的，不改任何既有播报，也不参与剧本逻辑。
//      没有 onEvent 订阅者时 `emit()` 是一次 Map 查找 + 提前返回。
//   2. 只放**判据要用**的字段。想「以后可能有用」的一律不加 ——
//      没人消费的字段会先腐烂，然后被当成事实引用。
//   3. 字段是机器读的，不做展示格式化（不带百分号、不带全角括号）。

import type { WoundSeverity } from "../combat/wound-effects";

/** 掷骰的发起方是谁。诊断要靠它区分「玩家在动」和「敌人在动」 */
export type ActorKind = "pc" | "enemy";

/** 失去意识的成因。两条路径的播报完全不同，混在一起就会漏报 */
export type DownedCause =
  /** 伤害直接把 HP 打到 0 */
  | "hp-zero"
  /** 重伤（deep/grievous）体质检定失败 —— HP 还有剩，人先倒了 */
  | "major-wound-con";

export type PlayEvent =
  /**
   * 一次技能检定。**只有走 `check()` 的才算** —— SAN 检定另有事件，
   * 因为它是被动反应不是主动行动，两者混在一起会让「昏迷还在掷骰」永远报警。
   */
  | {
      type: "check";
      actor: string;
      actorKind: ActorKind;
      /** 原样的技能标签，如 `体质（重伤）`、`侦查（发现捕兽夹）` */
      skill: string;
      skillValue: number;
      /** 调用方传进来的额外惩罚骰（环境/夜色等），不含伤势 */
      envPenalty: number;
      /** 角色身上未处理伤势自动带来的惩罚骰。`ignoreWound` 时为 0 */
      woundPenalty: number;
      /** 实际生效的总惩罚骰（上限 2） */
      totalPenalty: number;
      /** 这一掷是否豁免自身伤势 —— 只有「重伤体质检定」该是 true */
      ignoreWound: boolean;
      /**
       * 这条掷骰路径**会不会读角色身上的伤势**。
       *
       * 走 `checks.ts` 的 `check()` 就是 true。但战斗里调查员的攻击掷骰
       * （`combat.ts` 的 `pcAttack`）直接调 `CoCEngine.skillCheck`，
       * 绕过了 `check()` —— 于是伤势惩罚在战斗攻击上根本没接。
       *
       * 少了这一位，`woundPenalty: 0` 就有两种含义（「没伤」和「有伤但这条路不看」），
       * 判据分不出来，真缺陷会被当成正常通过。
       */
      woundAware: boolean;
      roll: number;
      success: boolean;
      level: string;
    }
  /** SAN 检定。被动反应，单列以免与「昏迷期间掷骰」判据混淆 */
  | { type: "san-check"; actor: string; roll: number; loss: number; passed: boolean }
  /**
   * 一次 HP 伤害结算。
   *
   * `severity` 是 `calcSeverity` 的原始结论，**不受播报标签影响** ——
   * 播报在 HP 归零时会把「重伤」写成「昏迷/濒死」，据文本分档必然漏掉这一档。
   */
  | {
      type: "damage";
      who: string;
      from: number;
      to: number;
      maxHp: number;
      amount: number;
      severity: WoundSeverity;
    }
  /** 记下一处未处理伤势（`recordWound` 真的写进去了才发） */
  | { type: "wound"; who: string; severity: WoundSeverity; penaltyDice: number }
  /** 伤势被处理掉（急救成功 / 苏醒） */
  | { type: "wound-healed"; who: string }
  | { type: "downed"; who: string; cause: DownedCause }
  | { type: "revived"; who: string; by: string }
  | { type: "combat-start"; enemy: string }
  | { type: "combat-round"; enemy: string; round: number }
  /**
   * 调查员在战斗里攻击一次。
   *
   * 单列而不是从 `check` 事件里反推：一度靠 `woundAware === false` 认它
   * （因为那条路径绕过了 `check()`），后来伤势惩罚接上去了，那个标记就不再
   * 等于「这是攻击」—— 判据会连人带账一起算错。
   * 「这是不是一次攻击」是语义，不该寄生在实现细节上。
   */
  | { type: "pc-attack"; actor: string; skill: string; success: boolean; damage: number }
  /**
   * 敌人还手一次。`outcome` 三态：没掷中 / 被闪开 / 命中。
   * 有这条就不必再从 `【格斗】` 反推攻击者是谁。
   */
  | {
      type: "enemy-attack";
      enemy: string;
      target: string;
      outcome: "miss" | "dodged" | "hit";
      damage: number;
    }
  | { type: "combat-end"; enemy: string; result: "defeated" | "fled" | "lost" }
  | { type: "scene-enter"; sceneId: string; sceneName: string; revisit: boolean }
  /** 一个决策岔口。`options` 是给出的选项数，0 表示无路可走 */
  | { type: "decision"; options: number; chosen: string }
  /** 正式结局。**没有这条就是没有结局**，「进过终局场景」不算 */
  | { type: "ending"; id: string; label: string }
  /** 本局没走到结局就收场（目前只有全员倒下一种） */
  | { type: "aborted"; reason: "all-down" }
  /**
   * 一次 LLM 调用的结果。
   *
   * 为什么要有：车卡阶段的八项背景与小传**本来就是 LLM 写的**，
   * 模板只是失败兜底。而 `llmOnce` 过去把每条失败路径都咽了
   * （`if (!resp.ok) return ""`、`catch { return "" }`），
   * 调用方再 `if (!raw) return base` 悄悄退回模板 ——
   * 于是「LLM 挂了」和「LLM 写得平淡」在产物上长得一模一样。
   * 兜底池每个职业每项只有 3 句，一旦回落，同职业两个角色必然撞句，
   * 读起来就是「像直接抄那几个词条」。
   */
  | {
      type: "llm-call";
      /** 干什么用的：`background` / `backstory` / `prologue` … */
      purpose: string;
      ok: boolean;
      /** 失败原因；成功时为空串 */
      reason: string;
      ms: number;
    };

export type PlayEventType = PlayEvent["type"];

/** 从事件流里挑一种类型，带类型收窄。诊断脚本里到处要用 */
export function ofType<T extends PlayEventType>(
  events: readonly PlayEvent[],
  type: T,
): Extract<PlayEvent, { type: T }>[] {
  return events.filter((e): e is Extract<PlayEvent, { type: T }> => e.type === type);
}
