// 摄取管线 · 条目评分键（手建，一次性）
//
// ⚠️ 这份数据**绝不能进 prompt**。它是评分口径，不是输入。
//    把基准的答案喂给模型，测出来的准确率不说明任何事 ——
//    与「靠引文判场景」自我验证是同一类错误。
//    `ingest-scoring-key-boundary.test.ts` 结构性地拦着这件事，不是靠这段注释。
//
// 为什么必须手建：实测 37 条分类结果里 21 条（57%）无法按名字与基准对上
// （14 条名字在基准里不存在 + 7 条本身无名），逐字匹配的天花板是 43%。
// 没有这份键，线索分类的准确率只能覆盖不到一半的条目，
// 而看不见的那 57% 里既可能全对也可能全错。见 docs/index-program.md §条目分类的混淆矩阵。
//
// 怎么建的：`tools/_gen-key-worksheet.ts` 把每个 ▶ 条目与**它所在场景**的基准对象配在一起，
// 搜索空间从「整本 32 线索 + 10 物品 + 44 连接」缩到单场景的 0–4 个候选，
// 于是每条判断都有依据、可复核。工作表在 docs/evidence/key-worksheet.txt。
//
// **这个办法有一处盲区，而且已经害过一次**：按场景切候选，就看不见**跨场景**的基准对象。
// clue_adrian_wallet 挂在 `与艾德里安的会面` 名下，内容却是证物室与交火现场的物品 ——
// 于是 p7:L11 那一栏的候选里根本没有它，第一版把那条标成了 `none`（详见该条注释）。
// 复核时对「基准里没有对应对象」这类判断要额外去全本搜一遍，别只信工作表那一屏。
//
// 键是对着《普瑞米尔的谷仓 ver1.03.pdf》定的。PDF 换版本这份键就得重建 ——
// 键用 `p{page}:L{line}`，而那个行号是**清洗后**的（见 sectionize 的 SourceRef.line），
// 清洗逻辑一变行号就漂。重建时先跑工作表脚本。

/** 一个条目在基准里实际是什么。一条可以同时是多个（`老旧文件` 就是 clue 又是 item）。 */
export type ActualKind =
  | { kind: "clue"; id: string }
  /**
   * 也包含**陷阱**。基准没有独立的陷阱结构，陷阱就是 `ModuleItem.type === "trap"`，
   * 所以这里不设 `trap` 变体 —— 这个字段记的是「基准里实际是什么」，基准里它就是 item。
   *
   * 但分类器的六种类别里**有** `trap`，而且它 4/4 全判对
   * （见 docs/index-program.md §条目分类的混淆矩阵）。于是 `p9:L13`/`p9:L15`/`p9:L17`/`p10:L4`
   * 这 4 条 —— 39 条里的 10% —— 只有在**算分时把 item id 解回 `ModuleItem.type`**
   * 才算得中；直接拿 `trap` 去比 `item`，4 个正确答案会被记成 4 个 miss。
   *
   * 这条约定原先一个字都没落在代码里，全靠下一个人自己想到。现在由
   * `ingest-scoring-key-boundary.test.ts` 的「陷阱条目 ↔ type=trap 的基准物品」双向钉住。
   */
  | { kind: "item"; id: string }
  | { kind: "connection" }
  | { kind: "npc_knowledge" }
  | { kind: "npc_secret" }
  /** 分支叙事：基准里没有对应结构，引擎层也没有 */
  | { kind: "event" }
  /**
   * 基准根本没收这一条 —— 不是抽错，是基准的取舍。
   *
   * **「收了但只收一份」不算 `none`。** p7:L11 第一版就是这么错的：基准把两处的 `驾驶证`
   * 去重成一个 `item:drivers_license`，被记成了「没收」，于是分类器一个正确答案被判成错。
   * 真要表达去重，得另开字段（比如 `duplicateOf`），挤进这里就等于让报告再也分不开这两件事。
   */
  | { kind: "none" };

