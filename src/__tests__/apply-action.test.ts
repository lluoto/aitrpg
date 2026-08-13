// applyAction 闸门 —— 表驱动测试（迁移计划阶段 2 验收）
//
// 验收标准（docs/kp-tool-surface-assessment.md §六 阶段 2）：
// 非法转移用例全部被拒绝并给出结构化原因。
//
// 下方 SPEC 是**测试夹具**，不是本项目的状态模型。备忘录 §三.1 为《璀璨欢宴》
// 列出的 8 个变量只能作为建模方法的样板——该剧本不在本仓库内（§三 已实测确认，
// 全仓检索其 5 个专名只命中评估文档自身）。项目实际加载的模组是 premiers_barn。
// 因此这里用一份结构同形、规模最小的夹具来验证闸门逻辑本身。
//
// bun test src/__tests__/apply-action.test.ts

import { describe, it, expect } from "bun:test";
import {
  applyAction,
  initialGateState,
  projectDelta,
  type GateState,
  type ProposedAction,
  type RejectReason,
  type ScenarioSpec,
} from "../rules/apply-action";

const SPEC: ScenarioSpec = {
  variables: [
    { id: "victim", domain: { kind: "enum", values: ["alive", "wounded", "dead"] }, initial: "alive" },
    { id: "evidence", domain: { kind: "enum", values: ["hidden", "found", "destroyed"] }, initial: "hidden" },
    { id: "guard", domain: { kind: "enum", values: ["unaware", "alert"] }, initial: "unaware" },
  ],
  transitions: [
    { variable: "victim", from: ["alive"], to: "wounded" },
    { variable: "victim", from: ["alive", "wounded"], to: "dead" },
    { variable: "evidence", from: ["hidden"], to: "found" },
    { variable: "evidence", from: ["hidden", "found"], to: "destroyed" },
    { variable: "guard", from: ["unaware"], to: "alert" },
  ],
  actions: [
    { id: "search_room", effects: [{ variable: "evidence", to: "found" }] },
    {
      id: "burn_evidence",
      effects: [{ variable: "evidence", to: "destroyed" }],
      requiresKnowledge: ["evidence_location"],
      firesEvent: "evidence_burned",
    },
    {
      id: "confess",
      effects: [{ variable: "guard", to: "alert" }],
      settlesReward: "san_relief",
      closesNode: "interrogation",
    },
  ],
};

const base = initialGateState(SPEC);

// Phase 3.2 fixture. It is deliberately untyped until apply-action's public
// types gain the integer-domain branch; the RED run must fail because the
// current implementation assumes every domain has Array.prototype.includes.
const NUMERIC_SPEC: ScenarioSpec = {
  variables: [{ id: "hp", domain: { kind: "integer", min: 0, max: 12 }, initial: 12 }],
  transitions: [],
  actions: [],
};

const numericBase = {
  variables: { hp: 12 },
  known: [],
  firedEvents: [],
  settledRewards: [],
  closedNodes: [],
};

function expectReject(
  state: GateState,
  proposed: ProposedAction,
): RejectReason {
  const res = applyAction(SPEC, state, proposed);
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("expected rejection");
  return res.error;
}

// ============================================================
// 1. 转移是否合法
// ============================================================

