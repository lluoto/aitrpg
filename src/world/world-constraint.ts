/**
 * 世界模型约束系统 — 统一约束引擎
 * =====================================
 *
 * 职责：将"规则/状态/常识"对 LLM 输出和初始状态的约束统一为一个优先级系统。
 *
 * 优先级规则（DESIGN-LOG.md §1）：
 *   模组特殊规则 > 当前场景已确认事实 > CoC通用规则 > LLM的一般常识
 *
 * 用法：
 *   // 创建引擎并加载默认约束
 *   const engine = new ConstraintEngine(DEFAULT_CONSTRAINTS);
 *
 *   // 模组可声明 override
 *   engine.applyModuleOverrides(module.constraintOverrides ?? []);
 *
 *   // 检查物品
 *   const result = engine.checkItem("移动电话(早期)", 1921);
 *   if (result?.type === "replace") use replacement;
 *
 *   // 检查对话文本
 *   const hit = engine.checkDialogue("这个线索很重要");
 *   if (hit) fallback to safe text;
 *
 * 设计原则（源自综述）：
 * - 确定性执行，不经过 LLM 解释
 * - 优先级排序确保模组特殊规则不会被通用规则覆盖
 * - 行动分类支持 block/replace/allow_with_cost/redirect 四种处置
 */

// ============================================================
// 优先级
// ============================================================

export enum ConstraintPriority {
  /** 模组特殊规则 — 最高优先级，override 一切 */
  MODULE_SPECIAL = 4,
  /** 当前场景已确认世界事实 */
  SCENE_FACT = 3,
  /** CoC 通用规则（如时代限制、NPC 不应说 meta 词汇） */
  COC_GENERAL = 2,
  /** LLM 的一般常识/叙事偏好 — 最低优先级 */
  LLM_JUDGMENT = 1,
}

// ============================================================
// 行动类型
// ============================================================

/**
 * 约束被触发时的处置方式。
 *
 * 替代 binary block/pass，提供四个分类（DESIGN-LOG.md §3）：
 * - block: 直接拒绝，附带世界内解释
 * - replace: 替换为时代/场景合适的内容
 * - allow_with_cost: 允许但有代价（消耗资源/触发新事件）
 * - redirect: 引导回正轨，不是硬拒绝
 */
type ConstraintAction =
  | { type: "block"; blockMessage?: string }
  | { type: "replace"; replacement: string }
  | { type: "allow_with_cost"; costDescription: string }
  | { type: "redirect"; redirectMessage: string };

// ============================================================
// 约束定义
// ============================================================

interface WorldConstraint {
  /** 唯一 ID，用于模组 override 定位 */
  id: string;
  priority: ConstraintPriority;
  /** 来源说明（调试/日志用） */
  source: string;

  // ── 匹配条件（三选一） ──

  /** 物品匹配：物品名精确匹配或前缀匹配 */
  matchItem?: string | ((item: string) => boolean);
  /** 对话文本匹配：子串或正则 */
  matchText?: string | RegExp | ((text: string) => boolean);
  /** 通用谓词匹配（用于无法用前两种表达的复杂条件） */
  matchPredicate?: (context: ConstraintContext) => boolean;

  /** 年代范围 [start, end] 闭区间；省略一端表示无界 */
  yearRange?: [number | undefined, number | undefined];
  /** 仅在指定场景中生效 */
  sceneId?: string;

  /** 触发时的处置 */
  action: ConstraintAction;
}

/** 检查时传入的上下文 */
interface ConstraintContext {
  year?: number;
  sceneId?: string;
  /** 匹配文本（DialogueCheck 时传入） */
  text?: string;
  /** 匹配物品名（ItemCheck 时传入） */
  itemName?: string;
}

// ============================================================
// 模组 override
// ============================================================

interface ModuleConstraintOverride {
  /**
   * 替换默认约束：若设置，用本 constraint 替换同 id 的默认约束。
   * 若未设置或默认中无此 id，则新增。
   */
  replaceConstraintId?: string;
  constraint: WorldConstraint;
}

