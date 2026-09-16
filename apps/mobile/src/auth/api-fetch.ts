/** Native requests need an explicit Origin for Better Auth's existing CSRF checks. */
export function createMobileApiFetch({
  apiUrl,
  native,
  request = fetch,
}: {
  apiUrl: string;
  native: boolean;
  request?: typeof fetch;
}): typeof fetch {
  const origin = new URL(apiUrl).origin;
  return async (input, init) => {
    const original = input instanceof Request ? input : undefined;
    const url = new URL(original?.url ?? String(input));
    if (url.origin !== origin) throw new Error("Request is outside the configured mobile API.");

    const headers = new Headers(original?.headers);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    // Browsers supply their own Origin; only native clients set the API's trusted base origin.
    if (native) headers.set("Origin", origin);

    const abort = new AbortController();
    const signal = init?.signal ?? original?.signal;
    const cancel = () => abort.abort();
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 15_000);
    try {
      return await request(input, {
        ...init,
        headers,
        credentials: "omit",
        redirect: "error",
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  };
}
