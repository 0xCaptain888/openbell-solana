export class OpenBellApiError extends Error {
  constructor(code, message, { status = 0, details = {} } = {}) {
    super(message);
    this.name = 'OpenBellApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class OpenBellApiClient {
  constructor({ baseUrl, token, fetchImpl = fetch } = {}) {
    if (!baseUrl) throw new TypeError('baseUrl is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async request(action, { method = 'GET', query = {}, body, token = this.token, headers = {} } = {}) {
    const url = new URL(this.baseUrl);
    url.searchParams.set('action', action);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const requestHeaders = { accept: 'application/json', ...headers };
    if (token) requestHeaders.authorization = `Bearer ${token}`;
    if (body !== undefined) requestHeaders['content-type'] = 'application/json';
    const response = await this.fetchImpl(url, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new OpenBellApiError(
      payload.error ?? 'HTTP_ERROR',
      payload.message ?? `OpenBell API returned HTTP ${response.status}`,
      { status: response.status, details: payload.details ?? {} }
    );
    return payload;
  }

  getStatus() { return this.request('status', { token: null }); }
  listTasks({ limit, cursor } = {}) { return this.request('tasks', { query: { limit, cursor } }); }
  getTask(taskId) { return this.request('task', { query: { taskId } }); }
  listNotifications({ limit = 100 } = {}) { return this.request('notifications', { query: { limit } }); }
  createTask(input, { idempotencyKey } = {}) {
    return this.request('create', { method: 'POST', body: input, headers: idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {} });
  }
  evaluateTask(taskId, observation) { return this.request('evaluate', { method: 'POST', query: { taskId }, body: { observation } }); }
  recoverTask(taskId, observation) { return this.request('recover', { method: 'POST', query: { taskId }, body: { observation } }); }
  cancelTask(taskId, reason) { return this.request('cancel', { method: 'POST', query: { taskId }, body: { reason } }); }
  settleTask(taskId, transactionProof) { return this.request('settle', { method: 'POST', query: { taskId }, body: { transactionProof } }); }
}

export function createOpenBellApiClient(options) { return new OpenBellApiClient(options); }

export async function runLiveJudgeTask({ baseUrl, idempotencyKey, fetchImpl = fetch } = {}) {
  if (!baseUrl) throw new TypeError('baseUrl is required');
  const key = idempotencyKey ?? globalThis.crypto?.randomUUID?.();
  if (!key) throw new TypeError('idempotencyKey is required when crypto.randomUUID is unavailable');
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/judge-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-idempotency-key': key },
    body: JSON.stringify({ consent: true })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new OpenBellApiError(payload.error ?? 'HTTP_ERROR', payload.message ?? `Judge Run returned HTTP ${response.status}`, { status: response.status });
  return payload;
}
