const express = require("express");
const cron = require("node-cron");
const pino = require("pino");
const path = require("path");
const mapRoutes = require("./routes/map");
const healthRoutes = require("./routes/health");
const errorHandler = require("./middleware/error");
const { fetchIncidents } = require("./clients/seoulIncidents");
const { fetchCrowd } = require("./clients/seoulPopulation");
const cache = require("./cache/redis");
const config = require("./config");

const logger = pino({ name: "safe-way" });
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  logger.info({ path: req.path, query: req.query }, "request");
  next();
});

app.use(express.static(path.join(__dirname, "..", "public")));
app.use(healthRoutes);
app.use(mapRoutes);
app.use(errorHandler);

// Scheduled collectors to warm cache.
cron.schedule("*/1 * * * *", async () => {
  try {
    const incidents = await fetchIncidents();
    await cache.setJson(
      "incidents:all:all",
      { data: incidents, meta: { cachedAt: Date.now() } },
      config.cache.ttlSeconds
    );
    const crowd = await fetchCrowd();
    await cache.setJson(
      "crowd:all:all",
      { data: crowd, meta: { cachedAt: Date.now() } },
      config.cache.ttlSeconds
    );
    logger.info("cache warmed");
  } catch (err) {
    logger.warn({ err }, "scheduled fetch failed");
  }
});

const port = config.port;
app.listen(port, () => {
  logger.info(`server running on :${port}`);
});
