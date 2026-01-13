// Geocode AREA_NM entries in data/crowdAreas.json using Nominatim and write lat/lng back.
// Respects a small delay to avoid hammering the service.

const fs = require("fs");
const path = require("path");

const INPUT = path.join(process.cwd(), "data", "crowdAreas.json");
const DELAY_MS = 600; // delay between requests

async function main() {
  const raw = fs.readFileSync(INPUT, "utf8");
  const list = JSON.parse(raw);
  let updated = 0;

  for (const item of list) {
    if (item.lat && item.lng) continue;
    const name = item.AREA_NM || item.areaNm || item.name;
    if (!name) continue;
    try {
      const coords = await geocode(`${name} 서울`);
      if (coords) {
        item.lat = coords.lat;
        item.lng = coords.lng;
        updated += 1;
        console.log(`✓ ${name} -> ${coords.lat}, ${coords.lng}`);
      } else {
        console.warn(`⚠️ geocode failed for ${name}`);
      }
    } catch (e) {
      console.warn(`⚠️ error for ${name}: ${e.message}`);
    }
    await delay(DELAY_MS);
  }

  fs.writeFileSync(INPUT, JSON.stringify(list, null, 2), "utf8");
  console.log(`Done. Updated ${updated} entries.`);
}

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    query
  )}&format=json&limit=1&addressdetails=0`;
  const res = await fetch(url, { headers: { "User-Agent": "safe-way-app/1.0" } });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  if (data && data[0]) {
    return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
  }
  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
