/** Same-origin API calls. Auth is the SameSite cookie (prod) or the Vite proxy's injected bearer (dev). */
async function req<T>(method: string, route: string, body?: unknown): Promise<T> {
  const r = await fetch(route, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = (await r.json()).error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r.json();
}

export const api = {
  claim: (token: string) => req('POST', '/api/session/claim', { token }),
  answer: (id: string, body: { text?: string; optionId?: string }) => req('POST', `/api/questions/${id}/answer`, body),
  cancel: (id: string) => req('POST', `/api/questions/${id}/cancel`, {}),
  snippet: (path: string, from?: number, to?: number) =>
    req<{ path: string; from: number; to: number; total: number; lines: string[] }>(
      'GET', `/api/file?path=${encodeURIComponent(path)}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`),
  loadMap: (path: string) => req('POST', '/api/map/load', { path }),
  tree: (path = '') => req<{ path: string; entries: { name: string; dir: boolean; size: number }[] }>('GET', `/api/tree?path=${encodeURIComponent(path)}`),
  fileAll: (path: string) => req<{ path: string; from: number; to: number; total: number; lines: string[] }>('GET', `/api/file?path=${encodeURIComponent(path)}&all=1`),
  focus: (body: { nodes?: string[]; note?: string }) => req('POST', '/api/focus', body),
};
