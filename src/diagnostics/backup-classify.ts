// 「哪些数据丢了就没了」——分类判据本身。
//
// ── 上一版的错 ──
// 1. `if (n === "poc") continue;` —— 假定整个 `poc/` 都有远端。
//    但 `poc/.gitignore` 排除了 `tools/ data/ play-logs/ analysis/ play-records/`
//    与 `frontend/public/{bgm,voice}`，其中 bgm+voice 就有 76MB。
//    「有仓库」不等于「入库了」，要问 git 而不是猜目录名。
// 2. 分类优先级反了：
//    · `.md/.yaml` 先撞上「手写设计」，于是 `v18_output/*.md` 这种生成物被算成人写的；
//    · 「备份残留」排在扩展名规则后面，于是 `x.ts.bak` 先被算成脚本、
//      `design.md.bak` 先被算成手写设计 —— 备份文件**因为扩展名绕过了备份判定**。
// 3. 漏项：根目录 `.txt`、图片、音频、`.zip`、`.py`（4109 个）、
//    没有 `raw/source` 路径特征的手写 JSON/TXT，全落进「其它」然后不再过问。
// 4. `walk(depth > 6) return` 与 `catch { return }` 都是**静默**的：
//    截断和读不了的目录一声不吭，算出来的总量凭什么可信。
// 5. 「其它」还剩一大堆没分类，却照样发布「不可再生 500MB」这种精确数。
//
// ── 现在的判据 ──
// 纯函数，只吃路径字符串 + 大小，因此可以用临时路径做正反夹具，
// 不必真有一棵 4GB 的文件树才能测。规则**按顺序**匹配，每条带稳定 id，
// 测试直接钉 `rule` 而不只是钉分类结果 —— 分类对了但走错规则同样是判据坏了。

export type BackupClass =
  /** 找不回来：外部来源 */
  | "源材料"
  /** 找不回来：人写的 */
  | "手写设计"
  /** 找不回来（除非仓库里有副本） */
  | "脚本"
  /** 能重跑 */
  | "抽取产物"
  /** 旧副本，不必再备 */
  | "备份残留"
  /** **判据说不准**。不许当成「不重要」，要人工过一遍 */
  | "待确认";

export interface ClassifyInput {
  /** 相对根的路径，分隔符统一成 `\` */
  rel: string;
  size: number;
}

interface ClassifyResult {
  kind: BackupClass;
  /** 命中的规则 id。测试钉这个，防「分类碰巧对了但走错规则」 */
  rule: string;
  /** 需要人工确认才能定性 */
  manualReview: boolean;
}

const NOVEL_TXT_MIN = 1024 * 1024;

const seg = (rel: string) => rel.split(/[\\/]/).filter(Boolean);
const extOf = (rel: string) => {
  const name = seg(rel).pop() ?? "";
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i).toLowerCase();
};

const SCRIPT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".ps1", ".psm1",
  ".sh", ".bat", ".cmd", ".vue", ".rb", ".pl",
]);
const SOURCE_DOC_EXT = new Set([".pdf", ".docx", ".doc", ".xlsx", ".xls", ".epub", ".mobi", ".pptx", ".ppt"]);
const MEDIA_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico",
  ".wav", ".mp3", ".flac", ".ogg", ".m4a", ".mp4", ".mov", ".avi",
]);
const ARCHIVE_EXT = new Set([".zip", ".7z", ".rar", ".tar", ".gz", ".bz2", ".xz"]);
const GENERATED_EXT = new Set([".jsonl", ".pyc", ".pyo", ".ndjson"]);
const HANDWRITTEN_EXT = new Set([".md", ".yaml", ".yml", ".toml", ".ini"]);
const OPAQUE_EXT = new Set([".db", ".sqlite", ".sqlite3", ".wal", ".shm"]);

/**
 * 备份残留。**必须排在所有扩展名规则前面** ——
 * `design.md.bak` / `engine.ts.bak3` / `稿子_before_rewrite.pdf`
 * 如果先撞上扩展名规则，就会分别被算成手写设计 / 脚本 / 源材料，
 * 「备份残留」那一档永远是空的，看着像很干净。
 *
 * ⚠ 反向要求同样重要：`scripts/backup-critical.ts` 和 `analysis/diag/audit-backup.md`
 * 名字里都有 `backup`，但它们是**正经文件**。判据认的是 `.bak` / `_bak` /
 * `_before_` / `.orig` / `~` 这些**后缀形态**，不是「名字里有 backup」。
 */
