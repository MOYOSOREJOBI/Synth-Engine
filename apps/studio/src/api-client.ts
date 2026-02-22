const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

let token: string | null = localStorage.getItem('pulsesynth_token');

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function apiFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { ...headers(), ...(opts.headers as Record<string, string> ?? {}) } });
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (res.status === 401) {
      token = null;
      localStorage.removeItem('pulsesynth_token');
    }
    return { ok: res.ok, status: res.status, data: data as T };
  } catch {
    return { ok: false, status: 0, data: null as T };
  }
}

export function isLoggedIn(): boolean { return !!token; }

export async function signup(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await apiFetch<{ token?: string }>('/v1/auth/signup', {
    method: 'POST', body: JSON.stringify({ email, password }),
  });
  if (ok && (data as { token?: string })?.token) {
    token = (data as { token: string }).token;
    localStorage.setItem('pulsesynth_token', token);
    return { ok: true };
  }
  return { ok: false, error: 'Signup failed' };
}

export async function login(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await apiFetch<{ token?: string }>('/v1/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  });
  if (ok && (data as { token?: string })?.token) {
    token = (data as { token: string }).token;
    localStorage.setItem('pulsesynth_token', token);
    return { ok: true };
  }
  return { ok: false, error: 'Invalid credentials' };
}

export function logout(): void {
  token = null;
  localStorage.removeItem('pulsesynth_token');
}

export async function listPatches(): Promise<Array<{ id: number; name: string; shared: number }>> {
  const { ok, data } = await apiFetch<Array<{ id: number; name: string; shared: number }>>('/v1/patches');
  return ok && Array.isArray(data) ? data : [];
}

export async function loadPatch(id: number): Promise<{ ok: boolean; patch?: unknown; name?: string }> {
  const { ok, data } = await apiFetch<{ patch?: unknown; name?: string }>(`/v1/patches/${id}`);
  if (ok && data) return { ok: true, patch: (data as { patch: unknown }).patch, name: (data as { name: string }).name };
  return { ok: false };
}

export async function savePatch(name: string, patch: unknown, shared = false): Promise<{ ok: boolean; id?: number }> {
  const { ok, data } = await apiFetch<{ id?: number }>('/v1/patches', {
    method: 'POST', body: JSON.stringify({ name, patch, shared }),
  });
  return ok ? { ok: true, id: (data as { id: number })?.id } : { ok: false };
}

export async function updatePatch(id: number, name: string, patch: unknown, shared?: boolean): Promise<boolean> {
  const { ok } = await apiFetch(`/v1/patches/${id}`, {
    method: 'PATCH', body: JSON.stringify({ name, patch, shared }),
  });
  return ok;
}

export async function deletePatch(id: number): Promise<boolean> {
  const { ok } = await apiFetch(`/v1/patches/${id}`, { method: 'DELETE' });
  return ok;
}

export async function sharePatch(id: number): Promise<boolean> {
  const { ok } = await apiFetch(`/v1/patches/${id}`, {
    method: 'PATCH', body: JSON.stringify({ shared: true }),
  });
  return ok;
}

export async function healthCheck(): Promise<boolean> {
  const { ok } = await apiFetch('/healthz');
  return ok;
}