const clue = (id: string): ActualKind => ({ kind: "clue", id });
const item = (id: string): ActualKind => ({ kind: "item", id });
const conn: ActualKind = { kind: "connection" };
const know: ActualKind = { kind: "npc_knowledge" };
const secret: ActualKind = { kind: "npc_secret" };
const event: ActualKind = { kind: "event" };
const none: ActualKind = { kind: "none" };

/**
 * 键：`sourceKey` → 该条目在基准里实际是什么。
 *
 * 39 条，与全书 ▶ 条目一一对应（含 2 条长在 npc 块上、进不了场景条目流的）。
 * 注释里写的是判定依据，不是复述条目内容 —— 复述没用，依据才是下次复核时要看的。
 */
export const ENTRY_SCORING_KEY: Record<string, ActualKind[]> = {
  // ── 菲碧·特里坎（npc 块，不进场景条目流）──
  // 这两条对应 phoebe_tricam 的 knowledge / secrets，基准逐条收了
  "p3:L8": [know],
  "p3:L9": [secret],

  // ── 加比的拖车房 ──
  // 基准三条线索的 findMethods 描述就是这三个条目名（少了「宣言」二字）
  "p3:L17": [clue("clue_pistol_in_bag")],
  "p3:L19": [clue("clue_drugs")],
  "p3:L20": [clue("clue_card")],

  // ── 维森酒吧 ──
  // 三条无名条目，按技能与内容对上基准三条：取悦→包场、社交→贵客身份、幸运→打听
  "p4:L12": [clue("clue_bar_mass_booking")],
  "p4:L13": [clue("clue_bar_guest_identity")],
  "p5:L1": [clue("clue_bar_ask_around")],

  // ── 与艾德里安的会面 ──
  // 精神分析那条是 clue_adrian_psychoanalysis 的第一个 findMethod
  "p5:L15": [clue("clue_adrian_psychoanalysis")],
  // 一条对两条线索：条目正文的前半句「如果他冷静了下来，会认罪，并宣言那些失踪案件都是
  // 自己所做，但是要求调查员帮助他的妻女，并且他会告知藏匿的农庄」**逐字**就是
  // clue_adrian_psychoanalysis 的 description 结尾（revelation 又复述了一遍）；
  // 而「告知藏匿的农庄」本身另收成 clue_adrian_farm_location（findMethods 写的是 npc_dialogue）。
  // 先前只标了后者 —— 按本键在 p8:L5 已经立下的先例（一条条目里有两个基准对象就标两个），
  // 前者也该在。这不改准确率（分类器答的是 event，两种标法都算错），改的是覆盖数与一对多不变式。
  "p5:L17": [clue("clue_adrian_psychoanalysis"), clue("clue_adrian_farm_location")],
  // 夺枪导致击毙：纯分支结局，基准里没有任何结构承载它
  "p6:L1": [event],

  // ── 证物室 ──
  "p6:L16": [item("key_anti_theft")],
  "p7:L1": [item("photo_farm")],
  "p7:L3": [item("drivers_license")],

  // ── 交火现场 ──
  // 驾驶证在这里是第二次出现。**这条先前标成 `none`，是错的，而且是把一个正确答案判成了错**。
  //
  // 两处站不住：
  //  1. `item:drivers_license` 是存在的（barn-of-premier.ts 的 buildItems）。它的 sceneId 是
  //     police_evidence_room，所以**绑定**是单份 —— 但那个对象基准收了。去重不等于没收，
  //     而 `none` 的语义写死在类型上：「基准根本没收这一条」。
  //  2. 基准还专门为这条写了 clue_adrian_wallet：description 是「如果调查员从证物室获得
  //     **或从交火现场找到**艾德里安的东西（**驾驶证**、住宅钥匙、农场照片等）」，
  //     findMethods 是 `[{type:"item", …「从证物室/交火现场获取艾德里安的物品」}]`。
  //     物件与场景基准都点名了。
  //
  // 分类器这条答的是 `item`，是对的；旧键把它记成了错。键是尺子，尺子上的错比被量的东西上的错更糟。
  //
  // 如果哪天真想要「一个基准对象只许被一个条目认领」这条计分口径，那是另一个字段的事
  //（比如给标记加个 `duplicateOf`），不能挤进 `none` —— 挤进来就等于用「基准没收」
  // 去表达「基准收了但只收一份」，两件事在报告里再也分不开。
  "p7:L11": [item("drivers_license")],
  "p7:L12": [item("key_house")],

  // ── 艾德里安在镇子内的住宅 ──
  // 一层什么也没有，基准没收
  "p8:L3": [none],
  // 搜查二层只是通往杂物室的步骤，基准把它并进了三条线索的 findMethod 描述里，
  // 没有独立对象
  "p8:L4": [none],
  // 检查杂物室一条条目里同时有孕妇照片与金锭挂饰 —— 对应基准两条线索
  "p8:L5": [clue("clue_townhouse_photo"), clue("clue_townhouse_gold")],
  // 正文为空（▶ 行只有名字），但名字本身就是那条线索
  "p8:L6": [clue("clue_townhouse_transfer")],

  // ── 农场外围（陷阱区）──
  // 陷阱在基准里是 ModuleItem.type="trap"
  "p9:L13": [item("trap_bear")],
  "p9:L15": [item("trap_shotgun")],
  "p9:L17": [item("trap_sound")],

  // ── 农场主别墅 ──
  "p10:L4": [item("trap_sulfuric_acid")],

  // ── 谷仓形建筑 ──
  // 这两条是**进入方式**（锁匠/力量开门、攀爬跳跃上屋顶），不是线索
  "p10:L9": [conn],
  "p10:L10": [conn],

  // ── 建筑内（谷仓大厅）──
  "p10:L14": [clue("clue_barn_body")],
  "p10:L15": [clue("clue_barn_victims")],
  // 氧气装置的细节，基准两条线索都没收它
  "p11:L1": [none],

  // ── 中控室 ──
  "p11:L8": [clue("clue_control_supplies")],
  // 基准把它叫「中控台拉杆」，条目叫「中控台的开关」—— 名字不同，是同一个东西
  "p11:L9": [clue("clue_control_lever")],

  // ── 艾德里安的卧室 ──
  // 拉门通往下水道，基准 connections 里就有「前往下水道」
  "p12:L3": [conn],
  "p12:L4": [clue("clue_bedroom_gun")],
  // 基准叫「日记本与老旧文件」，条目叫「床头柜」—— findMethod 描述写的是「侦查或挪开床头柜」
  "p12:L5": [clue("clue_bedroom_diary")],
  // **唯一的双角色条目**：基准同时收成 Clue 与 ModuleItem。
  // 下一轮做线索时不能假设「已判为 item ⇒ 不是 clue」
  "p12:L6": [clue("clue_bedroom_old_doc"), item("old_document")],

  // ── 下水道 ──
  "p12:L12": [clue("clue_sewer_bodies")],
  // 听到婴儿啼哭是转场氛围，基准没收成线索
  "p12:L14": [none],

  // ── 维修间（终局场景）──
  "p13:L7": [clue("clue_final_workbench")],

  // ── 比较大的奇怪管道（上一轮判成场景的误报块）──
  // 条目本身是真线索，只是它在基准里属「维修间」而不是这个块
  "p13:L11": [clue("clue_final_brain_jars")],
};

/** 键里去重后的实际类别分布，供报告与测试用 */
export function keyDistribution(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const kinds of Object.values(ENTRY_SCORING_KEY)) {
    for (const k of kinds) out[k.kind] = (out[k.kind] ?? 0) + 1;
  }
  return out;
}
