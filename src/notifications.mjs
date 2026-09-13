import { createHmac } from 'node:crypto';

export class NotificationCenter {
  constructor(adapters = []) {
    this.adapters = adapters;
  }

  async publish(notification) {
    const deliveries = await Promise.allSettled(this.adapters.map((adapter) => adapter.deliver(notification)));
    return deliveries.map((delivery, index) => ({
      adapter: this.adapters[index]?.name ?? `adapter-${index}`,
      delivered: delivery.status === 'fulfilled',
      error: delivery.status === 'rejected' ? delivery.reason?.message ?? String(delivery.reason) : null
    }));
  }
}

export class ConsoleNotifier {
  constructor({ logger = console } = {}) { this.name = 'console'; this.logger = logger; }
  async deliver(notification) { this.logger.info('[openbell:notification]', JSON.stringify(notification)); }
}

export class WebhookNotifier {
  constructor({ url, secret, fetchImpl = fetch } = {}) {
    if (!url) throw new Error('Webhook URL is required');
    this.name = 'webhook';
    this.url = url;
    this.secret = secret;
    this.fetchImpl = fetchImpl;
  }

  async deliver(notification) {
    const body = JSON.stringify(notification);
    const headers = { 'content-type': 'application/json', 'user-agent': 'openbell-webhook/1.0' };
    if (this.secret) headers['x-openbell-signature'] = createHmac('sha256', this.secret).update(body).digest('hex');
    const response = await this.fetchImpl(this.url, { method: 'POST', headers, body });
    if (!response.ok) throw new Error(`Webhook delivery failed with HTTP ${response.status}`);
  }
}
