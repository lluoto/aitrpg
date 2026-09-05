// 开发·三方审计补语义——已确证臆造的存档（机器可读）。
//
// 背景：`three-way-audit.ts` 的 `FABRICATION_REGISTRY` 只查【方括号】
// 标注的术语，长期读数是 0——但 0 从来不等于"没有臆造过"，它的准确
// 含义是"没有原文查无出处的方括号术语"。在它显示 0 的整段时间里，
// 已经确证过三条真实臆造，全部靠人通读原文才发现，三方审计工具一条
// 都没抓到（原因见下面每条的 `whyToolMissed`）：
//
//   ① True End 台词声称"她知道，米—戈欺骗了他们所有人"——与原文
//      （section_12:12-18、:61-71）明确写着"艾米丽被艾德里安欺骗，
//      以为自己只是失去了视觉与触觉"直接矛盾。commit a0fd9f9 已修。
//   ② mythos-module.ts 里艾德里安的 secrets 声称"意识到被米-戈欺骗"
//      ——与原文（section_01:15-18"完全没有意识到自己完全是被利用了"）
//      方向正相反，且与 True End 自己第2行互相矛盾。commit 34dbcad 已修。
//   ③ photo_farm.revelation 声称"照片背面写着农场的地址坐标"——原文
//      （section_06.txt:2-9）压根没有"照片背面"或"坐标"，是把一段
//      "拿照片比对+导航检定"的调查活动压缩成一句编造的捷径。本轮
//      （开发·三方审计补语义 任务①）已修。
//
// `docs/now.md`「失败要主动喊出来，别指望别人从『零条 warn』里猜」
// 是这份存档存在的理由——0 这个数字本身不会说话，得有一处地方把
// "0 是什么意思、不是什么意思"明确写下来，且是机器能核对的形式，
// 不是只写在注释里指望人记得。
//
// 判据用法（`confirmed-fabrication-log.test.ts`）：对每一条，把它挂靠
// 的模组数据（`source` 字段指明是 `barn-of-premier.ts` 的默认导出还是
// `mythos-module.ts` 的 `PREMIERS_BARN_MODULE`）序列化成文本，断言
// `fabricatedText` 不再是这段文本的子串。名单外的模组数据没有这层
// 保护——同 `FABRICATION_REGISTRY`/`KNOWN_UNREACHABLE` 一个模式：
// 显式登记 + 判据对每一条断言，不是自动扫描发现新的。
//
// ⚠⚠ 能力边界（同 three-way-audit.ts:21-33 的处理方式，别让下一个人
// 以为绿了就等于"这类问题不会再发生"）：这份判据只能挡**逐字重现**
// 已经登记过的这几句话——把 fabricatedText 换一种说法（哪怕意思完全
// 一样）重新写回数据里，判据看不见，会照样绿。它不是语义检查，是
// 字面串匹配；能查的只有"这句话有没有原样回来"，查不了"有没有一句
// 新的话在说同一件被否定过的事"。`confirmed-fabrication-log.test.ts`
// 里有一条测例专门验证这条边界是真的（构造一句同义改写，断言判据
// 抓不到），不是写在注释里的空口承诺。这也是为什么这份存档解决不了
// 三方审计"看不见语义矛盾"这条根本限制——它只是把已经人工找到的
// 几个具体实例钉住，不让它们静默地重新出现，仅此而已。
//
// ── 与 `module/representation-consistency.ts` 的 `KNOWN_INCONSISTENCIES`
// 分工（开发·场景 id 收敛 N11，2026-09-04 补记，避免两份登记表之间
// 出现单向链接——之前只有 representation-consistency.ts 提到这份存档，
// 反过来没有，交接规则没写清楚）──
//
//   KNOWN_INCONSISTENCIES        已发现、**未修复**的跨表示不一致；
//                                 判据对每一条只做"是不是还在名单里"的
//                                 存在性核对，不做字面串回归护栏。
//   CONFIRMED_FABRICATION_LOG    已确认、**已修复**的臆造；判据对每
//                                 一条断言修复后的原文不再逐字出现，
//                                 是真正的回归护栏（见上面 ⚠⚠ 能力边界）。
//
// **交接规则**：`KNOWN_INCONSISTENCIES` 里的某一条一旦被订正（数据
// 改了、不再是"两侧各执一词"），不能直接从名单里删掉就算完——要把
// 它迁进这份存档，补一条新的 `ConfirmedFabricationEntry`（挂错误的
// 那一侧原文当 `fabricatedText`，`fixCommit` 填订正的那次提交），
// 靠这条新记录去防止同一句话未来又静默地写回去。只删不迁 = 那处
// 曾经犯过的错从此没有任何机器判据在盯着，跟从来没发现过没有区别。
//
// 开发·陈旧记录纠正+收敛前置 N10 任务②B2 已经在 `KNOWN_INCONSISTENCIES`
// 里核对出 4 条确认无出处的内容（艾德里安/流浪汉/Mi-Go 站位、绑架
// 人数），当时特意**没有**直接塞进这份存档——因为那 4 条本轮没有修，
// 塞进来会让"已修复防回弹"这条不变量方向反转（见
// `docs/notes/engine.md`「谷仓模组两份表示收敛方案」一节 B2 的记录）。
// (g) 步骤 3（订正确认的事实错误）真正把它们改过来的那一轮，必须
// 按上面的交接规则把这 4 条从 `KNOWN_INCONSISTENCIES` 迁进这里，
// 不是直接删除——这是本节新增的存在理由，防止真的到了那一步时，
// 因为两份登记表之间没有写清楚交接规则而被漏掉。

