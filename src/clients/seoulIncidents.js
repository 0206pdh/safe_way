const { XMLParser } = require("fast-xml-parser");
const proj4 = require("proj4");
const config = require("../config");

// EPSG:5186(GRS80 / TM 중부) -> WGS84
// 중앙원점 y_0=500000 사용 (GRS80 / TM 중앙)
const grs80 = "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs";
const wgs84 = "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs";
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });

function buildUrl(start, end) {
  // Prefer Seoul OpenAPI 경로 규격, fallback to legacy URL if provided.
  if (config.seoul.incidentUrl) {
    const url = new URL(config.seoul.incidentUrl);
    url.searchParams.set("apiKey", config.seoul.apiKey);
    return url.toString();
  }
  return `${config.seoul.baseUrl}/${config.seoul.apiKey}/${config.seoul.format}/${config.seoul.incidentService}/${start}/${end}`;
}

async function fetchIncidents(params = {}) {
  const start = params.start || config.seoul.defaultStart;
  const end = params.end || config.seoul.defaultEnd;
  const url = buildUrl(start, end);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`status ${res.status}`);
    if (config.seoul.format === "xml") {
      const text = await res.text();
      const xml = parser.parse(text);
      const serviceKey = Object.keys(xml || {}).find(
        (k) => Array.isArray(xml[k]?.row)
      );
      const rows =
        (serviceKey && xml[serviceKey].row) ||
        [];
      return rows.map(mapRowXml);
    }
    const json = await res.json();
    const serviceKey = Object.keys(json || {}).find(
      (k) => Array.isArray(json[k]?.row) || Array.isArray(json[k])
    );
    const rows =
      (serviceKey && (json[serviceKey].row || json[serviceKey])) ||
      json?.data ||
      [];
    return rows;
  } catch (err) {
    console.warn("[incident-client] fetch failed, returning sample data:", err.message);
    const now = Date.now();
    // Sample minimal payload to keep downstream flow working.
    return [
      {
        id: `sample-incident-${now}`,
        category: "roadwork",
        message: "샘플: 공사 주의",
        lat: 37.5665,
        lng: 126.978,
        lanesClosed: 1,
        startedAt: new Date(now - 5 * 60 * 1000).toISOString()
      }
    ];
  }
}

function mapRowXml(row) {
  // Row fields (example): acc_id, acc_type, grs80tm_x, grs80tm_y, acc_info, occr_date, occr_time
  const [lng, lat] =
    row.grs80tm_x && row.grs80tm_y
      ? proj4(grs80, wgs84, [Number(row.grs80tm_x), Number(row.grs80tm_y)])
      : [126.978, 37.5665];
  return {
    id: row.acc_id,
    category: row.acc_type || "A",
    message: row.acc_info || "",
    lat,
    lng,
    startedAt: toIso(row.occr_date, row.occr_time),
    meta: {
      expClearAt: toIso(row.exp_clr_date, row.exp_clr_time),
      linkId: row.link_id,
      roadCode: row.acc_road_code
    }
  };
}

function toIso(dateStr, timeStr) {
  if (!dateStr) return new Date().toISOString();
  const d = `${dateStr}`.padEnd(8, "0");
  const t = `${timeStr || ""}`.padEnd(6, "0");
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(
    0,
    2
  )}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
  return iso;
}

module.exports = {
  fetchIncidents
};
