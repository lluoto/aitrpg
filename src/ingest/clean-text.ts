// 摄取管线 · 第二段：PDF 文本清洗
//
// 上游是 pdf-parse 抽出的逐页文本（见 pdf-source.ts）。原文是分栏排版，
// 抽出来有两个固定毛病，不处理就没法交给下游：
//
//   1. 行内的数字与拉丁词被制表符包住 —— "灵感有来自 \t2077 \t瑞弗警官"
//   2. 长句在栏宽处被硬换行切断 —— "很简单的木质栅栏，\n上面的油漆都已经"
//
// 第 2 条尤其要紧：断在半句上的文本喂给 LLM，它会把两个半句当成两件事。

/**
 * 句子终止标记。
 *
 * 收尾的引号/括号要一并算进去：模组的场景描述整段都是引文，
 * 结尾长这样 —— `到哪里去了。”` 。只认 `。` 的话，右引号会被当成下一句的开头，
 * 于是整段描述和后面的 KP 说明被接成一句。
 */
const SENTENCE_END = /[。！？…；][」』"'”’）)】]*$/;

/** 条目标记：模组用 ▶ 起头列陷阱与规则，是下游切分的锚点，必须独占一行 */
const ITEM_MARK = /^[▶►▷]/;

/** 冒号收尾 —— 引出后面一整块内容的标签 */
const LABEL_END = /[：:]$/;

/**
 * 短到像标题的标签行长度上限。
 *
 * 用来分开这两种同样以冒号收尾的行：
 *   "维修间："                    —— 场景名，是标题
 *   "艾德里安会在外围布置 3 种陷阱："  —— 正文的一句话
 * 除了长度，没有别的信号可用：两者在文本层面完全同形。
 * 12 是照着模组里最长的场景名（"农场主别墅"一类）留出余量定的。
 */
const LABEL_MAX_LEN = 12;

/**
 * 判断后一行是否应该接到前一行末尾（分栏硬换行的还原）。
 *
 * 默认接上——中文正文里，一行结束而没有终止标点，几乎总是被栏宽切断的。
 * 例外都是"这一行本身有结构含义"的情况。
 */
function shouldJoin(prev: string, next: string): boolean {
  // 新条目另起
  if (ITEM_MARK.test(next)) return false;
  // 上一行话说完了
  if (SENTENCE_END.test(prev)) return false;
  // 上一行是标签，它引出的是下面整块内容，不能把内容拽上来
  if (LABEL_END.test(prev)) return false;
  // 下一行本身是个短标签（场景名之类），别被上一行吸走。
  // 场景名是下游切分的锚点，糊进正文就定位不到场景边界了。
  if (LABEL_END.test(next) && next.length <= LABEL_MAX_LEN) return false;
  return true;
}

/**
 * 清洗单页文本。
 *
 * 幂等：清洗过的文本再洗一次结果不变。这条是有意保证的——
 * 管线里同一段文本可能被重复处理，不幂等就会越洗越短。
 */
export function cleanPageText(raw: string): string {
  if (!raw) return "";

  // 制表符与连续空格一律收成单个空格。
  // 不是直接删掉：`模组采用\tCOC7th\t规则` 删成 `模组采用COC7th规则` 反而更难读，
  // 中西文之间留一格是排版惯例。而 `1D4+1` 内部本来就没有空白，不受影响。
  const spaced = raw.replace(/[ \t\u00a0\u3000]+/g, " ");

  const lines = spaced.split(/\r?\n/).map((l) => l.trim());

  const out: string[] = [];
  let prev: string | null = null;
  let sawBlank = false;

  for (const line of lines) {
    if (line === "") {
      // 空行是段落分隔。连着几个也只算一个，且开头的空行不算。
      if (out.length > 0) sawBlank = true;
      continue;
    }

    if (out.length === 0) {
      out.push(line);
    } else if (sawBlank) {
      out.push("\n\n" + line);
    } else if (shouldJoin(prev as string, line)) {
      out.push(line); // 直接续上，中文之间不加空格
    } else {
      out.push("\n" + line);
    }

    sawBlank = false;
    prev = line;
  }

  return out.join("").trim();
}
