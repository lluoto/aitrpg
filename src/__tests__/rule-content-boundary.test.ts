// 规则内容边界测试 — 发行产物中不得内置受限规则书内容。
// 规则细节必须由模组或用户提供的规则书注入，而非仓库自带。
//
// 这些断言只检查机器可消费的结构事实（文件是否存在、是否被引用、注册表是否注册），
// 不断言任何叙事文本或说明性散文。

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";

import { getRulesetMod } from "../rules/coc-ruleset-mod";
import * as rulesetMod from "../rules/coc-ruleset-mod";

const SRC_ROOT = resolve(import.meta.dir, "..");

/** 受限内容文件：必须从发行树中删除 */
const FORBIDDEN_FILES = [
  "character/subclasses-extra.ts",
  "rules/coc-reference.ts",
] as const;

/** 受限内容模块说明符：任何源文件都不得再引用 */
const FORBIDDEN_IMPORT_SPECIFIERS = [
  "subclasses-extra",
  "coc-reference",
] as const;

/** 递归收集 src 下所有 .ts 源文件（不含本测试自身） */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!full.endsWith(".ts")) continue;
    if (full.endsWith("rule-content-boundary.test.ts")) continue;
    out.push(full);
  }
  return out;
}

describe("受限规则内容边界", () => {
  test("受限规则内容文件已从源码树删除", () => {
    const present = FORBIDDEN_FILES.filter((rel) => existsSync(join(SRC_ROOT, rel)));
    expect(present).toEqual([]);
  });

  test("没有源文件再引用受限规则内容模块", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const text = readFileSync(file, "utf-8");
      for (const specifier of FORBIDDEN_IMPORT_SPECIFIERS) {
        if (text.includes(`from "../${specifier}"`) || text.includes(`/${specifier}"`)) {
          offenders.push(`${file} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("规则集注册表不再内置 Pulp 变体规则", () => {
    expect(getRulesetMod("pulpcoc").id).not.toBe("pulpcoc");
  });

  test("规则集模块不再导出 Pulp 专有内容", () => {
    const exported = Object.keys(rulesetMod);
    expect(exported).not.toContain("PULP_COC_HOOKS");
    expect(exported).not.toContain("PULP_TALENTS");
    expect(exported).not.toContain("checkTalentRequirements");
    expect(exported).not.toContain("applyTalentToCombat");
  });

  test("规则集注册表仍开放给模组/规则书注入自定义规则", () => {
    rulesetMod.registerRulesetMod("boundary_probe", {
      id: "boundary_probe",
      label: "边界探针",
      maxSkill: 77,
    });
    expect(getRulesetMod("boundary_probe").maxSkill).toBe(77);
  });
});
