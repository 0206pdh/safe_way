const Redis = require("ioredis");
const config = require("../config");

const memoryStore = new Map();
let redis = null;

function initRedis() {
  if (redis || process.env.DISABLE_REDIS === "1") {
    return null;
  }
  try {
    redis = new Redis(config.cache.redisUrl, { lazyConnect: true });
    redis.on("error", (err) => {
      console.warn("[redis] error, using memory fallback:", err.message);
    });
    redis.connect().catch((err) => {
      console.warn("[redis] connect failed, using memory fallback:", err.message);
      redis = null;
    });
    return redis;
  } catch (err) {
    console.warn("[redis] init failed, using memory fallback:", err.message);
    redis = null;
    return null;
  }
}

initRedis();

async function getJson(key) {
  if (redis) {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  }
  const entry = memoryStore.get(key);
  return entry ? entry.value : null;
}

async function setJson(key, value, ttlSeconds) {
  if (redis) {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    return;
  }
  memoryStore.set(key, {
    value,
    expireAt: Date.now() + ttlSeconds * 1000
  });
}

async function getOrSetJson(key, fetcher, { ttlSeconds, staleSeconds }) {
  const now = Date.now();
  const cached = await getJson(key);
  if (cached && cached.meta && cached.meta.cachedAt) {
    const age = now - cached.meta.cachedAt;
    if (age <= ttlSeconds * 1000) {
      return { data: cached.data, stale: false };
    }
    if (age <= staleSeconds * 1000) {
      // Serve stale data, trigger refresh in background.
      refreshInBackground(key, fetcher, ttlSeconds);
      return { data: cached.data, stale: true };
    }
  }

  const data = await fetcher();
  const payload = { data, meta: { cachedAt: Date.now() } };
  await setJson(key, payload, ttlSeconds);
  return { data, stale: false };
}

function refreshInBackground(key, fetcher, ttlSeconds) {
  fetcher()
    .then((data) =>
      setJson(key, { data, meta: { cachedAt: Date.now() } }, ttlSeconds)
    )
    .catch((err) => console.warn("[cache] background refresh failed", err.message));
}

module.exports = {
  getJson,
  setJson,
  getOrSetJson
};
