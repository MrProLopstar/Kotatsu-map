const DATA_URL = './data/building_273.geojson';
const TRANSITIONS_URL = 'https://my.itmo.ru/api/navigator/buildings/273/transition';
const STORAGE_KEY = 'kotatsu-event-layout-v2';
const BUILDING = { center: [30.3380443, 59.9266753], bounds: [[30.3366429, 59.9258744], [30.3394456, 59.9274763]], bearing: 216 };
const COLORS = ['#8fbd9c', '#e5b978', '#e49070', '#a9a0c3', '#83a7bf'];
const state = { floor: 1, selected: null, shapes: [], roomCounts: {}, eventName: '' };
const $ = (selector) => document.querySelector(selector);
const mapMessage = $('#map-message');
let markers = [];
let labels = [];

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  state.eventName = typeof saved.eventName === 'string' ? saved.eventName.slice(0, 80) : '';
  state.shapes = Array.isArray(saved.shapes) ? saved.shapes.filter(validShape).slice(0, 200) : [];
  $('#event-name').value = state.eventName;
  $('#map-event-label').textContent = state.eventName || 'План события';
} catch { localStorage.removeItem(STORAGE_KEY); }

const map = new maplibregl.Map({
  container: 'map', center: BUILDING.center, zoom: 17.5, bearing: BUILDING.bearing,
  minZoom: 16, maxZoom: 21, maxBounds: [[30.334, 59.923], [30.342, 59.930]],
  style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e7e5dc' } }] },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

function validShape(shape) {
  return shape && Number.isInteger(shape.floor) && [1, 2].includes(shape.floor) &&
    typeof shape.name === 'string' && Array.isArray(shape.coordinates) && shape.coordinates.length >= 3 && shape.coordinates.length <= 40 &&
    shape.coordinates.every((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90);
}

function save() {
  state.eventName = $('#event-name').value.trim();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, eventName: state.eventName, shapes: state.shapes }));
  $('#save-state').classList.remove('unsaved');
}

function featureCollection() {
  return { type: 'FeatureCollection', features: state.shapes.map((shape) => ({
    type: 'Feature', id: shape.id,
    properties: { id: shape.id, floor: shape.floor, name: shape.name, color: shape.color },
    geometry: { type: 'Polygon', coordinates: [[...shape.coordinates, shape.coordinates[0]]] },
  })) };
}

function renderShapes() {
  const source = map.getSource('event-zones');
  if (source) source.setData(featureCollection());
  if (source) for (const shape of state.shapes) map.setFeatureState({ source: 'event-zones', id: shape.id }, { selected: shape.id === state.selected });
  renderShapeList();
  renderShapeEditor();
  renderLabels();
  renderHandles();
}

function renderShapeList() {
  const shapes = state.shapes.filter((shape) => shape.floor === state.floor);
  $('#shape-count').textContent = `${shapes.length} ${shapes.length === 1 ? 'ФИГУРА' : 'ФИГУР'}`;
  $('#shape-list').innerHTML = shapes.length ? shapes.map((shape) => `<button class="shape-row ${shape.id === state.selected ? 'active' : ''}" data-shape="${escapeHtml(shape.id)}"><i class="shape-color" style="background:${shape.color}"></i><span class="shape-row-name">${escapeHtml(shape.name || 'Новая зона')}</span><span class="shape-row-floor">${String(shape.coordinates.length).padStart(2, '0')} т.</span></button>`).join('') : '<p class="empty-state">Добавьте зону, чтобы отметить место встречи, лекции или стойки регистрации.</p>';
  $('#shape-list').querySelectorAll('[data-shape]').forEach((button) => button.addEventListener('click', () => selectShape(button.dataset.shape, true)));
}

function renderShapeEditor() {
  const shape = state.shapes.find((item) => item.id === state.selected && item.floor === state.floor);
  $('#shape-editor').hidden = !shape;
  if (!shape) return;
  $('#shape-name').value = shape.name;
  $('#color-options').innerHTML = COLORS.map((color) => `<button class="color-swatch ${shape.color === color ? 'active' : ''}" data-color="${color}" style="background:${color}" aria-label="Выбрать цвет"></button>`).join('');
  $('#color-options').querySelectorAll('[data-color]').forEach((button) => button.addEventListener('click', () => {
    shape.color = button.dataset.color;
    save();
    renderShapes();
  }));
}

function clearMarkers() {
  markers.forEach((marker) => marker.remove());
  markers = [];
}

function renderLabels() {
  labels.forEach((marker) => marker.remove());
  labels = [];
  for (const shape of state.shapes.filter((item) => item.floor === state.floor)) {
    const element = document.createElement('div');
    element.className = `zone-label ${shape.id === state.selected ? 'active' : ''}`;
    element.textContent = shape.name || 'Новая зона';
    labels.push(new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(polygonCenter(shape.coordinates)).addTo(map));
  }
}

