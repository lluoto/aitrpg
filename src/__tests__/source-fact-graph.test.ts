import { describe, expect, it } from "bun:test";
import {
  applyFactInterpretationReviews,
  buildSourceFactGraph,
  sourceStatementEvidenceRefId,
  validateSourceFactGraph,
  type FactInterpretationCandidate,
} from "../compiler/source-fact-graph";
import { cleanPageWithTrace, joinPagesWithTrace } from "../ingest/clean-text";
import { buildDocumentBlocks } from "../ingest/document-blocks";
import { createSyntheticDocumentIR } from "../ingest/document-ir";

function graphFor(pages: string[]) {
  const document = createSyntheticDocumentIR(pages, "source-fact-graph-test");
  const blocks = buildDocumentBlocks(document, joinPagesWithTrace(document.pages.map(cleanPageWithTrace)));
  return { document, blocks, graph: buildSourceFactGraph(document, blocks) };
}

function interpretation(statementId: string, evidenceRefs = [sourceStatementEvidenceRefId(statementId)]): FactInterpretationCandidate<number> {
  return {
    id: "candidate:fixture",
    sourceStatementIds: [statementId],
    claim: {
      path: "npcs.example.hp",
      value: 12,
      domain: "rule_numeric",
      authority: "module_explicit",
      derivation: "explicit",
      status: "candidate",
      evidenceRefs,
      sourceRef: null,
      confidence: null,
      reason: "test interpretation",
      rightsStatus: "unknown",
      scope: {},
    },
    interpretationStatus: "candidate",
  };
}

