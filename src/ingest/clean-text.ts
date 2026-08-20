// 摄取管线 · 第二段：PDF 文本清洗
//
// 上游是 pdf-parse 抽出的逐页文本（见 pdf-source.ts）。原文是分栏排版，
// 抽出来有两个固定毛病，不处理就没法交给下游：
//
//   1. 行内的数字与拉丁词被制表符包住 —— "灵感有来自 \t2077 \t瑞弗警官"
//   2. 长句在栏宽处被硬换行切断 —— "很简单的木质栅栏，\n上面的油漆都已经"
//
// 第 2 条尤其要紧：断在半句上的文本喂给 LLM，它会把两个半句当成两件事。
//
// 第 2 条有两个作用域：页内由 cleanPageText 处理，**跨页由 joinPages 处理**。
// 分开是因为上游给的就是逐页文本，而句子不认页边界 —— 只做页内的话，
// 正好断在页末的那些句子永远接不回来（实测全书 4 处）。

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

/**
 * 跨页续行：把上一页末行没说完的话与下一页首行接起来。
 *
 * cleanPageText 的作用域是**单页**，而句子会跨页。实测第 6 页的最后一行就是
 * `▶防盗门的钥匙：…这种先进防盗门可`，「不多见。」在第 7 页开头 ——
 * 页内的行连接永远接不到它。下游 sectionize 于是把那一行当成场景正文，
 * 条目正文就缺了后半截，抽取器再从缺半截的正文里抽机制。
 * 全书这样的地方 4 处（实测见 tools/_diag-absorb.ts）。
 *
 * 判据直接用页内那一套 shouldJoin，不重写：同样的两行，
 * 落在页中间还是正好跨页纯属排版偶然，两种情况必须得到同一个结果。
 *
 * **副作用要知道**：被接走的那一行从下一页消失，该页后续行的行号往上挪一格。
 * SourceRef.line 是清洗后的行号，所以它会变 —— 那是内部句柄，代码改动本就允许它变。
 * 而条目自身的位置不变（它在上一页），所以条目的键不受影响。
 *
 * 幂等：接完之后上一页末行以终止标点收尾，再跑一次不会再动。
 */
export function joinPages(pages: string[]): string[] {
  const out = [...pages];
  // 目前持有「末行」的那一页。不能直接看 i-1：连着两页都要接的时候，
  // 中间那页会被掏空，末行仍留在更前面那一页上。
  let tail = -1;

  for (let i = 0; i < out.length; i++) {
    if ((out[i] as string).trim() === "") continue;

    if (tail >= 0) {
      const prevLines = (out[tail] as string).split("\n");
      const curLines = (out[i] as string).split("\n");
      const prevLast = (prevLines[prevLines.length - 1] ?? "").trim();
      const curFirst = (curLines[0] ?? "").trim();

      if (prevLast !== "" && curFirst !== "" && shouldJoin(prevLast, curFirst)) {
        prevLines[prevLines.length - 1] = prevLast + curFirst;
        out[tail] = prevLines.join("\n");
        out[i] = curLines.slice(1).join("\n");
      }
    }

    if ((out[i] as string).trim() !== "") tail = i;
  }

  return out;
}
