import maplibregl from 'https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.js';

const DATA_URL = './data/building_273.geojson';
const TRANSITIONS_URL = 'https://my.itmo.ru/api/navigator/buildings/273/transition';
const BUILDING = { center: [30.3380443, 59.9266753], bounds: [[30.3366429, 59.9258744], [30.3394456, 59.9274763]], bearing: 216 };
const ZONES = [
  { id: 'welcome', label: 'Встреча', color: '#e9c77f' },
  { id: 'program', label: 'Программа', color: '#89b5a0' },
  { id: 'food', label: 'Кофе-брейк', color: '#e6a187' },
  { id: 'staff', label: 'Команда', color: '#a8a1bd' },
  { id: 'utility', label: 'Служебная', color: '#a8b6c0' },
];
const STORAGE_KEY = 'kotatsu-event-layout-v1';
const $ = (selector) => document.querySelector(selector);
const mapMessage = $('#map-message');
const state = { floor: 1, selected: null, rooms: [], zones: {}, eventName: '' };

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  if (saved.building === 273) {
    state.zones = saved.zones || {};
    state.eventName = saved.eventName || '';
    $('#event-name').value = state.eventName;
  }
} catch { localStorage.removeItem(STORAGE_KEY); }

const map = new maplibregl.Map({
  container: 'map',
  center: BUILDING.center,
  zoom: 17.4,
  bearing: BUILDING.bearing,
  minZoom: 16,
  maxZoom: 21,
  maxBounds: [[30.334, 59.923], [30.342, 59.930]],
  style: {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#eeede7' } },
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.72, 'raster-brightness-min': 0.28, 'raster-brightness-max': 0.98, 'raster-contrast': -0.08 } },
    ],
  },
  attributionControl: false,
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

function visibleRooms() {
  const query = $('#room-search').value.trim().toLocaleLowerCase('ru');
  return state.rooms.filter((room) => String(room.properties.level) === String(state.floor) && (!query || room.label.toLocaleLowerCase('ru').includes(query)));
}

function renderRoomList() {
  const rooms = visibleRooms();
  $('#room-count').textContent = `${rooms.length} пом.`;
  const assigned = rooms.filter((room) => state.zones[room.properties.id]);
  $('#assigned-count').textContent = `${assigned.length} зон`;
  $('#room-list').innerHTML = rooms.length ? rooms.map((room) => {
    const id = String(room.properties.id);
    const zone = ZONES.find((item) => item.id === state.zones[id]);
    return `<button class="room-row ${zone ? 'assigned' : ''} ${state.selected === id ? 'selected' : ''}" data-room="${id}"><i class="room-dot"></i><span class="room-name">${escapeHtml(room.label)}</span>${zone ? `<span class="room-zone">${escapeHtml(zone.label)}</span>` : ''}</button>`;
  }).join('') : '<div class="empty-list">Ничего не найдено на этом этаже.</div>';
  $('#room-list').querySelectorAll('[data-room]').forEach((button) => button.addEventListener('click', () => selectRoom(button.dataset.room, true)));
}

function renderAssignment() {
  const room = state.rooms.find((item) => String(item.properties.id) === state.selected);
  $('#selected-name').textContent = room?.label || 'Выберите помещение';
  $('#selected-meta').textContent = room ? `этаж ${state.floor} · ${room.properties.class || 'помещение'}` : 'на плане или в списке';
  $('#clear-room').hidden = !room;
  $('#zone-options').innerHTML = ZONES.map((zone) => `<button class="zone-button ${room && state.zones[state.selected] === zone.id ? 'active' : ''}" data-zone="${zone.id}" ${room ? '' : 'disabled'}>${escapeHtml(zone.label)}</button>`).join('') + (room && state.zones[state.selected] ? '<button class="zone-button" data-zone="">Убрать зону</button>' : '');
  $('#zone-options').querySelectorAll('[data-zone]').forEach((button) => button.addEventListener('click', () => assignZone(button.dataset.zone)));
}

