import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { AppStatus } from '../../shared/types';
import { SPEC, operations, type SemanticOperation } from './operations';

/**
 * Private ITEROP configuration. Independent of the engineering gateway: its own origin,
 * credential, release, contract and (optional) security context.
 *
 * A reviewed binding cannot choose a path: the path always comes from the operation inventory
 * (operations.ts). The contract only adds an optional base path for the tenant deployment,
 * the reviewed field mapping and the review evidence.
 */
const propertyPath = z
  .string()
  .regex(/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/)
  .refine((v) => !v.split('.').some((p) => ['__proto__', 'constructor', 'prototype'].includes(p)));
const docUrl = z.url().refine((v) => {
  const u = new URL(v);
  return (
    u.protocol === 'https:' &&
    ['3ds.com', 'iterop.com'].some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
  );
}, 'Use the official documentation source reviewed by the operator.');

const names = operations.map((o) => o.name) as [SemanticOperation, ...SemanticOperation[]];
const binding = z
  .object({
    operationId: z.string().min(1),
    classification: z.literal('PUBLIC_SUPPORTED'),
    method: z.literal('GET'),
    readOnly: z.literal(true),
    officialDocumentation: docUrl,
    requiredRole: z.string().min(1),
    requiredLicense: z.string().min(1),
    principalScoped: z.literal(true),
    requestSchemaReviewed: z.literal(true),
    responseSchemaReviewed: z.literal(true),
    csrf: z.literal('NOT_REQUIRED'),
    rowsPath: propertyPath.optional(),
    totalPath: propertyPath.optional(),
    completePath: propertyPath.optional(),
    fields: z.record(z.string(), propertyPath),
  })
  .strict();

export const iteropContractSchema = z
  .object({
    schemaVersion: z.literal(2),
    app: z.literal('ITEROP'),
    release: z.string().min(1),
    specRelease: z.literal(SPEC.release),
    apiVersion: z.string().min(1),
    authenticationVerified: z.literal(true),
    authMode: z.enum(['bearer', 'basic']),
    securityContext: z.enum(['REQUIRED', 'NOT_REQUIRED']),
    reviewedBy: z.string().min(1),
    verifiedAt: z.iso.date(),
    basePath: z
      .string()
      .regex(/^(?:\/[a-zA-Z0-9_.-]+)*$/)
      .refine((p) => !p.split('/').includes('..'))
      .default(''),
    probe: z.object({ operation: z.enum(names) }).strict(),
    operations: z.partialRecord(z.enum(names), binding),
  })
  .strict()
  .superRefine((c, ctx) => {
    for (const [name, b] of Object.entries(c.operations))
      if (b && operations.find((o) => o.name === name)?.operationId !== b.operationId)
        ctx.addIssue({ code: 'custom', message: `${name} must bind its documented operationId.` });
    if (!c.operations[c.probe.operation])
      ctx.addIssue({ code: 'custom', message: 'The probe operation must be bound.' });
  });
export type IteropContract = z.infer<typeof iteropContractSchema>;
export type IteropConfig = {
  origin?: string;
  release?: string;
  authMode?: 'bearer' | 'basic';
  authorization?: string;
  securityContext?: string;
  contract?: IteropContract;
  blockers: string[];
};

/** Minimum read slice before ITEROP is reported live-ready. */
export const coreOperations: SemanticOperation[] = [
  'iterop.list_startable_processes',
  'iterop.list_my_tasks',
];

export function loadIteropConfig(env: NodeJS.ProcessEnv = process.env): IteropConfig {
  const v = (name: string) => env[`NOVA_ITEROP_${name}`] || undefined;
  const blockers: string[] = [];
  let origin: string | undefined;
  if (v('ORIGIN')) {
    try {
      const u = new URL(v('ORIGIN')!);
      if (
        u.protocol !== 'https:' ||
        u.username ||
        u.password ||
        u.pathname !== '/' ||
        u.search ||
        u.hash
      )
        throw new Error();
      origin = u.origin;
    } catch {
      blockers.push('Service origin must be an HTTPS origin without a path or credentials.');
    }
  } else blockers.push('Configure the approved ITEROP service origin.');
  if (!v('RELEASE')) blockers.push('Set the exact deployed release.');
  const authMode =
    v('AUTH_MODE') === 'basic' ? 'basic' : v('AUTH_MODE') === 'bearer' ? 'bearer' : undefined;
  let authorization: string | undefined;
  if (authMode === 'bearer' && v('ACCESS_TOKEN')) authorization = `Bearer ${v('ACCESS_TOKEN')}`;
  else if (authMode === 'basic' && v('ACCESS_KEY') && v('SECRET_KEY'))
    authorization = `Basic ${Buffer.from(`${v('ACCESS_KEY')}:${v('SECRET_KEY')}`).toString('base64')}`;
  if (!authorization) blockers.push('Provision the approved, documented read-only API credential.');
  const securityContext = v('SECURITY_CONTEXT');
  if ([authorization, securityContext].some((x) => x && /[\r\n]/.test(x))) {
    authorization = undefined;
    blockers.push('Invalid private header configuration.');
  }
  let contract: IteropContract | undefined;
  const file = v('CONTRACT_FILE');
  if (file && existsSync(file)) {
    try {
      const parsed = iteropContractSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      if (parsed.release !== v('RELEASE') || parsed.authMode !== authMode) throw new Error();
      if (new Date(parsed.verifiedAt).getTime() > Date.now()) throw new Error();
      if (parsed.securityContext === 'REQUIRED' && !securityContext)
        blockers.push('This contract requires an authorized security context.');
      contract = parsed;
    } catch {
      blockers.push(
        'Contract rejected: verify schema, spec release, operationIds, release, authentication and review evidence.',
      );
    }
  } else blockers.push('Install the reviewed ITEROP contract for the deployed release.');
  if (contract && coreOperations.some((name) => !contract.operations[name]))
    blockers.push(`The first live slice requires: ${coreOperations.join(', ')}.`);
  return {
    origin,
    release: v('RELEASE'),
    authMode,
    authorization,
    securityContext,
    contract,
    blockers,
  };
}

export function iteropStatus(config: IteropConfig): AppStatus {
  const admitted = config.blockers.length ? [] : Object.keys(config.contract?.operations || {});
  return {
    app: 'ITEROP',
    label: 'Business Process',
    liveReady: config.blockers.length === 0,
    configured: Boolean(config.origin),
    credentialsPresent: Boolean(config.authorization),
    contractValid: Boolean(config.contract),
    release: config.release || null,
    authMode: config.authMode || null,
    blockers: config.blockers,
    allowedOperations: admitted,
    specRelease: SPEC.release,
    candidateOperations: operations.map((o) => ({
      name: o.name,
      operationId: o.operationId,
      method: o.method,
      path: o.path,
      description: o.description,
      status: admitted.includes(o.name) ? 'ADMITTED' : 'UNVERIFIED',
    })),
    accessFinding:
      config.contract && !config.blockers.length
        ? `Reviewed contract installed (${config.contract.apiVersion}, verified ${config.contract.verifiedAt}). Live results still require a private proof run.`
        : 'LIVE BLOCKED. The R2026x-FD04 Business Process API v2 documents these GET operations, but no route to the tenant is approved: Play sign-in is UI access only; the API Gateway route requires the PFI role (not held); a standalone REST key requires an ITEROP administrator. No tenant contract has been reviewed.',
  };
}
