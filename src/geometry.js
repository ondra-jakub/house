import { model, openingsForWall } from "./model.js";

export const EPS = 1e-8;
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const scale = (a, value) => [a[0] * value, a[1] * value];
export const length = (a) => Math.hypot(a[0], a[1]);
export const distance = (a, b) => length(sub(b, a));
export const centroid = (polygon) => {
  const area = signedArea(polygon);
  if (Math.abs(area) < EPS) return polygon[0];
  let x = 0;
  let y = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    x += (a[0] + b[0]) * cross;
    y += (a[1] + b[1]) * cross;
  }
  return [x / (6 * area), y / (6 * area)];
};

export function signedArea(polygon) {
  let sum = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

export const polygonArea = (polygon) => Math.abs(signedArea(polygon));
export const bounds = (polygon) => ({
  minX: Math.min(...polygon.map((point) => point[0])),
  maxX: Math.max(...polygon.map((point) => point[0])),
  minY: Math.min(...polygon.map((point) => point[1])),
  maxY: Math.max(...polygon.map((point) => point[1])),
});

export function clearDimensions(polygon) {
  const box = bounds(polygon);
  return { width: box.maxX - box.minX, depth: box.maxY - box.minY };
}

export function pointInPolygon(point, polygon, strict = false) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const onSegment = Math.abs((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])) < EPS
      && point[0] >= Math.min(a[0], b[0]) - EPS && point[0] <= Math.max(a[0], b[0]) + EPS
      && point[1] >= Math.min(a[1], b[1]) - EPS && point[1] <= Math.max(a[1], b[1]) + EPS;
    if (onSegment) return !strict;
    const intersects = ((a[1] > point[1]) !== (b[1] > point[1]))
      && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function properIntersection(a, b, c, d) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return ((abC > EPS && abD < -EPS) || (abC < -EPS && abD > EPS))
    && ((cdA > EPS && cdB < -EPS) || (cdA < -EPS && cdB > EPS));
}

export function polygonsOverlap(a, b) {
  const boxA = bounds(a);
  const boxB = bounds(b);
  if (boxA.minX >= boxB.maxX - EPS || boxA.maxX <= boxB.minX + EPS || boxA.minY >= boxB.maxY - EPS || boxA.maxY <= boxB.minY + EPS) return false;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      if (properIntersection(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return a.some((point) => pointInPolygon(point, b, true)) || b.some((point) => pointInPolygon(point, a, true));
}

export function wallLength(wall) {
  return distance(wall.start, wall.end);
}

export function wallPoint(wall, along, inward = 0) {
  const direction = scale(sub(wall.end, wall.start), 1 / wallLength(wall));
  return add(add(wall.start, scale(direction, along)), scale(wall.inward, inward));
}

export function wallPolygon(wall) {
  return [
    wall.start,
    wall.end,
    add(wall.end, scale(wall.inward, wall.thickness)),
    add(wall.start, scale(wall.inward, wall.thickness)),
  ];
}

export function solidIntervals(wall, openings = openingsForWall(wall.id)) {
  const sorted = [...openings].sort((a, b) => a.from - b.from);
  const intervals = [];
  let cursor = 0;
  for (const opening of sorted) {
    if (opening.from > cursor) intervals.push({ from: cursor, to: opening.from });
    cursor = Math.max(cursor, opening.to);
  }
  const total = wallLength(wall);
  if (cursor < total) intervals.push({ from: cursor, to: total });
  return intervals;
}

export function openingPoints(opening, wall) {
  return [wallPoint(wall, opening.from), wallPoint(wall, opening.to)];
}

export function projectPoint(point, { scale: factor = 30, origin = [80, 250], angle = Math.PI / 6 } = {}) {
  const [x, y, z = 0] = point;
  return [
    origin[0] + factor * (x - y) * Math.cos(angle),
    origin[1] + factor * (x + y) * Math.sin(angle) - factor * z,
  ];
}

export function roomAreas() {
  return Object.fromEntries(model.rooms.map((room) => [room.id, polygonArea(room.polygon)]));
}

export function areaSummary() {
  const areas = roomAreas();
  const residential = model.rooms.filter((room) => room.residential).reduce((sum, room) => sum + areas[room.id], 0);
  const indoor = model.rooms.filter((room) => room.id !== "terrace").reduce((sum, room) => sum + areas[room.id], 0);
  return {
    built: model.geometry.width * model.geometry.depth,
    residential,
    indoor,
    garage: areas.garage,
    terrace: areas.terrace,
    construction: model.geometry.width * model.geometry.depth - indoor,
  };
}

export function validateModel(candidate = model) {
  const errors = [];
  const ids = new Set();
  for (const room of candidate.rooms) {
    if (ids.has(room.id)) errors.push(`Duplicitní ID místnosti: ${room.id}`);
    ids.add(room.id);
    if (room.polygon.length < 3 || polygonArea(room.polygon) <= EPS) errors.push(`Neplatný polygon místnosti: ${room.id}`);
    const dimensions = clearDimensions(room.polygon);
    if (dimensions.width <= 0 || dimensions.depth <= 0) errors.push(`Záporný či nulový rozměr: ${room.id}`);
    if (room.id !== "terrace") {
      const t = candidate.geometry.exteriorWall;
      if (!room.polygon.every(([x, y]) => x >= t - EPS && x <= candidate.geometry.width - t + EPS && y >= t - EPS && y <= candidate.geometry.depth - t + EPS)) {
        errors.push(`Místnost přesahuje vnitřní obrysy: ${room.id}`);
      }
    }
  }
  for (let i = 0; i < candidate.rooms.length; i += 1) {
    for (let j = i + 1; j < candidate.rooms.length; j += 1) {
      const a = candidate.rooms[i];
      const b = candidate.rooms[j];
      if (a.id === "terrace" || b.id === "terrace") continue;
      if (polygonsOverlap(a.polygon, b.polygon)) errors.push(`Překryv místností: ${a.id} / ${b.id}`);
    }
  }
  const wallIds = new Set(candidate.walls.map((wall) => wall.id));
  for (const wall of candidate.walls) {
    if (!(wallLength(wall) > 0) || !(wall.thickness > 0)) errors.push(`Neplatná stěna: ${wall.id}`);
  }
  const openingIds = new Set();
  for (const opening of candidate.openings) {
    if (openingIds.has(opening.id)) errors.push(`Duplicitní otvor: ${opening.id}`);
    openingIds.add(opening.id);
    const wall = candidate.walls.find((item) => item.id === opening.wall);
    if (!wall || !wallIds.has(opening.wall)) {
      errors.push(`Otvor ${opening.id} nemá stěnu`);
      continue;
    }
    if (opening.from < -EPS || opening.to > wallLength(wall) + EPS || opening.to <= opening.from || opening.height <= 0 || opening.bottom < 0 || opening.bottom + opening.height > candidate.geometry.clearHeight + EPS) {
      errors.push(`Otvor mimo stěnu či výšku: ${opening.id}`);
    }
  }
  for (const wall of candidate.walls) {
    const openings = openingsForWall(wall.id).sort((a, b) => a.from - b.from);
    for (let index = 1; index < openings.length; index += 1) {
      if (openings[index].from < openings[index - 1].to - EPS) errors.push(`Překryv otvorů na stěně ${wall.id}`);
    }
  }
  const summary = areaSummary();
  if (Math.abs(summary.built - 192.5) > EPS) errors.push("Nesouhlasí zastavěná plocha");
  if (!(summary.residential > 0 && summary.indoor > summary.residential)) errors.push("Nesouhlasí součty ploch");
  return errors;
}

export function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}
