// 判据校准：备份分层的分类规则。
//
// 全部用**临时路径字符串**做夹具 —— 上一版只能对着真实的 4GB 文件树跑，
// 于是「根目录 txt 漏了」这种错要等到有人手算才发现（53MB vs 489MB，差 9 倍）。
//
// 每条规则都钉 `rule` 而不只是 `kind`：分类碰巧对了但走错规则，
// 下一个相似输入就会翻车。

import { describe, test, expect } from "bun:test";
import {
  classifyPath, summarize, irreplaceableStatement,
  PENDING_SIZE_LIMIT, type AuditItem,
} from "../diagnostics/backup-classify";

const MB = 1024 * 1024;
const c = (rel: string, size = 1024) => classifyPath({ rel, size });

describe("备份残留 — 必须排在扩展名规则前面", () => {
  test("**正确输入**：`.bak` 系列一律是备份残留", () => {
    expect(c("世界模型\\v18.json.bak").kind).toBe("备份残留");
    expect(c("世界模型\\v18.bak3").kind).toBe("备份残留");
    expect(c("世界模型\\v18.bak5_design").kind).toBe("备份残留");
    expect(c("scripts\\x_bak.mjs").kind).toBe("备份残留");
    expect(c("docs\\design_before_rewrite.md").kind).toBe("备份残留");
  });

  test("**错误输入（上一版会漏）**：备份标记在**中间**时，`.ts/.md/.pdf` 不得因扩展名绕过", () => {
    // 这才是上一版真正的漏法：`.bak` 在**末尾**时 `extname()` 取到的就是 `.bak`，
    // 反正撞不上扩展名规则；真正会绕过去的是标记在中间、扩展名还是原样的那些 ——
    // 「备份残留」排在扩展名规则后面时，它们分别被算成脚本 / 手写设计 / 源材料，
    // 于是那一档看着永远很干净。
    expect(c("src\\engine_before_refactor.ts").rule).toBe("backup-residue");
    expect(c("docs\\design_bak.md").rule).toBe("backup-residue");
    expect(c("来源\\手册_before_v2.pdf").rule).toBe("backup-residue");
    expect(c("src\\engine.bak.ts").rule).toBe("backup-residue");
  });

  test("**干扰输入**：名字里有 `backup` 的正经文件不得误判", () => {
    expect(c("scripts\\backup-critical.ts").kind).toBe("脚本");
    expect(c("tools\\audit-backup.md").kind).toBe("手写设计");
    expect(c("docs\\backup-plan.md").kind).toBe("手写设计");
    expect(c("src\\db_backup.ts").kind).toBe("脚本");   // `_bak` 后面不是 `.` 或结尾
    expect(c("docs\\before_and_after.md").kind).toBe("手写设计"); // 不是 `_before_`
  });
});

describe("生成目录 — 必须排在「手写设计」前面", () => {
  test("**错误输入（上一版会漏）**：生成目录里的 .md/.yaml 不是手写", () => {
    expect(c("世界模型\\v18_output\\report.md").rule).toBe("generated-dir");
    expect(c("世界模型\\v18_output\\report.md").kind).toBe("抽取产物");
    expect(c("世界模型\\extracted_output\\schema.yaml").kind).toBe("抽取产物");
    expect(c("世界模型\\chapters_全职法师\\c001.txt").kind).toBe("抽取产物");
  });

  test("**正确输入**：生成目录之外的 .md/.yaml 才算手写", () => {
    expect(c("世界模型\\races_design_spec.md").rule).toBe("handwritten-ext");
    expect(c("dnd_rules.yaml").kind).toBe("手写设计");
  });

  test("**干扰输入**：生成目录里的脚本仍是脚本、PDF 仍是源材料", () => {
    // 一个 PDF 放进 output/ 也还是那个 PDF，删了不会自己长回来。
    expect(c("世界模型\\v18_output\\rerun.py").kind).toBe("脚本");
    expect(c("世界模型\\output\\手册.pdf").kind).toBe("源材料");
    expect(c("世界模型\\output\\封面.png").kind).toBe("源材料");
  });
});

describe("上一版的漏项", () => {
  test("根目录的 .txt（4.5MB 小说全文）—— 就是「53MB vs 489MB」那个洞", () => {
    // 上一版判据是 `depth === 2 && rel.startsWith("世界模型\\")`，
    // 根目录那份一分钱都没算进去。
    const r = c("克苏鲁的呼唤-.txt", 4.5 * MB);
    expect(r.kind).toBe("源材料");
    expect(r.rule).toBe("large-txt");
  });

  test("深层目录里的大 txt 同样算（不限深度）", () => {
    expect(c("a\\b\\c\\d\\e\\f\\g\\长篇.txt", 3 * MB).kind).toBe("源材料");
  });

  test("图片 / 音频 / ZIP", () => {
    expect(c("世界模型\\relics\\封面.png").kind).toBe("源材料");
    expect(c("素材\\旁白.wav").kind).toBe("源材料");
    const zip = c("archive\\原始扫描.zip");
    expect(zip.kind).toBe("源材料");
    expect(zip.manualReview).toBe(true); // 里面是什么不知道，得人看
  });

  test("Python 脚本（4109 个，上一版全落进「其它」）", () => {
    expect(c("世界模型\\scripts\\extract.py").kind).toBe("脚本");
    expect(c("世界模型\\fix_config.py").rule).toBe("script-ext");
    expect(c("世界模型\\merge_v11.ps1").kind).toBe("脚本");
    expect(c("deploy\\run.sh").kind).toBe("脚本");
  });

  test("没有 raw/source 路径特征的手写 JSON/TXT → 待确认，不是「其它·看情况」", () => {
    const j = c("世界模型\\_summary.json", 20 * 1024);
    expect(j.kind).toBe("待确认");
    expect(j.manualReview).toBe(true);
    const t = c("猫子加食谱一份.txt", 5 * 1024);
    expect(t.kind).toBe("待确认");
    expect(t.manualReview).toBe(true);
  });

  test("有 raw/source 路径特征的文本仍是源材料", () => {
    expect(c("cthulhu_raw\\原文.txt", 1024).rule).toBe("raw-path");
    expect(c("来源\\访谈.json", 1024).kind).toBe("源材料");
  });
});

