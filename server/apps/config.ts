import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { AppDomain, AppStatus } from '../../shared/types';
import { appLabels, operations } from './registry';

/**
 * Independent private configuration per application. ITEROP and the dataset catalog never
 * share an origin, credential, contract or security context with each other or with the
 * engineering gateway.
 */
const propertyPath = z
  .string()
  .regex(/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/)
  .refine((v) => !v.split('.').some((p) => ['__proto__', 'constructor', 'prototype'].includes(p)));

const documentationHosts: Record<AppDomain, string[]> = {
  // ITEROP publishes its own knowledge base; platform-integrated routes are documented by 3ds.com.
  ITEROP: ['doc.iterop.com', '3ds.com'],
  DATASET_CATALOG: ['3ds.com'],
};
const docUrl = (app: AppDomain) =>
  z.url().refine((v) => {
    const u = new URL(v);
    return (
      u.protocol === 'https:' &&
      documentationHosts[app].some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
    );
  }, 'Use the official documentation source reviewed by the operator.');

const bindingSchema = (app: AppDomain) =>
  z
    .object({
      classification: z.literal('PUBLIC_SUPPORTED'),
      method: z.literal('GET'),
      readOnly: z.literal(true),
      officialDocumentation: docUrl(app),
      operationId: z.string().min(1),
      requiredRole: z.string().min(1),
      requiredLicense: z.string().min(1),
      /** Results are filtered by the upstream service for the authenticated principal. */
      principalScoped: z.boolean(),
      requestSchemaReviewed: z.literal(true),
      responseSchemaReviewed: z.literal(true),
      csrf: z.literal('NOT_REQUIRED'),
      path: z
        .string()
        .regex(/^\/[a-zA-Z0-9_./{}:-]+$/)
        .refine(
          (p) =>
            !p.includes('..') &&
            !p.includes('//') &&
            (!p.includes('{') ||
              (p.match(/\{id\}/g)?.length === 1 && !p.replace('{id}', '').includes('{'))),
        ),
      queryParameter: z
        .string()
        .regex(/^[a-zA-Z0-9_-]+$/)
        .optional(),
      rowsPath: propertyPath.optional(),
      totalPath: propertyPath.optional(),
      completePath: propertyPath.optional(),
      fields: z.record(z.string(), propertyPath),
    })
    .strict();

export function appContractSchema(app: AppDomain) {
  const names = operations[app].map((o) => o.name) as [string, ...string[]];
  return z
    .object({
      schemaVersion: z.literal(1),
      app: z.literal(app),
      release: z.string().min(1),
      apiVersion: z.string().min(1),
      authenticationVerified: z.literal(true),
      authMode: z.enum(['bearer', 'basic']),
      securityContext: z.enum(['REQUIRED', 'NOT_REQUIRED']),
      reviewedBy: z.string().min(1),
      verifiedAt: z.iso.date(),
      /** Read used by the connection test. Must be one of the bound operations. */
      probe: z.object({ operation: z.enum(names), query: z.string().max(100).optional() }).strict(),
      operations: z.partialRecord(z.enum(names), bindingSchema(app)),
    })
    .strict()
    .refine((c) => Boolean(c.operations[c.probe.operation as keyof typeof c.operations]), {
      message: 'The probe operation must be bound.',
    });
}
export type AppContract = z.infer<ReturnType<typeof appContractSchema>>;
export type AppBinding = z.infer<ReturnType<typeof bindingSchema>>;
export type AppConfig = {
  app: AppDomain;
  origin?: string;
  release?: string;
  authMode?: 'bearer' | 'basic';
  authorization?: string;
  securityContext?: string;
  contract?: AppContract;
  blockers: string[];
};

/** Minimum read slice required before an application is reported as live-ready. */
export const coreOperations: Record<AppDomain, string[]> = {
  ITEROP: ['iterop.list_my_tasks'],
  DATASET_CATALOG: ['catalog.search_datasets', 'catalog.get_dataset'],
};