function renderHandles() {
  clearMarkers();
  const shape = state.shapes.find((item) => item.id === state.selected && item.floor === state.floor);
  if (!shape || !map.getSource('event-zones')) return;
  shape.coordinates.forEach((coordinate, index) => {
    const element = document.createElement('button');
    element.className = 'vertex-marker';
    element.setAttribute('aria-label', `Переместить точку ${index + 1}`);
    const marker = new maplibregl.Marker({ element, draggable: true }).setLngLat(coordinate).addTo(map);
    marker.on('dragend', () => {
      shape.coordinates[index] = marker.getLngLat().toArray();
      save();
      renderShapes();
    });
    markers.push(marker);

    const next = shape.coordinates[(index + 1) % shape.coordinates.length];
    const midpoint = [(coordinate[0] + next[0]) / 2, (coordinate[1] + next[1]) / 2];
    const insert = document.createElement('button');
    insert.className = 'insert-marker';
    insert.textContent = '+';
    insert.title = 'Добавить точку';
    insert.setAttribute('aria-label', 'Добавить угол на этом ребре');
    insert.addEventListener('click', (event) => {
      event.stopPropagation();
      shape.coordinates.splice(index + 1, 0, midpoint);
      save();
      renderShapes();
    });
    markers.push(new maplibregl.Marker({ element: insert }).setLngLat(midpoint).addTo(map));
  });
}

function selectShape(id, pan = false) {
  state.selected = id;
  const shape = state.shapes.find((item) => item.id === id);
  if (pan && shape) map.easeTo({ center: polygonCenter(shape.coordinates), duration: 250 });
  renderShapes();
}

function addSquare() {
  const center = map.getCenter();
  const dy = 8 / 111320;
  const dx = 8 / (111320 * Math.cos(center.lat * Math.PI / 180));
  const count = state.shapes.filter((shape) => shape.floor === state.floor).length + 1;
  const shape = {
    id: crypto.randomUUID(), floor: state.floor, name: `Зона ${String(count).padStart(2, '0')}`, color: COLORS[0],
    coordinates: [[center.lng - dx, center.lat - dy], [center.lng + dx, center.lat - dy], [center.lng + dx, center.lat + dy], [center.lng - dx, center.lat + dy]],
  };
  state.shapes.push(shape);
  state.selected = shape.id;
  save();
  renderShapes();
}

function applyFloor() {
  state.selected = null;
  document.querySelectorAll('.floor-button').forEach((button) => {
    const active = Number(button.dataset.floor) === state.floor;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (map.getLayer('room-fill')) map.setFilter('room-fill', ['==', ['to-string', ['get', 'level']], String(state.floor)]);
  if (map.getLayer('room-line')) map.setFilter('room-line', ['==', ['to-string', ['get', 'level']], String(state.floor)]);
  if (map.getLayer('transition-line')) map.setFilter('transition-line', ['==', ['to-string', ['get', 'level']], String(state.floor)]);
  if (map.getLayer('event-zone-fill')) map.setFilter('event-zone-fill', ['==', ['get', 'floor'], state.floor]);
  if (map.getLayer('event-zone-line')) map.setFilter('event-zone-line', ['==', ['get', 'floor'], state.floor]);
  renderShapes();
  map.fitBounds(BUILDING.bounds, { padding: { top: 64, right: 36, bottom: 64, left: 36 }, duration: 300, bearing: BUILDING.bearing });
}

function exportLayout() {
  const blob = new Blob([JSON.stringify({ version: 2, eventName: $('#event-name').value.trim(), shapes: state.shapes }, null, 2)], { type: 'application/json' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'event-map-layout.json' });
  link.click();
  URL.revokeObjectURL(link.href);
}

function importLayout(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.shapes)) throw new Error('invalid');
      state.shapes = data.shapes.filter(validShape).slice(0, 200).map((shape) => ({ id: crypto.randomUUID(), floor: shape.floor, name: shape.name.slice(0, 48), color: COLORS.includes(shape.color) ? shape.color : COLORS[0], coordinates: shape.coordinates }));
      $('#event-name').value = typeof data.eventName === 'string' ? data.eventName.slice(0, 80) : '';
      save();
      renderShapes();
    } catch {
      showMessage('Не удалось открыть файл раскладки. Проверьте, что это JSON, экспортированный из карты.');
    }
  };
  reader.readAsText(file);
}

function polygonCenter(points) {
  return points.reduce((result, point) => [result[0] + point[0] / points.length, result[1] + point[1] / points.length], [0, 0]);
}

