import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(this.prefixKey(key));
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      const prefixedKey = this.prefixKey(key);

      if (ttlSeconds) {
        await this.redis.setex(prefixedKey, ttlSeconds, serialized);
      } else {
        await this.redis.set(prefixedKey, serialized);
      }
    } catch (error) {
      this.logger.error(`Cache set error for key ${key}:`, error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(this.prefixKey(key));
    } catch (error) {
      this.logger.error(`Cache del error for key ${key}:`, error);
    }
  }

  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(this.prefixKey(pattern));
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      this.logger.error(`Cache delPattern error for ${pattern}:`, error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(this.prefixKey(key));
      return result === 1;
    } catch {
      return false;
    }
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds?: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async incr(key: string, by: number = 1): Promise<number> {
    try {
      return await this.redis.incrby(this.prefixKey(key), by);
    } catch {
      return 0;
    }
  }

  async expire(key: string, seconds: number): Promise<void> {
    try {
      await this.redis.expire(this.prefixKey(key), seconds);
    } catch (error) {
      this.logger.error(`Cache expire error for ${key}:`, error);
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(this.prefixKey(key));
    } catch {
      return -1;
    }
  }

  async hset(key: string, field: string, value: any): Promise<void> {
    try {
      await this.redis.hset(this.prefixKey(key), field, JSON.stringify(value));
    } catch (error) {
      this.logger.error(`Cache hset error for ${key}:${field}:`, error);
    }
  }

  async hget<T>(key: string, field: string): Promise<T | null> {
    try {
      const value = await this.redis.hget(this.prefixKey(key), field);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async hgetall(key: string): Promise<Record<string, any>> {
    try {
      const data = await this.redis.hgetall(this.prefixKey(key));
      const result: Record<string, any> = {};
      for (const [field, value] of Object.entries(data)) {
        try {
          result[field] = JSON.parse(value);
        } catch {
          result[field] = value;
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  async sadd(key: string, ...members: string[]): Promise<void> {
    try {
      await this.redis.sadd(this.prefixKey(key), ...members);
    } catch (error) {
      this.logger.error(`Cache sadd error for ${key}:`, error);
    }
  }

  async smembers(key: string): Promise<string[]> {
    try {
      return await this.redis.smembers(this.prefixKey(key));
    } catch {
      return [];
    }
  }

  async acquireLock(lockKey: string, ttlSeconds: number = 30): Promise<boolean> {
    try {
      const prefixed = `lock:${this.prefixKey(lockKey)}`;
      const result = await this.redis.set(prefixed, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch {
      return false;
    }
  }

  async releaseLock(lockKey: string): Promise<void> {
    try {
      await this.redis.del(`lock:${this.prefixKey(lockKey)}`);
    } catch {}
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  private prefixKey(key: string): string {
    return `autoblog:${key}`;
  }
}
