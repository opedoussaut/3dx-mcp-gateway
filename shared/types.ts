export type Source = 'synthetic' | 'live';
/** Application domain chosen explicitly by the operator. Prompt text can never switch it. */
export type Domain = 'ENGINEERING' | 'ITEROP';
export type AppDomain = Exclude<Domain, 'ENGINEERING'>;
export type Mode = 'ASK' | 'INVESTIGATE' | 'ACT';
export type Intent =
  | 'revision'
  | 'structure'
  | 'compare'
  | 'qualification'
  | 'prepare'
  | 'search'
  | 'unknown'
  | AppIntent;
export type AppIntent =
  | 'process.startable'
  | 'process.my_tasks'
  | 'process.summary'
  | 'process.task_attention'
  | 'process.prepare';
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
  /** Normalized record kind used for canvas rendering, e.g. `process.task`. */
  kind?: string;
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
  domain: Domain;
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
  /** One entry per upstream operation attempted (application domains). */
  provenance?: Provenance[];
  draft?: {
    id: string;
    object: string;
    summary: string;
    evidenceRefs: string[];
    status: 'DRAFT_ONLY';
    kind?: 'engineering.review' | 'process.start';
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
  apps: Record<AppDomain, AppStatus>;
};
export type AppStatus = {
  app: AppDomain;
  label: string;
  liveReady: boolean;
  configured: boolean;
  credentialsPresent: boolean;
  contractValid: boolean;
  release: string | null;
  authMode: string | null;
  blockers: string[];
  allowedOperations: string[];
  specRelease: string;
  candidateOperations: {
    name: string;
    operationId: string;
    method: string;
    path: string;
    description: string;
    status: 'UNVERIFIED' | 'ADMITTED';
  }[];
  accessFinding: string;
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
export type Provenance = {
  operation: string;
  operationId: string;
  method: 'GET';
  path: string;
  specRelease: string;
  source: Source;
  scope: string;
  outcome: 'ok' | 'denied' | 'not_found' | 'error';
  coverage: Coverage | null;
  records: number;
  at: string;
};
export type FlowStage = {
  id: string;
  label: string;
  kind: 'start' | 'review' | 'approval' | 'action' | 'end';
};
export type FlowIllustrations = {
  source: 'synthetic';
  illustration: true;
  notice: string;
  flows: Record<string, FlowStage[]>;
  /** SYNTHETIC illustration only: which stage a synthetic task sits in. */
  placements: Record<string, string>;
};

/** Process orchestration (lab). Synthetic engine unless a reviewed sandbox drive contract admits live. */
export type OrchestrationStepKind = 'read' | 'drive' | 'compute' | 'human';
export type OrchestrationStepStatus =
  'pending' | 'awaiting_approval' | 'done' | 'blocked' | 'failed' | 'skipped';
export type OrchestrationStep = {
  id: string;
  kind: OrchestrationStepKind;
  title: string;
  stage?: string;
  operationId?: string;
  method?: 'GET' | 'POST';
  path?: string;
  status: OrchestrationStepStatus;
  request?: unknown;
  response?: unknown;
  outcome?: string;
  at?: string;
};
export type OrchestrationStatus =
  | 'awaiting_approval'
  | 'awaiting_signoff'
  | 'completed'
  | 'needs_input'
  | 'blocked'
  | 'failed'
  | 'cancelled';
export type OrchestrationStage = {
  id: string;
  label: string;
  kind: 'start' | 'automated' | 'human';
  tool?: string;
};
export type OrchestrationChange = {
  field: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
};
export type OrchestrationRun = {
  id: string;
  number: number;
  prompt: string;
  /** Who issued the command: the NOVA page, or Claude through the MCP server. */
  via?: 'portal' | 'claude';
  createdAt: string;
  source: Source;
  intent:
    | 'configure'
    | 'recalculate'
    | 'requirement'
    | 'tasks'
    | 'status'
    | 'processes'
    | 'refused'
    | 'unknown';
  status: OrchestrationStatus;
  summary: string;
  approval: 'each' | 'all';
  processKey?: string;
  processName?: string;
  identificator?: string;
  instanceId?: string;
  inputs?: Record<string, string | number>;
  stages: OrchestrationStage[];
  stageState: Record<string, 'pending' | 'active' | 'done' | 'awaiting' | 'human' | 'failed'>;
  stageNotes: Record<string, string>;
  steps: OrchestrationStep[];
  outputs: { field: string; label: string; value: string }[];
  findings: string[];
  missing: string[];
  changes: OrchestrationChange[];
  records: { id: string; title: string; detail: string }[];
};
