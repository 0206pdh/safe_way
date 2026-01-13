function levelToSeverity(level) {
  const map = {
    여유: 20,
    보통: 40,
    "약간 붐빔": 60,
    붐빔: 80
  };
  return map[level] ?? 30;
}

function normalizeCrowd(item) {
  if (!item) return null;

  // citydata_ppltn 케이스: AREA_NM 등 사용
  const areaName = item.areaNm || item.AREA_NM || item.area_name;
  const level =
    item.areaCongestLvl ||
    item.AREA_CONGEST_LVL ||
    item.level ||
    item.status;
  const density =
    item.density ??
    item.crowdLevel ??
    (item.ppltnMax && item.ppltnMin
      ? (Number(item.ppltnMax) + Number(item.ppltnMin)) / 2
      : 0);
  const lat = Number(item.lat ?? item.latitude);
  const lng = Number(item.lng ?? item.longitude);

  return {
    id: String(item.id ?? item.areaCd ?? item.AREA_CD ?? Date.now()),
    source: "seoul_crowd",
    type: "crowd",
    coords: { lat, lng },
    district: areaName || item.district || "",
    ts: item.updatedAt || item.timestamp || item.PPLTN_TIME || new Date().toISOString(),
    severity: levelToSeverity(level),
    description: `${areaName || "인구"} ${level || ""}`.trim(),
    meta: {
      density,
      level,
      msg: item.areaCongestMsg || item.AREA_CONGEST_MSG,
      ppltnMin: item.ppltnMin ?? item.AREA_PPLTN_MIN,
      ppltnMax: item.ppltnMax ?? item.AREA_PPLTN_MAX,
      trend: item.trend || "flat",
      raw: item
    }
  };
}

module.exports = {
  normalizeCrowd
};
