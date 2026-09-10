import { type CompilationManifest, type TransferPolicy } from "./compilation-manifest";
import { latentEvidenceIssue, type Authority, type CandidateStatus, type ClaimCandidate, type ClaimDomain } from "./source-authority";

export interface CandidateResolution<T> {
  path: string;
  domain: ClaimDomain;
  status: Extract<CandidateStatus, "accepted" | "conflicted" | "unresolved">;
  value?: T;
  reason: string;
  candidates: ClaimCandidate<T>[];
  accepted: ClaimCandidate<T>[];
  rejected: ClaimCandidate<T>[];
  conflicted: ClaimCandidate<T>[];
}

const PRIORITY: Record<ClaimDomain, Authority[][]> = {
  plot_fact: [["module_errata"], ["module_explicit"], ["user_document"], ["declared_canon_corpus"]],
  rule_numeric: [["module_errata", "module_explicit"], ["user_document", "open_licensed"], ["project_original"], ["engine_policy"], ["latent_model"]],
  behavior_prior: [["module_errata", "module_explicit"], ["declared_canon_corpus"], ["worldview_pattern"], ["engine_policy"]],
  gameplay_mechanic: [["module_errata", "module_explicit"], ["user_document", "open_licensed"], ["project_original"]],
};

function isWorldCandidate(candidate: ClaimCandidate<unknown>): boolean {
  return candidate.authority === "declared_canon_corpus" || candidate.authority === "worldview_pattern" || candidate.authority === "latent_model";
}

function policyIssue(candidate: ClaimCandidate<unknown>, domain: ClaimDomain, policy: TransferPolicy): string | undefined {
  if (!isWorldCandidate(candidate)) return undefined;
  if (policy === "no_transfer") return "transferPolicy=no_transfer rejects world candidate";
  if (policy === "analogy_only") return "analogy_only candidates cannot be auto accepted";
  if (policy === "mechanic_only" && domain === "plot_fact") return "mechanic_only cannot fill plot_fact";
  if (policy === "canon_fill" && candidate.authority === "declared_canon_corpus") {
    if (candidate.scope.transferUse !== "entity_general" && candidate.scope.transferUse !== "world_law") {
      return "canon_fill only accepts entity_general or world_law candidates";
    }
  }
  return undefined;
}

function scopeIssue(candidate: ClaimCandidate<unknown>, manifest: CompilationManifest): string | undefined {
  if (candidate.scope.moduleId && candidate.scope.moduleId !== manifest.moduleId) return "candidate moduleId is outside manifest";
  if (candidate.scope.ruleset && candidate.scope.ruleset !== manifest.ruleset) return "candidate ruleset is outside manifest";
  if (candidate.scope.era && candidate.scope.era !== manifest.era) return "candidate era is outside manifest";

  const needsWorkScope = isWorldCandidate(candidate) || candidate.scope.workId !== undefined;
  if (needsWorkScope && manifest.allowedWorkIds.length === 0) return "manifest allowedWorkIds is empty";
  if (candidate.authority === "declared_canon_corpus" && !candidate.scope.workId) return "declared_canon_corpus candidate lacks workId";
  if (candidate.scope.workId && !manifest.allowedWorkIds.includes(candidate.scope.workId)) return "candidate workId is outside manifest";
  if (candidate.scope.corpusScopeId && candidate.scope.corpusScopeId !== manifest.corpusScopeId) return "candidate corpusScopeId is outside manifest";
  if (manifest.allowedWorkIds.length > 1 && needsWorkScope) {
    if (!manifest.corpusScopeId) return "cross-work candidate requires corpusScopeId";
    if (manifest.transferPolicy !== "analogy_only") return "cross-work candidate requires analogy_only";
  }
  if (candidate.authority === "latent_model") {
    const issue = latentEvidenceIssue(candidate);
    if (issue) return issue;
    if (manifest.mode !== "latent") return "latent_model candidate requires latent mode";
  }
  return policyIssue(candidate, candidate.domain, manifest.transferPolicy);
}

