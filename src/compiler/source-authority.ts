/** Why a proposed field value may be considered during compilation. */
export type Authority =
  | "module_errata"
  | "module_explicit"
  | "user_document"
  | "open_licensed"
  | "project_original"
  | "declared_canon_corpus"
  | "latent_model"
  | "worldview_pattern"
  | "engine_policy";

/** How a value was obtained is independent from why it has authority. */
export type Derivation = "explicit" | "inferred" | "default" | "unknown";

export type CandidateStatus = "candidate" | "accepted" | "rejected" | "conflicted" | "unresolved";
export type RightsStatus = "unknown" | "open_licensed" | "project_owned" | "user_provided";
export type ClaimDomain = "plot_fact" | "rule_numeric" | "behavior_prior" | "gameplay_mechanic";
export type TransferUse = "plot_fact" | "entity_general" | "world_law" | "mechanic";

export interface ClaimScope {
  moduleId?: string;
  ruleset?: string;
  era?: string;
  workId?: string;
  corpusScopeId?: string;
  transferUse?: TransferUse;
}

/** FieldEvidence explains entitlement; it does not describe ingest rewrites. */
export interface FieldEvidence {
  authority: Authority;
  derivation: Derivation;
  status: CandidateStatus;
  evidenceRefs: string[];
  sourceRef: string | null;
  confidence?: number | null;
  reason: string;
  modelFingerprint?: string;
  rightsStatus: RightsStatus;
}

/** A ClaimCandidate proposes a concrete value under FieldEvidence and scope. */
export interface ClaimCandidate<T = unknown> extends FieldEvidence {
  path: string;
  value: T | undefined;
  domain: ClaimDomain;
  scope: ClaimScope;
}

export function latentEvidenceIssue(evidence: Pick<FieldEvidence, "authority" | "sourceRef" | "rightsStatus">): string | undefined {
  if (evidence.authority !== "latent_model") return undefined;
  if (evidence.sourceRef !== null) return "latent_model sourceRef must be null";
  if (evidence.rightsStatus !== "unknown") return "latent_model rightsStatus must be unknown";
  return undefined;
}
