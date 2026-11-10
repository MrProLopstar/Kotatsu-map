const STORAGE_KEY = 'kotatsu-event-layout-v2';
const BUILDINGS = window.ITMO_BUILDINGS;
const COLORS = ['#8fbd9c', '#e5b978', '#e49070', '#a9a0c3', '#83a7bf'];
const state = { buildingId: 273, floor: 0, viewMode: false, selected: null, shapes: [], eventName: '' };
const $ = (selector) => document.querySelector(selector);
const mapMessage = $('#map-message');
let map;
let markers = [];
let labels = [];
const undoStack = [];
const redoStack = [];
const localSprites = new Set(['cash', 'amenity.water', 'parking.bike', 'healthcare', 'amenity.restroom.male', 'amenity.restroom.female', 'amenity.restroom.unisex', 'office', 'auditory', 'stairs', 'canteen', 'cloakroom', 'coworking', 'gym', 'library', 'entrance', 'lockerroom.female', 'lockerroom.male', 'studoffice', 'museum', 'conferenceroom', 'default']);

function snapshot() {
  return { shapes: structuredClone(state.shapes), selected: state.selected, buildingId: state.buildingId, floor: state.floor, eventName: state.eventName };
}

function updateHistoryButtons() {
  $('#undo-button').disabled = !undoStack.length;
  $('#redo-button').disabled = !redoStack.length;
}

function recordHistory() {
  undoStack.push(snapshot());
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}

function restoreSnapshot(value) {
  const buildingChanged = value.buildingId !== state.buildingId;
  Object.assign(state, structuredClone(value));
  $('#event-name').value = state.eventName;
  $('#map-event-label').textContent = state.eventName || 'План события';
  save();
  if (buildingChanged) setBuilding(state.buildingId); else applyFloor();
  state.selected = value.selected;
  renderShapes();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restoreSnapshot(undoStack.pop());
  updateHistoryButtons();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restoreSnapshot(redoStack.pop());
  updateHistoryButtons();
}

function buildingById(id = state.buildingId) { return BUILDINGS.find((building) => building.building_id === Number(id)); }

function normalizedShape(shape) {
  if (!shape || typeof shape !== 'object') return null;
  const legacy = !Number.isInteger(shape.buildingId);
  const buildingId = legacy ? 273 : shape.buildingId;
  return { ...shape, buildingId, floor: legacy ? Number(shape.floor) - 1 : shape.floor };
}

function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.eventName = typeof saved.eventName === 'string' ? saved.eventName.slice(0, 80) : '';
    state.shapes = Array.isArray(saved.shapes) ? saved.shapes.map(normalizedShape).filter(validShape).slice(0, 500) : [];
  } catch { localStorage.removeItem(STORAGE_KEY); }
  $('#event-name').value = state.eventName;
  $('#map-event-label').textContent = state.eventName || 'План события';
}

function expandedBounds(building) {
  const [west, south, east, north] = building.bounds;
  return [[west - 0.002, south - 0.002], [east + 0.002, north + 0.002]];
}

function fitMap() {
  const building = buildingById();
  map.fitBounds([[building.bounds[0], building.bounds[1]], [building.bounds[2], building.bounds[3]]], {
    padding: { top: 64, right: 36, bottom: 64, left: 36 }, duration: 300, bearing: building.bearing,
  });
}

function setBuilding(id) {
  const building = buildingById(id);
  if (!building) return;
  state.buildingId = building.building_id;
  state.floor = building.levels.includes(state.floor) ? state.floor : (building.levels.includes(0) ? 0 : building.levels[building.levels.length - 1]);
  state.selected = null;
  $('#building-select').value = String(building.building_id);
  $('#building-name').textContent = building.name.toLocaleUpperCase('ru-RU');
  clearMarkers();
  labels.forEach((marker) => marker.remove());
  labels = [];
  renderFloors();
  if (map) {
    map.setMaxBounds(expandedBounds(building));
    map.setStyle(`./data/itmo-style.json?building=${building.building_id}`, { diff: false });
  }
}

