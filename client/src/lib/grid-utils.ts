const KNOWN_ABBREVS = new Set([
  "id","url","api","mtd","ytd","ssn","ein","mcc","pos","atm","crm","erp",
  "dba","iso","fbo","ach","pdf","csv","json","xml","sms","pin","cvv","kyc",
  "aml","pci","dss","tpv","mrr","arr","roi","cac","ltv","gp","np",
]);

export function humanizeField(field: string): string {
  let s = field.replace(/_/g, " ");
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const words = s.split(" ").filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (KNOWN_ABBREVS.has(lower)) return w.toUpperCase();
      if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      return w.toLowerCase();
    })
    .join(" ");
}

export function displayLabel(
  field: string,
  widgetLabels?: Record<string, string>,
  templateLabels?: Record<string, string>
): string {
  return widgetLabels?.[field] || templateLabels?.[field] || humanizeField(field);
}