describe("SourceFactGraph", () => {
  it("creates a source_exact statement for every DocumentBlock and no accepted interpretation", () => {
    const { blocks, graph } = graphFor(["前置散文。\n场景：\n普通正文。\n▶钥匙：打开门。"]);
    for (const block of blocks) expect(graph.statements.some((statement) => statement.id === `${block.id}:statement:whole`)).toBe(true);
    expect(graph.statements.every((statement) => statement.sourceStatus === "source_exact" && statement.semanticStatus === "uninterpreted")).toBe(true);
    expect(graph.interpretations).toEqual([]);
    validateSourceFactGraph(graph);
  });

  it("preserves heading scope plus marked-item whole, name, and body evidence", () => {
    const { graph } = graphFor(["场景：\n普通正文。\n▶钥匙：打开门。"]);
    const heading = graph.statements.find((statement) => statement.kind === "heading")!;
    const paragraph = graph.statements.find((statement) => statement.kind === "paragraph")!;
    const item = graph.statements.find((statement) => statement.kind === "marked_item")!;
    const name = graph.statements.find((statement) => statement.kind === "marked_item_name")!;
    const body = graph.statements.find((statement) => statement.kind === "marked_item_body")!;
    expect(graph.relations.some((relation) => relation.kind === "heading_scopes" && relation.from === heading.id && relation.to === paragraph.id)).toBe(true);
    expect(graph.relations.some((relation) => relation.kind === "marked_item_name" && relation.from === item.id && relation.to === name.id)).toBe(true);
    expect(graph.relations.some((relation) => relation.kind === "marked_item_body" && relation.from === item.id && relation.to === body.id)).toBe(true);
    expect(name.evidence.spans.map((span) => span.exactText).join("")).toBe("钥匙");
    expect(body.evidence.spans.map((span) => span.exactText).join("")).toBe("打开门。");
  });

  it("keeps same text at different evidence locations as different statements", () => {
    const { graph } = graphFor(["同一句。\n\n同一句。"]);
    const statements = graph.statements.filter((statement) => statement.kind === "paragraph");
    expect(statements).toHaveLength(2);
    expect(statements[0]?.id).not.toBe(statements[1]?.id);
    expect(statements[0]?.evidence.spans[0]?.rawStart).not.toBe(statements[1]?.evidence.spans[0]?.rawStart);
  });

  it("does not change an existing statement id when an unrelated block is included", () => {
    const { document, blocks } = graphFor(["前置内容。\n场景：\n正文。"]);
    const front = blocks.find((block) => block.kind === "paragraph" && !block.parentSectionId)!;
    const heading = blocks.find((block) => block.kind === "heading")!;
    const alone = buildSourceFactGraph(document, [front]);
    const withUnrelated = buildSourceFactGraph(document, [heading, front]);
    const retained = withUnrelated.statements.find((statement) => statement.text === front.text);
    if (!retained) throw new Error("front statement missing after unrelated insertion");
    expect(alone.statements[0]?.id).toBe(retained.id);
  });

  it("keeps both page spans on a cross-page source statement", () => {
    const { graph } = graphFor(["场景：\n跨页没有收尾", "补上。\n▶物：正文"]);
    const paragraph = graph.statements.find((statement) => statement.kind === "paragraph")!;
    expect(paragraph.text).toBe("跨页没有收尾补上。");
    expect(new Set(paragraph.evidence.spans.map((span) => span.pageNumber))).toEqual(new Set([1, 2]));
  });

  it("rejects interpretations with missing statements or mismatched evidence", () => {
    const { graph } = graphFor(["正文。"]);
    const statement = graph.statements[0]!;
    expect(() => validateSourceFactGraph({ ...graph, interpretations: [interpretation("missing-statement")] })).toThrow("source statement missing");
    expect(() => validateSourceFactGraph({
      ...graph,
      interpretations: [{ ...interpretation(statement.id, []), interpretationStatus: "accepted", claim: { ...interpretation(statement.id, []).claim, status: "accepted" } }],
    })).toThrow("evidence does not reference");
  });

  it("applies one deterministic review and rejects conflicting reviews", () => {
    const { graph } = graphFor(["正文。"]);
    const statement = graph.statements[0]!;
    const candidateGraph = { ...graph, interpretations: [interpretation(statement.id)] };
    const accepted = applyFactInterpretationReviews(candidateGraph, [{
      interpretationId: "candidate:fixture",
      decision: "accept",
      reason: "reviewed",
      reviewerKind: "deterministic_rule",
      policyId: "fixture-policy",
      reviewEvidenceStatementIds: [statement.id],
    }]);
    expect(accepted.interpretations[0]?.interpretationStatus).toBe("accepted");
    expect(accepted.interpretations[0]?.claim.status).toBe("accepted");
    expect(accepted.interpretations[0]?.review?.policyId).toBe("fixture-policy");
    expect(() => applyFactInterpretationReviews(candidateGraph, [
      { interpretationId: "candidate:fixture", decision: "accept", reason: "a", reviewerKind: "deterministic_rule", policyId: "fixture-policy", reviewEvidenceStatementIds: [statement.id] },
      { interpretationId: "candidate:fixture", decision: "reject", reason: "b", reviewEvidenceStatementIds: [statement.id] },
    ])).toThrow("conflicting interpretation reviews");
  });

  it("fails closed when an accept review lacks audit policy or source evidence", () => {
    const { graph } = graphFor(["正文。"]);
    const statement = graph.statements[0]!;
    const candidateGraph = { ...graph, interpretations: [interpretation(statement.id)] };
    expect(() => applyFactInterpretationReviews(candidateGraph, [{
      interpretationId: "candidate:fixture",
      decision: "accept",
      reason: "reviewed",
      reviewerKind: "deterministic_rule",
      reviewEvidenceStatementIds: [statement.id],
    }])).toThrow("policyId");
    expect(() => applyFactInterpretationReviews(candidateGraph, [{
      interpretationId: "candidate:fixture",
      decision: "accept",
      reason: "reviewed",
      reviewerKind: "approved_policy",
      policyId: "fixture-policy",
      reviewEvidenceStatementIds: [],
    }])).toThrow("review evidence");
  });
});
