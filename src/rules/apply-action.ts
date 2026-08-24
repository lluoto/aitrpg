// applyAction —— 状态变更的合法性闸门（迁移计划阶段 2）
//
// 依据 docs/kp-tool-surface-assessment.md §三 / §六：备忘录 §三.2 把「状态变更是否合法」
// 「角色是否知道某条信息」「当前节点是否达到结束条件」「事件/奖励是否已结算」
// 四类判断划给程序侧，本文件即这四类判断的唯一落点。
//
// 三条设计约束，都是从既有事故里来的：
//
// 1. **抽象层级不能做低**（PAYADOR，arXiv 2504.07304；§七 回归基线第 8 条）。
//    闸门不能只认预设动作名，否则玩家用未预写的方法达成同一状态时会被拒绝。
//    因此 ProposedAction 除了 declared 分支，还有 freeform 分支：后者直接声明
//    它想造成的状态变化，闸门校验这个「变化」而不是「动作名」。
//
// 2. **返回不可变 StateDelta，不就地改状态**（§八）。真相源两次静默失效都源于
//    「看起来能写的快照」：getCurrentState() 返回新对象，对它赋值全部丢弃。
//    这里所有出参一律 readonly，对 delta 赋值由类型系统拒绝。
//
// 3. **失败必须结构化上报**（§八）。RejectReason 是判别联合，带足够字段让调用方
//    生成可读原因，而不是降级成一行文本警告被 catch 吞掉。
//
// ⚠ 这里原先写着「本阶段不接线：这是纯函数 + 表驱动测试，写入路径的收束是
//   阶段 3 的事」。**该句已过期** —— 阶段 3 做了一部分：闸门现在有 4 个
//   生产调用方，都在 `api/game-session.ts`：
//     setDifficulty（枚举 4 值）、setPlayerHp、setPlayerSan、applyDamage
//     （applyDamage 先把增量投影成目标 HP 再送闸门）
//
//   仍**未**过闸门的是开放字符串集合：setPlayerInventory / setPlayerWeapons /
//   setPlayerArmor。这是有意豁免，不是漏接 —— 仓库里没有物品注册表，
//   硬造一个取值域要么无界要么现编，而「这类域比没有域更糟：它看起来在校验」。
//   理由与重估条件见 docs/kp-tool-surface-assessment.md §六.3。
//
//   留着旧句子的代价是：下一个人会以为闸门根本没生效，于是要么绕开它自己直写，
//   要么重新造一个。

// ============================================================
// 剧本声明：状态变量与允许的转移
// ============================================================

type StateValue = string | number;

/** 状态值域：枚举走显式转移图，整数走闭区间与整数性校验。 */
type StateDomain =
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "integer"; readonly min: number; readonly max: number };

/** 一个状态变量及其取值域。取值域是封闭的——不在域内的目标值一律拒绝。 */
interface StateVariableSpec {
  readonly id: string;
  readonly domain: StateDomain;
  readonly initial: StateValue;
}

/** 一次允许的状态转移：variable 从 from 中任一值变为 to。 */
interface TransitionSpec {
  readonly variable: string;
  readonly from: readonly StateValue[];
  readonly to: StateValue;
}

/** 具名动作。freeform 分支不需要它，但预写动作用它承载知情/一次性/奖励等约束。 */
interface ActionSpec {
  readonly id: string;
  readonly effects: readonly ProposedEffect[];
  /** 执行前角色必须已知的信息 id。缺任意一条即拒绝。 */
  readonly requiresKnowledge?: readonly string[];
  /** 只能发生一次的事件 id。已发生则拒绝，成功则记入 delta。 */
  readonly firesEvent?: string;
  /** 只结算一次的 SAN 奖励 id。 */
  readonly settlesReward?: string;
  /** 达成该节点的结束条件。已关闭则拒绝。 */
  readonly closesNode?: string;
}

export interface ScenarioSpec {
  readonly variables: readonly StateVariableSpec[];
  readonly transitions: readonly TransitionSpec[];
  readonly actions: readonly ActionSpec[];
}

// ============================================================
// 闸门输入
// ============================================================

