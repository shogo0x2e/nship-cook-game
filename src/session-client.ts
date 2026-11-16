import type { FamilyAction, FamilySnapshot, FamilyState, Role } from './shared.ts';

export type Connection = { username: string; role: Role };
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status=status; }
}
export async function request<T>(path: string, method = 'GET', data?: unknown, role?: Role): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store',
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(role ? { 'X-Cookgame-Role': role } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(7000) });
  if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new ApiError(response.status, body.error ?? 'Request failed'); }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
export function savedRole(): Role | null {
  try { const role=localStorage.getItem('mogumogu-role-v1');return role==='adult'||role==='child'?role:null; } catch {return null;}
}
export function saveRole(role: Role | null) {
  try {role?localStorage.setItem('mogumogu-role-v1',role):localStorage.removeItem('mogumogu-role-v1');}catch{/* The current page works without persistent role preference. */}
}
export class SessionClient {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private revision = -1;
  private failures = 0;
  constructor(readonly connection: Connection, private onState: (state: FamilyState) => void, private onConnection: (online: boolean, error?: unknown) => void) {}
  private accept(snapshot: FamilySnapshot) {
    if (this.stopped) return;
    this.failures=0;this.onConnection(true);
    if (snapshot.state.revision>this.revision) {this.revision=snapshot.state.revision;this.onState(snapshot.state);}
  }
  start() {void this.poll();}
  private async poll() {
    if(this.stopped)return;
    try{this.accept(await request<FamilySnapshot>('/api/family'));}
    catch(error){if(!this.stopped){this.failures++;this.onConnection(false,error);}}
    finally{if(!this.stopped)this.timer=setTimeout(()=>void this.poll(),Math.min(5000,800*2**Math.min(this.failures,3)));}
  }
  async action(action: FamilyAction) {
    try{this.accept(await request<FamilySnapshot>('/api/actions','POST',action,this.connection.role));}
    catch(error){if(!this.stopped&&(!(error instanceof ApiError)||error.status===401||error.status>=500))this.onConnection(false,error);throw error;}
  }
  stop(){this.stopped=true;clearTimeout(this.timer);}
}
