import type { Role, RoomAction, RoomResponse, RoomSnapshot, RoomState } from './shared.ts';

export type Connection = { roomId: string; token: string; role: Role; code: string };
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Camera frames and landmarks never enter this boundary.
export async function request<T>(path: string, method = 'GET', data?: unknown, token?: string): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: 'no-store', signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new ApiError(response.status, body.error ?? 'Request failed');
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
const storageKey = 'mogumogu-room-v1';
export function savedConnection(): Connection | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Connection | null;
    return value && /^[a-f0-9-]{36}$/.test(value.roomId) && /^[a-f0-9]{64}$/.test(value.token)
      && ['adult', 'child'].includes(value.role) && /^\d{6}$/.test(value.code) ? value : null;
  } catch { return null; }
}
export function saveConnection(value: Connection | null) {
  try { value ? sessionStorage.setItem(storageKey, JSON.stringify(value)) : sessionStorage.removeItem(storageKey); } catch { /* The current page still works without storage. */ }
}
export class SessionClient {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private revision = -1;
  private failures = 0;
  constructor(readonly connection: Connection, private onState: (state: RoomState) => void, private onConnection: (online: boolean, error?: unknown) => void) {}
  private accept(snapshot: RoomSnapshot) {
    if (this.stopped) return;
    this.failures = 0; this.onConnection(true);
    if (snapshot.state.revision > this.revision) { this.revision = snapshot.state.revision; this.onState(snapshot.state); }
  }
  start(initial?: RoomResponse) { if (initial) this.accept(initial); void this.poll(); }
  private async poll() {
    if (this.stopped) return;
    try { this.accept(await request<RoomSnapshot>(`/api/rooms/${this.connection.roomId}`, 'GET', undefined, this.connection.token)); }
    catch (error) { if (!this.stopped) { this.failures++; this.onConnection(false, error); } }
    finally { if (!this.stopped) this.timer = setTimeout(() => void this.poll(), Math.min(5000, 800 * 2 ** Math.min(this.failures, 3))); }
  }
  async action(action: RoomAction) {
    try { this.accept(await request<RoomSnapshot>(`/api/rooms/${this.connection.roomId}/actions`, 'POST', action, this.connection.token)); }
    catch (error) { if (!(error instanceof ApiError) || error.status >= 500) this.onConnection(false, error); throw error; }
  }
  stop() { this.stopped = true; clearTimeout(this.timer); }
}
