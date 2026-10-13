import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from 'redis';
type RedisConnection = ReturnType<typeof createClient>;

export class RedisSupport {
  private client: RedisConnection | null = null;
  async connect(url: string): Promise<void> {
    const client = createClient({
      url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: (retries) => Math.min(100 * 2 ** Math.min(retries, 5), 3000),
      },
    });
    client.on('error', () => {
      /* Optional acceleration; durable work remains in Postgres. */
    });
    try {
      this.client = client;
      await Promise.race([client.connect(), sleep(2200)]);
      this.client = client;
    } catch {
      /* Connection retries continue while callers fall back to Postgres. */
    }
  }
  get ready(): boolean {
    return this.client?.isReady ?? false;
  }
  async get<T>(key: string): Promise<T | null> {
    if (!this.ready) return null;
    try {
      const value = await this.client!.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch {
      return null;
    }
  }
  async cache(key: string, value: unknown, seconds: number): Promise<void> {
    if (!this.ready) return;
    try {
      await this.client!.set(key, JSON.stringify(value), { EX: seconds });
    } catch {
      /* Cache miss is safe. */
    }
  }
  async notify(): Promise<void> {
    if (!this.ready) return;
    try {
      await this.client!.multi()
        .lPush('syncguard:wakeups', 'work')
        .lTrim('syncguard:wakeups', 0, 99)
        .exec();
    } catch {
      /* Workers also poll Postgres. */
    }
  }
  async wait(): Promise<void> {
    if (!this.ready) {
      await sleep(500);
      return;
    }
    try {
      await this.client!.brPop('syncguard:wakeups', 1);
    } catch {
      await sleep(500);
    }
  }
  async allow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    if (!this.ready) return true; // Rate-limit simulation degrades open, never financial guards.
    try {
      const count = await this.client!.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
        { keys: [key], arguments: [String(windowSeconds)] },
      );
      return Number(count) <= limit;
    } catch {
      return true;
    }
  }
  async close(): Promise<void> {
    if (this.client?.isOpen) this.client.destroy();
  }
}
