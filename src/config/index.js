require("dotenv").config();

const config = {
  port: process.env.PORT || 3000,
  seoul: {
    // 서울 열린데이터 OpenAPI 기본 형식: {base}/{apiKey}/{format}/{service}/{start}/{end}
    baseUrl: process.env.SEOUL_BASE_URL || "http://openapi.seoul.go.kr:8088",
    apiKey:
      process.env.SEOUL_API_KEY ||
      process.env.SEOUL_INCIDENT_KEY ||
      process.env.SEOUL_CROWD_KEY ||
      "CHANGE_ME",
    format: process.env.SEOUL_FORMAT || "json",
    incidentService:
      process.env.SEOUL_INCIDENT_SERVICE || "YOUR_INCIDENT_SERVICE_NAME",
    crowdService:
      process.env.SEOUL_CROWD_SERVICE || "YOUR_CROWD_SERVICE_NAME",
    crowdArea: process.env.SEOUL_CROWD_AREA || "",
    crowdAreas: process.env.SEOUL_CROWD_AREAS
      ? process.env.SEOUL_CROWD_AREAS.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    crowdAreaFile: process.env.SEOUL_CROWD_AREA_FILE || null,
    // fallback legacy URL if 특정 API가 경로 방식이 아닐 경우에만 사용
    incidentUrl: process.env.SEOUL_INCIDENT_URL || null,
    crowdUrl: process.env.SEOUL_CROWD_URL || null,
    defaultStart: Number(process.env.SEOUL_DEFAULT_START || 1),
    defaultEnd: Number(process.env.SEOUL_DEFAULT_END || 200)
  },
  cache: {
    redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
    ttlSeconds: Number(process.env.CACHE_TTL_SECONDS || 90),
    staleSeconds: Number(process.env.CACHE_STALE_SECONDS || 120)
  }
};

module.exports = config;
