import type { Metrics, Operation, AuditEvent, ChaosPlan } from '@syncguard/contracts';
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.detail ?? body.reasons?.join(', ') ?? `Request failed (${response.status})`,
    );
  }
  return response.json() as Promise<T>;
}
export async function loadHealth(signal: AbortSignal) {
  const [metrics, operations] = await Promise.all([
    request<Metrics>('/metrics', { signal }),
    request<Operation[]>('/operations', { signal }),
  ]);
  return { metrics, operations };
}
export async function loadOperation(id: string, signal: AbortSignal) {
  const [operation, timeline] = await Promise.all([
    request<Operation>(`/operations/${id}`, { signal }),
    request<AuditEvent[]>(`/operations/${id}/timeline`, { signal }),
  ]);
  return { operation, timeline };
}
export const createPlan = (seed: number): Promise<ChaosPlan> =>
  request('/chaos/plans', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seed }),
  });
