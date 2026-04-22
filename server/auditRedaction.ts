const SENSITIVE_KEY_PATTERNS = [
  "password",
  "passwordhash",
  "passwordreset",
  "resettoken",
  "token",
  "secret",
  "twofactorsecret",
  "twofactor",
  "apikey",
  "api_key",
  "keysecret",
  "credit_card",
  "creditcard",
  "ssn",
  "cvv",
  "authorization",
];

const REDACTED = "[REDACTED]";

export function redactSensitive(input: any): any {
  if (input == null) return input;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      const redacted = redactSensitive(parsed);
      return JSON.stringify(redacted);
    } catch {
      return input;
    }
  }
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(redactSensitive);

  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    const k = key.toLowerCase();
    if (SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p))) {
      out[key] = REDACTED;
    } else if (value && typeof value === "object") {
      out[key] = redactSensitive(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