function priorityFor(candidate: ClaimCandidate<unknown>, domain: ClaimDomain): number | undefined {
  const direct = PRIORITY[domain].findIndex((authorities) => authorities.includes(candidate.authority));
  if (direct >= 0) return direct;
  if (domain === "gameplay_mechanic") {
    if (candidate.derivation === "inferred") return 3;
    if (candidate.authority === "engine_policy") return 4;
    if (candidate.authority === "latent_model") return 5;
  }
  return undefined;
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function resolved<T>(candidate: ClaimCandidate<T>, status: CandidateStatus, resolutionReason: string): ClaimCandidate<T> {
  return { ...candidate, evidenceRefs: [...candidate.evidenceRefs], scope: { ...candidate.scope }, status, reason: `${candidate.reason}; resolution: ${resolutionReason}` };
}

/**
 * Resolve one field without using candidate order as a tie breaker. The output
 * is the only object that may carry an accepted runtime value.
 */
export function resolveCandidates<T>(
  path: string,
  domain: ClaimDomain,
  candidates: readonly ClaimCandidate<T>[],
  manifest: CompilationManifest,
): CandidateResolution<T> {
  const output = candidates.map((candidate) => ({ ...candidate, evidenceRefs: [...candidate.evidenceRefs], scope: { ...candidate.scope } }));
  const eligible: Array<{ index: number; tier: number }> = [];

  output.forEach((candidate, index) => {
    if (candidate.path !== path || candidate.domain !== domain) {
      output[index] = resolved(candidate, "rejected", "candidate path or domain does not match resolution request");
      return;
    }
    if (candidate.status !== "candidate" && candidate.status !== "accepted") {
      output[index] = resolved(candidate, "rejected", "source status is not eligible for resolution");
      return;
    }
    const issue = scopeIssue(candidate, manifest);
    if (issue) {
      output[index] = resolved(candidate, "rejected", issue);
      return;
    }
    const tier = priorityFor(candidate, domain);
    if (tier === undefined) {
      output[index] = resolved(candidate, "rejected", "authority has no priority in this domain");
      return;
    }
    eligible.push({ index, tier });
  });

  for (const tier of [...new Set(eligible.map((entry) => entry.tier))].sort((left, right) => left - right)) {
    const entries = eligible.filter((entry) => entry.tier === tier);
    const defined = entries.filter((entry) => output[entry.index]!.value !== undefined);
    for (const entry of entries.filter((entry) => output[entry.index]!.value === undefined)) {
      output[entry.index] = resolved(output[entry.index]!, "unresolved", "candidate has no value for this field");
    }
    if (defined.length === 0) continue;

    const first = output[defined[0]!.index]!;
    const conflicts = defined.filter((entry) => !sameValue(first.value, output[entry.index]!.value));
    if (conflicts.length > 0) {
      for (const entry of defined) output[entry.index] = resolved(output[entry.index]!, "conflicted", "same precedence candidates disagree");
      for (const lower of eligible.filter((entry) => entry.tier > tier)) {
        output[lower.index] = resolved(output[lower.index]!, "rejected", "higher precedence conflict must be resolved first");
      }
      return result(path, domain, "conflicted", undefined, "same precedence candidates disagree", output);
    }

    for (const entry of defined) output[entry.index] = resolved(output[entry.index]!, "accepted", "selected by scoped authority priority");
    for (const lower of eligible.filter((entry) => entry.tier > tier)) {
      output[lower.index] = resolved(output[lower.index]!, "rejected", "lower precedence value was not needed");
    }
    return result(path, domain, "accepted", first.value, "selected by scoped authority priority", output);
  }

  return result(path, domain, "unresolved", undefined, "no scoped candidate supplied a value", output);
}

function result<T>(
  path: string,
  domain: ClaimDomain,
  status: CandidateResolution<T>["status"],
  value: T | undefined,
  reason: string,
  candidates: ClaimCandidate<T>[],
): CandidateResolution<T> {
  return {
    path,
    domain,
    status,
    ...(value === undefined ? {} : { value }),
    reason,
    candidates,
    accepted: candidates.filter((candidate) => candidate.status === "accepted"),
    rejected: candidates.filter((candidate) => candidate.status === "rejected" || candidate.status === "unresolved"),
    conflicted: candidates.filter((candidate) => candidate.status === "conflicted"),
  };
}
