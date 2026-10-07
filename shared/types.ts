export type Source = 'synthetic' | 'live';
export type Mode = 'ASK' | 'INVESTIGATE' | 'ACT';
export type Intent =
  'revision' | 'structure' | 'compare' | 'qualification' | 'prepare' | 'search' | 'unknown';
export type ToolName =
  | 'get_current_user'
  | 'search_engineering_items'
  | 'get_engineering_item'
  | 'get_product_structure'
  | 'get_requirements'
  | 'search_knowledge';
export type TraceStep = {
  label: string;
  detail: string;
  kind: 'policy' | 'route' | 'tool' | 'evidence';
  durationMs: number;
};
export type Evidence = {
  id: string;
  title: string;
  source: Source;
  fields: Record<string, string | number | boolean | null>;
  retrievedAt: string;
};
export type Item = {
  id: string;
  identifier: string;
  title: string;
  revision: string;
  state?: string;
  superseded?: boolean;
  owner?: string;
  material?: string;
  connector?: string;
  pinCount?: number;
  voltage?: number;
};
export type Coverage = 'complete' | 'partial' | 'unknown';
export type ToolResult = { items: Item[]; evidence: Evidence[]; coverage: Coverage };
export type Mission = {
  id: string;
  prompt: string;
  source: Source;
  mode: Mode;
  intent: Intent;
  status: 'completed' | 'needs_input' | 'blocked' | 'insufficient_evidence' | 'prepared';
  title: string;
  answer: string;
  findings: string[];
  evidence: Evidence[];
  trace: TraceStep[];
  metrics: {
    elapsedMs: number;
    toolCalls: number;
    modelCalls: number;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    writes: 0;
  };
  createdAt: string;
  draft?: {
    id: string;
    object: string;
    summary: string;
    evidenceRefs: string[];
    status: 'DRAFT_ONLY';
    expiresAt: string;
    digest: string;
  };
};
export type RuntimeStatus = {
  version: string;
  liveReady: boolean;
  configured: boolean;
  credentialsPresent: boolean;
  contractValid: boolean;
  securityContextPresent: boolean;
  release: string | null;
  blockers: string[];
  allowedTools: ToolName[];
  provider: string;
  modelReady: boolean;
};
export type Benchmark = {
  id: string;
  title: string;
  prompt: string;
  mode: Mode;
  intent: Intent;
  description: string;
};
export type AuraObservation = {
  answer: string;
  citations: string[];
  elapsedSeconds: number | null;
  release: string;
  competency: string;
  sameContext: boolean;
  scores: { correctness: number | null; evidence: number | null; completeness: number | null };
};
export type Comparison = {
  id: string;
  createdAt: string;
  benchmarkId: string;
  nova: Mission;
  aura: AuraObservation;
  comparability: string;
  auraMetrics: { toolCalls: null; tokens: null; costUsd: null; visibility: 'NOT_OBSERVABLE' };
};
