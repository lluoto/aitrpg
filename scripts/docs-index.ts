// 文档索引维护。把 docs/index-program.md 拆成「机器可读的结构」+「只追加的 log」。
//
// 为什么：那份文件 2152 行 / 151KB，每个会话开头读一次约 40k token，
// 而其中九成是历史问题记录，跟当次任务多半无关。
//
// 拆完的形态：
//   .opencode/architecture.json   架构地图（表格 → 结构化行），按 section 取
//   .opencode/todo.json           待办 / 已知问题 / 环境约束，带 severity 可过滤
//   docs/notes/index.json         log 索引（标题/日期/状态/摘要/行号）
//   docs/notes/<组>.md            log 正文，**只追加**
//   docs/index-program.md         短导航页
//
// 用法：
//   bun scripts/docs-index.ts split [--dry]   一次性迁移（只跑一次）
//   bun scripts/docs-index.ts                 重建 notes/index.json（日常）
//
// ⚠ 必须用 bun 跑，不能用 PowerShell：本仓中文源文件过 PS 会 mojibake。

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";

const SRC = "docs/index-program.md";
const NOTES_DIR = "docs/notes";
// 放 docs/ 不放 .opencode/：后者被 .gitignore 排除，
// 而架构与待办是项目知识不是会话状态，clone 下来必须还在。
const META_DIR = "docs";

const RECORDS_START = "## 模组摄取（在建）";
const KEY_DOCS = "## 关键文档";
const KNOWN_ISSUES = "## 已知问题";

// ── log 分组：默认继承所在章节主题（摄取），只有命中关键词才拨出去 ──
// 顺序即优先级。engine 不能用「场景」当关键词——摄取那边也满篇「场景」。
const GROUPS: Array<{ id: string; name: string; keys: RegExp }> = [
  {
    id: "engine",
    name: "运行引擎 / 主循环",
    keys: /主循环|循环反转|自由行动|移动|传送|chooseConnection|玩家|intent|agent|决策|自主|通关|掉线|failback|脚手架|岔口|core 线索/i,
  },
  {
    id: "rules",
    name: "规则 / 检定 / 伤害",
    keys: /伤害|重伤|急救|陷阱|SAN|理智|惩罚骰|骰子/i,
  },
];
const DEFAULT_GROUP = { id: "ingest", name: "模组摄取" };

const STATUS_LEGEND: Record<string, string> = {
  fixed: "已修，有实测数",
  open: "已定位未修 / 待决策",
  warn: "有坑，注意",
  rejected: "试过被否决，别再走一遍",
  note: "记录",
};

const today = () => new Date().toISOString().slice(0, 10);

function classify(title: string): string {
  for (const g of GROUPS) if (g.keys.test(title)) return g.id;
  return DEFAULT_GROUP.id;
}

function statusOf(raw: string): string {
  if (/✅/.test(raw)) return "fixed";
  if (/❓/.test(raw)) return "open";
  if (/⚠/.test(raw)) return "warn";
  if (/⛔|🚫/.test(raw)) return "rejected";
  return "note";
}

