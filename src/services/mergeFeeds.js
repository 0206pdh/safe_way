const { normalizeIncident } = require("../normalizers/incident");
const { normalizeCrowd } = require("../normalizers/population");
const { computeRisk } = require("./riskScore");

function mergeFeeds({ incidents = [], crowd = [] }) {
  const incidentFeatures = incidents
    .map(normalizeIncident)
    .filter(Boolean)
    .map((f) => ({ ...f, risk: computeRisk(f) }));

  const crowdFeatures = crowd
    .map(normalizeCrowd)
    .filter(Boolean)
    .map((f) => ({ ...f, risk: computeRisk(f) }));

  return [...incidentFeatures, ...crowdFeatures];
}

function summarizeByDistrict(features) {
  const summary = {};
  features.forEach((f) => {
    if (!f.district) return;
    if (!summary[f.district]) {
      summary[f.district] = {
        count: 0,
        maxRisk: 0,
        avgRisk: 0,
        levels: { red: 0, yellow: 0, green: 0 }
      };
    }
    const district = summary[f.district];
    district.count += 1;
    district.maxRisk = Math.max(district.maxRisk, f.risk.risk);
    district.avgRisk += f.risk.risk;
    district.levels[f.risk.level] = (district.levels[f.risk.level] || 0) + 1;
  });

  Object.keys(summary).forEach((key) => {
    summary[key].avgRisk = Math.round(summary[key].avgRisk / summary[key].count);
  });

  return summary;
}

module.exports = {
  mergeFeeds,
  summarizeByDistrict
};