const BACKUP_RE = /(\.bak[\w-]*$)|(\.bak[\w-]*\.)|(_bak\d*(\.|$))|(_before_)|(\.orig(\.|$))|(\.old(\.|$))|(~$)|(\.copy(\.|$))|(_副本(\.|$))/i;

/** 明确是「跑脚本生成出来的」目录。名字是约定，改约定要连这里一起改 */
const GENERATED_DIR_RE = /^(chapters?_.+|extracted_.+|.+_output|.+_extracted|output|results|dist|build|node_modules|__pycache__|\.pytest_cache|ex_logs|coverage|\.cache)$/i;

/** 「原始素材」的路径特征 */
const RAW_PATH_RE = /(来源|原著|原文|素材|原始|raw|source|sources|assets_src)/i;

/** 仓库里由脚本重建的媒体产物 */
const REBUILDABLE_MEDIA_RE = /(^|\\)frontend\\public\\(bgm|voice)(\\|$)/i;

export function classifyPath(input: ClassifyInput): ClassifyResult {
  const rel = input.rel.replace(/\//g, "\\");
  const parts = seg(rel);
  const name = parts[parts.length - 1] ?? "";
  const dirs = parts.slice(0, -1);
  const ext = extOf(rel);

  // ── 1. 备份残留：最先判，不给扩展名绕过的机会 ──
  if (BACKUP_RE.test(name)) {
    return { kind: "备份残留", rule: "backup-residue", manualReview: false };
  }

  // ── 2. 由脚本重建的媒体（本仓库的 bgm/voice） ──
  if (REBUILDABLE_MEDIA_RE.test(rel)) {
    return { kind: "抽取产物", rule: "rebuildable-media", manualReview: false };
  }

  const inGenerated = dirs.some((d) => GENERATED_DIR_RE.test(d));

  // ── 3. 生成目录：**排在「手写设计」前面** ──
  // 但脚本与真·源格式（PDF/EPUB/图片/压缩包）例外：
  // 一个 PDF 放进 output/ 也还是那个 PDF，删了不会自己长回来。
  if (inGenerated && !SCRIPT_EXT.has(ext) && !SOURCE_DOC_EXT.has(ext)
      && !MEDIA_EXT.has(ext) && !ARCHIVE_EXT.has(ext)) {
    return { kind: "抽取产物", rule: "generated-dir", manualReview: false };
  }

  // ── 4. 一望即知的生成扩展名 ──
  if (GENERATED_EXT.has(ext)) {
    return { kind: "抽取产物", rule: "generated-ext", manualReview: false };
  }

  // ── 5. 脚本（含 Python —— 4109 个 .py 上一版全落进「其它」）──
  if (SCRIPT_EXT.has(ext)) {
    return { kind: "脚本", rule: "script-ext", manualReview: false };
  }

  // ── 6. 外部文档源 ──
  if (SOURCE_DOC_EXT.has(ext)) {
    return { kind: "源材料", rule: "source-doc", manualReview: false };
  }

  // ── 7. 图片 / 音频 ──
  if (MEDIA_EXT.has(ext)) {
    return { kind: "源材料", rule: "media", manualReview: false };
  }

  // ── 8. 压缩包：里面是什么不知道，必须人看 ──
  if (ARCHIVE_EXT.has(ext)) {
    return { kind: "源材料", rule: "archive-opaque", manualReview: true };
  }

  // ── 9. PDF 抽出来的 txt：源 PDF 还在就能重跑 ──
  if (/\.(pdf|docx?|epub)\.txt$/i.test(name)) {
    return { kind: "抽取产物", rule: "derived-from-doc", manualReview: false };
  }

  // ── 10. raw/source 路径特征下的文本 ──
  if (RAW_PATH_RE.test(rel) && [".txt", ".json", ".md"].includes(ext)) {
    return { kind: "源材料", rule: "raw-path", manualReview: false };
  }

  // ── 11. 够大的 .txt = 小说/长文本全文。**不限深度、不限目录** ──
  // 上一版写的是 `depth === 2 && rel.startsWith("世界模型\\")`，
  // 于是 `C:\aitrpg` 根目录下那份 4.5MB 的小说全文一分钱都没算进去
  // （review-request 第 5 条：算出 53MB，实际 489MB）。
  if (ext === ".txt" && input.size >= NOVEL_TXT_MIN) {
    return { kind: "源材料", rule: "large-txt", manualReview: false };
  }

  // ── 12. 手写设计（已经过了生成目录那一关） ──
  if (HANDWRITTEN_EXT.has(ext)) {
    return { kind: "手写设计", rule: "handwritten-ext", manualReview: false };
  }

  // ── 13. 剩下的一律「待确认」，并且**明确标成要人看** ──
  // 小 .txt / 散装 .json / .db / 无扩展名文件都在这儿。
  // 上一版把它们叫「其它 · 看情况」然后再不过问，同时照样发布精确的
  // 「不可再生 500MB」—— 一个还没分完类的审计不该给出精确总量。
  if (ext === ".txt" || ext === ".json" || ext === ".csv" || ext === ".tsv") {
    return { kind: "待确认", rule: "small-text-unclassified", manualReview: true };
  }
  if (OPAQUE_EXT.has(ext)) {
    return { kind: "待确认", rule: "opaque-binary", manualReview: true };
  }
  return { kind: "待确认", rule: "unknown-ext", manualReview: true };
}

// ============================================================
// 汇总：什么时候可以给出「不可再生总量」
// ============================================================

const IRREPLACEABLE: readonly BackupClass[] = ["源材料", "手写设计", "脚本"];

interface KindTotal { count: number; size: number }

interface AuditSummary {
  byKind: Map<BackupClass, KindTotal>;
  totalSize: number;
  /** 已确定不可再生的部分（下界） */
  irreplaceableSize: number;
  irreplaceableCount: number;
  /** 待人工确认的部分 */
  pendingSize: number;
  pendingCount: number;
  /**
   * 审计是否算完成。
   * 待确认占比超过阈值就是**没完成** —— 这时不许发布精确总量，只能给下界。
   */
  complete: boolean;
  /** 未完成的理由，直接进报告 */
  incompleteReason: string;
}

export interface AuditItem { rel: string; size: number; kind: BackupClass; rule: string; manualReview: boolean }

/** 待确认占总量超过这个比例，就认为审计没做完 */
const PENDING_RATIO_LIMIT = 0.02;
/** 或者待确认的绝对体量超过这个数（字节），同样算没做完 */
export const PENDING_SIZE_LIMIT = 50 * 1024 * 1024;

export function summarize(items: readonly AuditItem[]): AuditSummary {
  const byKind = new Map<BackupClass, KindTotal>();
  let totalSize = 0;
  for (const it of items) {
    const cur = byKind.get(it.kind) ?? { count: 0, size: 0 };
    cur.count++; cur.size += it.size;
    byKind.set(it.kind, cur);
    totalSize += it.size;
  }
  const irr = items.filter((i) => IRREPLACEABLE.includes(i.kind));
  const pending = items.filter((i) => i.kind === "待确认" || i.manualReview);
  const pendingSize = pending.reduce((a, b) => a + b.size, 0);
  const ratio = totalSize > 0 ? pendingSize / totalSize : 0;
  const tooMuchPending = ratio > PENDING_RATIO_LIMIT || pendingSize > PENDING_SIZE_LIMIT;
  return {
    byKind,
    totalSize,
    irreplaceableSize: irr.reduce((a, b) => a + b.size, 0),
    irreplaceableCount: irr.length,
    pendingSize,
    pendingCount: pending.length,
    complete: !tooMuchPending,
    incompleteReason: tooMuchPending
      ? `待确认 ${pending.length} 个 / ${(pendingSize / 1024 / 1024).toFixed(1)} MB（占 ${(ratio * 100).toFixed(1)}%），超过 ${(PENDING_RATIO_LIMIT * 100).toFixed(0)}% 或 ${PENDING_SIZE_LIMIT / 1024 / 1024}MB 阈值`
      : "",
  };
}

/**
 * 审计结论怎么措辞。
 *
 * 没做完就**只能给下界**。「不可再生 500MB」这种精确数在还剩一堆没分类时
 * 是假精确 —— 它当初漏掉根目录 txt，就是这么算出 53MB 的。
 */
export function irreplaceableStatement(s: AuditSummary): string {
  const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
  if (s.complete) {
    return `不可再生合计：${s.irreplaceableCount} 个文件 / ${mb(s.irreplaceableSize)} MB`;
  }
  return [
    `⚠ 审计**未完成**，不给精确总量。`,
    `已确定不可再生**至少** ${s.irreplaceableCount} 个文件 / ${mb(s.irreplaceableSize)} MB；`,
    `另有待人工确认 ${s.pendingCount} 个 / ${mb(s.pendingSize)} MB，上界为 ${mb(s.irreplaceableSize + s.pendingSize)} MB。`,
    `原因：${s.incompleteReason}`,
  ].join("\n");
}
