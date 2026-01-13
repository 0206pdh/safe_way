const express = require("express");
const { fetchIncidents } = require("../clients/seoulIncidents");
const { fetchCrowd } = require("../clients/seoulPopulation");
const cache = require("../cache/redis");
const config = require("../config");
const { mergeFeeds, summarizeByDistrict } = require("../services/mergeFeeds");

const router = express.Router();
const ttl = config.cache.ttlSeconds;
const stale = config.cache.staleSeconds;

async function getIncidentFeed(query) {
  const key = `incidents:${query.district || "all"}:${query.bbox || "all"}`;
  const { data, stale: isStale } = await cache.getOrSetJson(
    key,
    () => fetchIncidents(query),
    { ttlSeconds: ttl, staleSeconds: stale }
  );
  return { data, isStale };
}

async function getCrowdFeed(query) {
  const areaList =
    (typeof query.areas === "string"
      ? query.areas.split(",").map((s) => s.trim()).filter(Boolean)
      : []) || [];
  const areaKey = areaList.length
    ? areaList.join("-")
    : (config.seoul.crowdAreas && config.seoul.crowdAreas.join("-")) ||
      config.seoul.crowdArea ||
      "all";
  const key = `crowd:${areaKey}`;
  const { data, stale: isStale } = await cache.getOrSetJson(
    key,
    () =>
      fetchCrowd({
        areas:
          areaList.length > 0
            ? areaList
            : config.seoul.crowdAreas.length
              ? config.seoul.crowdAreas
              : [config.seoul.crowdArea]
      }),
    { ttlSeconds: ttl, staleSeconds: stale }
  );
  return { data, isStale };
}

router.get("/incidents", async (req, res, next) => {
  try {
    const { data, isStale } = await getIncidentFeed(req.query);
    const merged = mergeFeeds({ incidents: data, crowd: [] });
    res.set("Cache-Control", "public, max-age=30");
    res.json({ stale: isStale, count: merged.length, items: merged });
  } catch (err) {
    next(err);
  }
});

router.get("/crowd", async (req, res, next) => {
  try {
    const { data, isStale } = await getCrowdFeed(req.query);
    const merged = mergeFeeds({ incidents: [], crowd: data });
    res.set("Cache-Control", "public, max-age=30");
    res.json({ stale: isStale, count: merged.length, items: merged });
  } catch (err) {
    next(err);
  }
});

router.get("/areas/:district/risk", async (req, res, next) => {
  try {
    const [incidents, crowd] = await Promise.all([
      getIncidentFeed({ district: req.params.district }),
      getCrowdFeed({ district: req.params.district })
    ]);
    const merged = mergeFeeds({
      incidents: incidents.data,
      crowd: crowd.data
    });
    const summary = summarizeByDistrict(merged);
    const data = summary[req.params.district] || {
      count: 0,
      maxRisk: 0,
      avgRisk: 0,
      levels: { green: 0, yellow: 0, red: 0 }
    };
    res.json({
      district: req.params.district,
      stale: incidents.isStale || crowd.isStale,
      ...data
    });
  } catch (err) {
    next(err);
  }
});

router.get("/tiles/risk/:z/:x/:y", async (req, res, next) => {
  try {
    // For now return full feature collection (no tile slicing to keep stub simple).
    const [incidents, crowd] = await Promise.all([
      getIncidentFeed({}),
      getCrowdFeed({})
    ]);
    const merged = mergeFeeds({
      incidents: incidents.data,
      crowd: crowd.data
    }).map(toGeoJSONFeature);
    res.json({
      tile: {
        z: Number(req.params.z),
        x: Number(req.params.x),
        y: Number(req.params.y)
      },
      stale: incidents.isStale || crowd.isStale,
      type: "FeatureCollection",
      features: merged
    });
  } catch (err) {
    next(err);
  }
});

router.get("/route", async (req, res, next) => {
  try {
    const { s, e, avoid = "red" } = req.query;
    if (!s || !e) {
      return res.status(400).json({ error: "query params s and e are required" });
    }
    const [startLat, startLng] = s.split(",").map(Number);
    const [endLat, endLng] = e.split(",").map(Number);
    const route = await fetchOsrmRoute(startLat, startLng, endLat, endLng);
    res.json({ ...route, avoided: avoid });
  } catch (err) {
    next(err);
  }
});

async function fetchOsrmRoute(startLat, startLng, endLat, endLng) {
  const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&alternatives=true&steps=false`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`route failed status ${res.status}`);
  }
  const json = await res.json();
  if (!json.routes || !json.routes[0]) {
    throw new Error("route not found");
  }
  return {
    routes: json.routes.map((r) => ({
      geometry: r.geometry.coordinates, // [lng, lat]
      summary: {
        distanceMeters: Math.round(r.distance),
        durationSeconds: Math.round(r.duration)
      }
    }))
  };
}

function toGeoJSONFeature(f) {
  return {
    type: "Feature",
    id: f.id,
    properties: {
      type: f.type,
      source: f.source,
      risk: f.risk.risk,
      level: f.risk.level,
      description: f.description
    },
    geometry: {
      type: "Point",
      coordinates: [f.coords.lng, f.coords.lat]
    }
  };
}

module.exports = router;