export interface ConfirmedFabricationEntry {
  /** 唯一 id，供测试按名索引，不依赖数组下标 */
  id: string;
  /** 臆造原文——逐字，变异检验会把它原样放回数据里验证判据变红 */
  fabricatedText: string;
  /** 这段文本挂靠哪份模组数据——判据据此决定序列化谁 */
  source: "barn-of-premier" | "mythos-module" | "premiers-barn";
  /** 具体位置（文件 + 字段路径），供人复核 */
  location: string;
  /** 怎么被发现的——这几条无一例外都是人工通读原文才发现的 */
  discoveredBy: string;
  /** 三方审计工具当时为什么看不见这条——每条理由都不一样，不能一概而论 */
  whyToolMissed: string;
  /** 修复它的 commit */
  fixCommit: string;
}

export const CONFIRMED_FABRICATION_LOG: ConfirmedFabricationEntry[] = [
  {
    id: "true-end-emily-knew",
    fabricatedText: "但她知道，米—戈欺骗了他们所有人。",
    source: "barn-of-premier",
    location: "END_NARRATIONS（id: \"true\"）第 2 行",
    discoveredBy:
      "人工通读原文 section_12:12-18、:61-71 核对 True End 文案时发现：原文明确写着艾米丽被" +
      "艾德里安欺骗，以为自己只是失去了视觉与触觉，根本不知道自己是缸中脑；旧文案却让她在结局里" +
      "开口点破整场骗局，语义方向整个反了。",
    whyToolMissed:
      "这句话不带任何方括号——three-way-audit.ts 的方括号术语审计只查【被标注的词】是否在原文里" +
      "查得到，这句话里一个词单独查都能在原文找到出处（\"知道\"\"欺骗\"都是原文词汇），只有整句" +
      "话拼起来的意思与原文矛盾，而这属于三方审计文件头 :21-33 早就写明的能力边界——它看不见语义矛盾。",
    fixCommit: "a0fd9f9",
  },
  {
    id: "adrian-secrets-aware",
    fabricatedText: "意识到被米-戈欺骗",
    source: "mythos-module",
    location: "PREMIERS_BARN_MODULE.npcs[adrian_estrom].personality.secrets",
    discoveredBy:
      "人工核对 section_01:15-18（\"完全没有意识到自己完全是被利用了\"）与 True End 自己的第 2 行" +
      "（\"艾德里安直到瘫痪在病床上，都没有意识到自己不过是被利用的工具\"）时发现两处互相矛盾——" +
      "secrets 写的是「知道」，原文与另一处叙事都写的是「不知道」，方向正相反。",
    whyToolMissed:
      "同上一条，字面词汇本身都能在原文查到出处（\"意识到\"\"欺骗\"都是常见词），三方审计的" +
      "存在性检查查不出\"这句话的意思是不是反的\"；而且这条数据在 secrets 字段里，" +
      "`AUDITED_MODULE_FILES` 当时虽然已经覆盖 mythos-module.ts（阶段7任务②），覆盖的是" +
      "\"文件被扫到没有\"，不是\"扫到的每句话语义对不对\"。",
    fixCommit: "34dbcad",
  },
  {
    id: "photo-farm-coordinates",
    fabricatedText: "照片背面写着农场的地址坐标。",
    source: "barn-of-premier",
    location: "buildItems()（id: \"photo_farm\"）.revelation",
    discoveredBy:
      "开发·三方审计补语义 任务①：人工核对 section_06.txt:2-9 时发现原文写的是一段调查活动" +
      "（拿照片对照小镇周围地貌，本地人靠灵感、外地人靠导航检定，失败可以求助本地 NPC），" +
      "全文没有任何地方提到\"照片背面\"或\"坐标\"。",
    whyToolMissed:
      "这条与前两条不同类——不是语义矛盾（这句话本身不与原文任何一句话直接冲突），是**编造机制**：" +
      "原文没写\"背面\"这个概念，也没写\"坐标\"这种可以直接抄下来的东西，是凭空发明的一个更简单的" +
      "捷径，替换掉了原文写明的检定流程。三方审计的方括号术语审计与声明实体审计都不查散文里的自由" +
      "叙述文本（`ModuleItem.revelation` 从不带方括号），这类臆造只能靠人逐句核对原文才能发现。",
    fixCommit: "80abf68",
  },
  // ── 步骤 3（开发·场景集合收敛 N12，2026-09-04）: 从 KNOWN_INCONSISTENCIES 迁移 ──
  // B2 裁决的 4 条确认错误，在真正订正时按交接规则迁入此处（source: "premiers-barn"
  // 指向 MODULE_PREMIERS_BARN，即 rules/custom-modules/premiers_barn.ts，
  // 不是第三份表示 PREMIERS_BARN_MODULE/mythos-module.ts）。
  {
    id: "premiers-barn-adrian-at-farm",
    fabricatedText: '"sceneId":"艾德里安的农场"',
    source: "premiers-barn",
    location: "MODULE_PREMIERS_BARN.npcs[艾德里安·埃斯特鲁姆].sceneId",
    discoveredBy:
      "N10 任务②B2：findNpcSceneInconsistencies 报出两侧站位不一致，人工核对 section_11.txt" +
      "抓捕通报（「于霍姆斯医院接受治疗，处于意识不清状态」）确认他被捕枪伤后在医院，" +
      "MythosModule 把抓捕前的落脚点当成了故事发生时的当前位置。",
    whyToolMissed:
      "结构化 NPC.sceneId 字段，不在方括号审计与声明实体审计的检查范围内，" +
      "只有跨表示一致性判据（representation-consistency.ts）才会比对两侧站位是否一致。",
    fixCommit: "34e1f0c",
  },
  {
    id: "premiers-barn-tramp-at-farm-outskirts",
    // 注意："sceneId":"农场外围" 单独出现 4 次（捕兽夹 3 件物品 + 流浪汉 NPC），
    // 需要带足够的 NPC 上下文才能唯一定位——使用 id/name/type/hp 组合，1 次出现。
    fabricatedText: '"id":"流浪汉","name":"流浪汉","type":"npc","hp":12,"maxHp":12,"ac":10,"faction":"人类","sceneId":"农场外围"',
    source: "premiers-barn",
    location: "MODULE_PREMIERS_BARN.npcs[流浪汉].sceneId",
    discoveredBy:
      "N10 任务②B2：findNpcSceneInconsistencies 报出两侧站位不一致，人工核对 section_06.txt:57-62" +
      "（「房子被周围的流浪汉所占据」）确认流浪汉占据的是艾德里安在镇内那栋荒废别墅，" +
      "农场周围段落从未出现流浪汉。",
    whyToolMissed:
      "结构化 NPC.sceneId 字段，不在方括号审计与声明实体审计的检查范围内，" +
      "只有跨表示一致性判据（representation-consistency.ts）才会比对两侧站位。",
    fixCommit: "05b17b5",
  },
];

/**
 * 判据：给定一份序列化好的模组数据文本，返回其中仍然逐字出现的
 * 已知臆造条目——空数组表示这份数据里一条都不剩，是"绿"的意思。
 *
 * 不在这里做序列化（不 import BARN_OF_PREMIER/PREMIERS_BARN_MODULE）：
 * 让调用方决定怎么序列化、序列化谁，变异检验才能传一份构造出来的
 * 假文本进来，不用真的去改数据文件。
 */
export function findReintroducedFabrications(
  serializedModuleText: string,
  source: ConfirmedFabricationEntry["source"],
): ConfirmedFabricationEntry[] {
  return CONFIRMED_FABRICATION_LOG.filter(
    (entry) => entry.source === source && serializedModuleText.includes(entry.fabricatedText),
  );
}