describe("可重建产物不算不可再生", () => {
  test("`.jsonl` / `.pyc` / `__pycache__`", () => {
    expect(c("世界模型\\v18.jsonl", 200 * MB).kind).toBe("抽取产物");
    expect(c("世界模型\\__pycache__\\x.pyc").kind).toBe("抽取产物");
  });

  test("PDF 抽出来的 txt（源 PDF 还在就能重跑）", () => {
    expect(c("天鹅.pdf.txt", 13 * 1024).rule).toBe("derived-from-doc");
  });

  test("仓库里由脚本重建的 bgm/voice", () => {
    expect(c("poc\\frontend\\public\\bgm\\rain.wav", 3 * MB).rule).toBe("rebuildable-media");
    expect(c("poc\\frontend\\public\\voice\\line-01.wav", 500 * 1024).kind).toBe("抽取产物");
  });

  test("干扰输入：不在 bgm/voice 下的 wav 仍是源材料", () => {
    expect(c("素材\\环境音\\rain.wav", 3 * MB).kind).toBe("源材料");
  });
});

describe("审计完成度 — 待确认太多就不许发布精确总量", () => {
  const item = (rel: string, size: number): AuditItem => {
    const r = classifyPath({ rel, size });
    return { rel, size, kind: r.kind, rule: r.rule, manualReview: r.manualReview };
  };

  test("**正确输入**：待确认很少 → 审计完成，给精确数", () => {
    const items = [
      item("来源\\手册.pdf", 100 * MB),
      item("dnd_rules.yaml", 1024),
      item("世界模型\\notes.json", 1024), // 待确认，但只有 1KB
    ];
    const s = summarize(items);
    expect(s.complete).toBe(true);
    expect(irreplaceableStatement(s)).toContain("不可再生合计");
    expect(irreplaceableStatement(s)).not.toContain("未完成");
  });

  test("**错误输入**：待确认还有一大堆 → 审计未完成，只给下界", () => {
    // 上一版「其它」里躺着一堆没分类的东西，照样发布「不可再生 500MB」。
    const items = [
      item("来源\\手册.pdf", 100 * MB),
      item("世界模型\\一堆.json", PENDING_SIZE_LIMIT + MB),
    ];
    const s = summarize(items);
    expect(s.complete).toBe(false);
    const text = irreplaceableStatement(s);
    expect(text).toContain("未完成");
    expect(text).toContain("至少");
    expect(text).toContain("上界");
  });

  test("**干扰输入**：待确认体量小但占比高（总量本身就小）→ 按占比也判未完成", () => {
    const items = [item("dnd_rules.yaml", 1000), item("x.json", 1000)];
    const s = summarize(items);
    expect(s.complete).toBe(false);
  });

  test("分类汇总不重不漏", () => {
    const items = [
      item("来源\\手册.pdf", 10),
      item("dnd_rules.yaml", 20),
      item("scripts\\a.py", 30),
      item("世界模型\\v18.jsonl", 40),
      item("x.ts.bak", 50),
      item("y.json", 60),
    ];
    const s = summarize(items);
    const sum = [...s.byKind.values()].reduce((a, b) => a + b.size, 0);
    expect(sum).toBe(210);
    expect(s.byKind.get("源材料")?.count).toBe(1);
    expect(s.byKind.get("备份残留")?.count).toBe(1);
    expect(s.byKind.get("待确认")?.count).toBe(1);
    expect(s.irreplaceableSize).toBe(60); // pdf 10 + yaml 20 + py 30
  });
});

describe("变异检验", () => {
  test("变异：把大 txt 规则改回「只认 世界模型\\ 深度 2」→ 根目录那份漏掉", () => {
    // 判据现状：不限目录不限深度。
    expect(c("克苏鲁的呼唤-.txt", 4.5 * MB).kind).toBe("源材料");
    // 而「小 txt」仍旧进待确认，说明大小阈值真的在起作用（不是无脑全算源材料）。
    expect(c("克苏鲁的呼唤-.txt", 4 * 1024).kind).toBe("待确认");
  });

  test("变异：备份规则挪到扩展名之后 → `engine.ts.bak` 会变成「脚本」", () => {
    // 现状必须是「备份残留」；如果哪天有人调换顺序，这条立刻红。
    expect(c("src\\engine.ts.bak").kind).toBe("备份残留");
    expect(c("src\\engine.ts").kind).toBe("脚本");
  });
});