describe("闸门 · 转移合法性", () => {
  const cases: ReadonlyArray<{
    name: string;
    state: GateState;
    proposed: ProposedAction;
    code: RejectReason["code"];
  }> = [
    {
      name: "未声明的动作名",
      state: base,
      proposed: { kind: "declared", actor: "p1", actionId: "teleport" },
      code: "unknown_action",
    },
    {
      name: "未声明的状态变量",
      state: base,
      proposed: { kind: "freeform", actor: "p1", description: "拧动没有的阀门", effects: [{ variable: "valve", to: "open" }] },
      code: "unknown_variable",
    },
    {
      name: "取值不在域内",
      state: base,
      proposed: { kind: "freeform", actor: "p1", description: "把证物变成第四态", effects: [{ variable: "evidence", to: "eaten" }] },
      code: "value_out_of_domain",
    },
    {
      name: "起始值不允许该转移（死者不能回到受伤）",
      state: { ...base, variables: { ...base.variables, victim: "dead" } },
      proposed: { kind: "freeform", actor: "p1", description: "让尸体重新受伤", effects: [{ variable: "victim", to: "wounded" }] },
      code: "illegal_transition",
    },
    {
      name: "同一变量被同一动作赋两次",
      state: base,
      proposed: {
        kind: "freeform",
        actor: "p1",
        description: "同时找到又销毁证物",
        effects: [{ variable: "evidence", to: "found" }, { variable: "evidence", to: "destroyed" }],
      },
      code: "conflicting_effects",
    },
    {
      name: "空效果",
      state: base,
      proposed: { kind: "freeform", actor: "p1", description: "发呆", effects: [] },
      code: "empty_effects",
    },
  ];

  for (const c of cases) {
    it(`拒绝并给出结构化原因：${c.name}`, () => {
      expect(expectReject(c.state, c.proposed).code).toBe(c.code);
    });
  }

  it("合法转移通过并返回精确的变更", () => {
    const res = applyAction(SPEC, base, { kind: "declared", actor: "p1", actionId: "search_room" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.changes).toEqual([{ variable: "evidence", from: "hidden", to: "found" }]);
  });

  it("拒绝原因带足够字段供调用方解释（不是一行文本）", () => {
    const err = expectReject(
      { ...base, variables: { ...base.variables, victim: "dead" } },
      { kind: "freeform", actor: "p1", description: "x", effects: [{ variable: "victim", to: "wounded" }] },
    );
    expect(err.code).toBe("illegal_transition");
    if (err.code !== "illegal_transition") return;
    expect(err.variable).toBe("victim");
    expect(err.from).toBe("dead");
    expect(err.to).toBe("wounded");
    expect(err.allowedFrom).toEqual(["alive"]);
  });
});

// ============================================================
// 2. 角色是否知情
// ============================================================

describe("闸门 · 角色知情", () => {
  it("缺少必需信息时拒绝，并列出缺哪几条", () => {
    const err = expectReject(base, { kind: "declared", actor: "p1", actionId: "burn_evidence" });
    expect(err.code).toBe("actor_not_informed");
    if (err.code !== "actor_not_informed") return;
    expect(err.actor).toBe("p1");
    expect(err.missing).toEqual(["evidence_location"]);
  });

  it("已知情则放行", () => {
    const state: GateState = { ...base, known: ["evidence_location"] };
    const res = applyAction(SPEC, state, { kind: "declared", actor: "p1", actionId: "burn_evidence" });
    expect(res.ok).toBe(true);
  });
});

// ============================================================
// 3 & 4. 事件是否已发生 / 奖励是否已结算 / 节点是否已关闭
// ============================================================

describe("闸门 · 一次性结算", () => {
  it("同一事件不会触发第二次", () => {
    const state: GateState = { ...base, known: ["evidence_location"], firedEvents: ["evidence_burned"] };
    const err = expectReject(state, { kind: "declared", actor: "p1", actionId: "burn_evidence" });
    expect(err.code).toBe("event_already_fired");
  });

  it("同一 SAN 奖励不会结算第二次", () => {
    const state: GateState = { ...base, settledRewards: ["san_relief"] };
    const err = expectReject(state, { kind: "declared", actor: "p1", actionId: "confess" });
    expect(err.code).toBe("reward_already_settled");
  });

  it("已关闭的节点不会再次达成结束条件", () => {
    const state: GateState = { ...base, closedNodes: ["interrogation"] };
    const err = expectReject(state, { kind: "declared", actor: "p1", actionId: "confess" });
    expect(err.code).toBe("node_already_closed");
  });

  it("首次执行会把事件/奖励/节点写进 delta", () => {
    const res = applyAction(SPEC, base, { kind: "declared", actor: "p1", actionId: "confess" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.settledRewards).toEqual(["san_relief"]);
    expect(res.value.closedNodes).toEqual(["interrogation"]);
    expect(res.value.firedEvents).toEqual([]);
  });
});

// ============================================================
// 5. 抽象层级：未预写的做法必须能被接受（PAYADOR / §七 回归基线第 8 条）
// ============================================================

describe("闸门 · 抽象层级不做低", () => {
  it("未预写的做法只要状态转移合法就放行，不因动作名不存在而拒绝", () => {
    const res = applyAction(SPEC, base, {
      kind: "freeform",
      actor: "p1",
      description: "把证物冲进下水道——剧本里没有这个动作",
      effects: [{ variable: "evidence", to: "destroyed" }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.changes).toEqual([{ variable: "evidence", from: "hidden", to: "destroyed" }]);
  });

  it("未预写的做法不继承预写动作的知情约束", () => {
    // burn_evidence 需要 evidence_location；等效的 freeform 做法不该被同一约束拦下，
    // 因为约束挂在具名动作上，而不是挂在目标状态上。
    const res = applyAction(SPEC, base, {
      kind: "freeform",
      actor: "p1",
      description: "失手打翻油灯烧了证物",
      effects: [{ variable: "evidence", to: "destroyed" }],
    });
    expect(res.ok).toBe(true);
  });

  it("目标状态已达成时视为幂等通过，不产生变更也不报错", () => {
    const state: GateState = { ...base, variables: { ...base.variables, evidence: "found" } };
    const res = applyAction(SPEC, state, { kind: "declared", actor: "p1", actionId: "search_room" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.changes).toEqual([]);
  });
});

// ============================================================
// 6. 有界整数域（Phase 3.2）
// ============================================================

describe("闸门 · 有界整数域", () => {
  it("接受范围内的整数并生成数值 delta", () => {
    const result = applyAction(NUMERIC_SPEC, numericBase, {
      kind: "freeform",
      actor: "kp",
      description: "set hp to 7",
      effects: [{ variable: "hp", to: 7 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected bounded integer acceptance");
    expect(result.value.changes).toEqual([{ variable: "hp", from: 12, to: 7 }]);
  });

  it("接受两个端点", () => {
    const atMin = applyAction(NUMERIC_SPEC, numericBase, {
      kind: "freeform", actor: "kp", description: "set hp to zero", effects: [{ variable: "hp", to: 0 }],
    });
    const atMax = applyAction(NUMERIC_SPEC, { ...numericBase, variables: { hp: 0 } }, {
      kind: "freeform", actor: "kp", description: "restore hp", effects: [{ variable: "hp", to: 12 }],
    });

    expect(atMin.ok).toBe(true);
    expect(atMax.ok).toBe(true);
  });

  it("拒绝范围外、分数和错误值类型，并保留结构化 domain", () => {
    const cases = [-1, 13, 2.5, "seven"];
    for (const to of cases) {
      const result = applyAction(NUMERIC_SPEC, numericBase, {
        kind: "freeform", actor: "kp", description: "invalid hp", effects: [{ variable: "hp", to }],
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected bounded integer rejection");
      expect(result.error.code).toBe("value_out_of_domain");
      if (result.error.code === "value_out_of_domain") {
        expect(result.error.domain).toEqual({ kind: "integer", min: 0, max: 12 });
      }
    }
  });

  it("数值目标已达成时幂等通过且不产生变更", () => {
    const result = applyAction(NUMERIC_SPEC, { ...numericBase, variables: { hp: 7 } }, {
      kind: "freeform", actor: "kp", description: "set hp to 7", effects: [{ variable: "hp", to: 7 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected numeric idempotence");
    expect(result.value.changes).toEqual([]);
  });
});

// ============================================================
// 7. 纯函数性质
// ============================================================

describe("闸门 · 纯函数", () => {
  it("不修改传入状态", () => {
    const snapshot = JSON.stringify(base);
    applyAction(SPEC, base, { kind: "declared", actor: "p1", actionId: "search_room" });
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("同输入同输出", () => {
    const p: ProposedAction = { kind: "declared", actor: "p1", actionId: "search_room" };
    expect(applyAction(SPEC, base, p)).toEqual(applyAction(SPEC, base, p));
  });

  it("projectDelta 返回新状态且不改入参", () => {
    const res = applyAction(SPEC, base, { kind: "declared", actor: "p1", actionId: "confess" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const snapshot = JSON.stringify(base);
    const next = projectDelta(base, res.value);
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(next.variables["guard"]).toBe("alert");
    expect(base.variables["guard"]).toBe("unaware");
    expect(next.closedNodes).toContain("interrogation");
  });

  it("投影后再执行同一动作会被一次性约束拒绝", () => {
    const first = applyAction(SPEC, base, { kind: "declared", actor: "p1", actionId: "confess" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const next = projectDelta(base, first.value);
    expect(expectReject(next, { kind: "declared", actor: "p1", actionId: "confess" }).code).toBe(
      "reward_already_settled",
    );
  });
});
