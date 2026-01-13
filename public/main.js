let map = null;
let incidentLayer = null;
let crowdLayer = null;
let routeLine = null;
let userMarker = null;
let currentRoute = null;
let toastTimer = null;

const indicatorCircle = document.querySelector("#indicator .circle");
const indicatorDot = document.querySelector("#indicator .dot");
const indicatorText = document.querySelector("#indicator-text");
const summaryDot = document.querySelector("#bottom-sheet .summary .dot");
const summaryText = document.querySelector("#summary-text");

const areaLookup = {
  강남역: { lat: 37.49794, lng: 127.02762 },
  광화문: { lat: 37.57599, lng: 126.9769 },
  "광화문·덕수궁": { lat: 37.57189, lng: 126.97699 },
  홍대입구: { lat: 37.55633, lng: 126.9236 },
  명동: { lat: 37.56357, lng: 126.98265 },
  여의도: { lat: 37.52487, lng: 126.92723 },
  잠실: { lat: 37.51327, lng: 127.1025 }
};

function initMap() {
  try {
    map = L.map("map", { zoomControl: false }).setView([37.5665, 126.978], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    incidentLayer = L.layerGroup().addTo(map);
    crowdLayer = L.layerGroup().addTo(map);
  } catch (e) {
    console.error("지도 초기화 실패", e);
    indicatorText.textContent = "지도 로딩 실패";
  }
}

function levelColor(level) {
  if (level === "red") return "#f04438";
  if (level === "yellow") return "#f79009";
  return "#12b76a";
}

function updateIndicator(level, risk) {
  indicatorCircle.style.background = levelColor(level) + "22";
  indicatorDot.style.background = levelColor(level);
  indicatorText.textContent = level === "red" ? "위험" : level === "yellow" ? "주의" : "안전";
  summaryDot.style.background = levelColor(level);
  summaryText.textContent = `평균 위험도 ${risk ?? 0} (${indicatorText.textContent})`;
}

async function fetchIncidents() {
  const res = await fetch("/incidents");
  const json = await res.json();
  return json.items || [];
}

async function fetchCrowd(areaList) {
  const query = areaList && areaList.length ? `?areas=${encodeURIComponent(areaList.join(","))}` : "";
  const res = await fetch(`/crowd${query}`);
  const json = await res.json();
  return json.items || [];
}

function renderFeatures(items) {
  if (!incidentLayer || !crowdLayer) return;
  incidentLayer.clearLayers();
  crowdLayer.clearLayers();

  let maxRisk = 0;
  let sumRisk = 0;
  let count = 0;
  const latlngs = [];

  items.forEach((item) => {
    if (currentRoute && !isNearRoute(item.coords, currentRoute, 1000)) {
      // Only show items within 1km of current route
      return;
    }
    const color = levelColor(item.risk.level);
    const marker = L.circleMarker([item.coords.lat, item.coords.lng], {
      radius: item.type === "incident" ? 10 : 8,
      color,
      fillColor: color,
      fillOpacity: 0.35,
      weight: 2
    }).bindPopup(
      `<strong>${item.type === "incident" ? "돌발" : "혼잡"}</strong><br/>${item.description || ""}<br/>리스크 ${item.risk.risk} (${item.risk.level})`
    );

    latlngs.push([item.coords.lat, item.coords.lng]);

    if (item.type === "incident") {
      marker.addTo(incidentLayer);
    } else {
      marker.addTo(crowdLayer);
    }

    maxRisk = Math.max(maxRisk, item.risk.risk);
    sumRisk += item.risk.risk;
    count += 1;
  });

  const avg = count ? Math.round(sumRisk / count) : 0;
  const level = maxRisk >= 61 ? "red" : maxRisk >= 31 ? "yellow" : "green";
  updateIndicator(level, avg);

  if (map && latlngs.length) {
    map.fitBounds(latlngs, { padding: [60, 60] });
  }
}

async function loadData(areaListForCrowd) {
  try {
    const [incidents, crowd] = await Promise.all([
      fetchIncidents(),
      fetchCrowd(areaListForCrowd)
    ]);
    const merged = [...incidents, ...crowd];
    renderFeatures(merged);
    if (currentRoute) {
      const nearCount = merged.filter((i) => isNearRoute(i.coords, currentRoute, 1000)).length;
      if (nearCount === 0) {
        showToast("경로에 위험요소가 없습니다. 안전합니다.");
      }
    }
    return merged;
  } catch (err) {
    console.error("데이터 로드 실패", err);
    indicatorText.textContent = "오류";
    return [];
  }
}

async function requestRoute() {
  if (!map) return;
  const startVal = document.getElementById("start-input").value;
  const endVal = document.getElementById("end-input").value;
  const center = map.getCenter();

  const parseLatLng = (val) => {
    if (!val) return null;
    const parts = val.split(",").map((v) => Number(v.trim()));
    if (parts.length === 2 && parts.every((n) => !Number.isNaN(n))) {
      return { lat: parts[0], lng: parts[1] };
    }
    return null;
  };

  let start = parseLatLng(startVal);
  let end = parseLatLng(endVal);

  // If text 주소일 경우 지오코딩 시도
  if (!start && startVal) {
    start = await geocode(startVal);
  }
  if (!end && endVal) {
    end = await geocode(endVal);
  }
  start = start || { lat: center.lat, lng: center.lng };
  end = end || { lat: center.lat + 0.01, lng: center.lng + 0.01 };

  try {
    const res = await fetch(
      `/route?s=${start.lat},${start.lng}&e=${end.lat},${end.lng}&avoid=red`
    );
    const json = await res.json();
    if (!json.routes || !json.routes.length) throw new Error("no route geometry");

    // Derive area names near route for crowd API
    const areasFromRoute = pickAreasAlongRoute(json.routes[0].geometry);
    const hazards = await loadData(areasFromRoute);

    // Pick safest route among alternatives using hazard proximity
    const best = chooseSafestRoute(json.routes, hazards);
    currentRoute = best.geometry.map(([lng, lat]) => ({ lat, lng }));

    if (routeLine) {
      map.removeLayer(routeLine);
    }
    routeLine = L.polyline(best.geometry.map(([lng, lat]) => [lat, lng]), {
      color: "#1b76ff",
      weight: 6,
      opacity: 0.9
    }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });
  } catch (err) {
    console.error("경로 요청 실패", err);
    indicatorText.textContent = "경로 오류";
  }
}

