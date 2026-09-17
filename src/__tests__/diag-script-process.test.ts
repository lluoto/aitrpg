import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import * as diagnostics from "../diagnostics/source-scan";

type Result = { status?: number | null; signal?: string | null; error?: Error; stdout?: string; stderr?: string };
const full = "0 fail\nRan 3056 tests across 214 files";
const checkpoint = "## 编译闭环检查点 I 交接\n\nHandcrafted active compiler evidence.\n\n### Witnesses\n\nKeep these too.\n\n";

// Execute production bodies, replacing only imported IO and local process/console.
// No module/global mocks, subprocesses, or writes to the repository are involved.
function run(script: string, result: Result, query: "tests" | "unwired" | "hooks" = "tests", noTest = false,
  existingDocument = `# Existing\n\n${checkpoint}## 第一件事：读这三份\n\nOld generated content.`) {
  const writes = new Map<string, string>();
  const logs: string[] = [];
  const calls: string[] = [];
  let exit = 0;
  const files = new Map([
    ["docs/test-baseline.json", JSON.stringify({ tests: 3056, files: 214, unwiredMethods: 90 })],
    ["docs/handoff.md", existingDocument],
    [".githooks/commit-msg", "fixture"],
  ]);
  const source = readFileSync(join(import.meta.dir, "../../scripts", script + ".ts"), "utf8")
    .replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  const bindings = {
    ...diagnostics, join,
    readFileSync: (path: string) => {
      if (!files.has(path)) throw new Error(`Unexpected read: ${path}`);
      return files.get(path)!;
    },
    existsSync: (path: string) => files.has(path),
    readdirSync: () => { throw new Error("Unexpected directory traversal"); },
    statSync: () => { throw new Error("Unexpected stat"); },
    writeFileSync: (path: string, text: string) => {
      if (path !== `docs/${script}.md`) throw new Error(`Unexpected write: ${path}`);
      writes.set(path, text);
    },
    spawnSync: (command: string, args: string[], options: { shell?: boolean }) => {
      const key = args.join(" ");
      calls.push(`${command} ${key}`);
      if (script !== "preflight") expect(options.shell).toBeUndefined();
      if ((query === "tests" && key === "test") ||
          (query === "unwired" && key === "scripts/diag/probe-unwired.ts") ||
          (query === "hooks" && key === "config --get core.hooksPath")) return result;
      if (key === "test") return { status: 0, stdout: full };
      if (key === "scripts/diag/probe-unwired.ts") return { status: 0, stdout: "没调用方 90" };
      if (key === "config --get core.hooksPath") return { status: 0, stdout: ".githooks" };
      return { status: 0, stdout: "" };
    },
    process: { argv: noTest ? ["bun", script, "--no-test"] : ["bun", script], exit: (code: number) => { exit = code; } },
    console: { log: (text: string) => logs.push(text) },
  };
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  new Function(...Object.keys(bindings), js)(...Object.values(bindings));
  const text = writes.get(`docs/${script}.md`) ?? logs.join("\n");
  const summary = script === "preflight" ? text : text.split("\n").find((line) => script === "now" ? line.startsWith("| 测试 |") : line.includes("**测试**"))!;
  return { text, summary, exit, calls, writes };
}

