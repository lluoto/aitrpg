// 分辨「丢了就没了」和「能重新生成」。
//
// ── 上一版为什么不可信 ──
// 1. `if (n === "poc") continue;` —— 假定整个 `poc/` 都有远端。可是 `.gitignore`
//    排掉了 `tools/ data/ play-logs/ analysis/ play-records/` 与
//    `frontend/public/{bgm,voice}`，光 bgm+voice 就 76MB。
//    「有仓库」不等于「入库了」，要问 git 而不是猜目录名。
// 2. 分类优先级反了：`.md/.yaml` 先撞「手写设计」→ 生成目录里的报告被算成人写的；
//    「备份残留」排在扩展名规则后面 → `x.ts.bak` 先被算成脚本，
//    于是「备份残留」那一档看着永远很干净。
// 3. 漏项：根目录 `.txt`（4.5MB 小说全文）、图片、音频、`.zip`、
//    `.py`（4109 个）、没有 raw/source 路径特征的手写 JSON/TXT。
//    review-request 第 5 条那个「53MB vs 489MB，差 9 倍」就是漏根目录 txt 来的。
// 4. `depth > 6 return` 和 `catch { return }` 都是**静默**的：
//    截断和读不了的目录一声不吭，算出来的总量凭什么可信。
// 5. 「其它」还剩一大堆没分类，却照样发布「不可再生 500MB」这种精确数。
//
// 分类判据抽成了纯函数 `src/diagnostics/backup-classify.ts`，
// 那边用临时路径字符串做正反夹具，不必真有一棵 4GB 的文件树才能测。

