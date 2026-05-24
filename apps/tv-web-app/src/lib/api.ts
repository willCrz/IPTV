const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export async function apiLogin(email: string, password: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, deviceType: 'web' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Erro no login');
  return data.data;
}

export async function apiGetChannels(token: string, playlistId?: string) {
  const url = playlistId
    ? `${API}/channels/live?playlistId=${playlistId}&limit=200`
    : `${API}/channels/live?limit=200`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return data.data?.items || [];
}

export async function apiImportList(token: string, type: string, opts: Record<string, string>) {
  const res = await fetch(`${API}/list/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, ...opts }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Erro na importação');
  return data.data;
}

export async function apiGetPlaylists(token: string) {
  const res = await fetch(`${API}/list`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return data.data || [];
}