function showMessage(message) {
  mapMessage.textContent = message;
  mapMessage.hidden = false;
  window.setTimeout(() => { mapMessage.hidden = true; }, 5000);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function addTransitionLayer() {
  try {
    const response = await fetch(TRANSITIONS_URL);
    if (!response.ok) return;
    const graph = await response.json();
    const nodes = new Map(graph.features.map((node) => [String(node.properties.id), node]));
    const features = [];
    for (const node of graph.features) for (const edge of node.properties.transitions || []) {
      const target = nodes.get(String(edge.id));
      if (target && node.properties.level === target.properties.level && node.properties.id < edge.id) features.push({
        type: 'Feature', geometry: { type: 'LineString', coordinates: [node.geometry.coordinates.slice(0, 2), target.geometry.coordinates.slice(0, 2)] }, properties: { level: node.properties.level },
      });
    }
    map.addSource('transitions', { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({ id: 'transition-line', type: 'line', source: 'transitions', filter: ['==', ['to-string', ['get', 'level']], String(state.floor)], paint: { 'line-color': '#73867a', 'line-width': 1, 'line-opacity': 0.24, 'line-dasharray': [1.5, 2] } }, 'event-zone-fill');
  } catch (error) { console.warn('Indoor transitions unavailable', error); }
}

map.on('load', () => {
  map.addSource('event-zones', { type: 'geojson', data: featureCollection(), promoteId: 'id' });
  map.addLayer({ id: 'event-zone-fill', type: 'fill', source: 'event-zones', filter: ['==', ['get', 'floor'], state.floor], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.62, 0.48] } });
  map.addLayer({ id: 'event-zone-line', type: 'line', source: 'event-zones', filter: ['==', ['get', 'floor'], state.floor], paint: { 'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#26372c', '#576b59'], 'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.2, 1.2] } });
  map.on('click', 'event-zone-fill', (event) => { const id = event.features?.[0]?.properties.id; if (id) selectShape(String(id)); });
  map.on('mouseenter', 'event-zone-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'event-zone-fill', () => { map.getCanvas().style.cursor = ''; });
  applyFloor();
  loadIndoorPlan();
});

async function loadIndoorPlan() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const geojson = await response.json();
    const rooms = geojson.features.filter((feature) => feature.properties?._layer === 'area' && ['room', 'hall', 'corridor', 'stairs', 'toilet', 'elevator'].includes(feature.properties?.class));
    map.addSource('indoor', { type: 'geojson', data: { type: 'FeatureCollection', features: rooms } });
    map.addLayer({ id: 'room-fill', type: 'fill', source: 'indoor', filter: ['==', ['to-string', ['get', 'level']], String(state.floor)], paint: { 'fill-color': '#f4f3eb', 'fill-opacity': 0.64 } }, 'event-zone-fill');
    map.addLayer({ id: 'room-line', type: 'line', source: 'indoor', filter: ['==', ['to-string', ['get', 'level']], String(state.floor)], paint: { 'line-color': '#8e968a', 'line-width': 1.1, 'line-opacity': 0.8 } }, 'event-zone-fill');
    for (const floor of [1, 2]) state.roomCounts[floor] = rooms.filter((room) => String(room.properties.level) === String(floor)).length;
    $('#room-count').textContent = `${state.roomCounts[state.floor]} ПОМЕЩЕНИЙ`;
    addTransitionLayer();
  } catch (error) {
    console.error(error);
    $('#room-count').textContent = 'РУЧНАЯ РАЗМЕТКА';
    showMessage('План помещения недоступен, но зоны можно создавать и редактировать.');
  }
}

document.querySelectorAll('.floor-button').forEach((button) => button.addEventListener('click', () => { state.floor = Number(button.dataset.floor); applyFloor(); $('#room-count').textContent = state.roomCounts[state.floor] ? `${state.roomCounts[state.floor]} ПОМЕЩЕНИЙ` : 'ПЛАН ЗАГРУЖАЕТСЯ'; }));
$('#add-shape').addEventListener('click', addSquare);
$('#event-name').addEventListener('input', () => { $('#map-event-label').textContent = $('#event-name').value.trim() || 'План события'; $('#save-state').classList.add('unsaved'); save(); });
$('#shape-name').addEventListener('input', () => { const shape = state.shapes.find((item) => item.id === state.selected); if (!shape) return; shape.name = $('#shape-name').value.slice(0, 48); save(); map.getSource('event-zones')?.setData(featureCollection()); renderShapeList(); renderLabels(); });
$('#delete-shape').addEventListener('click', () => { state.shapes = state.shapes.filter((shape) => shape.id !== state.selected); state.selected = null; save(); renderShapes(); });
$('#fit-map').addEventListener('click', () => map.fitBounds(BUILDING.bounds, { padding: { top: 64, right: 36, bottom: 64, left: 36 }, duration: 300, bearing: BUILDING.bearing }));
$('#help-button').addEventListener('click', () => showMessage('Добавьте зону — квадрат появится по центру карты. Перетяните круглые маркеры, чтобы изменить форму. Нажмите + на ребре, чтобы добавить угол.'));
$('#export-button').addEventListener('click', exportLayout);
$('#import-button').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', (event) => { if (event.target.files[0]) importLayout(event.target.files[0]); event.target.value = ''; });
document.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'n' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); addSquare(); }
  if (event.key === 'Escape' && state.selected) { state.selected = null; renderShapes(); }
});