$('#building-select').innerHTML = BUILDINGS.map((building) => `<option value="${building.building_id}">${escapeHtml(building.name)}</option>`).join('');
loadLayout();
const initialBuilding = buildingById();
map = new maplibregl.Map({
  container: 'map', center: [(initialBuilding.bounds[0] + initialBuilding.bounds[2]) / 2, (initialBuilding.bounds[1] + initialBuilding.bounds[3]) / 2], zoom: 17.5, bearing: initialBuilding.bearing,
  minZoom: 15, maxZoom: 21, maxBounds: expandedBounds(initialBuilding),
  style: './data/itmo-style.json?building=273',
  transformRequest: (url, resourceType) => resourceType === 'Tile' && url.includes('/services/273/tiles/')
    ? { url: url.replace('/services/273/tiles/', `/services/${state.buildingId}/tiles/`) } : { url },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
map.on('styleimagemissing', ({ id }) => {
  if (!localSprites.has(id)) return;
  map.loadImage(`./assets/sprites/${encodeURIComponent(id)}.png`).then(({ data }) => {
    if (!map.hasImage(id)) map.addImage(id, data);
  }).catch(() => {});
});

function validShape(shape) {
  const building = shape && buildingById(shape.buildingId);
  return building && Number.isInteger(shape.floor) && building.levels.includes(shape.floor) &&
    typeof shape.name === 'string' && Array.isArray(shape.coordinates) && shape.coordinates.length >= 3 && shape.coordinates.length <= 40 &&
    shape.coordinates.every((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90);
}

function save() {
  state.eventName = $('#event-name').value.trim();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, eventName: state.eventName, shapes: state.shapes }));
  $('#save-state').classList.remove('unsaved');
}

function floorCaption(level) {
  return level < 0 ? 'Подвальный этаж' : `${level + 1}-й этаж`;
}

function renderFloors() {
  const building = buildingById();
  const occupied = new Set(state.shapes.filter((shape) => shape.buildingId === state.buildingId).map((shape) => shape.floor));
  const levels = building.levels.slice().sort((a, b) => a - b).filter((level) => !state.viewMode || occupied.has(level));
  if (levels.length && !levels.includes(state.floor)) state.floor = levels[0];
  else if (!levels.length && state.viewMode) state.floor = null;
  $('#floor-switch').innerHTML = levels.length ? levels.map((level) => `<button class="floor-button ${level === state.floor ? 'active' : ''}" data-floor="${level}" aria-pressed="${level === state.floor}"><b>${level < 0 ? '−1' : String(level + 1).padStart(2, '0')}</b><span>${floorCaption(level)}</span></button>`).join('') : '<p class="empty-state floor-empty">В этом корпусе пока нет занятых этажей.</p>';
  $('#floor-switch').querySelectorAll('[data-floor]').forEach((button) => button.addEventListener('click', () => {
    state.floor = Number(button.dataset.floor);
    applyFloor();
  }));
  renderOccupiedBuildings();
}

function renderOccupiedBuildings() {
  const groups = BUILDINGS.map((building) => ({
    building,
    levels: building.levels.slice().sort((a, b) => a - b).filter((level) => state.shapes.some((shape) => shape.buildingId === building.building_id && shape.floor === level)),
  })).filter((group) => group.levels.length);
  $('#occupied-building-list').innerHTML = groups.length ? groups.map(({ building, levels }) => `
    <section class="occupied-building">
      <h3>${escapeHtml(building.name)}</h3>
      <div class="occupied-floor-list">${levels.map((level) => `<button class="occupied-floor ${building.building_id === state.buildingId && level === state.floor ? 'active' : ''}" data-building="${building.building_id}" data-floor="${level}" aria-pressed="${building.building_id === state.buildingId && level === state.floor}">${level < 0 ? 'Подвал' : `${level + 1}-й этаж`}</button>`).join('')}</div>
    </section>`).join('') : '<p class="empty-state">Нет занятых корпусов. Вернитесь в редактор и добавьте зоны.</p>';
  $('#occupied-building-list').querySelectorAll('[data-building][data-floor]').forEach((button) => button.addEventListener('click', () => {
    const buildingId = Number(button.dataset.building);
    const floor = Number(button.dataset.floor);
    if (buildingId !== state.buildingId) {
      setBuilding(buildingId);
      state.floor = floor;
      renderFloors();
    } else {
      state.floor = floor;
      applyFloor();
    }
  }));
}

