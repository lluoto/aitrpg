// 圣杯规则集的攻击裁决
// bun test src/__tests__/grail-ruleset.test.ts

import { describe, it, expect } from "bun:test";
import { RulesEngine } from "../rules/rules-engine";
import { GrailEngine } from "../rules/grail-engine";
import type { WorldEntity } from "../types";

/** index.ts getPlayerAttributes() 交给规则路由器的就是这个形状 —— 没有 status */
function playerSheet() {
  return {
    name: "调查员",
    id: "player",
    proficiency: 2,
    abilities: { strength: 50, dexterity: 50 },
    hasSneakAttack: false,
  };
}

function entity(over: Partial<WorldEntity> = {}): WorldEntity {
  return {
    id: "m1", name: "守卫", type: "monster",
    hp: 30, maxHp: 30, ac: 15, status: [], position: "here",
    ...over,
  };
}

describe("圣杯裁决 — 攻击方不是世界实体", () => {
  // 之前这里是 as any 硬转成 WorldEntity 的：inferRank 展开 attacker.status，
  // 而玩家属性表没有这个字段，于是抛 "Spread syntax requires ...iterable"。
  // 切到 /规则 grail 之后每一次攻击都会崩。
  it("玩家属性表作为攻击方不抛异常", () => {
    const engine = new RulesEngine();
    expect(() =>
      engine.adjudicateAttack({ action: "attack", target: "m1" }, playerSheet(), entity(), "grail")
    ).not.toThrow();
  });

  it("返回的是完整的圣杯裁决结果", () => {
    const engine = new RulesEngine();
    const r = engine.adjudicateAttack(
      { action: "attack", target: "m1" }, playerSheet(), entity(), "grail"
    );
    expect(r.ruleset).toBe("grail");
    expect(typeof r.hit).toBe("boolean");
    expect(typeof r.damage).toBe("number");
    expect(["kill", "wound", "miss"]).toContain(r.result);
  });
});

describe("inferRank — 只依赖它真正读的字段", () => {
  it("没有 status 时按名字推断", () => {
    const g = new GrailEngine();
    expect(g.inferRank({ name: "传奇的骑士" })).toBe("legendary");
    expect(g.inferRank({ name: "黄金位阶守卫" })).toBe("gold");
    expect(g.inferRank({ name: "无名小卒" })).toBe("bronze");
  });

  it("status 里的位阶字样同样生效", () => {
    const g = new GrailEngine();
    expect(g.inferRank({ name: "守卫", status: ["白银"] })).toBe("silver");
  });

  it("attributes.rank 优先于名字", () => {
    const g = new GrailEngine();
    expect(g.inferRank({ name: "传奇的骑士", attributes: { rank: "iron" } })).toBe("iron");
  });

  it("世界实体本身也满足这个入参", () => {
    const g = new GrailEngine();
    expect(g.inferRank(entity({ name: "黑铁卫兵" }))).toBe("iron");
  });
});