describe("production summary rendering", () => {
  for (const script of ["now", "handoff", "preflight"]) {
    test(`${script}: decoy failures cannot mask positive Bun summary`, () => {
      const r = run(script, { status: 0, stdout: "fixture: 0 failures", stderr: " 2 fail\r\nRan 3056 tests across 214 files [1.00s]\r\n" });
      expect(r.summary).not.toContain("全绿");
      expect(r.summary).toContain("2 条失败");
      expect(r.exit).toBe(script === "preflight" ? 1 : 0);
    });
    test(`${script}: decoy test/file counts do not replace real counts`, () => {
      const r = run(script, { status: 0, stdout: "fixture: Ran 9999 tests across 999 files", stderr: " 0 fail\nRan 3056 tests across 214 files [1.00s]" });
      expect(r.summary).toContain("3056 条 / 214 文件");
      expect(r.summary).not.toContain("9999");
      expect(r.exit).toBe(0);
    });
    test(`${script}: multiple exact summaries are ambiguous, never passing`, () => {
      const r = run(script, { status: 0, stdout: full, stderr: "2 fail\nRan 3056 tests across 214 files" });
      expect(r.summary).not.toContain("全绿");
      expect(r.summary).toContain("没解析到测试条数");
      expect(r.exit).toBe(script === "preflight" ? 1 : 0);
    });
  }
  for (const ending of ["", "\n", "\r\n"]) test(`handoff: checkpoint EOF separator ${JSON.stringify(ending)}`, () => {
    const section = "## 编译闭环检查点 I 交接\n\nKeep this evidence." + ending;
    const r = run("handoff", { status: 0, stdout: full }, "tests", false, "# Existing\n\n" + section);
    expect(r.text).toContain(section);
    expect(r.text).toMatch(/Keep this evidence\.\r?\n(?:\r?\n)*## 第一件事：读这三份/);
    expect(r.exit).toBe(0);
  });
  for (const script of ["now", "handoff"]) {
    test(`${script}: complete zero-failure success and checkpoint preservation`, () => {
      const r = run(script, { status: 0, stdout: full });
      expect(r.summary).toContain("全绿");
      expect(r.exit).toBe(0);
      expect(r.writes.size).toBe(1);
      if (script === "handoff") expect(r.text).toContain(checkpoint);
    });
    for (const [name, result] of Object.entries({
      "missing failed": { status: 0, stdout: "Ran 3056 tests across 214 files" },
      "positive failed": { status: 0, stdout: "2 fail\nRan 3056 tests across 214 files" },
      "missing counts": { status: 0, stdout: "0 fail" },
      "nonzero": { status: 1, stdout: full },
      "signal": { status: 0, signal: "SIGTERM", stdout: full },
      "spawn error": { status: 0, error: new Error("fixture EPERM"), stdout: full },
      "null status": { status: null, stdout: full },
      "unknown status": { stdout: full },
    })) test(`${script}: ${name} never green, snapshot still generated`, () => {
      const r = run(script, result);
      expect(r.summary).not.toContain("全绿");
      expect(r.summary).toMatch(/未通过|完整摘要/);
      expect(r.writes.size).toBe(1);
      expect(r.exit).toBe(0);
    });
    test(`${script}: no-test is unrun`, () => {
      const r = run(script, { status: 0, stdout: full }, "tests", true);
      expect(r.text).toMatch(/未跑/);
      expect(r.summary).not.toContain("全绿");
      expect(r.calls).not.toContain("bun test");
    });
    if (script === "handoff") test("handoff: matching tests with fewer files is regression, not green", () => {
      const r = run(script, { status: 0, stdout: "0 fail\nRan 3056 tests across 213 files" });
      expect(r.summary).not.toContain("全绿");
      expect(r.summary).toContain("文件数回退");
    });
    if (script === "now") test("now: lower test count is regression, not green", () => {
      const r = run("now", { status: 0, stdout: "0 fail\nRan 3055 tests across 214 files" });
      expect(r.summary).not.toContain("全绿");
      expect(r.summary).toContain("测试条数回退");
    });
  }
});

describe("production preflight process checks", () => {
  test("valid unwired and hooks succeed", () => {
    expect(run("preflight", { status: 0, stdout: "没调用方 90" }, "unwired").exit).toBe(0);
  });
  for (const [name, outcome] of Object.entries({
    nonzero: { status: 2 }, signal: { status: 0, signal: "SIGTERM" },
    error: { status: 0, error: new Error("fixture EPERM") }, unknown: { status: null },
    missing: {},
  })) {
    test(`unwired ${name} rejects parseable partial output`, () => {
      const r = run("preflight", { ...outcome, stdout: "没调用方 90" }, "unwired");
      expect(r.exit).toBe(1);
      expect(r.text).toMatch(/probe-unwired.*(?:退出码|信号|启动)/);
      expect(r.text).not.toContain("断线 90 处，与基线一致");
    });
    for (const stdout of ["", ".githooks"]) test(`hooks ${name} rejects ${stdout || "empty"} output as lookup failure`, () => {
      const r = run("preflight", { ...outcome, stdout }, "hooks");
      expect(r.exit).toBe(1);
      expect(r.text).toMatch(/core.hooksPath.*(?:退出码|信号|启动)/);
      expect(r.text).not.toContain("跑一次 `git config");
      expect(r.text).not.toContain("commit-msg 判据在跑");
    });
  }
  test("unwired successful missing count is parsing failure", () => {
    const r = run("preflight", { status: 0, stdout: "truncated" }, "unwired");
    expect(r.exit).toBe(1);
    expect(r.text).toContain("解析不到条数");
  });
  test("hooks exit 1 empty is genuinely unset", () => {
    const r = run("preflight", { status: 1, stdout: "" }, "hooks");
    expect(r.exit).toBe(1);
    expect(r.text).toContain("(未设置)");
    expect(r.text).toContain("跑一次 `git config");
  });
  test("hooks exit 1 empty stdout with stderr is failed lookup", () => {
    const r = run("preflight", { status: 1, stdout: "", stderr: "error: lookup failed" }, "hooks");
    expect(r.exit).toBe(1);
    expect(r.text).toContain("lookup 退出码 1");
    expect(r.text).toContain("error: lookup failed");
    expect(r.text).not.toContain("跑一次 `git config");
    expect(r.text).not.toContain("(未设置)");
  });
  test("hooks exit 1 whitespace-only stderr remains unset", () => {
    const r = run("preflight", { status: 1, stdout: " \r\n", stderr: " \r\n" }, "hooks");
    expect(r.text).toContain("(未设置)");
    expect(r.text).toContain("跑一次 `git config");
  });
  test("hooks exit 1 partial is failed lookup", () => {
    const r = run("preflight", { status: 1, stdout: ".githooks" }, "hooks");
    expect(r.exit).toBe(1);
    expect(r.text).toContain("lookup 退出码 1");
    expect(r.text).not.toContain("commit-msg 判据在跑");
  });
  for (const [name, stdout, reason] of [
    ["missing failures", "Ran 3056 tests across 214 files", "失败数"],
    ["positive failures", "2 fail\nRan 3056 tests across 214 files", "2 条失败"],
    ["missing files", "0 fail\nRan 3056 tests", "测试条数"],
    ["regressed files", "0 fail\nRan 3056 tests across 213 files", "文件数回退"],
  ]) test(`preflight tests: ${name}`, () => {
    const r = run("preflight", { status: 0, stdout }, "tests");
    expect(r.exit).toBe(1);
    expect(r.text).toContain(reason!);
    expect(r.text).not.toContain("测试 3056 条 / 214 文件，与基线一致");
  });
});

describe("authoritative Bun summary lines", () => {
  test("Bun terminal period before timing is accepted", () => {
    expect(diagnostics.parseTestOutput(" 0 fail\nRan 3056 tests across 214 files. [1.00s]"))
      .toEqual({ tests: 3056, files: 214, passed: null, skipped: null, failed: 0 });
  });
  test("decoy failure and count prose ignored", () => {
    expect(diagnostics.parseTestOutput("fixture: 0 failures\nfixture: Ran 9999 tests across 999 files\n 2 fail\nRan 3056 tests across 214 files [1.00s]"))
      .toEqual({ tests: 3056, files: 214, passed: null, skipped: null, failed: 2 });
  });
  for (const newline of ["\n", "\r\n"]) test(`trimmed exact summary ${JSON.stringify(newline)}`, () => {
    expect(diagnostics.parseTestOutput(` 0 fail ${newline} Ran 3056 tests across 214 files [1.00s] `))
      .toEqual({ tests: 3056, files: 214, passed: null, skipped: null, failed: 0 });
  });
  test("absent exact lines stay null", () => {
    expect(diagnostics.parseTestOutput("fixture: 0 failures\nfixture: Ran 3056 tests across 214 files\n0 failures\nRan 3056 tests across 214 files decoy"))
      .toEqual({ tests: null, files: null, passed: null, skipped: null, failed: null });
  });
  for (const extra of ["\n2 fail", "\nRan 1 tests across 1 files", "\n" + full]) test(`multiple exact evidence fails closed ${JSON.stringify(extra)}`, () => {
    expect(diagnostics.parseTestOutput(full + extra)).toEqual({ tests: null, files: null, passed: null, skipped: null, failed: null });
  });
});

describe("complete baseline evidence", () => {
  for (const cur of [
    { tests: 3056, files: 214, failed: null },
    { tests: 3056, files: null, failed: 0 },
    { tests: 3056, files: 213, failed: 0 },
  ]) test(`reject ${JSON.stringify(cur)}`, () => {
    expect(diagnostics.judgeTestCount(cur, { tests: 3056, files: 214 }).problems.length).toBeGreaterThan(0);
  });
});