import { readdirSync, statSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import {
  classifyPath, summarize, irreplaceableStatement,
  type AuditItem, type BackupClass,
} from "../../src/diagnostics/backup-classify";
import { writeReport } from "../../src/diagnostics/report";

const ROOT = "C:\\aitrpg";
const REPO = join(ROOT, "poc");
const MAX_DEPTH = 12;

// ── 1. 问 git：哪些文件真的入库了 ─────────────────────────────

function gitTrackedFiles(): { tracked: Set<string>; ok: boolean; note: string } {
  const r = spawnSync("git", ["-C", REPO, "ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    return {
      tracked: new Set(),
      ok: false,
      note: `git ls-files 失败（${r.error?.message ?? `退出码 ${r.status}`}）—— 无法区分已跟踪与被忽略，poc/ 全部按「未备份」计入`,
    };
  }
  const set = new Set(
    r.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
      .map((p) => join(REPO, p.replace(/\//g, "\\"))),
  );
  return { tracked: set, ok: true, note: "" };
}

/** 入库 ≠ 推上去了。没有 upstream 或有未推送提交，「有远端」这个前提就不成立 */
function remoteStatus(): string {
  const remotes = spawnSync("git", ["-C", REPO, "remote"], { encoding: "utf8" });
  if (remotes.error || remotes.status !== 0) return "⚠ 读不到 git remote —— 无法确认 poc/ 是否真有远端";
  const names = remotes.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) return "⚠ **poc/ 根本没有配置远端** —— 「已跟踪 = 有备份」这个前提不成立，全部按未备份看待";
  const ahead = spawnSync("git", ["-C", REPO, "rev-list", "--count", "@{u}..HEAD"], { encoding: "utf8" });
  if (ahead.error || ahead.status !== 0) {
    return `远端：${names.join(", ")}；⚠ 当前分支没有 upstream —— 已提交但未必推得上去`;
  }
  const n = Number(ahead.stdout.trim());
  return n > 0
    ? `远端：${names.join(", ")}；⚠ 有 ${n} 个提交**尚未推送** —— 这部分同样只存在于本机`
    : `远端：${names.join(", ")}；HEAD 已推送`;
}

// ── 2. 遍历。截断与读失败都要留痕，不许静默 ────────────────────

const items: AuditItem[] = [];
const truncatedDirs: string[] = [];
const unreadableDirs: string[] = [];
const unreadableFiles: string[] = [];
let trackedCount = 0;
let trackedSize = 0;

const { tracked, ok: gitOk, note: gitNote } = gitTrackedFiles();

function record(full: string, size: number) {
  const rel = full.startsWith(ROOT + "\\") ? full.slice(ROOT.length + 1) : full;
  const r = classifyPath({ rel, size });
  items.push({ rel, size, kind: r.kind, rule: r.rule, manualReview: r.manualReview });
}

function walk(dir: string, depth: number) {
  if (depth > MAX_DEPTH) { truncatedDirs.push(dir); return; }
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    // 上一版这里是 `catch { return }` —— 读不了的目录一声不吭地从统计里消失
    unreadableDirs.push(`${dir}  (${e instanceof Error ? e.message : String(e)})`);
    return;
  }
  for (const n of names) {
    if (n === ".git" || n === "node_modules") continue;
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch (e) {
      unreadableFiles.push(`${p}  (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    if (st.isDirectory()) { walk(p, depth + 1); continue; }
    // poc/ 里**已跟踪**的文件才算有远端；被 .gitignore 排除的照样要审
    if (gitOk && tracked.has(p)) { trackedCount++; trackedSize += st.size; continue; }
    record(p, st.size);
  }
}

walk(ROOT, 0);

// ── 3. 汇总 ──────────────────────────────────────────────────

const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
const s = summarize(items);

const RECOVERY: Record<BackupClass, string> = {
  "源材料": "**找不回来** — 外部来源，未必还能拿到",
  "手写设计": "**找不回来** — 人写的",
  "脚本": "**找不回来** — 除非 poc 里有副本",
  "抽取产物": "能重跑（前提是源材料 + 脚本都在）",
  "备份残留": "本身就是旧副本，不必再备",
  "待确认": "**判据说不准，需要人过一遍**",
};

const out: string[] = ["# 备份分层：什么丢了就没了", ""];
out.push("范围：`C:\\aitrpg` **全部**，其中 `poc/` 只排除 git 已跟踪的文件。");
out.push("");
out.push(`- ${remoteStatus()}`);
out.push(`- poc/ 已跟踪（视为有远端，未计入下表）：${trackedCount} 个 / ${mb(trackedSize)} MB`);
if (!gitOk) out.push(`- ${gitNote}`);
out.push(`- 遍历深度上限 ${MAX_DEPTH}；被截断的目录 ${truncatedDirs.length} 个，读不了的目录 ${unreadableDirs.length} 个，读不了的文件 ${unreadableFiles.length} 个`);
out.push("");

out.push("| 类别 | 文件数 | 大小 (MB) | 丢了怎么办 |");
out.push("|---|---|---|---|");
for (const [k, v] of [...s.byKind.entries()].sort((a, b) => b[1].size - a[1].size)) {
  out.push(`| ${k} | ${v.count} | ${mb(v.size)} | ${RECOVERY[k]} |`);
}
out.push("");
out.push("## 结论");
out.push("");
out.push(irreplaceableStatement(s));
out.push("");

if (!s.complete) {
  out.push("## 待人工确认清单（判据说不准的那些）");
  out.push("");
  out.push("判据只能把它们排除在「明确可重建」之外，不能替人断定值不值得备份。");
  out.push("在这份清单被过完之前，**上面的总量只是下界**。");
  out.push("");
  const pending = items.filter((i) => i.kind === "待确认" || i.manualReview);
  const byRule = new Map<string, { n: number; size: number; samples: string[] }>();
  for (const p of pending) {
    const cur = byRule.get(p.rule) ?? { n: 0, size: 0, samples: [] };
    cur.n++; cur.size += p.size;
    if (cur.samples.length < 5) cur.samples.push(`${p.rel} (${mb(p.size)} MB)`);
    byRule.set(p.rule, cur);
  }
  for (const [rule, v] of [...byRule.entries()].sort((a, b) => b[1].size - a[1].size)) {
    out.push(`### ${rule} — ${v.n} 个 / ${mb(v.size)} MB`);
    out.push("");
    for (const sm of v.samples) out.push(`- \`${sm}\``);
    out.push("");
  }
  out.push("按大小排前 20 个待确认：");
  out.push("");
  for (const p of [...pending].sort((a, b) => b.size - a.size).slice(0, 20)) {
    out.push(`- \`${p.rel}\`  ${mb(p.size)} MB  [${p.rule}]`);
  }
  out.push("");
}

out.push("## 已确定不可再生 · 按大小排前 25");
out.push("");
const crit = items.filter((i) => ["源材料", "手写设计", "脚本"].includes(i.kind));
for (const it of [...crit].sort((a, b) => b.size - a.size).slice(0, 25)) {
  out.push(`- \`${it.rel}\`  ${mb(it.size)} MB  [${it.kind} · ${it.rule}]`);
}
out.push("");
out.push("## 最大的抽取产物（能重跑，但要时间）");
out.push("");
for (const it of items.filter((i) => i.kind === "抽取产物").sort((a, b) => b.size - a.size).slice(0, 8)) {
  out.push(`- \`${it.rel}\`  ${mb(it.size)} MB`);
}

if (truncatedDirs.length || unreadableDirs.length || unreadableFiles.length) {
  out.push("");
  out.push("## 遍历没覆盖到的地方（这些不在上面任何一个数字里）");
  out.push("");
  for (const d of truncatedDirs.slice(0, 20)) out.push(`- 深度截断：\`${d}\``);
  for (const d of unreadableDirs.slice(0, 20)) out.push(`- 读不了的目录：\`${d}\``);
  for (const f of unreadableFiles.slice(0, 20)) out.push(`- 读不了的文件：\`${f}\``);
}

await writeReport("audit-backup.md", out.join("\n") + "\n");
console.log(
  `${s.complete ? "审计完成" : "**审计未完成**"}｜已确定不可再生 ${s.irreplaceableCount} 个 / ${mb(s.irreplaceableSize)} MB｜` +
  `待确认 ${s.pendingCount} 个 / ${mb(s.pendingSize)} MB｜` +
  `深度截断 ${truncatedDirs.length}｜读失败 ${unreadableDirs.length + unreadableFiles.length}` +
  `  -> analysis/diag/audit-backup.md`,
);
