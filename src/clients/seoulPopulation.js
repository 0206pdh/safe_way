const { XMLParser } = require("fast-xml-parser");
const fs = require("fs");
const path = require("path");
const config = require("../config");

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
const geocodeCache = new Map();
let areaCoordMap = loadAreaCoordMap();

function buildUrl(areaName) {
  const type = config.seoul.format || "json";
  const area = encodeURIComponent(areaName || config.seoul.crowdArea || "");
  return `${config.seoul.baseUrl}/${config.seoul.apiKey}/${type}/citydata_ppltn/1/5/${area}`;
}

async function fetchCrowd(params = {}) {
  const areaList = resolveAreas(params);

  try {
    const results = await fetchAreasWithLimit(areaList, 5);

    const rows = results.filter(Boolean);
    if (!rows.length) throw new Error("empty crowd response");
    return rows;
  } catch (err) {
    console.warn("[crowd-client] fetch failed, returning sample data:", err.message);
    const now = Date.now();
    return [
      {
        id: `sample-crowd-${now}`,
        density: 0.62,
        status: "busy",
        areaNm: (areaList && areaList[0]) || "강남역",
        lat: 37.49794,
        lng: 127.02762,
        updatedAt: new Date(now - 2 * 60 * 1000).toISOString(),
        trend: "up"
      }
    ];
  }
}

function resolveAreas(params) {
  if (params.areas && Array.isArray(params.areas)) return params.areas.filter(Boolean);
  if (typeof params.area === "string") return [params.area];
  if (params.area && Array.isArray(params.area)) return params.area.filter(Boolean);
  if (config.seoul.crowdAreas && config.seoul.crowdAreas.length) {
    return config.seoul.crowdAreas;
  }
  if (config.seoul.crowdAreaFile) {
    try {
      const p = path.isAbsolute(config.seoul.crowdAreaFile)
        ? config.seoul.crowdAreaFile
        : path.join(process.cwd(), config.seoul.crowdAreaFile);
      const raw = fs.readFileSync(p, "utf8");
      const json = JSON.parse(raw);
      if (Array.isArray(json)) {
        // can be array of strings or objects with AREA_NM
        return json
          .map((item) => (typeof item === "string" ? item : item.AREA_NM || item.areaNm))
          .filter(Boolean);
      }
    } catch (e) {
      console.warn("[crowd-client] failed to read area file", e.message);
    }
  }
  return [config.seoul.crowdArea].filter(Boolean);
}

async function fetchAreasWithLimit(areaList, limit = 5) {
  const results = [];
  const queue = [...areaList];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, () =>
    worker(queue, results)
  );
  await Promise.all(workers);
  return results;

  async function worker(q, out) {
    while (q.length) {
      const areaName = q.shift();
      const url = buildUrl(areaName);
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`status ${res.status} body:${body.slice(0, 200)}`);
        }
        if (config.seoul.format === "xml") {
          const text = await res.text();
          const xml = parser.parse(text);
          const rootKey = Object.keys(xml || {}).find((k) =>
            k.toLowerCase().includes("citydata_ppltn")
          );
          const payload = rootKey ? xml[rootKey] : null;
          const mapped = payload ? await mapRowXml(payload) : null;
          out.push(mapped);
        } else {
          const json = await res.json();
          const debugRaw =
            process.env.DEBUG_CROWD === "1"
              ? JSON.stringify(json).slice(0, 500)
              : null;
          if (debugRaw) console.log("[crowd raw]", areaName, debugRaw);
          const serviceKey = Object.keys(json || {}).find((k) =>
            k.toLowerCase().includes("citydata_ppltn")
          );
          const container = serviceKey ? json[serviceKey] : null;
          const code = container?.RESULT?.CODE || container?.RESULT?.["RESULT.CODE"];
          const message =
            container?.RESULT?.MESSAGE || container?.RESULT?.["RESULT.MESSAGE"];
          if (code && code !== "INFO-000") {
            throw new Error(`API code ${code} msg:${message || ""}`);
          }
          const row = Array.isArray(container?.row) ? container.row[0] : null;
          const mapped = row ? await mapRowXml(row) : null;
          out.push(mapped);
        }
      } catch (e) {
        console.warn("[crowd-client] fetch area failed", areaName, url, e.message);
      }
    }
  }
}

async function mapRowXml(row) {
  if (!row) return null;
  const name = row.AREA_NM;
  let coords = lookupCoords(name);
  if (!coords) {
    coords = await geocodeArea(name);
  }
  return {
    areaNm: name,
    areaCongestLvl: row.AREA_CONGEST_LVL,
    areaCongestMsg: row.AREA_CONGEST_MSG,
    ppltnMin: Number(row.AREA_PPLTN_MIN),
    ppltnMax: Number(row.AREA_PPLTN_MAX),
    maleRate: Number(row.MALE_PPLTN_RATE),
    femaleRate: Number(row.FEMALE_PPLTN_RATE),
    updatedAt: row.PPLTN_TIME,
    fcst: row.FCST_PPLTN?.FCST_PPLTN || [],
    lat: coords.lat,
    lng: coords.lng
  };
}

function lookupCoords(areaName = "") {
  if (!areaName) return null;
  if (areaCoordMap[areaName]) return areaCoordMap[areaName];
  // Partial matches (e.g., "강남 MICE 관광특구" -> "강남")
  const keys = Object.keys(areaCoordMap);
  const hit = keys.find((k) => areaName.includes(k) || k.includes(areaName));
  if (hit) return areaCoordMap[hit];
  return null;
}

async function geocodeArea(areaName) {
  if (!areaName) return { lat: 37.5665, lng: 126.978 };
  if (geocodeCache.has(areaName)) return geocodeCache.get(areaName);
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(areaName)}&format=json&limit=1&addressdetails=0`;
    const res = await fetch(url, { headers: { "User-Agent": "safe-way-app" } });
    if (!res.ok) throw new Error(`geocode status ${res.status}`);
    const data = await res.json();
    if (data && data[0]) {
      const coords = { lat: Number(data[0].lat), lng: Number(data[0].lon) };
      geocodeCache.set(areaName, coords);
      areaCoordMap[areaName] = coords;
      return coords;
    }
  } catch (e) {
    console.warn("[crowd-client] geocode failed", areaName, e.message);
  }
  return { lat: 37.5665, lng: 126.978 };
}

function loadAreaCoordMap() {
  const map = {};
  const file = config.seoul.crowdAreaFile;
  if (!file) return map;
  try {
    const p = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
    const raw = fs.readFileSync(p, "utf8");
    const json = JSON.parse(raw);
    if (Array.isArray(json)) {
      json.forEach((item) => {
        const name = item.AREA_NM || item.areaNm || item.name;
        if (!name) return;
        if (item.lat && item.lng) {
          map[name] = { lat: Number(item.lat), lng: Number(item.lng) };
        }
      });
    }
  } catch (e) {
    console.warn("[crowd-client] failed to load area coords", e.message);
  }
  return map;
}

module.exports = {
  fetchCrowd
};
