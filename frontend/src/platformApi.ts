import { API_BASE, ApiError } from './api';

const TOKEN_KEY = 'inv_platform_token';

export function getPlatformToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function setPlatformToken(t: string): void {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* */ }
}

let onUnauthorized = (): void => {};
export const setPlatformUnauthorizedHandler = (fn: () => void): void => { onUnauthorized = fn; };

async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getPlatformToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/platform${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check that the backend is running.');
  }
  if (res.status === 204) return null as T;
  const text = await res.text();
  let data: { error?: string } | T | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    const errBody = data as { error?: string } | null;
    throw new ApiError(res.status, errBody?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const platformApi = {
  get: <T = any>(p: string, params?: Record<string, unknown>) => {
    const q = params
      ? `?${Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}`
      : '';
    return request<T>('GET', `${p}${q}`);
  },
  post: <T = any>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
};
