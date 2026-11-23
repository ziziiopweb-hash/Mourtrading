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
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { error: text || `HTTP ${res.status}` };
  }

  if (!res.ok) {
    throw new ApiError(
      String(json.error || `Request failed (${res.status})`),
      res.status,
      typeof json.code === 'string' ? json.code : undefined,
      Array.isArray(json.missingVars) ? json.missingVars.map(String) : undefined,
    );
  }

  return json as T;
}