// ============================================================
// 约束引擎
// ============================================================

export class ConstraintEngine {
  private constraints: WorldConstraint[] = [];

  constructor(defaultConstraints: WorldConstraint[]) {
    this.constraints = [...defaultConstraints];
    this.sort();
  }

  /** 应用模组 override */
  applyModuleOverrides(overrides: ModuleConstraintOverride[]): void {
    for (const ov of overrides) {
      if (ov.replaceConstraintId) {
        const idx = this.constraints.findIndex(c => c.id === ov.replaceConstraintId);
        if (idx >= 0) {
          this.constraints[idx] = ov.constraint;
        } else {
          this.constraints.push(ov.constraint);
        }
      } else {
        this.constraints.push(ov.constraint);
      }
    }
    this.sort();
  }

  /** 按优先级降序排列 */
  private sort(): void {
    this.constraints.sort((a, b) => b.priority - a.priority);
  }

  /** 获取当前所有约束（只读快照，用于调试/日志） */
  getConstraints(): readonly WorldConstraint[] {
    return this.constraints;
  }

  // ── 检查方法 ──

  /**
   * 检查物品名是否命中任何约束。
   * 返回最高优先级命中的 action，或 null（无命中）。
   */
  checkItem(itemName: string, year?: number, sceneId?: string): ConstraintAction | null {
    const ctx: ConstraintContext = { year, sceneId, itemName };
    for (const c of this.constraints) {
      if (!this.matchesYear(c, ctx)) continue;
      if (!this.matchesScene(c, ctx)) continue;
      if (c.matchItem) {
        const match = typeof c.matchItem === "function"
          ? c.matchItem(itemName)
          : itemName === c.matchItem || itemName.startsWith(c.matchItem + "(") || itemName.startsWith(c.matchItem + "×");
        if (match) return c.action;
      }
    }
    return null;
  }

  /**
   * 检查对话文本是否命中任何约束。
   * 返回最高优先级命中的 action，或 null（无命中）。
   */
  checkDialogue(text: string, sceneId?: string): ConstraintAction | null {
    const ctx: ConstraintContext = { text, sceneId };
    for (const c of this.constraints) {
      if (!this.matchesScene(c, ctx)) continue;
      if (c.matchText) {
        const match = typeof c.matchText === "function"
          ? c.matchText(text)
          : typeof c.matchText === "string"
            ? text.includes(c.matchText)
            : c.matchText.test(text);
        if (match) return c.action;
      }
    }
    return null;
  }

  /**
   * 通用检查 — 使用 matchPredicate。
   */
  checkPredicate(ctx: ConstraintContext): ConstraintAction | null {
    for (const c of this.constraints) {
      if (!this.matchesYear(c, ctx)) continue;
      if (!this.matchesScene(c, ctx)) continue;
      if (c.matchPredicate && c.matchPredicate(ctx)) return c.action;
    }
    return null;
  }

  private matchesYear(c: WorldConstraint, ctx: ConstraintContext): boolean {
    if (!c.yearRange) return true;
    if (ctx.year === undefined) return true; // 没提供年份，放过
    const [start, end] = c.yearRange;
    if (start !== undefined && ctx.year < start) return false;
    if (end !== undefined && ctx.year > end) return false;
    return true;
  }

  private matchesScene(c: WorldConstraint, ctx: ConstraintContext): boolean {
    if (!c.sceneId) return true;
    return c.sceneId === ctx.sceneId;
  }
}

// ============================================================
// 默认约束集
// ============================================================

/**
 * CoC 7e 1920s 默认约束。
 * 这些是通用规则，模组可通过 applyModuleOverrides 替换。
 */
