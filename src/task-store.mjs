import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const clone = (value) => value == null ? value : structuredClone(value);
const emptyDatabase = () => ({ storeVersion: 'openbell.store.v1', tasks: {}, notifications: [] });

export class MemoryTaskStore {
  constructor(seed = emptyDatabase()) {
    this.data = clone(seed);
  }

  async getTask(taskId) { return clone(this.data.tasks[taskId] ?? null); }
  async listTasks() { return Object.values(this.data.tasks).map(clone); }
  async putTask(task) { this.data.tasks[task.taskId] = clone(task); return clone(task); }
  async addNotification(notification) { this.data.notifications.push(clone(notification)); return clone(notification); }
  async listNotifications({ limit = 100 } = {}) { return this.data.notifications.slice(-limit).reverse().map(clone); }
}

export class JsonFileTaskStore {
  constructor(filePath) {
    if (!filePath) throw new Error('Task store path is required');
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async readDatabase() {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8'));
      return { ...emptyDatabase(), ...value, tasks: value.tasks ?? {}, notifications: value.notifications ?? [] };
    } catch (error) {
      if (error.code === 'ENOENT') return emptyDatabase();
      throw error;
    }
  }

  async update(mutator) {
    const operation = this.writeQueue.then(async () => {
      const data = await this.readDatabase();
      const result = await mutator(data);
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.filePath);
      return clone(result);
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async getTask(taskId) { return clone((await this.readDatabase()).tasks[taskId] ?? null); }
  async listTasks() { return Object.values((await this.readDatabase()).tasks).map(clone); }
  async putTask(task) { return this.update((data) => (data.tasks[task.taskId] = clone(task))); }
  async addNotification(notification) { return this.update((data) => { data.notifications.push(clone(notification)); return notification; }); }
  async listNotifications({ limit = 100 } = {}) { return (await this.readDatabase()).notifications.slice(-limit).reverse().map(clone); }
}
