/** Minimal, offline OpenAPI helpers used by the resolver script and the FD04 contract tests. */
type Json = Record<string, unknown>;

export function loadSpec(text: string) {
  const spec = JSON.parse(text) as Json;
  const pointer = (ref: string): unknown => {
    if (!ref.startsWith('#/')) throw new Error(`External $ref not supported: ${ref}`);
    return ref
      .slice(2)
      .split('/')
      .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce<unknown>((v, k) => (v as Json)?.[k], spec);
  };
  /** Inline every local $ref (cycle-safe); keeps the original ref as `$resolvedFrom`. */
  const deref = (value: unknown, seen: string[] = []): unknown => {
    if (Array.isArray(value)) return value.map((v) => deref(v, seen));
    if (!value || typeof value !== 'object') return value;
    const obj = value as Json;
    if (typeof obj.$ref === 'string') {
      if (seen.includes(obj.$ref)) return { $circular: obj.$ref };
      const { $ref, ...siblings } = obj;
      return {
        $resolvedFrom: $ref,
        ...(deref(pointer($ref), [...seen, $ref]) as Json),
        ...siblings,
      };
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, deref(v, seen)]));
  };
  const methods = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];
  const paths = (spec.paths || {}) as Record<string, Json>;
  const index = Object.entries(paths).flatMap(([path, item]) =>
    methods
      .filter((m) => item[m])
      .map((m) => ({
        path,
        method: m.toUpperCase(),
        op: item[m] as Json,
        shared: (item.parameters || []) as unknown[],
      })),
  );
  const operation = (operationId: string) => {
    const found = index.find((o) => o.op.operationId === operationId);
    if (!found) return undefined;
    const responses = deref(found.op.responses) as Record<string, Json>;
    const okSchema = (responses['200']?.content as Json | undefined)?.['application/json'] as
      Json | undefined;
    return {
      ...found,
      parameters: deref([...found.shared, ...((found.op.parameters as unknown[]) || [])]) as Json[],
      responses,
      okSchema: okSchema?.schema as Json | undefined,
    };
  };
  return { spec, pointer, deref, paths, index, operation };
}

/** Property names of an object schema, or of the item schema of an array schema. */
export function propertyNames(schema: unknown): string[] {
  const s = schema as Json;
  const target = s?.type === 'array' ? (s.items as Json) : s;
  return Object.keys((target?.properties as Json) || {}).sort();
}
