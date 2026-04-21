/**
 * Resolve {{$SECRET_NAME}} placeholders in a string using process.env.
 * Throws if any referenced secret is missing or empty.
 *
 * Shared by the Communications hub (action_templates webhook) and the
 * external endpoints registry so both paths agree on placeholder syntax.
 */
export function resolveSecrets(text: string): string {
  return text.replace(/\{\{\$([A-Z0-9_]+)\}\}/g, (_match, name) => {
    const val = process.env[name];
    if (val === undefined || val === '') {
      throw new Error(`Secret not found: "${name}". Ensure the environment variable ${name} is set.`);
    }
    return val;
  });
}

/**
 * Recursively walk an object/array and resolve {{$SECRET}} placeholders in
 * any string leaves. Useful for hashes like authConfig and headers.
 */
export function resolveSecretsDeep<T>(value: T): T {
  if (typeof value === 'string') return resolveSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => resolveSecretsDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveSecretsDeep(v);
    }
    return out as T;
  }
  return value;
}
