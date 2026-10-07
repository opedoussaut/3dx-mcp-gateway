export async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(45_000),
    headers:
      data === undefined
        ? {}
        : { 'Content-Type': 'application/json', 'X-Nova-Client': 'workspace' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}
export function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
export const duration = (ms: number) =>
  ms < 1 ? '< 1 ms' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