function refreshRoomState() {
  for (const room of state.rooms) {
    const id = String(room.properties.id);
    map.setFeatureState({ source: 'indoor', id }, { zone: state.zones[id] || '', selected: id === state.selected });
  }
  renderRoomList();
  renderAssignment();
}

function selectRoom(id, pan = false) {
  state.selected = id;
  const room = state.rooms.find((item) => String(item.properties.id) === id);
  if (pan && room) map.easeTo({ center: polygonCenter(room.geometry), duration: 300 });
  refreshRoomState();
}

function assignZone(zone) {
  if (!state.selected) return;
  if (zone) state.zones[state.selected] = zone;
  else delete state.zones[state.selected];
  save();
  refreshRoomState();
}

function save() {
  state.eventName = $('#event-name').value.trim();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ building: 273, eventName: state.eventName, zones: state.zones }));
  $('#save-state').textContent = 'Сохранено в этом браузере';
}

function applyFloor() {
  state.selected = null;
  for (const button of document.querySelectorAll('.floor-button')) {
    const active = Number(button.dataset.floor) === state.floor;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  map.setFilter('rooms-fill', ['==', ['to-string', ['get', 'level']], String(state.floor)]);
  map.setFilter('rooms-line', ['==', ['to-string', ['get', 'level']], String(state.floor)]);
  map.setFilter('room-label', ['==', ['to-string', ['get', 'level']], String(state.floor)]);
  if (map.getLayer('transition-line')) map.setFilter('transition-line', ['==', ['to-string', ['get', 'level']], String(state.floor)]);
  renderRoomList();
  renderAssignment();
  for (const room of state.rooms) map.setFeatureState({ source: 'indoor', id: String(room.properties.id) }, { selected: false });
  map.fitBounds(BUILDING.bounds, { padding: { top: 70, right: 48, bottom: 76, left: 48 }, duration: 350, bearing: BUILDING.bearing });
}

function exportLayout() {
  const rooms = Object.entries(state.zones).map(([id, zone]) => {
    const room = state.rooms.find((item) => String(item.properties.id) === id);
    return { id, name: room?.label || id, floor: Number(room?.properties.level), zone };
  });
  const blob = new Blob([JSON.stringify({ building: 273, buildingName: 'Ломоносова, 9', eventName: $('#event-name').value.trim(), exportedAt: new Date().toISOString(), rooms }, null, 2)], { type: 'application/json' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'itmo-event-layout.json' });
  link.click();
  URL.revokeObjectURL(link.href);
}

function importLayout(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.building !== 273 || !Array.isArray(data.rooms)) throw new Error('invalid');
      const known = new Set(state.rooms.map((room) => String(room.properties.id)));
      state.zones = Object.fromEntries(data.rooms.filter((room) => known.has(String(room.id)) && ZONES.some((zone) => zone.id === room.zone)).map((room) => [String(room.id), room.zone]));
      $('#event-name').value = typeof data.eventName === 'string' ? data.eventName.slice(0, 80) : '';
      save();
      refreshRoomState();
    } catch {
      showMessage('Не удалось прочитать файл. Выберите раскладку, ранее сохранённую из этого редактора.');
    }
  };
  reader.readAsText(file);
}

function showMessage(message) {
  mapMessage.textContent = message;
  mapMessage.hidden = false;
  window.setTimeout(() => { mapMessage.hidden = true; }, 5000);
}

