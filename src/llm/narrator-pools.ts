// 战斗叙述文案池 —— **纯数据，不含逻辑**。
//
// 谁改这个文件：内容开发（外部模型）往这里加句子；接线与分档逻辑在
// 同目录 narrator.ts，别在那边动笔。
//
// 分档口径（与 combat/wound-effects.ts 的 calcSeverity 完全一致，
// 按伤害/最大HP **比例**，不是绝对值）：
//   scratch  ≤25%          擦伤（无惩罚骰）
//   flesh    25%~49%       轻伤
//   deep     ≥50%          CoC 重伤（Major Wound）
//   grievous ≥75%          致残级重伤
//   lethal   ——            HP 归零。注意：calcSeverity **不产出** lethal，
//                          这一档由「目标是否倒下」决定，不是比例算出来的。
//
// 写作约束（有测试把着，违者红）：
//   1. 每个池 ≥4 条起步（内容任务要求扩到 ≥12），同池内不许有重复句。
//   2. 占位符只有三个：{attacker} {defender} {weapon}。
//   3. 年代 1920s：不要出现现代词汇。
//   4. **文案不许承诺机制**：不能写「开始流血」「将承受惩罚骰」，
//      除非那件事真的会发生 —— 这个仓库修过三处「文案说了实现没做」。
//   5. lethal 描写的是「倒下」，不是「断气」：CoC 里 0 HP 是濒死/昏迷，
//      还能被急救拉回来。
//
// 基调：冷静、细节化、旁观者视角；避免武侠/奇幻式表达；
// 专注伤口形态、血液、声音、目标的生理反应。

/** 擦伤 — 几乎无影响，但带出恐惧氛围 */
export const SCRATCH_TEMPLATES = [
  "{weapon}擦过{defender}的体表，留下一道浅浅的血痕。暗红色的液体沿着伤口边缘缓缓渗出。",
  "{defender}被{weapon}蹭破了皮——伤口不深，但血珠已经沿着皮肤滚落。",
  "一声钝响后，{defender}的手臂上多了一道细长的划口。皮肉翻开处露出粉红色的嫩肉。",
  "{weapon}掠过{defender}的侧肋，带起一串细小的血珠。",
];

/** 轻伤 — 流血，痛楚 */
export const FLESH_TEMPLATES = [
  "{weapon}切入{defender}的手臂，皮肉翻开，鲜血立刻涌出。{defender}闷哼一声，咬紧了牙关。",
  "猩红的液体从{defender}的肋部淌下——{weapon}在那里留下了一道不浅的伤口。",
  "{weapon}击中了{defender}的身体。温热的血浸透了衣物，在布料上洇开一片深色。",
  "{defender}的肩头被{weapon}撕开一道口子。可以看见筋膜在伤口深处泛着苍白的光。",
];

/** 重伤 — 明显影响行动能力（CoC Major Wound） */
export const DEEP_TEMPLATES = [
  "{weapon}深深嵌入{defender}的身体，抽出时带出一股温热黏腻的液体。{defender}踉跄后退，呼吸变得粗重。",
  "骨肉被撕裂的闷响。{weapon}在{defender}的躯干上留下了一道狰狞的创口——鲜血正从那里汩汩涌出。",
  "这一击几乎贯穿了{defender}的防御。伤口深可见骨，暗红的血液正沿着{defender}的身体流到地面上。",
  "{weapon}重重击中了{defender}——可以听到骨头发出不妙的声响。{defender}的脸色瞬间变得煞白。",
];

/** 致残级重伤 — 濒死，意识模糊 */
export const GRIEVOUS_TEMPLATES = [
  "{weapon}穿透了{defender}的身体。露出的刃尖上挂着温热的血液，一滴滴落在地上。{defender}发出一声不似人声的哀嚎。",
  "毁灭性的一击。{defender}的身体被{weapon}撕开巨大的创口——透过翻卷的皮肉，可以看到内部的骨骼与脏器。",
  "{defender}遭受了致命创伤。鲜血以可怕的速率喷涌而出，{defender}的双腿开始发软，视线涣散。",
  "空气中弥漫着铁锈般的血腥味。{defender}低头看了一眼自己胸前的伤口——那一眼中充满了不可置信。",
];

/** 倒下（HP 归零）— 濒死而非断气，急救还来得及 */
export const LETHAL_TEMPLATES = [
  "{weapon}精准地没入{defender}的要害部位。{defender}甚至没能发出声音——只是无声地瘫软下去，像一具被剪断提线的木偶。",
  "致命一击。{defender}发出一声短促的气音，然后向后倒去。鲜血迅速在身下汇聚成一滩深色的水洼。",
  "{weapon}斩断了{defender}的抵抗。身体倒地的声音沉闷而沉重，仿佛某种容器被打翻。",
  "战斗结束了。{defender}以一种不自然的角度瘫倒在地上，{weapon}造成的创口仍在缓缓渗出暗红色的液体。",
];

/** 未命中 */
export const MISS_TEMPLATES = [
  "{weapon}划破空气，在{defender}身侧掠过——只差不到一寸。",
  "{defender}侧身闪避，{weapon}几乎擦着皮肤飞过。",
  "攻击落空。{weapon}击中了一旁的墙壁/地面，溅起碎片与尘土。{defender}已经移动到了另一个位置。",
  "{attacker}的突击被{defender}一个后撤步化解。{weapon}在空气中挥了个空。",
];

/** 大失败（fumble）—— 比普通落空更狼狈，攻击者自己出丑 */
export const FUMBLE_TEMPLATES = [
  "{attacker}的攻击落空，反而一个踉跄差点摔倒！",
  "{attacker}用力过猛失去平衡，武器几乎脱手——{defender}趁势拉开距离。",
  "{attacker}这一下挥得太急，{weapon}磕在了旁边的硬物上，震得虎口发麻。",
  "{attacker}的{weapon}脱了手，狼狈地弯腰去捡，{defender}冷冷地看着这一幕。",
];

/** 暴击前缀。允许空串（=不加前缀），去重检查时会跳过空串。 */
export const CRIT_PREFIX = ["致命的暴击！", "精准命中！", ""];