function featureCollection() {
  return { type: 'FeatureCollection', features: state.shapes.map((shape) => ({
    type: 'Feature', id: shape.id,
    properties: { id: shape.id, buildingId: shape.buildingId, floor: shape.floor, name: shape.name, color: shape.color },
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
  const shapes = state.shapes.filter((shape) => shape.buildingId === state.buildingId && shape.floor === state.floor);
  $('#shape-count').textContent = `${shapes.length} ${shapes.length === 1 ? 'ФИГУРА' : 'ФИГУР'}`;
  $('#shape-list').innerHTML = shapes.length ? shapes.map((shape) => `<button class="shape-row ${shape.id === state.selected ? 'active' : ''}" data-shape="${escapeHtml(shape.id)}"><i class="shape-color" style="background:${shape.color}"></i><span class="shape-row-name">${escapeHtml(shape.name || 'Новая зона')}</span><span class="shape-row-floor">${String(shape.coordinates.length).padStart(2, '0')} т.</span></button>`).join('') : '<p class="empty-state">Добавьте зону, чтобы отметить место встречи, лекции или стойки регистрации.</p>';
  $('#shape-list').querySelectorAll('[data-shape]').forEach((button) => button.addEventListener('click', () => selectShape(button.dataset.shape, true)));
}

function renderShapeEditor() {
  const shape = state.shapes.find((item) => item.id === state.selected && item.buildingId === state.buildingId && item.floor === state.floor);
  $('#shape-editor').hidden = !shape;
  if (!shape) return;
  $('#shape-name').value = shape.name;
  $('#color-options').innerHTML = COLORS.map((color) => `<button class="color-swatch ${shape.color === color ? 'active' : ''}" data-color="${color}" style="background:${color}" aria-label="Выбрать цвет"></button>`).join('');
  $('#color-options').querySelectorAll('[data-color]').forEach((button) => button.addEventListener('click', () => {
    recordHistory();
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
  for (const shape of state.shapes.filter((item) => item.buildingId === state.buildingId && item.floor === state.floor)) {
    const element = document.createElement('div');
    element.className = `zone-label ${shape.id === state.selected ? 'active' : ''}`;
    element.textContent = shape.name || 'Новая зона';
    labels.push(new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(polygonCenter(shape.coordinates)).addTo(map));
  }
}

function renderHandles() {
  clearMarkers();
  if (state.viewMode) return;
  const shape = state.shapes.find((item) => item.id === state.selected && item.buildingId === state.buildingId && item.floor === state.floor);
  if (!shape || !map.getSource('event-zones')) return;
  shape.coordinates.forEach((coordinate, index) => {
    const element = document.createElement('button');
    element.className = 'vertex-marker';
    element.setAttribute('aria-label', `Переместить точку ${index + 1}`);
    const marker = new maplibregl.Marker({ element, draggable: true }).setLngLat(coordinate).addTo(map);
    marker.on('dragstart', recordHistory);
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
      recordHistory();
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
  const count = state.shapes.filter((shape) => shape.buildingId === state.buildingId && shape.floor === state.floor).length + 1;
  const shape = {
    id: crypto.randomUUID(), buildingId: state.buildingId, floor: state.floor, name: `Зона ${String(count).padStart(2, '0')}`, color: COLORS[0],
    coordinates: [[center.lng - dx, center.lat - dy], [center.lng + dx, center.lat - dy], [center.lng + dx, center.lat + dy], [center.lng - dx, center.lat + dy]],
  };
  recordHistory();
  state.shapes.push(shape);
  state.selected = shape.id;
  save();
  renderFloors();
  renderShapes();
}

function applyFloor() {
  state.selected = null;
  for (const layer of map.getStyle().layers) {
    if (!layer.filter || !layer['source-layer']) continue;
    const filter = structuredClone(layer.filter);
    const setLevel = (node) => {
      if (!Array.isArray(node)) return;
      if (node[0] === '==' && node[1] === 'level') node[2] = String(state.floor);
      else node.forEach(setLevel);
    };
    setLevel(filter);
    if (JSON.stringify(filter) !== JSON.stringify(layer.filter)) map.setFilter(layer.id, filter);
  }
  const zoneFilter = ['all', ['==', ['get', 'buildingId'], state.buildingId], ['==', ['get', 'floor'], state.floor]];
  if (map.getLayer('event-zone-fill')) map.setFilter('event-zone-fill', zoneFilter);
  if (map.getLayer('event-zone-line')) map.setFilter('event-zone-line', zoneFilter);
  renderFloors();
  renderShapes();
  fitMap();
}

function exportLayout() {
  const blob = new Blob([JSON.stringify({ version: 3, eventName: $('#event-name').value.trim(), shapes: state.shapes }, null, 2)], { type: 'application/json' });
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
      recordHistory();
      state.shapes = data.shapes.map(normalizedShape).filter(validShape).slice(0, 500).map((shape) => ({ id: crypto.randomUUID(), buildingId: shape.buildingId, floor: shape.floor, name: shape.name.slice(0, 48), color: COLORS.includes(shape.color) ? shape.color : COLORS[0], coordinates: shape.coordinates }));
      $('#event-name').value = typeof data.eventName === 'string' ? data.eventName.slice(0, 80) : '';
      save();
      renderFloors();
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

let interactionsReady = false;
map.on('style.load', () => {
  map.addSource('event-zones', { type: 'geojson', data: featureCollection(), promoteId: 'id' });
  const zoneFilter = ['all', ['==', ['get', 'buildingId'], state.buildingId], ['==', ['get', 'floor'], state.floor]];
  map.addLayer({ id: 'event-zone-fill', type: 'fill', source: 'event-zones', filter: zoneFilter, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.62, 0.48] } });
  map.addLayer({ id: 'event-zone-line', type: 'line', source: 'event-zones', filter: zoneFilter, paint: { 'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#26372c', '#576b59'], 'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.2, 1.2] } });
  if (!interactionsReady) {
  map.on('click', 'event-zone-fill', (event) => { const id = event.features?.[0]?.properties.id; if (id) selectShape(String(id)); });
  map.on('mouseenter', 'event-zone-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'event-zone-fill', () => { map.getCanvas().style.cursor = ''; });
  map.on('mousedown', 'event-zone-fill', (event) => {
    const id = String(event.features?.[0]?.properties.id || '');
    const shape = state.shapes.find((item) => item.id === id && item.buildingId === state.buildingId && item.floor === state.floor);
    if (!shape) return;
    selectShape(id);
    const original = shape.coordinates.map((point) => [...point]);
    const origin = map.unproject(event.point).toArray();
    let moved = false;
    map.dragPan.disable();
    map.getCanvas().style.cursor = 'grabbing';
    const move = (nextEvent) => {
      const current = map.unproject(nextEvent.point).toArray();
      const delta = [current[0] - origin[0], current[1] - origin[1]];
      if (!moved) { recordHistory(); moved = true; }
      shape.coordinates = original.map(([lng, lat]) => [lng + delta[0], lat + delta[1]]);
      map.getSource('event-zones').setData(featureCollection());
      shape.coordinates.forEach((point, index) => {
        markers[index * 2]?.setLngLat(point);
        const following = shape.coordinates[(index + 1) % shape.coordinates.length];
        markers[index * 2 + 1]?.setLngLat([(point[0] + following[0]) / 2, (point[1] + following[1]) / 2]);
      });
      const labelIndex = state.shapes.filter((item) => item.buildingId === state.buildingId && item.floor === state.floor).findIndex((item) => item.id === shape.id);
      labels[labelIndex]?.setLngLat(polygonCenter(shape.coordinates));
    };
    const finish = () => {
      map.off('mousemove', move);
      map.off('mouseup', finish);
      window.removeEventListener('mouseup', finish);
      map.dragPan.enable();
      map.getCanvas().style.cursor = '';
      if (moved) { save(); renderShapes(); }
    };
    map.on('mousemove', move);
    map.on('mouseup', finish);
    window.addEventListener('mouseup', finish, { once: true });
    event.preventDefault();
  });
  interactionsReady = true;
  }
  applyFloor();
  $('#room-count').textContent = 'ПЛАН КОРПУСА';
});
$('#building-select').addEventListener('change', (event) => setBuilding(event.target.value));
$('#view-mode').addEventListener('click', () => {
  const previousFloor = state.floor;
  state.viewMode = !state.viewMode;
  document.querySelector('.editor').classList.toggle('view-mode', state.viewMode);
  $('#view-mode').setAttribute('aria-pressed', String(state.viewMode));
  $('#view-mode').textContent = state.viewMode ? 'Редактирование' : 'Просмотр';
  $('#event-name').readOnly = state.viewMode;
  renderFloors();
  if (state.floor !== previousFloor) applyFloor(); else renderShapes();
});
fetch('./build-version.txt').then((response) => response.ok && response.text()).then((sha) => {
  if (sha) {
    const link = $('#build-commit');
    link.textContent = sha.trim();
    link.href = `https://github.com/MrProLopstar/Kotatsu-map/commit/${sha.trim()}`;
  }
}).catch(() => {});
$('#add-shape').addEventListener('click', addSquare);
$('#undo-button').addEventListener('click', undo);
$('#redo-button').addEventListener('click', redo);
$('#event-name').addEventListener('focus', recordHistory);
$('#event-name').addEventListener('input', () => { $('#map-event-label').textContent = $('#event-name').value.trim() || 'План события'; $('#save-state').classList.add('unsaved'); save(); });
$('#shape-name').addEventListener('focus', recordHistory);
$('#shape-name').addEventListener('input', () => { const shape = state.shapes.find((item) => item.id === state.selected); if (!shape) return; shape.name = $('#shape-name').value.slice(0, 48); save(); map.getSource('event-zones')?.setData(featureCollection()); renderShapeList(); renderLabels(); });
$('#delete-shape').addEventListener('click', () => { recordHistory(); state.shapes = state.shapes.filter((shape) => shape.id !== state.selected); state.selected = null; save(); renderShapes(); });
$('#fit-map').addEventListener('click', fitMap);
$('#help-button').addEventListener('click', () => showMessage('Добавьте зону — квадрат появится по центру карты. Перетяните круглые маркеры, чтобы изменить форму. Нажмите + на ребре, чтобы добавить угол.'));
$('#export-button').addEventListener('click', exportLayout);
$('#import-button').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', (event) => { if (event.target.files[0]) importLayout(event.target.files[0]); event.target.value = ''; });
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !state.viewMode && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && !state.viewMode && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); redo(); return; }
  if (event.key.toLowerCase() === 'n' && !state.viewMode && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); addSquare(); }
  if (event.key === 'Escape' && state.selected) { state.selected = null; renderShapes(); }
});