/** 闸门看到的当前状态。全部只读——闸门不持有状态，也不修改状态。 */
export interface GateState {
  readonly variables: Readonly<Record<string, StateValue>>;
  readonly known: readonly string[];
  readonly firedEvents: readonly string[];
  readonly settledRewards: readonly string[];
  readonly closedNodes: readonly string[];
}

interface ProposedEffect {
  readonly variable: string;
  readonly to: StateValue;
}

/**
 * 玩家提议的行动。判别联合：
 * - `declared` 走剧本预写动作，附带知情/一次性/奖励等约束；
 * - `freeform` 是未预写的做法，只声明想造成的状态变化，由闸门判定其合法性。
 */
export type ProposedAction =
  | { readonly kind: "declared"; readonly actor: string; readonly actionId: string }
  | {
      readonly kind: "freeform";
      readonly actor: string;
      readonly description: string;
      readonly effects: readonly ProposedEffect[];
    };

// ============================================================
// 闸门输出
// ============================================================

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

interface VariableChange {
  readonly variable: string;
  readonly from: StateValue;
  readonly to: StateValue;
}

/** 通过校验后的状态增量。调用方据此写入真相源；闸门自身不写。 */
export interface StateDelta {
  readonly changes: readonly VariableChange[];
  readonly firedEvents: readonly string[];
  readonly settledRewards: readonly string[];
  readonly closedNodes: readonly string[];
}

export type RejectReason =
  | { readonly code: "unknown_action"; readonly actionId: string }
  // 下面两条由调用方（会话层）产出，不由纯闸门产出：闸门只看「效果」，
  // 看不到目标是否存在，也看不到增量型操作的原始金额。放进同一个联合，
  // 是为了让 HTTP 只需处理一种失败形状。
  | { readonly code: "unknown_target"; readonly targetId: string }
  | { readonly code: "invalid_amount"; readonly variable: string; readonly amount: number }
  | { readonly code: "empty_effects" }
  | { readonly code: "unknown_variable"; readonly variable: string }
  | {
      readonly code: "value_out_of_domain";
      readonly variable: string;
      readonly to: StateValue;
      readonly domain: StateDomain;
    }
  | {
      readonly code: "illegal_transition";
      readonly variable: string;
      readonly from: StateValue;
      readonly to: StateValue;
      readonly allowedFrom: readonly StateValue[];
    }
  | { readonly code: "conflicting_effects"; readonly variable: string }
  | { readonly code: "actor_not_informed"; readonly actor: string; readonly missing: readonly string[] }
  | { readonly code: "event_already_fired"; readonly event: string }
  | { readonly code: "reward_already_settled"; readonly reward: string }
  | { readonly code: "node_already_closed"; readonly node: string };

// ============================================================
// 闸门
// ============================================================

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const reject = (error: RejectReason): Result<never, RejectReason> => ({ ok: false, error });

/**
 * 校验一次提议的状态变更。纯函数：不读外部状态、不写任何东西、同输入同输出。
 *
 * 通过则返回不可变 StateDelta；不通过则返回带结构化原因的 RejectReason。
 * 无副作用意味着调用方可以先问后做，也可以只问不做（用于给玩家解释为何不可行）。
 */
