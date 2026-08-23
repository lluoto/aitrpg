import type { GateState, ScenarioSpec } from "./apply-action";

const DIFFICULTY_DOMAIN = ["easy", "medium", "hard", "nightmare"] as const;
type DifficultyLabel = (typeof DIFFICULTY_DOMAIN)[number];

/** Phase 3.1 的最小真实场景：会话级难度是当前唯一已接线的枚举状态。 */
export const COC_SESSION_SCENARIO: ScenarioSpec = {
  variables: [{ id: "difficulty", domain: { kind: "enum", values: DIFFICULTY_DOMAIN }, initial: "medium" }],
  transitions: DIFFICULTY_DOMAIN.flatMap((to) => [{ variable: "difficulty", from: DIFFICULTY_DOMAIN, to }]),
  actions: [],
};

export function buildDifficultyGateState(difficulty: DifficultyLabel = "medium"): GateState {
  return {
    variables: { difficulty },
    known: [],
    firedEvents: [],
    settledRewards: [],
    closedNodes: [],
  };
}

export function isDifficultyLabel(value: string): value is DifficultyLabel {
  return (DIFFICULTY_DOMAIN as readonly string[]).includes(value);
}

/**
 * 「当前值 + 上限」这类有界整数状态的声明。HP 与 SAN 共用。
 *
 * 不声明 transitions：整数域的合法性就是 0..max 的闭区间与整数性本身，
 * 再列一张转移表等于把 max+1 条边写死，没有额外约束力。
 */
export function boundedIntegerScenario(variable: string, current: number, max: number): ScenarioSpec {
  return {
    variables: [{ id: variable, domain: { kind: "integer", min: 0, max }, initial: current }],
    transitions: [],
    actions: [],
  };
}

export function boundedIntegerGateState(variable: string, current: number): GateState {
  return {
    variables: { [variable]: current },
    known: [],
    firedEvents: [],
    settledRewards: [],
    closedNodes: [],
  };
}
