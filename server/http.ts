/**
 * Shared, bounded read transport for every reviewed connector.
 *
 * One fixed origin per call, GET only, no redirects, 12-second timeout, no retry,
 * JSON only, one-megabyte cap. Raw upstream error bodies never leave this module.
 */
export class GatewayError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function boundedGetJson(
  request: typeof fetch,
  url: URL,
  headers: Record<string, string>,
  platform = 'platform',
): Promise<unknown> {
  let response: Response;
  try {
    response = await request(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: 'application/json', ...headers },
    });
  } catch {
    throw new GatewayError(
      'UPSTREAM_UNAVAILABLE',
      `The ${platform} could not be reached. Check the private runtime; no retry or redirect was attempted.`,
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new GatewayError(
      'AUTHORIZATION_DENIED',
      `The ${platform} denied access. No identity or endpoint fallback was attempted.`,
    );
  if (response.status === 404)
    throw new GatewayError(
      'NOT_FOUND',
      `The ${platform} returned no record for that identifier, or it is not visible to this principal.`,
    );
  if (!response.ok)
    throw new GatewayError('UPSTREAM_ERROR', `The ${platform} returned HTTP ${response.status}.`);
  if (!response.headers.get('content-type')?.includes('json'))
    throw new GatewayError('INVALID_RESPONSE', 'Expected the documented JSON response.');
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 1_000_000) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new GatewayError(
      'INVALID_RESPONSE',
      `The ${platform} response was invalid or exceeded the one-megabyte limit.`,
    );
  }
}

export function atPath(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (v, p) =>
        v !== null && typeof v === 'object' && Object.hasOwn(v, p)
          ? (v as Record<string, unknown>)[p]
          : undefined,
      value,
    );
}