export function applyAction(
  spec: ScenarioSpec,
  state: GateState,
  proposed: ProposedAction,
): Result<StateDelta, RejectReason> {
  const resolved = resolve(spec, proposed);
  if (!resolved.ok) return resolved;
  const { effects, action } = resolved.value;

  if (effects.length === 0) return reject({ code: "empty_effects" });

  // 角色是否知道某条信息
  if (action?.requiresKnowledge) {
    const missing = action.requiresKnowledge.filter((k) => !state.known.includes(k));
    if (missing.length > 0) {
      return reject({ code: "actor_not_informed", actor: proposed.actor, missing });
    }
  }

  // 事件是否已发生 / 奖励是否已结算 / 节点是否已关闭
  if (action?.firesEvent && state.firedEvents.includes(action.firesEvent)) {
    return reject({ code: "event_already_fired", event: action.firesEvent });
  }
  if (action?.settlesReward && state.settledRewards.includes(action.settlesReward)) {
    return reject({ code: "reward_already_settled", reward: action.settlesReward });
  }
  if (action?.closesNode && state.closedNodes.includes(action.closesNode)) {
    return reject({ code: "node_already_closed", node: action.closesNode });
  }

  // 状态转移是否合法
  const changes: VariableChange[] = [];
  const touched = new Set<string>();
  for (const effect of effects) {
    if (touched.has(effect.variable)) {
      return reject({ code: "conflicting_effects", variable: effect.variable });
    }
    touched.add(effect.variable);

    const variable = spec.variables.find((v) => v.id === effect.variable);
    if (!variable) return reject({ code: "unknown_variable", variable: effect.variable });

    if (!isValueInDomain(variable.domain, effect.to)) {
      return reject({
        code: "value_out_of_domain",
        variable: effect.variable,
        to: effect.to,
        domain: variable.domain,
      });
    }

    const from = state.variables[effect.variable] ?? variable.initial;
    // 幂等：目标值即当前值时不产生变更，但也不算非法——玩家用别的方法达成
    // 已经达成的状态，应当被接受而不是被拒绝（§七 回归基线第 8 条的同类情形）。
    if (from === effect.to) continue;

    if (variable.domain.kind === "integer") {
      changes.push({ variable: effect.variable, from, to: effect.to });
      continue;
    }

    const allowedFrom = spec.transitions
      .filter((t) => t.variable === effect.variable && t.to === effect.to)
      .flatMap((t) => t.from);
    if (!allowedFrom.includes(from)) {
      return reject({
        code: "illegal_transition",
        variable: effect.variable,
        from,
        to: effect.to,
        allowedFrom,
      });
    }

    changes.push({ variable: effect.variable, from, to: effect.to });
  }

  return ok({
    changes,
    firedEvents: action?.firesEvent ? [action.firesEvent] : [],
    settledRewards: action?.settlesReward ? [action.settlesReward] : [],
    closedNodes: action?.closesNode ? [action.closesNode] : [],
  });
}

function isValueInDomain(domain: StateDomain, value: StateValue): boolean {
  switch (domain.kind) {
    case "enum":
      return typeof value === "string" && domain.values.includes(value);
    case "integer":
      return typeof value === "number"
        && Number.isInteger(value)
        && value >= domain.min
        && value <= domain.max;
    default: {
      const exhaustive: never = domain;
      return exhaustive;
    }
  }
}

interface ResolvedAction {
  readonly effects: readonly ProposedEffect[];
  /** freeform 没有对应的剧本动作，知情/一次性/奖励约束因此不适用。 */
  readonly action: ActionSpec | undefined;
}

function resolve(
  spec: ScenarioSpec,
  proposed: ProposedAction,
): Result<ResolvedAction, RejectReason> {
  switch (proposed.kind) {
    case "declared": {
      const action = spec.actions.find((a) => a.id === proposed.actionId);
      if (!action) return reject({ code: "unknown_action", actionId: proposed.actionId });
      return ok({ effects: action.effects, action });
    }
    case "freeform":
      return ok({ effects: proposed.effects, action: undefined });
    default: {
      // 判别联合穷尽性由类型系统保证：新增分支而不处理会在此处编译失败。
      const exhaustive: never = proposed;
      return exhaustive;
    }
  }
}

/** 把 delta 投影到一份新的状态上。纯函数，返回新对象，不改入参。 */
export function projectDelta(state: GateState, delta: StateDelta): GateState {
  const variables: Record<string, StateValue> = { ...state.variables };
  for (const c of delta.changes) variables[c.variable] = c.to;
  return {
    variables,
    known: state.known,
    firedEvents: [...state.firedEvents, ...delta.firedEvents],
    settledRewards: [...state.settledRewards, ...delta.settledRewards],
    closedNodes: [...state.closedNodes, ...delta.closedNodes],
  };
}

/** 由剧本声明构造初始状态。 */
export function initialGateState(spec: ScenarioSpec): GateState {
  const variables: Record<string, StateValue> = {};
  for (const v of spec.variables) variables[v.id] = v.initial;
  return { variables, known: [], firedEvents: [], settledRewards: [], closedNodes: [] };
}