export const DEFAULT_CONSTRAINTS: WorldConstraint[] = [
  // ── 物品年代约束 ──
  {
    id: "anachronistic_mobile_phone",
    priority: ConstraintPriority.COC_GENERAL,
    source: "CoC 1920s 时代设定：移动电话 1973 年才诞生",
    matchItem: (s) => s.includes("移动电话"),
    yearRange: [undefined, 1973],
    action: { type: "replace", replacement: "黄铜望远镜" },
  },

  // ── 时代科技黑名单（LLM 易幻觉出现的现代科技，1921 年个人社会绝不可能存在）──
  // 注意：
  // - 移动电话/手机/短信等个人移动通讯设备绝不存在：个人对个人的联系依赖信件/当面/托人带话，
  //   一旦出现手机，"联系失效"的戏剧核心即崩塌 → 必须约束
  // - 个人端到端电话联系（"打他电话"）同样受限：1920s 电话是端到端物理线路，普瑞米尔是落后
  //   小镇，个人家庭电话罕见，拖车房少年绝无电话线路 → 约束"打某人电话"式个人联系表述
  // - 机构电话（警察局/银行/医院）合理，不禁"电话"名词本身
  // - "电视"不在黑名单：模组内艾米丽（电子学教授）+ 米戈跨时代科技，谷仓监控屏用电视机
  //   改造（原文场景 L36），属于模组内合理的例外科技 → 允许存在
  {
    id: "anachronistic_tech",
    priority: ConstraintPriority.COC_GENERAL,
    source: "CoC 1920s 时代设定：个人移动通讯（手机/短信）与个人端到端电话联系不存在；互联网/电脑等现代科技不应出现在 1920s",
    matchText: /手机|移动电话|智能手机|电脑|平板电脑|笔记本电脑|互联网|无线网络|上网|wifi|wi-fi|蓝牙|gps|卫星导航|扫码|二维码|微信|短信|短视频|数码相机|无人机|电子支付|智能设备|打[他她]电话|给[他她]打电话|[他她]打来电话|挂断电话|接起电话|放下听筒/i,
    yearRange: [undefined, 1940],
    action: { type: "block", blockMessage: "现代个人通讯/科技词汇不应出现在 1920s 场景中" },
  },

  // ── NPC 对话不应出现场景/位置 meta 词汇 ──
  {
    id: "dialogue_meta_location",
    priority: ConstraintPriority.COC_GENERAL,
    source: "NPC 对话不应像报菜单一样说出场景名",
    matchText: /旅店|旅馆|客栈|场景|关卡|地图/,
    action: { type: "block", blockMessage: "NPC不会像报菜单一样说出场景名" },
  },

  // ── NPC 对话不应出现游戏机制术语 ──
  {
    id: "dialogue_meta_mechanic",
    priority: ConstraintPriority.COC_GENERAL,
    source: "NPC 对话不应出现游戏机制术语",
    matchText: /线索|任务|道具|物品|装备|调查进度|剧情/,
    action: { type: "block", blockMessage: "NPC不会说出游戏机制术语" },
  },

  // ── NPC 对话不应出现玩家 meta 术语 ──
  {
    id: "dialogue_meta_player",
    priority: ConstraintPriority.COC_GENERAL,
    source: "NPC 不应意识到自己是游戏角色",
    matchText: /调查员|PL|KP|跑团|游戏|模组|剧本|存档|读档|save|load/i,
    action: { type: "block", blockMessage: "NPC不应出现玩家meta词汇" },
  },

  // ── NPC 对话不应出现角色 meta 术语 ──
  {
    id: "dialogue_meta_character",
    priority: ConstraintPriority.COC_GENERAL,
    source: "NPC 不应称呼自己或玩家为NPC/PC",
    matchText: /NPC|PC|玩家角色|非玩家角色/i,
    action: { type: "block", blockMessage: "NPC不应出现角色meta词汇" },
  },
];

/**
 * 共享对话安全校验 — 供各 LLM 文本输出点（叙事/开场/对话扩展）统一使用。
 * 命中任一对话约束（meta 词汇 / 时代科技黑名单）时返回处置结果，未命中返回 null。
 */
export function checkDialogueText(text: string, sceneId?: string): ConstraintAction | null {
  const engine = new ConstraintEngine(DEFAULT_CONSTRAINTS);
  return engine.checkDialogue(text, sceneId);
}
