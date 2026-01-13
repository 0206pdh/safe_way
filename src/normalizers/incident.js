const severityByCategory = {
  accident: 80,
  roadwork: 60,
  control: 90,
  caution: 40,
  // AccInfo acc_type codes: A01 사고, A04 공사/통제, A09 기상/결빙, A10 행사, A11 기타
  A01: 85, // 사고
  A04: 60, // 공사/전면 통제
  A09: 70, // 기상/결빙
  A10: 40, // 행사
  A11: 50, // 기타
  default: 50
};

function normalizeIncident(item) {
  if (!item) return null;
  const rawCat =
    item.category ||
    item.acc_type ||
    item.accType ||
    item.ACC_TYPE;
  const severity =
    severityByCategory[rawCat] ||
    severityByCategory[rawCat?.toLowerCase?.()] ||
    severityByCategory.default;

  return {
    id: String(item.id ?? item.incidentId ?? Date.now()),
    source: "seoul_incident",
    type: "incident",
    coords: {
      lat: Number(item.lat ?? item.latitude),
      lng: Number(item.lng ?? item.longitude)
    },
    district: item.district || item.addr || "",
    ts: item.startedAt || item.timestamp || new Date().toISOString(),
    severity,
    description: item.message || item.title || "incident",
    meta: {
      category: rawCat,
      lanesClosed: item.lanesClosed,
      raw: item
    }
  };
}

module.exports = {
  normalizeIncident
};
