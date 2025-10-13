// Updated: 2024-13-10
// by: DatNB

const redis = require('redis');
const config = require('./index');

class RedisClient {
    constructor() {
        this.client = null;
        this.isConnected = false;
    }

    async connect() {
        if (this.isConnected) {
            return this.client;
        }

        try {
            this.client = redis.createClient({
                socket: {
                    host: config.redis.host || 'localhost',
                    port: config.redis.port || 6379,
                    connectTimeout: 10000,
                    reconnectStrategy: (retries) => {
                        if (retries > 10) {
                            console.error('Redis: Too many reconnection attempts');
                            return new Error('Too many reconnection attempts');
                        }
                        // Exponential backoff: 50ms * 2^retries
                        return Math.min(retries * 50, 3000);
                    }
                },
                password: config.redis.password || undefined,
                database: config.redis.db || 0
            });

            // Event listeners
            this.client.on('connect', () => {
                console.log('Redis: Connecting...');
            });

            this.client.on('ready', () => {
                console.log('Redis: Connected and ready');
                this.isConnected = true;
            });

            this.client.on('error', (err) => {
                console.error('Redis Error:', err.message);
                this.isConnected = false;
            });

            this.client.on('reconnecting', () => {
                console.log('Redis: Reconnecting...');
            });

            this.client.on('end', () => {
                console.log('Redis: Connection closed');
                this.isConnected = false;
            });

            await this.client.connect();
            return this.client;
        } catch (error) {
            console.error('Redis: Failed to connect:', error.message);
            throw error;
        }
    }

    getClient() {
        if (!this.client || !this.isConnected) {
            throw new Error('Redis client is not connected');
        }
        return this.client;
    }

    // Wrapper methods for common operations
    async get(key) {
        const client = this.getClient();
        return await client.get(key);
    }

    async set(key, value, expiryInSeconds = null) {
        const client = this.getClient();
        if (expiryInSeconds) {
            return await client.setEx(key, expiryInSeconds, value);
        }
        return await client.set(key, value);
    }

    async setex(key, seconds, value) {
        const client = this.getClient();
        return await client.setEx(key, seconds, value);
    }

    async del(key) {
        const client = this.getClient();
        return await client.del(key);
    }

    async exists(key) {
        const client = this.getClient();
        return await client.exists(key);
    }

    async expire(key, seconds) {
        const client = this.getClient();
        return await client.expire(key, seconds);
    }

    async ttl(key) {
        const client = this.getClient();
        return await client.ttl(key);
    }

    async incr(key) {
        const client = this.getClient();
        return await client.incr(key);
    }

    async decr(key) {
        const client = this.getClient();
        return await client.decr(key);
    }

    async hSet(key, field, value) {
        const client = this.getClient();
        return await client.hSet(key, field, value);
    }

    async hGet(key, field) {
        const client = this.getClient();
        return await client.hGet(key, field);
    }

    async hGetAll(key) {
        const client = this.getClient();
        return await client.hGetAll(key);
    }

    async hDel(key, field) {
        const client = this.getClient();
        return await client.hDel(key, field);
    }

    async keys(pattern) {
        const client = this.getClient();
        return await client.keys(pattern);
    }

    async flushAll() {
        const client = this.getClient();
        return await client.flushAll();
    }

    async disconnect() {
        if (this.client && this.isConnected) {
            await this.client.quit();
            this.isConnected = false;
            console.log('Redis: Disconnected gracefully');
        }
    }

    async ping() {
        try {
            const client = this.getClient();
            const result = await client.ping();
            return result === 'PONG';
        } catch (error) {
            return false;
        }
    }
}

// Export singleton instance
const redisClient = new RedisClient();

module.exports = redisClient;