function polygonCenter(geometry) {
  const ring = geometry.coordinates[0][0];
  const mean = ring.reduce((result, point) => [result[0] + point[0] / ring.length, result[1] + point[1] / ring.length], [0, 0]);
  return mean;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

map.on('load', async () => {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const geojson = await response.json();
    state.rooms = geojson.features.filter((feature) => feature.properties?._layer === 'area' && ['room', 'hall', 'corridor', 'stairs', 'toilet', 'elevator'].includes(feature.properties?.class)).map((feature) => ({ ...feature, label: feature.properties['name:ru'] || feature.properties.name || feature.properties.ref || feature.properties.class }));
    map.addSource('indoor', { type: 'geojson', data: { ...geojson, features: state.rooms }, promoteId: 'id' });
    map.addLayer({ id: 'rooms-fill', type: 'fill', source: 'indoor', paint: { 'fill-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#e9a084', ['match', ['feature-state', 'zone'], 'welcome', '#e9c77f', 'program', '#89b5a0', 'food', '#e6a187', 'staff', '#a8a1bd', 'utility', '#a8b6c0', '#f2f1e9'], 'fill-opacity': 0.94 } });
    map.addLayer({ id: 'rooms-line', type: 'line', source: 'indoor', paint: { 'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#bb5539', '#a4a89e'], 'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.5, 1], 'line-opacity': 0.9 } });
    try {
      const response = await fetch(TRANSITIONS_URL);
      if (response.ok) {
        const graph = await response.json();
        const nodes = new Map(graph.features.map((node) => [String(node.properties.id), node]));
        const edges = [];
        for (const node of graph.features) for (const edge of node.properties.transitions || []) {
          const target = nodes.get(String(edge.id));
          if (target && node.properties.level === target.properties.level && node.properties.id < edge.id) edges.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [node.geometry.coordinates.slice(0, 2), target.geometry.coordinates.slice(0, 2)] }, properties: { level: node.properties.level } });
        }
        map.addSource('transitions', { type: 'geojson', data: { type: 'FeatureCollection', features: edges } });
        map.addLayer({ id: 'transition-line', type: 'line', source: 'transitions', paint: { 'line-color': '#687d70', 'line-width': 1.1, 'line-opacity': 0.36, 'line-dasharray': [1.5, 2] } });
      }
    } catch (error) { console.warn('Indoor transitions unavailable', error); }
    map.addLayer({ id: 'room-label', type: 'symbol', source: 'indoor', minzoom: 18, layout: { 'text-field': ['coalesce', ['get', 'name:ru'], ['get', 'name'], ['get', 'ref'], ''], 'text-size': 10, 'text-font': ['Open Sans Regular'], 'text-anchor': 'center', 'text-max-width': 8, 'text-allow-overlap': false }, paint: { 'text-color': '#39443c', 'text-halo-color': '#faf9f3', 'text-halo-width': 1.2 } });
    applyFloor();
    refreshRoomState();
    map.on('click', 'rooms-fill', (event) => {
      const feature = event.features?.[0];
      if (feature) selectRoom(String(feature.properties.id));
    });
    map.on('mouseenter', 'rooms-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'rooms-fill', () => { map.getCanvas().style.cursor = ''; });
  } catch (error) {
    console.error(error);
    showMessage('План не загрузился. Обновите страницу или проверьте подключение к интернету.');
    $('#room-list').innerHTML = '<div class="empty-list">Не удалось загрузить план помещений.</div>';
  }
});

document.querySelectorAll('.floor-button').forEach((button) => button.addEventListener('click', () => { state.floor = Number(button.dataset.floor); applyFloor(); refreshRoomState(); }));
$('#room-search').addEventListener('input', renderRoomList);
$('#event-name').addEventListener('input', save);
$('#clear-room').addEventListener('click', () => { state.selected = null; refreshRoomState(); });
$('#fit-map').addEventListener('click', () => map.fitBounds(BUILDING.bounds, { padding: { top: 70, right: 48, bottom: 76, left: 48 }, duration: 350, bearing: BUILDING.bearing }));
$('#export-button').addEventListener('click', exportLayout);
$('#import-button').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', (event) => { if (event.target.files[0]) importLayout(event.target.files[0]); event.target.value = ''; });
document.addEventListener('keydown', (event) => { if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); $('#room-search').focus(); } });
