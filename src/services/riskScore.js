function scoreTrend(trend) {
  if (trend === "up") return 10;
  if (trend === "down") return -10;
  return 0;
}

function classify(risk) {
  if (risk >= 61) return "red";
  if (risk >= 31) return "yellow";
  return "green";
}

function computeRisk(feature, now = new Date()) {
  if (!feature) return { risk: 0, level: "green" };
  const base = Number(feature.severity || 0);
  const trend =
    feature.meta && feature.meta.trend ? scoreTrend(feature.meta.trend) : 0;
  const hour = now.getHours();
  const timeFactor = hour >= 23 || hour < 6 ? -5 : 0;

  let incidentBias = 0;
  if (feature.type === "incident" && feature.meta?.category === "control") {
    incidentBias = 10;
  }

  const risk = Math.max(
    0,
    Math.min(100, Math.round(base + trend + timeFactor + incidentBias))
  );
  return { risk, level: classify(risk) };
}

module.exports = {
  computeRisk,
  classify
};
