// 叙事文本出处强制——开发·三档约束 阶段7 任务③。
//
// 背景：module/types.ts:44 的 ModuleData.provenance? 早就预见了这个问题
// （types.ts:37-43："运行模组是生成物，不是手稿……没有这份记录，模组
// 数据就成了黑盒"），但这个字段从来没被任何代码写过、任何判据检查过——
// 保护写在类型声明里，从未真正生效。
//
// 本阶段【不】给全模组一次性补出处——那等于把从未核对过的内容一次性盖
// 章"已审"，反而掩盖了它们从没被核对过的事实（本文件与 rule 说明同一个
// 立场）。只做一件更小、更诚实的事：给 EndNarration 加了可选的
// sourceRef 字段（module/types.ts），本轮新增/修改的两条（True End、
// near_truth）已经手工核对过原文并填了引用；没有核对过的旧条目（good/
// bad/normal）显式登记在下面的"未核对"名单里，不是悄悄放行。
//
// 判据用法与 FABRICATION_REGISTRY/KNOWN_UNREACHABLE 同一个模式：
// sourceRef 缺失的条目集合必须与 UNREVIEWED_NARRATION_REGISTRY 的 id
// 集合精确相等。名单外新出现的缺失（比如以后有人加一条新结局却没填
// sourceRef 也没有把它加进这份名单）会让判据变红——逼着人要么补上
// sourceRef，要么显式承认"这条也还没核对"，不能什么都不做就让判据
// 悄悄绿过去。

import type { EndNarration } from "../module/types";

export interface UnreviewedNarrationEntry {
  id: string;
  note: string;
}

/**
 * 已知缺 sourceRef、本阶段不追溯的结局条目。
 *
 * good/normal：本轮完全没有改动这两条的文案，也没有为它们核对过原文
 * 出处——阶段5/6 全量补出处时应该处理，不是这一阶段的范围。
 * bad：本轮同样没有改动/核对，且这个结局本身当前不可达（触发条件
 * bad_lever_pulled 没有任何生产者，见 barn-of-premier.ts 里"让不可达
 * 成为显式事实"那段注释）——不可达不代表不需要出处，同样显式登记，
 * 不因为"反正玩家看不到"就当作例外处理。
 */
export const UNREVIEWED_NARRATION_REGISTRY: UnreviewedNarrationEntry[] = [
  { id: "good", note: "本轮未触碰 Good End 文案，未核对过原文出处——留给阶段5/6 全量补出处" },
  { id: "bad", note: "本轮未触碰 Bad End 文案，未核对过原文出处；该结局当前不可达，同样需要显式登记而非默认豁免" },
  { id: "normal", note: "本轮未触碰 Normal End 文案，未核对过原文出处——留给阶段5/6 全量补出处" },
];

/**
 * 找出缺 sourceRef（未填或全空白）的结局条目 id 列表。
 * 判据用法见文件头：这份结果的集合必须与 UNREVIEWED_NARRATION_REGISTRY
 * 的 id 集合精确相等。
 */
export function findMissingSourceRef(narrations: EndNarration[]): string[] {
  return narrations
    .filter((n) => !n.sourceRef || n.sourceRef.trim() === "")
    .map((n) => n.id);
}