function locateMe() {
  if (!navigator.geolocation || !map) {
    console.warn("geolocation unavailable");
    return;
  }
  const updatePosition = (pos) => {
    const { latitude, longitude } = pos.coords;
    map.setView([latitude, longitude], 15, { animate: true });
    if (userMarker) userMarker.remove();
    userMarker = L.circleMarker([latitude, longitude], {
      radius: 10,
      color: "#1b76ff",
      fillColor: "#1b76ff",
      fillOpacity: 0.6,
      weight: 2
    }).addTo(map);
    document.getElementById("start-input").value = `${latitude.toFixed(
      5
    )},${longitude.toFixed(5)}`;
  };

  navigator.geolocation.getCurrentPosition(
    updatePosition,
    (err) => {
      console.warn("geolocation error", err);
      indicatorText.textContent = "위치 권한 거부";
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );

  navigator.geolocation.watchPosition(
    updatePosition,
    (err) => console.warn("watchPosition error", err),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

document.getElementById("route-btn").addEventListener("click", requestRoute);
document.getElementById("locate-btn").addEventListener("click", locateMe);

async function geocode(query) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=0`
    );
    if (!res.ok) throw new Error("geocode failed");
    const data = await res.json();
    if (data && data[0]) {
      return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
    }
  } catch (e) {
    console.warn("geocode error", e);
  }
  return null;
}

function haversineDistance(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function isNearRoute(point, routeCoords, thresholdMeters) {
  if (!routeCoords || !routeCoords.length) return true;
  let min = Infinity;
  for (let i = 0; i < routeCoords.length; i++) {
    const d = haversineDistance(point, routeCoords[i]);
    if (d < min) min = d;
    if (min <= thresholdMeters) return true;
  }
  return min <= thresholdMeters;
}

function pickAreasAlongRoute(geometry) {
  if (!geometry || !geometry.length) return [];
  const coords = geometry.map(([lng, lat]) => ({ lat, lng }));
  const names = Object.keys(areaLookup);
  const picked = new Set();
  coords.forEach((pt) => {
    names.forEach((name) => {
      const d = haversineDistance(pt, areaLookup[name]);
      if (d <= 2000) picked.add(name);
    });
  });
  return Array.from(picked);
}

function chooseSafestRoute(routes, hazards) {
  if (!routes || !routes.length) return routes[0];
  if (!hazards || !hazards.length) return routes[0];

  const scoreRoute = (geom) => {
    const coords = geom.map(([lng, lat]) => ({ lat, lng }));
    let score = 0;
    hazards.forEach((h) => {
      const near = isNearRoute(h.coords, coords, 300);
      if (near) score += h.risk.risk;
    });
    return score;
  };

  let best = routes[0];
  let bestScore = scoreRoute(routes[0].geometry);
  for (let i = 1; i < routes.length; i++) {
    const s = scoreRoute(routes[i].geometry);
    if (s < bestScore) {
      bestScore = s;
      best = routes[i];
    }
  }
  if (best !== routes[0]) {
    showToast("혼잡/돌발을 피해 우회 경로로 안내합니다.");
  }
  return best;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}

// Init
initMap();
loadData();
setInterval(loadData, 60000);
