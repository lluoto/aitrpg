// ============================================================
// 政治经济模块 - 核心类型定义
// 基于：疯巫妖的实验日志、黎明之剑、网游之亡者征途、
//       第四次灵石金融危机、银河系殖民手册
// ============================================================

// ── 势力 / 派系 ──

export type FactionType =
  | "government"      // 国家/帝国/城邦政权
  | "guild"           // 公会/行会
  | "cult"            // 教派/秘密结社
  | "corporation"     // 商会/公司
  | "noble_house"     // 贵族家族
  | "clan"            // 氏族/宗族
  | "school";         // 学派/门派

export type Stance =
  | "ally"
  | "trade_pact"
  | "neutral"
  | "unfriendly"
  | "hostile"
  | "war";

export type TreatyType =
  | "alliance"          // 军事同盟
  | "trade"             // 贸易协定
  | "non_aggression"    // 互不侵犯
  | "ceasefire"         // 停战
  | "vassal"            // 附庸
  | "sanction"          // 制裁（惩罚型条约）
  | "embargo";          // 禁运

export interface Treaty {
  id: string;
  type: TreatyType;
  parties: string[];
  terms: string;
  signedAtRound: number;
  duration?: number;       // 持续回合数，undefined=永久
  active: boolean;
}

interface FactionRelation {
  targetId: string;
  stance: Stance;
  score: number;           // -100 ~ 100
  treaties: Treaty[];
  tradeVolume: number;     // 累计贸易额
  lastInteractionRound: number;
}

export interface Faction {
  id: string;
  name: string;
  type: FactionType;
  leaderName?: string;
  capitalName?: string;
  territory: string[];            // 控制场景ID列表
  resources: Record<string, number>;  // resourceId → stockpile
  treasury: number;               // 通用货币储备
  stability: number;              // 0~100，民心/稳定度
  militaryPower: number;          // 军事实力评估
  economicPower: number;          // 经济实力评估
  relations: Record<string, FactionRelation>;
  activePolicies: string[];       // Policy.id[]
  createdAtRound: number;
}

// ── 资源 / 市场 ──

export type ResourceCategory =
  | "raw_material"      // 原材料
  | "food"              // 粮食
  | "luxury"            // 奢侈品
  | "magical"           // 魔法/灵石类
  | "military"          // 军需
  | "strategic";        // 战略物资

export interface ResourceDef {
  id: string;
  name: string;
  category: ResourceCategory;
  basePrice: number;       // 基准价
  description: string;
  isFinite: boolean;       // 是否可耗尽
}

export interface MarketEntry {
  resourceId: string;
  price: number;
  supply: number;          // 库存量
  demand: number;          // 需求量
  trend: "rising" | "stable" | "falling";
  lastUpdatedRound: number;
}

export interface TradeRoute {
  id: string;
  fromFactionId: string;
  toFactionId: string;
  resourceId: string;
  volume: number;          // 每回合交易量
  price: number;
  active: boolean;
  establishedRound: number;
}

export interface Market {
  id: string;
  name: string;
  location: string;            // 场景ID
  controlledBy: string;        // 控制势力ID
  entries: Record<string, MarketEntry>;  // resourceId → entry
  tradeRoutes: TradeRoute[];
  taxRate: number;             // 0~1
  lastUpdateRound: number;
}

// ── 政策 / 法令 ──

export type PolicyCategory =
  | "tax"               // 税收政策
  | "trade"             // 贸易政策
  | "military"          // 军事政策
  | "diplomatic"        // 外交政策
  | "economic"          // 经济政策
  | "domestic";         // 内政政策

export interface PolicyEffect {
  target: string;             // 影响目标（如 "treasury", "stability", "trade_income"）
  operation: "add" | "multiply" | "set";
  value: number;
  description: string;
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  factionId: string;
  category: PolicyCategory;
  effects: PolicyEffect[];
  active: boolean;
  enactedAtRound: number;
  cost: number;               // 实施费用
  cooldown: number;           // 冷却回合数
}

// ── 金融 / 货币 ──

export type CurrencyType =
  | "commodity"     // 商品本位（灵石/黄金）
  | "credit"        // 信用货币（灵石券）
  | "fiat";         // 法定货币

