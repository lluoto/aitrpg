// 判据：提交信息是否符合 docs/todo.json rule-04 的约定。
//
// 纯函数 + 独立测试，脚本本体只负责读文件、打印、给退出码——同一条判据
// 分层原则用在了 preflight 的所有检查上（见 source-scan.ts 的头注释），
// 这条也不例外。消费方：scripts/check-commit-msg.ts（被 .githooks/commit-msg
// 调用）、preflight 第 12 项间接依赖同一份约定描述。
//
// 约定本身（rule-04）：
//   subject  英文祈使句 + conventional 前缀（feat/fix/docs/test/refactor/
//            chore）+ 冒号 + 空格，≤72 字符；允许在 "..." 或「...」内
//            引用中文术语/原文
//   body     每行 ≤72 字符手动换行；不用 markdown 粗体/斜体
//            （GitHub 提交消息不渲染 markdown）

export interface CommitMsgIssue {
  line: number;
  message: string;
}

const CONVENTIONAL_PREFIX = /^(feat|fix|docs|test|refactor|chore)(\([\w.-]+\))?: /;
const CJK_RANGE = /[\u4e00-\u9fff\u3000-\u303f]/;
const MAX_LINE = 72;

/** 把 "..." 与「...」包住的内容剥掉，只剩下需要检查"是不是中文"的那部分。 */
function stripQuotedTerms(s: string): string {
  return s.replace(/"[^"]*"/g, "").replace(/「[^」]*」/g, "");
}

/** GitHub 提交消息不渲染 markdown，`**粗体**`/`*斜体*` 会原样显示成星号。 */
function findMarkdownEmphasis(line: string): boolean {
  return /\*\*[^*]+\*\*/.test(line) || /(?<!\*)\*[^*\s][^*]*\*(?!\*)/.test(line);
}

/**
 * 校验一份提交信息文本（git 传给 commit-msg 钩子的那份原始文件内容）。
 *
 * ⚠ 空 subject 不报——那是 git 自己的事（空提交信息会被 git 直接拒绝，
 * 这条判据不重复造轮子）。也不检查是否有 body：很多小改动（如 rule-01
 * 那种一行 chore）合理地没有 body，不该被强制要求写。
 */
export function validateCommitMessage(raw: string): CommitMsgIssue[] {
  const issues: CommitMsgIssue[] = [];
  // 交互式提交（`git commit` 不带 -m）会在文件里附一堆 `#` 开头的状态提示，
  // 那些不是消息本体，不该被当作 body 的一部分去检查。
  const lines = raw.split("\n").filter((l) => !l.startsWith("#"));
  const subject = lines[0] ?? "";
  if (subject.trim() === "") return issues;

  if (subject.length > MAX_LINE) {
    issues.push({ line: 1, message: `subject 超过 ${MAX_LINE} 字符（实际 ${subject.length}）` });
  }
  if (!CONVENTIONAL_PREFIX.test(subject)) {
    issues.push({ line: 1, message: "subject 缺少 conventional 前缀（feat/fix/docs/test/refactor/chore）" });
  }
  if (CJK_RANGE.test(stripQuotedTerms(subject))) {
    issues.push({ line: 1, message: 'subject 含引号之外的中文字符（允许在 "..." 或「...」内引用术语，见 rule-04）' });
  }

  // body：跳过 subject（下标 0）与紧随的空行（下标 1，按惯例）。
  // 不强制要求这一行真的是空的——有的合理提交只有一行 subject，没有 body。
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length > MAX_LINE) {
      issues.push({
        line: i + 1,
        message: `body 第 ${i + 1} 行超过 ${MAX_LINE} 字符（实际 ${line.length}）：${line.slice(0, 40)}…`,
      });
    }
    if (findMarkdownEmphasis(line)) {
      issues.push({
        line: i + 1,
        message: `body 第 ${i + 1} 行含 markdown 粗体/斜体标记——GitHub 不渲染，会原样显示成星号：${line.slice(0, 40)}…`,
      });
    }
  }

  return issues;
}
