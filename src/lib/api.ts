export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly missingVars?: string[];

  constructor(message: string, status: number, code?: string, missingVars?: string[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.missingVars = missingVars;
  }
}

let activeIdTokenGetter: (() => Promise<string | null>) | null = null;

export function registerIdTokenGetter(fn: () => Promise<string | null>) {
  activeIdTokenGetter = fn;
}

export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Requested-With', 'MourTrading');

  if (activeIdTokenGetter) {
    try {
      const token = await activeIdTokenGetter();
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    } catch {
      // Fall back to HttpOnly cookie session
    }
  }

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let json: Record<string, unknown> = {};
  let parsedAsJson = false;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    parsedAsJson = true;
  } catch {
    const looksLikeHtmlOrNotFound =
      res.status === 404 ||
      text.includes('NOT_FOUND') ||
      text.includes('The page could not be found') ||
      text.trim().startsWith('<');
    json = {
      error: looksLikeHtmlOrNotFound
        ? `Service endpoint unavailable (${res.status})`
        : text.slice(0, 180) || `HTTP ${res.status}`,
    };
  }

  if (!res.ok) {
    const rawMsg = parsedAsJson ? String(json.error || `Request failed (${res.status})`) : String(json.error);
    throw new ApiError(
      rawMsg,
      res.status,
      typeof json.code === 'string' ? json.code : undefined,
      Array.isArray(json.missingVars) ? json.missingVars.map(String) : undefined,
    );
  }

  return json as T;
}
