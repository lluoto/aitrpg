import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { findReverseImports, importPointsTo, maskSource, scanImports } from "../diagnostics/source-scan";

const LEGACY_WRAPPER = "src/rules/custom-modules/premiers_barn.ts";
const TRANSITION_FIELDS = ["loaderSceneDescriptions", "loaderExits", "clueBindings"];

function source(file: string): string {
  return readFileSync(file, "utf8");
}

function containsRuntimeField(sourceText: string, field: string): boolean {
  const masked = maskSource(sourceText).masked;
  if (masked.includes(field)) return true;
  const quoted = new RegExp(`["']${field}["']\\s*:`, "g");
  for (const match of sourceText.matchAll(quoted)) {
    const colon = (match.index ?? 0) + match[0].lastIndexOf(":");
    if (masked[colon] === ":") return true;
  }
  return false;
}

function productionFiles(): string[] {
  const files = Array.from(new Bun.Glob("{src,scripts}/**/*.ts").scanSync("."));
  if (files.length < 100) throw new Error("source scan input is unexpectedly incomplete");
  return files.filter((file) => !file.includes("/__tests__/"));
}

describe("Barn unification resurrection sentinels", () => {
  it("registry imports BARN_OF_PREMIER directly and cannot load the removed wrapper", () => {
    expect(existsSync(LEGACY_WRAPPER)).toBe(false);
    const imports = scanImports(source("src/rules/custom-modules/index.ts"));
    expect(imports.some((entry) => importPointsTo(entry.path, "barn-of-premier"))).toBe(true);
    expect(imports.some((entry) => importPointsTo(entry.path, "premiers_barn"))).toBe(false);
    expect(imports.some((entry) => importPointsTo(entry.path, "unified-module"))).toBe(false);
  });

  it("production import graph has no old Barn adapter consumer or symbol", () => {
    const files = productionFiles();
    const adapterImports = files.flatMap((file) => findReverseImports(file, source(file), "premiers_barn"));
    expect(adapterImports).toEqual([]);
    const symbolUsers = files.filter((file) => /\bMODULE_PREMIERS_BARN\b/.test(maskSource(source(file)).masked));
    expect(symbolUsers).toEqual([]);
  });

  it("transition scene graph and clue binding fields cannot return to type, data, or loader", () => {
    for (const file of ["src/module/runtime-types.ts", "src/module/barn-of-premier.ts", "src/module/module-data-runtime-loader.ts"]) {
      for (const field of TRANSITION_FIELDS) expect(containsRuntimeField(source(file), field)).toBe(false);
    }
  });

  it("Barn GameSession path and direct loader never import the adapter", () => {
    for (const file of ["src/api/game-session.ts", "src/module/module-data-runtime-loader.ts"]) {
      const imports = scanImports(source(file));
      expect(imports.some((entry) => importPointsTo(entry.path, "premiers_barn"))).toBe(false);
    }
  });

  it("mutation model: a registry import of the wrapper is detected", () => {
    const mutatedRegistry = 'import { MODULE_PREMIERS_BARN } from "./premiers_barn";';
    const imports = scanImports(mutatedRegistry);
    expect(imports.some((entry) => importPointsTo(entry.path, "premiers_barn"))).toBe(true);
  });

  it("mutation model: restoring loaderExits to runtime data is detected", () => {
    const mutatedBarn = 'const runtime = { "loaderExits": {} };';
    expect(containsRuntimeField(mutatedBarn, "loaderExits")).toBe(true);
  });
});
