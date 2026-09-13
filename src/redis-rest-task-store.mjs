const clone = (value) => value == null ? value : structuredClone(value);

export class RedisRestError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RedisRestError';
    this.code = code;
    this.details = details;
  }
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export class RedisRestTaskStore {
  constructor({ url, token, namespace = 'openbell:v1', fetchImpl = fetch } = {}) {
    if (!url || !token) throw new RedisRestError('PERSISTENCE_NOT_CONFIGURED', 'Redis REST URL and token are required');
    this.url = url.replace(/\/$/, '');
    this.token = token;
    this.namespace = namespace;
    this.fetchImpl = fetchImpl;
  }

  taskKey(taskId) { return `${this.namespace}:task:${taskId}`; }
  get taskIndexKey() { return `${this.namespace}:task-index`; }
  get notificationKey() { return `${this.namespace}:notifications`; }

  async command(command) {
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        'user-agent': 'openbell-solana/0.3'
      },
      body: JSON.stringify(command)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      throw new RedisRestError('PERSISTENCE_UNAVAILABLE', payload.error ?? `Redis REST request failed with HTTP ${response.status}`);
    }
    return payload.result;
  }

  async pipeline(commands) {
    const response = await this.fetchImpl(`${this.url}/pipeline`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        'user-agent': 'openbell-solana/0.3'
      },
      body: JSON.stringify(commands)
    });
    const payload = await response.json().catch(() => []);
    const failure = Array.isArray(payload) ? payload.find((entry) => entry?.error) : null;
    if (!response.ok || !Array.isArray(payload) || failure) {
      throw new RedisRestError('PERSISTENCE_UNAVAILABLE', failure?.error ?? `Redis REST pipeline failed with HTTP ${response.status}`);
    }
    return payload.map((entry) => entry.result);
  }

  async transaction(commands) {
    const response = await this.fetchImpl(`${this.url}/multi-exec`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        'user-agent': 'openbell-solana/0.3'
      },
      body: JSON.stringify(commands)
    });
    const payload = await response.json().catch(() => ({}));
    const failure = Array.isArray(payload) ? payload.find((entry) => entry?.error) : payload?.error ? payload : null;
    if (!response.ok || !Array.isArray(payload) || failure) {
      throw new RedisRestError('PERSISTENCE_UNAVAILABLE', failure?.error ?? `Redis REST transaction failed with HTTP ${response.status}`);
    }
    return payload.map((entry) => entry.result);
  }

  async getTask(taskId) {
    return clone(parseJson(await this.command(['GET', this.taskKey(taskId)])));
  }

  async listTasks() {
    const taskIds = await this.command(['SMEMBERS', this.taskIndexKey]);
    if (!Array.isArray(taskIds) || taskIds.length === 0) return [];
    const values = await this.command(['MGET', ...taskIds.map((taskId) => this.taskKey(taskId))]);
    return values.map((value) => parseJson(value)).filter(Boolean).map(clone);
  }

  async putTask(task) {
    await this.transaction([
      ['SET', this.taskKey(task.taskId), JSON.stringify(task)],
      ['SADD', this.taskIndexKey, task.taskId]
    ]);
    return clone(task);
  }

  async addNotification(notification) {
    await this.transaction([
      ['LPUSH', this.notificationKey, JSON.stringify(notification)],
      ['LTRIM', this.notificationKey, '0', '999']
    ]);
    return clone(notification);
  }

  async listNotifications({ limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const values = await this.command(['LRANGE', this.notificationKey, '0', String(safeLimit - 1)]);
    return (Array.isArray(values) ? values : []).map((value) => parseJson(value)).filter(Boolean).map(clone);
  }
}

export function createRedisRestTaskStoreFromEnv(env = process.env, options = {}) {
  const url = env.OPENBELL_REDIS_REST_URL ?? env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.OPENBELL_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new RedisRestTaskStore({ url, token, namespace: env.OPENBELL_REDIS_NAMESPACE ?? 'openbell:v1', ...options });
}
