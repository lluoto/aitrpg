// 判据校准：提交信息约定（docs/todo.json rule-04）。
// 三侧都要有：合规通过、违规拦截、文本相似但合法不误报。
//
// bun test src/__tests__/commit-msg.test.ts

import { describe, test, expect } from "bun:test";
import { validateCommitMessage } from "../diagnostics/commit-msg";

describe("合规的提交信息通过", () => {
  test("**不应报**：简单的一行 subject，没有 body", () => {
    expect(validateCommitMessage("fix: correct off-by-one in scene graph BFS")).toEqual([]);
  });

  test("**不应报**：subject + body，每行都在 72 字符以内", () => {
    const msg = [
      "feat: add commit message convention (rule-04)",
      "",
      "Write down the convention in docs/todo.json rule-04, wire it into",
      "the handoff.ts generator template, and add a .gitmessage template.",
    ].join("\n");
    expect(validateCommitMessage(msg)).toEqual([]);
  });

  test("**不应报**：subject 里引号内的中文术语允许出现（本仓真实历史提交的形状）", () => {
    expect(validateCommitMessage('fix: "潜行" was listed as an attack verb')).toEqual([]);
    expect(validateCommitMessage("fix: NPC dialogue always ends with 「我知道的就这些了」")).toEqual([]);
  });

  test("**不应报**：带 scope 的 conventional 前缀", () => {
    expect(validateCommitMessage("fix(intent): tighten chase/flee regex")).toEqual([]);
  });

  test("**不应报**：空字符串——git 自己会拦空提交，这条判据不重复造轮子", () => {
    expect(validateCommitMessage("")).toEqual([]);
  });
});

describe("违规的提交信息被拦下", () => {
  test("**应报**：subject 超过 72 字符", () => {
    const long = "fix: " + "x".repeat(70); // 5 + 70 = 75 > 72
    const issues = validateCommitMessage(long);
    expect(issues.some((i) => i.line === 1 && /超过 72/.test(i.message))).toBe(true);
  });

  test("**应报**：subject 缺少 conventional 前缀", () => {
    const issues = validateCommitMessage("update the scene graph BFS logic");
    expect(issues.some((i) => i.line === 1 && /conventional 前缀/.test(i.message))).toBe(true);
  });

  test("**应报**：subject 含引号之外的中文字符（本仓真实的旧习惯，改掉的正是这个）", () => {
    const issues = validateCommitMessage("fix: 收紧chase正则");
    expect(issues.some((i) => i.line === 1 && /引号之外的中文/.test(i.message))).toBe(true);
  });

  test("**应报**：body 某一行超过 72 字符", () => {
    const msg = [
      "docs: update the commit convention",
      "",
      "x".repeat(80),
    ].join("\n");
    const issues = validateCommitMessage(msg);
    expect(issues.some((i) => i.line === 3 && /超过 72/.test(i.message))).toBe(true);
  });

  test("**应报**：body 里用了 markdown 粗体——GitHub 不渲染，会显示成字面星号", () => {
    const msg = [
      "docs: note the markdown caveat",
      "",
      "**this** should not be bold on GitHub.",
    ].join("\n");
    const issues = validateCommitMessage(msg);
    expect(issues.some((i) => i.line === 3 && /markdown/.test(i.message))).toBe(true);
  });
});

describe("干扰：文本相似但合法，不该被误报", () => {
  test("**不应报**：body 里的单个星号（列表项常见写法）不算 markdown 强调", () => {
    const msg = [
      "docs: add a checklist",
      "",
      "* first item",
      "* second item",
    ].join("\n");
    const issues = validateCommitMessage(msg);
    expect(issues.some((i) => /markdown/.test(i.message))).toBe(false);
  });

  test("**不应报**：body 里的中文（rule-04 只管 subject 的语言，不管 body）", () => {
    const msg = [
      "fix: correct the scene graph BFS",
      "",
      "根因是遍历顺序错了，已经用真实模组数据验证过。",
    ].join("\n");
    expect(validateCommitMessage(msg)).toEqual([]);
  });

  test("**不应报**：交互式提交里 git 自动附的 # 注释行不算 body 内容", () => {
    const msg = [
      "fix: correct the scene graph BFS",
      "",
      "# Please enter the commit message for your changes. Lines starting",
      "# with '#' will be ignored, and an empty message aborts the commit.",
      "#",
      "# On branch master",
    ].join("\n");
    expect(validateCommitMessage(msg)).toEqual([]);
  });

  test("**不应报**：恰好 72 字符的行（边界值，不该被 > 72 误伤成 >= 72）", () => {
    const exact72 = "fix: " + "x".repeat(67); // 总长 72
    expect(exact72.length).toBe(72);
    expect(validateCommitMessage(exact72)).toEqual([]);
  });
});
