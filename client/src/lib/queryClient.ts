import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Auto-forward the URL's ?db=<env> query param as an x-database-env header on
// every same-origin fetch. Unauthenticated flows that arrive via emailed
// links (prospect validation, signature request, application status, magic
// link, etc.) carry the env in the URL because the recipient has no session
// to derive it from. Without this, deep nested API calls (raw fetch, queries,
// mutations) all fall back to production on the server. Production users
// (no ?db) are unaffected — the helper is a no-op then.
if (typeof window !== "undefined" && !(window as { __dbFetchPatched?: boolean }).__dbFetchPatched) {
  (window as { __dbFetchPatched?: boolean }).__dbFetchPatched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    try {
      const dbParam = new URLSearchParams(window.location.search).get("db");
      if (dbParam && ["dev", "development", "test"].includes(dbParam)) {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const isSameOrigin = url.startsWith("/") || url.startsWith(window.location.origin);
        if (isSameOrigin) {
          const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
          if (!headers.has("x-database-env")) headers.set("x-database-env", dbParam);
          init = { ...init, headers };
        }
      }
    } catch {
      /* ignore — never let header injection break the actual request */
    }
    return originalFetch(input, init);
  };
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    mode: "cors",
  });
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
      mode: "cors",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    const body: unknown = await res.json();
    // Transparent unwrap of paginated envelopes for legacy consumers that
    // expect arrays. New paginated UIs should call the typed `*.getPaged()`
    // helpers in `lib/api.ts` and read `total`/`page`/`pageSize` directly.
    if (isPaginatedEnvelope(body)) {
      return body.items;
    }
    return body;
  };

interface PaginatedEnvelope<T = unknown> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function isPaginatedEnvelope(value: unknown): value is PaginatedEnvelope {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.items) &&
    typeof v.total === "number" &&
    typeof v.page === "number" &&
    typeof v.pageSize === "number"
  );
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