export type FinancialCrisisType =
  | "inflation"      // 通货膨胀
  | "deflation"      // 通货紧缩
  | "bank_run"       // 银行挤兑
  | "default"        // 债务违约
  | "hyperinflation" // 恶性通胀
  | "market_crash";  // 市场崩溃

export interface Currency {
  id: string;
  name: string;
  type: CurrencyType;
  issuer: string;                     // 发行势力ID
  exchangeRate: Record<string, number>;  // currencyId → 兑换率
  supply: number;                     // 流通量
  stability: number;                  // 0~100 币值稳定度
}

export interface Bank {
  id: string;
  name: string;
  location: string;
  factionId: string;
  reserves: Record<string, number>;   // currencyId → 储备量
  loans: Loan[];
  stability: number;                  // 0~100
}

export interface Loan {
  id: string;
  borrower: string;                   // factionId
  amount: number;
  currencyId: string;
  interestRate: number;               // 每回合利率
  remainingRounds: number;
  collateral: string;                 // 抵押品描述
  defaulted: boolean;
}

export interface FinancialCrisis {
  id: string;
  type: FinancialCrisisType;
  severity: number;                   // 1~10
  name: string;
  description: string;
  affectedFactionIds: string[];
  startedAtRound: number;
  resolved: boolean;
  resolvedAtRound?: number;
}

// ── 外交行动 ──

type DiplomaticAction =
  | "propose_treaty"
  | "break_treaty"
  | "declare_war"
  | "offer_peace"
  | "demand_tribute"
  | "send_gift"
  | "insult"
  | "request_aid";

export interface DiplomaticOffer {
  action: DiplomaticAction;
  fromFactionId: string;
  toFactionId: string;
  treatyType?: TreatyType;
  terms?: string;
  giftAmount?: number;
  resourceId?: string;
  resourceAmount?: number;
  expiresAtRound: number;
}

// ── 游戏内事件 ──

export type EconomyEventType =
  | "market_shift"      // 市场价格变动
  | "resource_discovery"// 资源发现
  | "trade_disruption"  // 贸易中断
  | "faction_stance_change" // 势力关系变化
  | "policy_enacted"    // 政策实施
  | "financial_crisis"  // 金融危机
  | "tribute_collected";// 贡赋征收

export interface EconomyEvent {
  id: string;
  type: EconomyEventType;
  round: number;
  description: string;
  affectedFactions: string[];
  data?: Record<string, unknown>;
  /**
   * 这一批事件是被**哪一次触发**产出的（docs/todo.json 的 todo-17：
   * "全链应有 causation_id 防止重复触发"）。
   *
   * ⚠ 传播规则——不是随便加个字段：
   *   1. **可选**是故意的。四个子系统（factions/trades/policies/finances）
   *      各自的 `advanceRound()` 完全不知道 causationId 这回事，构造事件时
   *      不填它——它们是内部产出，还没离开引擎边界。
   *   2. 同一次 `PoliticoEconomyEngine.advanceRound(causationId)` 调用里，
   *      四个子系统汇总出的**所有**事件在离开引擎前被统一盖上**同一个**
   *      causationId——它们是同一次时钟触发的结果，不是互相触发的因果链。
   *      causationId 标的是"这次推进"这件事，不是"这条事件"本身
   *      （那是 `id` 的职责）。
   *   3. 幂等保护发生在盖章**之前**：同一个 causationId 第二次传入会被
   *      `advanceRound()` 直接拒绝（返回空数组、不产生新事件、不推进
   *      round、子系统的 `advanceRound()` 根本不会被调用），而不是产生事件之后
   *      再去重——去重晚了就已经有副作用了（round 已经推进、子系统状态
   *      已经变了）。
   *   4. **不变式（由 `causation-id.test.ts` 钉住）**：任何从
   *      `PoliticoEconomyEngine.advanceRound()` 返回、或进了 `this.events`
   *      的事件，`causationId` 一定已经被盖上，不会是 `undefined`。
   *      可选只是给子系统内部用的宽松，不是允许它在引擎边界外缺失。
   */
  causationId?: string;
}

// ── 引擎状态（对外暴露） ──

export interface PoliticoEconomyState {
  factions: Faction[];
  markets: Market[];
  activePolicies: Policy[];
  activeCrises: FinancialCrisis[];
  currencies: Currency[];
  recentEvents: EconomyEvent[];
  round: number;
}
