import {
  evidenceRefFromTrace,
  sliceTracedText,
  splitTracedLines,
  trimTracedText,
  type TracedText,
} from "./clean-text";
import { sha256, type DocumentBlock, type DocumentBlockKind, type DocumentIR, type EvidenceRef } from "./document-ir";
import { parseSectionItemLine, parseSectionTitleLine } from "./sectionize";

const MARKED_ITEM = /^[▶►▷]\s*/;
const LIST_ITEM = /^(?:[-*•]|\d+[.)])\s+/;

function concatTraces(parts: TracedText[], separator = ""): TracedText {
  let text = "";
  const fragments = [] as TracedText["fragments"];
  for (const [index, part] of parts.entries()) {
    if (index > 0) text += separator;
    const offset = text.length;
    text += part.text;
    fragments.push(...part.fragments.map((fragment) => ({
      outputStart: offset + fragment.outputStart,
      outputEnd: offset + fragment.outputEnd,
      evidence: fragment.evidence,
    })));
  }
  return { text, fragments };
}

/** Stable across reclassification because it depends on document identity and evidence, never block order. */
function blockId(document: DocumentIR, kind: DocumentBlockKind, evidence: EvidenceRef): string {
  const documentIdentity = document.documentHash ?? `synthetic:${document.sourceDescriptor ?? "unspecified"}`;
  const locations = evidence.spans.map((span) => `${span.pageNumber}:${span.rawStart}:${span.rawEnd}`).join("|");
  return `block_${sha256(`${documentIdentity}|${kind}|${locations}`).slice(0, 24)}`;
}

function block(document: DocumentIR, kind: DocumentBlockKind, trace: TracedText, parentSectionId?: string, details: Partial<DocumentBlock> = {}): DocumentBlock {
  const evidence = evidenceRefFromTrace(trace);
  return {
    id: blockId(document, kind, evidence),
    kind,
    text: trace.text,
    evidence,
    ...(parentSectionId ? { parentSectionId } : {}),
    ...details,
  };
}

function markedItemTrace(line: TracedText): { text: TracedText; name?: TracedText; body: TracedText } {
  const marker = line.text.match(MARKED_ITEM)?.[0] ?? "";
  const rest = trimTracedText(sliceTracedText(line, marker.length, line.text.length));
  const parsed = parseSectionItemLine(line.text);
  if (!parsed) throw new Error("marked item parser disagrees with block parser");
  const colon = rest.text.search(/[：:]/);
  if (colon < 0) return { text: rest, body: rest };
  const name = trimTracedText(sliceTracedText(rest, 0, colon));
  const body = trimTracedText(sliceTracedText(rest, colon + 1, rest.text.length));
  return { text: rest, ...(name.text ? { name } : {}), body };
}

/**
 * Produce source-addressable prose, heading, and marked-item blocks before any
 * LLM classification. Existing Section/SourceRef output is deliberately left
 * unchanged for scoring-key compatibility.
 */
export function buildDocumentBlocks(document: DocumentIR, tracedPages: TracedText[]): DocumentBlock[] {
  if (tracedPages.length !== document.pages.length) {
    throw new Error(`document pages and traces length mismatch: ${document.pages.length} vs ${tracedPages.length}`);
  }

  const blocks: DocumentBlock[] = [];
  let parentSectionId: string | undefined;
  let paragraph: TracedText[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const trace = concatTraces(paragraph, "\n");
    blocks.push(block(document, "paragraph", trace, parentSectionId));
    paragraph = [];
  };

  for (const page of tracedPages) {
    for (const line of splitTracedLines(page)) {
      if (line.text === "") {
        flushParagraph();
        continue;
      }
      const heading = parseSectionTitleLine(line.text);
      if (heading !== undefined) {
        flushParagraph();
        const headingBlock = block(document, "heading", line);
        blocks.push(headingBlock);
        parentSectionId = headingBlock.id;
        continue;
      }
      if (parseSectionItemLine(line.text)) {
        flushParagraph();
        const item = markedItemTrace(line);
        blocks.push(block(document, "marked_item", item.text, parentSectionId, {
          ...(item.name ? { nameEvidence: evidenceRefFromTrace(item.name) } : {}),
          bodyEvidence: evidenceRefFromTrace(item.body),
        }));
        continue;
      }
      const list = line.text.match(LIST_ITEM);
      if (list) {
        flushParagraph();
        const item = trimTracedText(sliceTracedText(line, list[0].length, line.text.length));
        blocks.push(block(document, "list_item", item, parentSectionId));
        continue;
      }
      paragraph.push(line);
    }
  }
  flushParagraph();
  return blocks;
}
