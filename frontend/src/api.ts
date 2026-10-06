const TOKEN_KEY = 'inv_token';

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function setToken(t: string): void {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

let onUnauthorized = (): void => {};
export const setUnauthorizedHandler = (fn: () => void): void => { onUnauthorized = fn; };

type RequestOptions = { raw?: boolean };

async function request<T = any>(method: string, path: string, body?: unknown, { raw = false }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check that the backend is running.');
  }
  if (raw) return res as T;
  if (res.status === 204) return null as T;
  const text = await res.text();
  let data: { error?: string } | T | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
    const errBody = data as { error?: string } | null;
    throw new ApiError(res.status, errBody?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string, params?: Record<string, unknown>) => request<T>('GET', params ? `${p}?${qs(params)}` : p),
  post: <T = any>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  del: <T = any>(p: string) => request<T>('DELETE', p),
  upload: <T = any>(p: string, formData: FormData) => request<T>('POST', p, formData),
};

export function qs(params?: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  }
  return u.toString();
}

export async function fetchAll<T = any>(path: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page < 500; page += 1) {
    const res = await api.get<{ data: T[]; total: number }>(path, { ...params, page, per_page: 200 });
    out.push(...res.data);
    if (out.length >= res.total || !res.data.length) break;
  }
  return out;
}

export const documentUrl = (id: string, inline = false): string =>
  `/api/documents/${id}/download?token=${encodeURIComponent(getToken())}${inline ? '&inline=1' : ''}`;
