/** Strips characters that would break a PostgREST `or=(...)` filter. */
export function searchTerm(q: string | string[] | undefined) {
  const v = (Array.isArray(q) ? q[0] : q)?.replace(/[,()*%\\:"']/g, " ").trim() ?? "";
  return v.slice(0, 80);
}

export function param(v: string | string[] | undefined) {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export const PAGE_SIZE = 25;

export function pageRange(page: string | string[] | undefined) {
  const n = Math.max(1, Number.parseInt(param(page), 10) || 1);
  return { page: n, from: (n - 1) * PAGE_SIZE, to: n * PAGE_SIZE - 1 };
}

/** Builds a query string from the current params with overrides. */
export function withParams(
  current: Record<string, string | string[] | undefined>,
  overrides: Record<string, string | number | null>,
) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const s = param(v);
    if (s) sp.set(k, s);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null || v === "") sp.delete(k);
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