export function loadAppConfig(app: AppDomain, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const prefix = `NOVA_${appLabels[app].env}_`;
  const v = (name: string) => env[prefix + name] || undefined;
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
  } else blockers.push('Configure the private service origin for this application.');
  if (!v('RELEASE')) blockers.push('Set the exact reviewed release of this application.');
  const authMode =
    v('AUTH_MODE') === 'basic' ? 'basic' : v('AUTH_MODE') === 'bearer' ? 'bearer' : undefined;
  let authorization: string | undefined;
  if (authMode === 'bearer' && v('ACCESS_TOKEN')) authorization = `Bearer ${v('ACCESS_TOKEN')}`;
  else if (authMode === 'basic' && v('ACCESS_KEY') && v('SECRET_KEY'))
    authorization = `Basic ${Buffer.from(`${v('ACCESS_KEY')}:${v('SECRET_KEY')}`).toString('base64')}`;
  if (!authorization)
    blockers.push('Provision the documented, approved credential for this application.');
  const securityContext = v('SECURITY_CONTEXT');
  if ([authorization, securityContext].some((x) => x && /[\r\n]/.test(x))) {
    authorization = undefined;
    blockers.push('Invalid private header configuration.');
  }
  let contract: AppContract | undefined;
  const file = v('CONTRACT_FILE');
  if (file && existsSync(file)) {
    try {
      const parsed = appContractSchema(app).parse(JSON.parse(readFileSync(file, 'utf8')));
      if (parsed.release !== v('RELEASE') || parsed.authMode !== authMode) throw new Error();
      if (new Date(parsed.verifiedAt).getTime() > Date.now()) throw new Error();
      if (parsed.securityContext === 'REQUIRED' && !securityContext)
        blockers.push('This contract requires an authorized security context.');
      contract = parsed;
    } catch {
      blockers.push(
        'Contract rejected: verify application, schema, release, authentication and review evidence.',
      );
    }
  } else blockers.push('Install the reviewed, release-specific contract for this application.');
  if (contract && coreOperations[app].some((name) => !contract.operations[name as never]))
    blockers.push(`The first live slice requires: ${coreOperations[app].join(', ')}.`);
  return {
    app,
    origin,
    release: v('RELEASE'),
    authMode,
    authorization,
    securityContext,
    contract,
    blockers,
  };
}

const findings: Record<AppDomain, string> = {
  ITEROP:
    'UNVERIFIED. Public ITEROP documentation describes administrator-created REST access keys (HTTP Basic) and notes JWT is not supported for API v2. Platform notes describe an API Gateway route that requires the PFI role, which the operator reports not having. No tenant contract has been reviewed.',
  DATASET_CATALOG:
    'UNVERIFIED. No official, release-scoped external REST API for the dataset catalog has been confirmed. Catalog access is associated with the Data Steward role. No tenant contract has been reviewed.',
};

export function appStatus(config: AppConfig): AppStatus {
  const admitted = config.blockers.length ? [] : Object.keys(config.contract?.operations || {});
  return {
    app: config.app,
    label: appLabels[config.app].label,
    liveReady: config.blockers.length === 0,
    configured: Boolean(config.origin),
    credentialsPresent: Boolean(config.authorization),
    contractValid: Boolean(config.contract),
    release: config.release || null,
    authMode: config.authMode || null,
    blockers: config.blockers,
    allowedOperations: admitted,
    candidateOperations: operations[config.app].map((o) => ({
      name: o.name,
      description: o.description,
      status: admitted.includes(o.name) ? 'ADMITTED' : 'UNVERIFIED',
    })),
    accessFinding:
      config.contract && !config.blockers.length
        ? `Reviewed contract installed (${config.contract.apiVersion}, verified ${config.contract.verifiedAt}). Live results still require a private proof run.`
        : findings[config.app],
  };
}
