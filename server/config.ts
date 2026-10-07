import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { RuntimeStatus, ToolName } from '../shared/types';

const propertyPath = z
  .string()
  .regex(/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/)
  .refine((v) => !v.split('.').some((p) => ['__proto__', 'constructor', 'prototype'].includes(p)));
const docUrl = z.url().refine((v) => {
  const u = new URL(v);
  return u.protocol === 'https:' && (u.hostname === '3ds.com' || u.hostname.endsWith('.3ds.com'));
}, 'Use the official documentation source reviewed by the operator.');
const names = [
  'get_current_user',
  'search_engineering_items',
  'get_engineering_item',
  'get_product_structure',
  'get_requirements',
  'search_knowledge',
] as const;
const bindingSchema = z
  .object({
    classification: z.literal('PUBLIC_SUPPORTED'),
    method: z.literal('GET'),
    readOnly: z.literal(true),
    officialDocumentation: docUrl,
    operationId: z.string().min(1),
    requiredRole: z.string().min(1),
    requiredLicense: z.string().min(1),
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
export const contractSchema = z
  .object({
    schemaVersion: z.literal(1),
    release: z.string().min(1),
    authenticationVerified: z.literal(true),
    authMode: z.enum(['bearer', 'basic']),
    reviewedBy: z.string().min(1),
    verifiedAt: z.iso.date(),
    operations: z.partialRecord(z.enum(names), bindingSchema),
  })
  .strict();
export type Contract = z.infer<typeof contractSchema>;
export type Binding = z.infer<typeof bindingSchema>;
export type Config = {
  origin?: string;
  release?: string;
  securityContext?: string;
  authorization?: string;
  contract?: Contract;
  blockers: string[];
  model: { provider: 'none' | 'ollama'; url: string; name: string; egress: boolean };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const blockers: string[] = [];
  let origin: string | undefined;
  if (env.NOVA_TENANT_ORIGIN) {
    try {
      const u = new URL(env.NOVA_TENANT_ORIGIN);
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
      blockers.push('Tenant origin must be an HTTPS origin without a path or credentials.');
    }
  } else blockers.push('Configure the private tenant origin.');
  if (!env.NOVA_RELEASE) blockers.push('Set the exact tenant release.');
  if (!env.NOVA_SECURITY_CONTEXT) blockers.push('Configure an authorized security context.');
  let authorization: string | undefined;
  if (env.NOVA_AUTH_MODE === 'bearer' && env.NOVA_ACCESS_TOKEN)
    authorization = `Bearer ${env.NOVA_ACCESS_TOKEN}`;
  else if (env.NOVA_AUTH_MODE === 'basic' && env.NOVA_CLIENT_ID && env.NOVA_CLIENT_SECRET)
    authorization = `Basic ${Buffer.from(`${env.NOVA_CLIENT_ID}:${env.NOVA_CLIENT_SECRET}`).toString('base64')}`;
  if (!authorization)
    blockers.push('Provision the verified authentication mechanism in the private runtime.');
  if ([authorization, env.NOVA_SECURITY_CONTEXT].some((v) => v && /[\r\n]/.test(v))) {
    authorization = undefined;
    blockers.push('Invalid private header configuration.');
  }
  let contract: Contract | undefined;
  if (env.NOVA_CONTRACT_FILE && existsSync(env.NOVA_CONTRACT_FILE)) {
    try {
      const result = contractSchema.parse(JSON.parse(readFileSync(env.NOVA_CONTRACT_FILE, 'utf8')));
      if (result.release !== env.NOVA_RELEASE || result.authMode !== env.NOVA_AUTH_MODE)
        throw new Error();
      if (new Date(result.verifiedAt).getTime() > Date.now()) throw new Error();
      contract = result;
    } catch {
      blockers.push(
        'Contract rejected: verify schema, release, authentication and review evidence.',
      );
    }
  } else blockers.push('Install the reviewed, release-specific API contract file.');
  const core: ToolName[] = ['search_engineering_items', 'get_engineering_item'];
  if (contract && core.some((name) => !contract.operations[name]))
    blockers.push(
      'The initial live slice requires both engineering search and item retrieval bindings.',
    );
  const provider = env.NOVA_MODEL_PROVIDER === 'ollama' ? 'ollama' : 'none';
  let modelUrl = 'http://127.0.0.1:11434';
  if (provider === 'ollama') {
    try {
      const u = new URL(env.NOVA_MODEL_URL || modelUrl);
      if (
        !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
        !['http:', 'https:'].includes(u.protocol) ||
        u.username ||
        u.password ||
        u.pathname !== '/' ||
        u.search ||
        u.hash
      )
        throw new Error();
      modelUrl = u.origin;
    } catch {
      throw new Error('The Ollama provider must use a loopback origin.');
    }
  }
  return {
    origin,
    release: env.NOVA_RELEASE,
    securityContext: env.NOVA_SECURITY_CONTEXT,
    authorization,
    contract,
    blockers,
    model: {
      provider,
      url: modelUrl,
      name: env.NOVA_MODEL_NAME || '',
      egress: env.NOVA_MODEL_EGRESS === 'true',
    },
  };
}

export function runtimeStatus(config: Config): Omit<RuntimeStatus, 'apps'> {
  return {
    version: '0.2.0',
    liveReady: config.blockers.length === 0,
    configured: Boolean(config.origin),
    credentialsPresent: Boolean(config.authorization),
    contractValid: Boolean(config.contract),
    securityContextPresent: Boolean(config.securityContext),
    release: config.release || null,
    blockers: config.blockers,
    allowedTools: Object.keys(config.contract?.operations || {}) as ToolName[],
    provider: config.model.provider === 'ollama' ? 'Local Ollama' : 'Deterministic router',
    modelReady:
      config.model.provider === 'ollama' && config.model.egress && Boolean(config.model.name),
  };
}