function dateOf(raw: string): string | null {
  return raw.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

function cleanTitle(raw: string): string {
  return raw.replace(/^#{2,3}\s*/, "").replace(/^(✅|❓|⚠|⛔|🚫)\s*/, "").trim();
}

function summarize(body: string[]): string {
  const line = body.find((l) => l.trim() && !/^[#|>`\-*]/.test(l.trim()));
  return (line ?? "").trim().replace(/\*\*/g, "").slice(0, 140);
}

/** markdown 表格 → { columns, rows }；不是表格就返回 null */
function parseTable(lines: string[], from: number): { columns: string[]; rows: string[][]; end: number } | null {
  const isRow = (l: string) => /^\s*\|/.test(l);
  const isSep = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
  if (!isRow(lines[from] ?? "") || !isSep(lines[from + 1] ?? "")) return null;

  const cells = (l: string) =>
    l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  const columns = cells(lines[from]!);
  const rows: string[][] = [];
  let i = from + 2;
  for (; i < lines.length && isRow(lines[i]!); i++) rows.push(cells(lines[i]!));
  return { columns, rows, end: i };
}

interface ArchSection {
  id: string;
  title: string;
  prose: string[];
  tables: Array<{ columns: string[]; rows: string[][] }>;
}

/** 把 ## 分节的 markdown 解析成结构 */
function parseArchitecture(lines: string[], startSeq = 1): ArchSection[] {
  const out: ArchSection[] = [];
  let seq = startSeq;
  let cur: ArchSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^##\s/.test(l)) {
      if (cur) out.push(cur);
      cur = { id: `sec-${String(seq++).padStart(2, "0")}`, title: cleanTitle(l), prose: [], tables: [] };
      continue;
    }
    if (!cur) continue;
    const t = parseTable(lines, i);
    if (t) {
      cur.tables.push({ columns: t.columns, rows: t.rows });
      i = t.end - 1;
      continue;
    }
    if (l.trim() && l.trim() !== "---") cur.prose.push(l);
  }
  if (cur) out.push(cur);
  return out;
}

/** 已知问题那节 → todo 条目。**粗体行**当分类，其下 - 项当条目 */
function parseTodos(lines: string[]) {
  const items: Array<{ id: string; category: string; severity: string; text: string }> = [];
  let category = "未分类";
  let n = 1;

  const severityOf = (cat: string, text: string) => {
    if (/陷阱|不能|会卡死|mojibake|假红|不能当/.test(cat + text)) return "warn";
    if (/废弃|无引用|孤儿/.test(cat)) return "cleanup";
    return "info";
  };

  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    const bold = l.match(/^\*\*(.+?)\*\*$/);
    if (bold) {
      category = bold[1]!.trim();
      continue;
    }
    if (/^[-*]\s/.test(l)) {
      const text = l.replace(/^[-*]\s*/, "").trim();
      items.push({
        id: `todo-${String(n++).padStart(2, "0")}`,
        category,
        severity: severityOf(category, text),
        text,
      });
    } else if (items.length) {
      // 续行并进上一条
      items[items.length - 1]!.text += " " + l;
    }
  }
  return items;
}

// ────────────────────────────────────────────────────────────
// reindex：扫 docs/notes/*.md 重建 index.json
// ────────────────────────────────────────────────────────────
function reindex(write = true) {
  if (!existsSync(NOTES_DIR)) throw new Error(`${NOTES_DIR} 不存在，先跑 split`);

  const groupName = new Map<string, string>([
    ...GROUPS.map((g) => [g.id, g.name] as [string, string]),
    [DEFAULT_GROUP.id, DEFAULT_GROUP.name],
  ]);

  const records: any[] = [];
  const groups: any[] = [];

  for (const f of readdirSync(NOTES_DIR).filter((f) => f.endsWith(".md")).sort()) {
    const gid = f.replace(/\.md$/, "");
    const lines = readFileSync(`${NOTES_DIR}/${f}`, "utf8").split(/\r?\n/);
    let count = 0;
    let n = 0;

    for (let i = 0; i < lines.length; i++) {
      if (!/^###\s/.test(lines[i]!)) continue;
      let end = i + 1;
      while (end < lines.length && !/^###\s/.test(lines[end]!)) end++;
      const raw = lines[i]!;
      n++;
      records.push({
        id: `${gid}-${String(n).padStart(2, "0")}`,
        title: cleanTitle(raw),
        date: dateOf(raw),
        status: statusOf(raw),
        group: gid,
        file: `${NOTES_DIR}/${f}`,
        line: i + 1,
        lines: end - i,
        summary: summarize(lines.slice(i + 1, end)),
      });
      count++;
      i = end - 1;
    }
    groups.push({ id: gid, name: groupName.get(gid) ?? gid, file: `${NOTES_DIR}/${f}`, count });
  }

  const index = {
    generated: today(),
    note: "问题记录索引。按 file+line 取正文，不必整份读。正文只追加，改动请重跑 bun scripts/docs-index.ts",
    statusLegend: STATUS_LEGEND,
    groups,
    records,
  };

  if (write) writeFileSync(`${NOTES_DIR}/index.json`, JSON.stringify(index, null, 2) + "\n", "utf8");
  return index;
}

// ────────────────────────────────────────────────────────────
// split：一次性迁移
// ────────────────────────────────────────────────────────────
function split(dry: boolean) {
  const all = readFileSync(SRC, "utf8").split(/\r?\n/);

  const iRec = all.findIndex((l) => l.trim() === RECORDS_START);
  const iKey = all.findIndex((l) => l.trim() === KEY_DOCS);
  const iIss = all.findIndex((l) => l.trim() === KNOWN_ISSUES);
  if (iRec < 0 || iKey < 0 || iIss < 0) throw new Error(`定位不到边界 ${iRec}/${iKey}/${iIss}`);

  const head = all.slice(0, iRec);            // 架构
  const recs = all.slice(iRec, iKey);         // log
  const keyDocs = all.slice(iKey, iIss);      // 关键文档表
  const issues = all.slice(iIss + 1);         // 已知问题

  // ── 架构 JSON ──
  const archSections = parseArchitecture(head);
  const keyDocSections = parseArchitecture(keyDocs, archSections.length + 1);
  const architecture = {
    generated: today(),
    source: SRC,
    note: "架构地图。按 title 找 section，只取需要的那节，不必整份读。",
    maintain: "新增文件顺手补一行；与代码不符以代码为准。改完重跑 bun scripts/docs-index.ts",
    sections: [...archSections, ...keyDocSections],
  };

  // ── 待办 JSON ──
  const todos = {
    generated: today(),
    source: `${SRC} #已知问题`,
    note: "已知问题 / 环境约束。severity=warn 的是踩过的坑，动手前先扫一遍。",
    items: parseTodos(issues),
  };

  // ── log 分组 ──
  const secStarts: number[] = [];
  for (let i = 0; i < recs.length; i++) if (/^###\s/.test(recs[i]!)) secStarts.push(i);
  const preamble = recs.slice(0, secStarts[0] ?? recs.length);
  const sections = secStarts.map((s, k) =>
    recs.slice(s, k < secStarts.length - 1 ? secStarts[k + 1]! : recs.length),
  );

  const byGroup = new Map<string, string[][]>();
  for (const sec of sections) {
    const gid = classify(cleanTitle(sec[0]!));
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid)!.push(sec);
  }

  // 行数守恒
  const srcLines = sections.reduce((a, s) => a + s.length, 0);
  const outLines = [...byGroup.values()].reduce((a, v) => a + v.reduce((b, s) => b + s.length, 0), 0);
  if (srcLines !== outLines) throw new Error(`行数不守恒 ${srcLines} vs ${outLines}`);

  const allGroups = [...GROUPS, DEFAULT_GROUP as any];
  const files = new Map<string, string>();

  for (const g of allGroups) {
    const secs = byGroup.get(g.id);
    if (!secs?.length) continue;
    const out = [
      `# ${g.name}`,
      "",
      `> 从 \`${SRC}\` 拆出的 log，**只追加**。索引 \`${NOTES_DIR}/index.json\`（重建：\`bun scripts/docs-index.ts\`）。`,
      "",
    ];
    if (g.id === DEFAULT_GROUP.id && preamble.length > 1) {
      out.push(...preamble.slice(1).filter((l) => l.trim()), "");
    }
    for (const sec of secs) {
      out.push(...sec);
      if (out[out.length - 1]!.trim()) out.push("");
    }
    files.set(`${NOTES_DIR}/${g.id}.md`, out.join("\n").replace(/\n{3,}$/, "\n"));
  }

  // ── 导航页 ──
  const stub = [
    "# 代码索引 — 程序本身",
    "",
    "> 这份文件原本 2152 行 / 151KB，每次读要 ~40k token，九成内容跟当次任务无关。",
    "> 现在拆成三块：**架构走 JSON、待办走 JSON、log 只追加**。",
    "> 姊妹篇 `docs/index-world-model.md`（世界模型与模组内容）。",
    "",
    "## 去哪找",
    "",
    "| 我想…… | 读这个 | 说明 |",
    "|---|---|---|",
    `| 看架构地图 / 某个模块在哪 | \`${META_DIR}/architecture.json\` | 按 \`title\` 找 section，只取那一节 |`,
    `| 看待办 / 已知的坑 | \`${META_DIR}/todo.json\` | \`severity=warn\` 的是踩过的坑，动手前先扫 |`,
    `| 查某个问题查过没有 | \`${NOTES_DIR}/index.json\` | 每条一行元数据，按 \`file\`+\`line\` 取正文 |`,
    `| 读某条记录的正文 | \`${NOTES_DIR}/<组>.md\` | 只追加，不改旧条目 |`,
    "",
    "## 维护",
    "",
    "```",
    "bun scripts/docs-index.ts          # 追加记录后重建 notes/index.json",
    "```",
    "",
    "- **新增记录**：追加到 `docs/notes/<组>.md`，标题用 `### ✅/❓/⚠ 标题（日期）`，再重跑上面那条",
    "- **改架构/待办**：直接编辑对应 JSON",
    "- ⚠ 中文文件**不要过 PowerShell 写**（会 mojibake），用编辑器或 bun 脚本",
    "",
  ].join("\n");
  files.set(SRC, stub);

  // 统计
  console.log(`源文件 ${all.length} 行 →`);
  console.log(`  ${META_DIR}/architecture.json   ${architecture.sections.length} 节, ` +
    `${architecture.sections.reduce((a, s) => a + s.tables.reduce((b, t) => b + t.rows.length, 0), 0)} 行表格`);
  console.log(`  ${META_DIR}/todo.json           ${todos.items.length} 条`);
  console.log(`  ${NOTES_DIR}/                   ${sections.length} 段 log:`);
  for (const g of allGroups) {
    const s = byGroup.get(g.id);
    if (!s?.length) continue;
    console.log(`     ${g.id.padEnd(8)} ${String(s.length).padStart(2)} 段  ${s.reduce((a, x) => a + x.length, 0)} 行`);
  }
  console.log(`  ${SRC}                          ${stub.split("\n").length} 行（导航页）`);

  if (dry) {
    console.log("\n--dry，未写盘");
    return;
  }

  mkdirSync(NOTES_DIR, { recursive: true });
  mkdirSync(META_DIR, { recursive: true });
  writeFileSync(`${META_DIR}/architecture.json`, JSON.stringify(architecture, null, 2) + "\n", "utf8");
  writeFileSync(`${META_DIR}/todo.json`, JSON.stringify(todos, null, 2) + "\n", "utf8");
  for (const [p, c] of files) writeFileSync(p, c, "utf8");

  const idx = reindex(true);
  console.log(`\n已写盘。notes/index.json: ${idx.records.length} 条记录`);
}

// ────────────────────────────────────────────────────────────
// 查询：只取需要的那一节，别整份读
// ────────────────────────────────────────────────────────────
const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));

function qArch(kw?: string) {
  const a = load(`${META_DIR}/architecture.json`);
  if (!kw) {
    for (const s of a.sections) {
      const rows = s.tables.reduce((x: number, t: any) => x + t.rows.length, 0);
      console.log(`${s.id}  ${s.title}  (${rows} 行)`);
    }
    console.log(`\n看某一节：bun scripts/docs-index.ts arch <关键词>`);
    return;
  }
  const re = new RegExp(kw, "i");
  const hit = a.sections.filter(
    (s: any) => re.test(s.title) || s.tables.some((t: any) => t.rows.some((r: string[]) => r.some((c) => re.test(c)))),
  );
  if (!hit.length) return console.log(`没有匹配 ${kw} 的 section`);
  for (const s of hit) {
    console.log(`\n## ${s.title}`);
    for (const l of s.prose) console.log(l);
    for (const t of s.tables) {
      for (const r of t.rows) {
        if (kw && !r.some((c: string) => re.test(c)) && !re.test(s.title)) continue;
        console.log("  " + r.join("  |  "));
      }
    }
  }
}

function qTodo(sev?: string) {
  const t = load(`${META_DIR}/todo.json`);
  const items = sev ? t.items.filter((i: any) => i.severity === sev) : t.items;
  let cat = "";
  for (const i of items) {
    if (i.category !== cat) {
      cat = i.category;
      console.log(`\n【${cat}】`);
    }
    console.log(`  ${i.id}  [${i.severity}] ${i.text}`);
  }
  if (!sev) console.log(`\n只看坑：bun scripts/docs-index.ts todo warn`);
}

function qLog(kw?: string) {
  const idx = load(`${NOTES_DIR}/index.json`);
  const re = kw ? new RegExp(kw, "i") : null;
  // 搜正文而不只是标题+摘要 —— 关键词（failback、chooseConnection…）多半只出现在正文里
  const bodies = new Map<string, string[]>();
  const bodyOf = (r: any) => {
    if (!bodies.has(r.file)) bodies.set(r.file, readFileSync(r.file, "utf8").split(/\r?\n/));
    return bodies.get(r.file)!.slice(r.line - 1, r.line - 1 + r.lines).join("\n");
  };
  const hit = re
    ? idx.records.filter((r: any) => re.test(r.title) || re.test(r.summary) || re.test(bodyOf(r)))
    : idx.records;
  for (const r of hit) {
    console.log(`${r.id.padEnd(11)} ${r.status.padEnd(9)} ${r.date ?? "".padEnd(10)}  ${r.title}`);
    console.log(`${" ".repeat(13)}${r.file}:${r.line} (${r.lines} 行)`);
  }
  console.log(`\n共 ${hit.length} 条${kw ? `（匹配 ${kw}）` : ""}。读正文用 Read 工具按 file+line 取。`);
}

const cmd = process.argv[2];
const arg = process.argv[3];
switch (cmd) {
  case "split":
    split(process.argv.includes("--dry"));
    break;
  case "arch":
    qArch(arg);
    break;
  case "todo":
    qTodo(arg);
    break;
  case "log":
    qLog(arg);
    break;
  default: {
    const idx = reindex(true);
    console.log(`notes/index.json 已重建：${idx.groups.length} 组 / ${idx.records.length} 条`);
    console.log(`\n查询：arch [关键词] · todo [severity] · log [关键词]`);
  }
}
