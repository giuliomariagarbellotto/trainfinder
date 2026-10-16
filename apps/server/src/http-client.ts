import { config } from "./config.js";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} per ${url}`);
  }
}

export async function fetchText(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<string> {
  const { timeoutMs = 20_000, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { "User-Agent": `${config.clientName} (+https://github.com/giuliomariagarbellotto/trainfinder)`, ...rest.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return res.text();
}

export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  return JSON.parse(await fetchText(url, init)) as T;
}

/** Esegue fn su tutti gli elementi con al massimo `limit` richieste contemporanee. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
