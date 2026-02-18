const API = `${location.protocol}//${location.hostname}:8088`;

const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refresh');
const randomBtn = document.getElementById('random');

const layerMcd = document.getElementById('layer-mcd');
const layerStar = document.getElementById('layer-starbucks');
const layerDG = document.getElementById('layer-dg');
const layerQuakes = document.getElementById('layer-quakes');

const qHours = document.getElementById('q-hours');
const qMinMag = document.getElementById('q-minmag');

const map = L.map('map', { zoomSnap: 0.25 }).setView([39.5, -98.35], 4);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

const clusters = {
  mcd: L.markerClusterGroup(),
  starbucks: L.markerClusterGroup(),
  dg: L.markerClusterGroup(),
  quakes: L.markerClusterGroup(),
};

function setStatus(msg){ statusEl.textContent = msg; }

function getBBox(){
  const b = map.getBounds();
  const s = b.getSouth().toFixed(5);
  const w = b.getWest().toFixed(5);
  const n = b.getNorth().toFixed(5);
  const e = b.getEast().toFixed(5);
  return `${s},${w},${n},${e}`;
}

function clearLayer(key){
  clusters[key].clearLayers();
  if (map.hasLayer(clusters[key])) map.removeLayer(clusters[key]);
}

function ensureLayer(key){
  if (!map.hasLayer(clusters[key])) map.addLayer(clusters[key]);
}

async function fetchJSON(url){
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function addGeoJSONPointsToCluster(gj, clusterKey, popupFn){
  (gj.features || []).forEach(f => {
    if (!f.geometry || f.geometry.type !== 'Point') return;
    const [lon, lat] = f.geometry.coordinates;
    const m = L.marker([lat, lon]);
    if (popupFn) m.bindPopup(popupFn(f));
    clusters[clusterKey].addLayer(m);
  });
}

async function loadBrand(brand, clusterKey){
  const bbox = getBBox();
  setStatus(`Loading ${brand}...`);
  const gj = await fetchJSON(`${API}/api/osm/brand?brand=${brand}&bbox=${bbox}`);
  addGeoJSONPointsToCluster(gj, clusterKey, (f) => {
    const name = f.properties?.name || 'Unknown';
    return `<b>${name}</b><br><small>${f.properties?.id || ''}</small>`;
  });
  ensureLayer(clusterKey);
  setStatus(`Loaded ${brand}: ${gj.features?.length || 0}`);
}

async function loadQuakes(){
  const bbox = getBBox();
  const hours = Number(qHours.value || 24);
  const minmag = Number(qMinMag.value || 2.5);

  setStatus(`Loading earthquakes...`);
  const gj = await fetchJSON(`${API}/api/usgs/quakes?hours=${hours}&minmag=${minmag}&bbox=${bbox}`);

  (gj.features || []).forEach(f => {
    const c = f.geometry?.coordinates;
    if (!c) return;
    const [lon, lat] = c;
    const mag = f.properties?.mag ?? '?';
    const place = f.properties?.place ?? '';
    const time = f.properties?.time ? new Date(f.properties.time).toLocaleString() : '';

    const m = L.circleMarker([lat, lon], {
      radius: Math.max(4, Math.min(16, (mag * 2))),
      weight: 1,
      fillOpacity: 0.6
    }).bindPopup(`<b>M ${mag}</b><br>${place}<br><small>${time}</small>`);

    clusters.quakes.addLayer(m);
  });

  ensureLayer('quakes');
  setStatus(`Loaded earthquakes: ${gj.features?.length || 0}`);
}

async function refresh(){
  // clear selected layers then reload
  if (!layerMcd.checked) clearLayer('mcd');
  if (!layerStar.checked) clearLayer('starbucks');
  if (!layerDG.checked) clearLayer('dg');
  if (!layerQuakes.checked) clearLayer('quakes');

  // load selected layers
  try{
    if (layerMcd.checked) await loadBrand('mcdonalds', 'mcd');
    if (layerStar.checked) await loadBrand('starbucks', 'starbucks');
    if (layerDG.checked) await loadBrand('dollargeneral', 'dg');
    if (layerQuakes.checked) await loadQuakes();
    setStatus('Done.');
  }catch(e){
    console.error(e);
    setStatus(`Error: ${e.message}`);
  }
}

refreshBtn.addEventListener('click', refresh);

randomBtn.addEventListener('click', () => {
  const spots = [
    [34.05, -118.25, 9], // LA
    [40.71, -74.00, 10], // NYC
    [41.88, -87.63, 10], // Chicago
    [29.76, -95.36, 10], // Houston
    [39.74, -104.99, 10], // Denver
    [47.61, -122.33, 10], // Seattle
    [25.76, -80.19, 11], // Miami
    [33.45, -112.07, 10], // Phoenix
  ];
  const pick = spots[Math.floor(Math.random() * spots.length)];
  map.setView([pick[0], pick[1]], pick[2]);
});

map.on('moveend', () => {
  // optional auto-refresh: comment out if you don’t want it.
  // refresh();
});

setStatus('Ready. Zoom in, select layers, hit Refresh.');
