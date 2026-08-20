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
// 正好断在页末的那些句子永远接不回来：实测全书 **5 处**页边界要接，
// 其中 4 处的上一行是 `▶` 条目（tools/_diag-absorb.ts 数的是这 4 处），
// 第 5 处是附录里的普通正文。两个分母都记在这里，免得照小的那个去审就漏了。

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
 * ASCII 连续句点收尾 —— 也是一种「话说完了」。
 *
 * 单独一条而不是并进 SENTENCE_END，是量出来的，不是风格选择。
 * 把 `\.{2,}` 并进 SENTENCE_END 之后逐字节比过全书的 cleanPageText 输出，
 * 变了 2 页 5 处：p15 的四个结局标签（`…“伎俩”呢...` + `Good End`）不再被粘成一行
 * ——那是改好了；但 p12 那段法语疯话（`…宇 ■ 之 中 ...` + `啊...美丽的…`）
 * 被从句子中间劈开——那是改坏了，`...` 在那里是句内停顿而非句末。
 * 页内的 `...` 两种含义都有，页边界上（实测全书仅 p1 末行一处）只有句末那种。
 * 所以这条判据只在页边界用；页内那 5 处要不要动，是另一轮、要另一份审计的事。
 */
const ASCII_ELLIPSIS_END = /\.{2,}[」』"'”’）)】]*$/;

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
 * 页边界上的续接判据 = shouldJoin 再加两条只在页边界成立的否决。
 *
 * shouldJoin 是对的基础判据，但在页边界上**不够**：cleanPageText 是逐页调用的，
 * 它把每页的空行吃掉了（开头的空行跳过、结尾 trim 掉），而空行是它自己眼里
 * **绝对不接**的段落分隔。于是「上一页末行与下一页首行之间原本隔着一个空行」
 * 这件事，到 joinPages 手上已经看不见了 —— 两者掌握的信息并不等价，
 * 页内够用的判据搬到页边界就会漏。下面两条补的就是这个信息差。
 *
 * 1. **首行以冒号收尾 → 一律不接，不看长度。**
 *    页内那条 `next.length <= LABEL_MAX_LEN` 的长度闸门是必要的：页内一个长的
 *    冒号结尾行通常是正文的一句话（`艾德里安会在外围布置 3 种陷阱：`），
 *    误判成标题会把正文劈开。但**页顶**的冒号结尾行不一样 —— 它多了一条页内
 *    没有的先验：一页的第一行几乎总是承接标题层级的结构，实测就是
 *    `事件真相（想跑的人请不要继续往下看了。）：`（21 字，长度闸门放它过去了），
 *    它被焊到了 p1 末尾。所以页边界上放弃长度信号，宁可少接一处。
 *    改在这里而不是改 shouldJoin：页内语义必须一个字不动。
 *
 * 2. **上一页末行以 ASCII 连续句点收尾 → 不接**（见 ASCII_ELLIPSIS_END 的说明）。
 *
 * 反过来「页内接、页边界不接」的不对称是有意的：接错了是把两段无关文本焊成一句，
 * 下游会当成一件事；漏接了只是少还原一处排版换行。两种错的代价不对等。
 */
function shouldJoinAcrossPages(prevLast: string, curFirst: string): boolean {
  if (!shouldJoin(prevLast, curFirst)) return false;
  if (LABEL_END.test(curFirst)) return false;
  if (ASCII_ELLIPSIS_END.test(prevLast)) return false;
  return true;
}

/**
 * 跨页续行：把上一页末行没说完的话与下一页首行接起来。
 *
 * cleanPageText 的作用域是**单页**，而句子会跨页。实测第 6 页的最后一行就是
 * `▶防盗门的钥匙：…这种先进防盗门可`，「不多见。」在第 7 页开头 ——
 * 页内的行连接永远接不到它。下游 sectionize 于是把那一行当成场景正文，
 * 条目正文就缺了后半截，抽取器再从缺半截的正文里抽机制。
 *
 * **两个分母，别搞混**：实测全书接 **5 处**页边界（p4→p5、p5→p6、p6→p7、
 * p10→p11、p17→p18）。其中 **4 处**的上一行是 `▶` 条目 —— `tools/_diag-absorb.ts`
 * 报的「跨页 4 行」数的是这 4 处，因为它只管跟在 `▶` 后面的续行；
 * joinPages 连普通正文的跨页也接，第 5 处（p17→p18）就是附录里的普通正文。
 * 先前注释里那个孤零零的「4 处」是后一个分母的数，照它去审 joinPages
 * 会正好在第 5 处上停下 —— p1→p2 那个把章节标签焊到上一页的缺陷就藏在那里。
 *
 * 判据用 shouldJoinAcrossPages：内核是页内那套 shouldJoin（同样的两行，落在页中间
 * 还是正好跨页纯属排版偶然），外面套两条页边界特有的否决，理由见那个函数。
 *
 * **副作用要知道**：被接走的那一行从下一页消失，该页后续行的行号往上挪一格。
 * SourceRef.line 是清洗后的行号，所以它会变 —— 那是内部句柄，代码改动本就允许它变。
 * 注意**上一页的行号也会变**：连着两页都要接的时候，中间那页既往前捐出首行、
 * 又从后一页收进首行，它自己的行号跟着挪。实测 p5→p6 与 p6→p7 就是连着的，
 * `▶防盗门的钥匙` 从 p6:L17 挪到了 p6:L16，`▶中控台的开关` 从 p11:L10 挪到 p11:L9。
 * 所以「条目在上一页所以位置不变」是错的 —— 恰恰是 tail 指针要处理的那种情形下最错。
 * 条目的键不受影响另有原因：line 每次跑都重新生成，而 item_NN 是按条目顺序编号的，
 * 接续不改变条目之间的先后，编号就不变。
 *
 * 幂等：接完之后上一页末行以终止标点收尾，再跑一次不会再动。
 * 但这只对「接上之后确实以终止标点收尾」的输入成立 —— 见测试里那条非幂等用例。
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

      if (prevLast !== "" && curFirst !== "" && shouldJoinAcrossPages(prevLast, curFirst)) {
        prevLines[prevLines.length - 1] = prevLast + curFirst;
        out[tail] = prevLines.join("\n");
        // slice(1) 会在「被接走的那行后面原本跟着空行」时留下一个开头的换行。
        // **别清掉它**：这个残留是有用的 —— 再跑一次时它让 curFirst 成为空串，
        // 于是 joinPages 不会跨过那个段落分隔继续接。段落分隔是 cleanPageText
        // 眼里绝对不接的东西，而这个换行是它在页边界上唯一还留得下来的痕迹。
        out[i] = curLines.slice(1).join("\n");
      }
    }

    if ((out[i] as string).trim() !== "") tail = i;
  }

  return out;
}
