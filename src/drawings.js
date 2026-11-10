import { model, openingsForWall } from "./model.js";
import {
  EPS,
  add,
  centroid,
  clearDimensions,
  distance,
  formatNumber,
  length,
  pointInPolygon,
  polygonArea,
  projectPoint,
  scale,
  sub,
  wallLength,
  wallPoint,
  wallPolygon,
} from "./geometry.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const SCALE_TEXT = "M 1:100 pouze při kalibrovaném tisku A3; na obrazovce orientačně";
const DETAIL_TYPES = ["wall", "foundation", "parapet", "window"];
const LAYER_FILLS = ["#d9cfc0", "#e5d8c2", "#cfd9c6", "#d8dde4", "#e8e2d5", "#c9c3b6", "#dfe4dc"];
let drawingCounter = 0;

function n(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function measure(value, digits = 2) {
  return `${formatNumber(value, digits)} m`;
}

function millimeters(value) {
  return `${formatNumber(value * 1000, 0)} mm`;
}

function areaLabel(area) {
  return `${formatNumber(area, 1)} m²`;
}

function assemblyThickness(assembly) {
  return assembly.layers.reduce((sum, layer) => sum + (Number(layer.d) || 0), 0);
}

function wrapText(text, maxChars = 92) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function polygonPath(polygon, project) {
  const points = polygon.map((point) => project(point));
  if (!points.length) return "";
  return `${points.map((point, index) => `${index ? "L" : "M"}${n(point[0])} ${n(point[1])}`).join(" ")} Z`;
}

function path3(points, project) {
  if (!points.length) return "";
  return `${points.map((point, index) => `${index ? "L" : "M"}${n(project(point)[0])} ${n(project(point)[1])}`).join(" ")} Z`;
}

const STYLE = `
  .drawing { background: #fcfbf7; color: #33403a; }
  text { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; fill: currentColor; }
  .drawing-title { font-size: 18px; font-weight: 600; letter-spacing: .04em; }
  .drawing-subtitle { font-size: 11px; fill: #5c6861; }
  .meta { font-size: 10px; fill: #55625a; }
  .scale-note { font-size: 9.5px; fill: #6e786f; }
  .room .room-shape { stroke: #59655c; stroke-width: 1.1; vector-effect: non-scaling-stroke; }
  .room-social .room-shape { fill: #e7cdb0; }
  .room-private .room-shape { fill: #d5ddcb; }
  .room-service .room-shape { fill: #e0dfd7; }
  .room-private-service .room-shape { fill: #dde2d4; }
  .room-hall .room-shape { fill: #ece9e1; }
  .room-garage .room-shape { fill: #d1d4ce; }
  .room-terrace .room-shape { fill: #e6d6be; }
  .room:hover .room-shape, .room:focus-visible .room-shape { stroke: #a55f3d; stroke-width: 2; }
  .room-name { font-size: 10px; font-weight: 600; text-anchor: middle; }
  .room-area { font-size: 9.5px; text-anchor: middle; fill: #47534b; }
  .room-clear { font-size: 8.5px; text-anchor: middle; fill: #778176; }
  .wall { fill: #9a9184; stroke: #504a43; stroke-width: .55; }
  .wall-interior { fill: #b3ac9d; }
  .opening-void { fill: #fcfbf7; stroke: none; }
  .opening-frame { fill: none; stroke: #385e63; stroke-width: 1.1; }
  .opening-glass { fill: none; stroke: #6c8b90; stroke-width: .8; }
  .door-leaf { stroke: #815c42; stroke-width: 1.1; fill: none; }
  .door-swing { stroke: #9d795a; stroke-width: .8; fill: none; stroke-dasharray: 3 2; }
  .beam { stroke: #7b5f3e; stroke-width: 5; stroke-linecap: square; }
  .beam-label { font-size: 8.5px; fill: #6a4d2f; }
  .dimension { stroke: #3d4a44; stroke-width: .75; fill: none; }
  .dimension text { font-size: 9px; fill: #3d4a44; stroke: none; text-anchor: middle; }
  .clear-dimension { font-size: 8.5px; fill: #6a756c; }
  .axes line { stroke: #7f8b82; stroke-width: .55; stroke-dasharray: 7 4; opacity: .55; }
  .axis-label { font-size: 8.5px; fill: #6c786f; text-anchor: middle; }
  .opening-axis line { stroke: #8a6a4a; stroke-width: .55; stroke-dasharray: 3 2; }
  .opening-axis text { font-size: 7.5px; fill: #7b5c3e; }
  .section-line { stroke: #8b4d35; stroke-width: 1.1; stroke-dasharray: 10 4; fill: none; }
  .section-label { font-size: 11px; font-weight: 700; text-anchor: middle; fill: #8b4d35; }
  .section-arrow { fill: #8b4d35; }
  .north-arrow path { fill: #3c4a44; }
  .north-arrow text { font-size: 10px; font-weight: 600; text-anchor: middle; }
  .elevation-wall { fill: #e9e3d7; stroke: #4f584f; stroke-width: .8; }
  .elevation-line { stroke: #5b665d; stroke-width: .8; fill: none; }
  .elevation-roof-line { stroke: #7b5f3e; stroke-width: 1.4; fill: none; }
  .elevation-opening { fill: #e5eef0; stroke: #385e63; stroke-width: 1.1; }
  .elevation-frame { fill: none; stroke: #2f5257; stroke-width: 1.3; }
  .elevation-glass { fill: none; stroke: #7d9aa0; stroke-width: .7; }
  .elevation-label { font-size: 8px; text-anchor: middle; fill: #3f4a43; }
  .material { font-size: 9px; fill: #566159; }
  .section-room-shape { stroke: #647067; stroke-width: .7; }
  .section-room .section-room-shape { fill-opacity: .7; }
  .section-floor { fill: #c9c3b6; stroke: #504a43; stroke-width: .8; }
  .section-roof { fill: #d8cdbd; stroke: #504a43; stroke-width: .8; }
  .section-beam { fill: #b38f63; stroke: #644b30; stroke-width: .8; }
  .wall-cut { fill: #9a9184; stroke: #504a43; stroke-width: .65; }
  .wall-cut.interior { fill: #b3ac9d; }
  .frame-line { stroke: #8b6a45; stroke-width: .55; opacity: .75; }
  .section-room-label { font-size: 9px; text-anchor: middle; fill: #3f4a43; }
  .atika-label { font-size: 8.5px; fill: #8b4d35; }
  .detail-layer { stroke: #5e665d; stroke-width: .4; }
  .detail-outline { fill: none; stroke: #39433c; stroke-width: 1; }
  .detail-note { font-size: 9px; fill: #5f6a61; }
  .legend-row text { font-size: 9px; fill: #3f4a43; }
  .legend-row.excluded text { fill: #8a918a; }
  .legend-title { font-size: 11px; font-weight: 600; }
  .legend-total { font-size: 9px; fill: #5f6a61; }
  .detail-label { font-size: 9px; fill: #4e5a51; }
  .axo-floor { fill: #d8d1c3; stroke: #4f584f; stroke-width: .8; }
  .axo-terrace { fill: #e7d8c0; stroke: #8b7a5f; stroke-width: .7; }
  .axo-room-shape { stroke: #66726a; stroke-width: .5; stroke-opacity: .8; }
  .axo-private .axo-room-shape { fill: #d5ddcb; }
  .axo-social .axo-room-shape { fill: #e7cdb0; }
  .axo-service .axo-room-shape { fill: #e0dfd7; }
  .axo-private-service .axo-room-shape { fill: #dde2d4; }
  .axo-hall .axo-room-shape { fill: #ece9e1; }
  .axo-garage .axo-room-shape { fill: #d1d4ce; }
  .axo-terrace .axo-room-shape { fill: #e6d6be; }
  .axo-edge { stroke: #7b857d; stroke-width: .55; stroke-dasharray: 4 3; fill: none; }
  .axo-roof { fill: none; stroke: #8b6a45; stroke-width: .9; stroke-dasharray: 6 4; }
  .axo-beam-face { fill: #b38f63; stroke: #644b30; stroke-width: .7; fill-opacity: .9; }
  .axo-beam-face.side { fill: #9a7a52; }
  .axo-beam-label { font-size: 8px; fill: #5f452b; }
  .axo-room-label { font-size: 8px; text-anchor: middle; fill: #3f4a43; }
`;

function svgDocument({ kind, title, desc, width, height, body, drawingScale = null }) {
  drawingCounter += 1;
  const uid = drawingCounter;
  const titleId = `drawing-title-${uid}`;
  const descId = `drawing-desc-${uid}`;
  const calibrated = Number.isFinite(drawingScale) && drawingScale > 0;
  const printWidth = calibrated ? width / drawingScale * 10 : null;
  const scaleNote = calibrated ? SCALE_TEXT : kind === "axonometry" ? "Axonometrie bez závazného měřítka; rozměry v metrech" : "Schematický detail bez závazného měřítka; kóty a jednotky v metrech";
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${n(width)} ${n(height)}" role="img" aria-labelledby="${titleId} ${descId}" class="drawing drawing-${esc(kind)}" data-calibrated="${calibrated}"${calibrated ? ` style="--print-width:${n(printWidth, 3)}mm"` : ""}>
<title id="${titleId}">${esc(title)}</title>
<desc id="${descId}">${esc(desc)}</desc>
<style>${STYLE}</style>
<g class="drawing-body">
${body}
</g>
<g class="meta" aria-hidden="true">
<text x="24" y="${n(height - 30)}" class="units">Jednotky: m</text>
<text x="24" y="${n(height - 14)}" class="scale-note">${scaleNote}</text>
</g>
</svg>`;
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => n(value, 6)))].sort((a, b) => a - b);
}

function planLayout() {
  const factor = 44;
  const origin = [150, 145];
  const worldMaxY = Math.max(
    model.geometry.depth,
    ...model.rooms.flatMap((room) => room.polygon.map((point) => point[1])),
  );
  const project = ([x, y]) => [origin[0] + x * factor, origin[1] + y * factor];
  return {
    factor,
    origin,
    project,
    worldMaxY,
    width: origin[0] + model.geometry.width * factor + 230,
    height: origin[1] + worldMaxY * factor + 150,
  };
}

function createPlanOpening(opening, wall, project) {
  const normalLength = length(wall.inward) || 1;
  const inward = scale(wall.inward, 1 / normalLength);
  const thickness = wall.thickness;
  const innerA = wallPoint(wall, opening.from);
  const innerB = wallPoint(wall, opening.to);
  const outerA = add(innerA, scale(inward, thickness));
  const outerB = add(innerB, scale(inward, thickness));
  const width = opening.to - opening.from;
  const mid = add(wallPoint(wall, (opening.from + opening.to) / 2), scale(inward, thickness / 2));
  const result = {
    opening,
    wall,
    inward,
    mid,
    innerA,
    innerB,
    outerA,
    outerB,
    voidPath: polygonPath([innerA, innerB, outerB, outerA], project),
    innerLine: `M${n(project(innerA)[0])} ${n(project(innerA)[1])}L${n(project(innerB)[0])} ${n(project(innerB)[1])}`,
    outerLine: `M${n(project(outerA)[0])} ${n(project(outerA)[1])}L${n(project(outerB)[0])} ${n(project(outerB)[1])}`,
    jambA: `M${n(project(innerA)[0])} ${n(project(innerA)[1])}L${n(project(outerA)[0])} ${n(project(outerA)[1])}`,
    jambB: `M${n(project(innerB)[0])} ${n(project(innerB)[1])}L${n(project(outerB)[0])} ${n(project(outerB)[1])}`,
    glazing: [],
    panels: [],
    leaf: "",
    swing: "",
  };

  if (opening.type === "window") {
    for (const fraction of [0.35, 0.65]) {
      const offset = scale(inward, thickness * fraction);
      const a = add(innerA, offset);
      const b = add(innerB, offset);
      result.glazing.push(`M${n(project(a)[0])} ${n(project(a)[1])}L${n(project(b)[0])} ${n(project(b)[1])}`);
    }
  }

  if (opening.type === "sliding") {
    for (const fraction of [1 / 3, 2 / 3]) {
      const pointA = wallPoint(wall, opening.from + width * fraction);
      const pointB = add(pointA, scale(inward, thickness));
      result.panels.push(`M${n(project(pointA)[0])} ${n(project(pointA)[1])}L${n(project(pointB)[0])} ${n(project(pointB)[1])}`);
    }
  }

  if (opening.type === "door") {
    const hingeAtEnd = opening.hinge === "end";
    const hinge = wallPoint(wall, hingeAtEnd ? opening.to : opening.from);
    const other = wallPoint(wall, hingeAtEnd ? opening.from : opening.to);
    const leaf = add(hinge, scale(inward, width));
    const hingeSvg = project(hinge);
    const otherSvg = project(other);
    const leafSvg = project(leaf);
    const radius = distance(hingeSvg, otherSvg);
    const cross = (otherSvg[0] - hingeSvg[0]) * (leafSvg[1] - hingeSvg[1])
      - (otherSvg[1] - hingeSvg[1]) * (leafSvg[0] - hingeSvg[0]);
    const sweep = cross >= 0 ? 1 : 0;
    result.leaf = `M${n(hingeSvg[0])} ${n(hingeSvg[1])}L${n(leafSvg[0])} ${n(leafSvg[1])}`;
    result.swing = `M${n(otherSvg[0])} ${n(otherSvg[1])}A${n(radius)} ${n(radius)} 0 0 ${sweep} ${n(leafSvg[0])} ${n(leafSvg[1])}`;
  }

  return result;
}

function createPlanGeometry(layout) {
  const project = layout.project;
  return {
    rooms: model.rooms.map((room) => ({
      room,
      area: polygonArea(room.polygon),
      dims: clearDimensions(room.polygon),
      center: project(centroid(room.polygon)),
      d: polygonPath(room.polygon, project),
    })),
    walls: model.walls.map((wall) => ({
      wall,
      d: polygonPath(wallPolygon(wall), project),
    })),
    openings: model.openings
      .map((opening) => {
        const wall = model.walls.find((item) => item.id === opening.wall);
        return wall ? createPlanOpening(opening, wall, project) : null;
      })
      .filter(Boolean),
  };
}

function roomMarkup(item, technical) {
  const { room, area, dims, center, d } = item;
  const label = `${room.name.replace(/\s+/g, " ").trim()}, ${areaLabel(area)}`;
  const nameLines = technical ? [room.shortName] : room.name.split("\n");
  const extraLines = technical ? 2 : 1;
  const lineHeight = 11;
  const totalHeight = (nameLines.length + extraLines) * lineHeight;
  let y = center[1] - totalHeight / 2 + 10;
  const texts = [];
  for (const line of nameLines) {
    texts.push(`<text class="room-name" x="${n(center[0])}" y="${n(y)}">${esc(line)}</text>`);
    y += lineHeight;
  }
  texts.push(`<text class="room-area" x="${n(center[0])}" y="${n(y)}">${areaLabel(area)}</text>`);
  y += lineHeight;
  if (technical) {
    texts.push(`<text class="room-clear" x="${n(center[0])}" y="${n(y)}">${formatNumber(dims.width, 2)} × ${formatNumber(dims.depth, 2)} m</text>`);
  }
  return `<g class="room room-${esc(room.zone)}" data-room="${esc(room.id)}" data-area="${n(area)}" tabindex="0" role="button" aria-label="${esc(label)}">
<path class="room-shape" d="${d}"/>
${texts.join("\n")}
</g>`;
}

function planOpeningMarkup(item) {
  const { opening, voidPath, innerLine, outerLine, jambA, jambB, glazing, panels, leaf, swing } = item;
  const parts = [
    `<path class="opening-void" d="${voidPath}"/>`,
    `<path class="opening-frame" d="${jambA}"/>`,
    `<path class="opening-frame" d="${jambB}"/>`,
  ];
  if (glazing.length) {
    parts.push(`<path class="opening-glass" d="${glazing.join(" ")}"/>`);
  }
  if (panels.length) {
    parts.push(`<path class="opening-glass" d="${panels.join(" ")}"/>`);
  }
  if (leaf) parts.push(`<path class="door-leaf" d="${leaf}"/>`);
  if (swing) parts.push(`<path class="door-swing" d="${swing}"/>`);
  if (opening.type === "garage") {
    parts.push(`<path class="opening-frame" d="${innerLine}"/><path class="opening-frame" d="${outerLine}"/>`);
  }
  return `<g class="opening opening-${esc(opening.type)}" data-opening="${esc(opening.id)}">
${parts.join("\n")}
</g>`;
}

function planAxesMarkup(layout) {
  const xs = [0, model.geometry.width];
  const ys = [0, model.geometry.depth];
  for (const wall of model.walls) {
    if (Math.abs(wall.start[0] - wall.end[0]) < EPS) xs.push(wall.start[0]);
    if (Math.abs(wall.start[1] - wall.end[1]) < EPS) ys.push(wall.start[1]);
  }
  const xAxes = uniqueSorted(xs);
  const yAxes = uniqueSorted(ys);
  const { project } = layout;
  const vertical = xAxes.map((x, index) => {
    const [sx, sy1] = project([x, -0.55]);
    const [, sy2] = project([x, model.geometry.depth + 0.55]);
    const [, labelY] = project([x, -0.75]);
    return `<line x1="${n(sx)}" y1="${n(sy1)}" x2="${n(sx)}" y2="${n(sy2)}"/><text class="axis-label" x="${n(sx)}" y="${n(labelY)}">${index + 1}</text>`;
  }).join("\n");
  const horizontal = yAxes.map((y, index) => {
    const [sx1, sy] = project([-0.55, y]);
    const [sx2] = project([model.geometry.width + 0.55, y]);
    const [labelX] = project([-0.85, y]);
    return `<line x1="${n(sx1)}" y1="${n(sy)}" x2="${n(sx2)}" y2="${n(sy)}"/><text class="axis-label" x="${n(labelX)}" y="${n(sy + 3)}">${String.fromCharCode(65 + index)}</text>`;
  }).join("\n");
  return `<g class="axes" aria-hidden="true">
${vertical}
${horizontal}
</g>`;
}

function planOpeningAxesMarkup(geometry, project) {
  return `<g class="opening-axes" aria-hidden="true">
${geometry.openings.map((item) => {
    const { opening, inward, mid, wall } = item;
    const start = add(mid, scale(inward, -0.45));
    const end = add(mid, scale(inward, wall.thickness + 0.45));
    const [x1, y1] = project(start);
    const [x2, y2] = project(end);
    const [lx, ly] = project(add(end, scale(inward, 0.12)));
    return `<g class="opening-axis" data-opening-axis="${esc(opening.id)}"><line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/><text x="${n(lx)}" y="${n(ly)}">${esc(opening.id)}</text></g>`;
  }).join("\n")}
</g>`;
}

function planBeamsMarkup(layout) {
  const { project, factor } = layout;
  return `<g class="beams" aria-hidden="true">
${model.beams.map((beam) => {
    const [x1, y1] = project(beam.start);
    const [x2, y2] = project(beam.end);
    const width = Math.max(2, beam.width * factor);
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const label = `${beam.id} · ${beam.material} · ${millimeters(beam.depth)}`;
    return `<g data-beam="${esc(beam.id)}"><line class="beam" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke-width="${n(width)}"/><text class="beam-label" x="${n(midX)}" y="${n(midY - width / 2 - 4)}">${esc(label)}</text></g>`;
  }).join("\n")}
</g>`;
}

function horizontalPlanDimension(project, from, to, y, label, extensionFrom = null) {
  const [x1, dimensionY] = project([from, y]);
  const [x2] = project([to, y]);
  const tick = 5;
  let extension = "";
  if (extensionFrom !== null) {
    const [ex1, ey1] = project([from, extensionFrom]);
    const [ex2, ey2] = project([to, extensionFrom]);
    extension = `<path d="M${n(ex1)} ${n(ey1)}V${n(dimensionY - 5)}M${n(ex2)} ${n(ey2)}V${n(dimensionY - 5)}"/>`;
  }
  return `<g class="dimension">${extension}<path d="M${n(x1)} ${n(dimensionY)}H${n(x2)}"/><path d="M${n(x1)} ${n(dimensionY - tick)}V${n(dimensionY + tick)}M${n(x2)} ${n(dimensionY - tick)}V${n(dimensionY + tick)}"/><text x="${n((x1 + x2) / 2)}" y="${n(dimensionY - 6)}">${esc(label)}</text></g>`;
}

function verticalPlanDimension(project, from, to, x, label, extensionFrom = null) {
  const [dimensionX, y1] = project([x, from]);
  const [, y2] = project([x, to]);
  const tick = 5;
  let extension = "";
  if (extensionFrom !== null) {
    const [ex1, ey1] = project([extensionFrom, from]);
    const [ex2, ey2] = project([extensionFrom, to]);
    extension = `<path d="M${n(ex1)} ${n(ey1)}H${n(dimensionX - 5)}M${n(ex2)} ${n(ey2)}H${n(dimensionX - 5)}"/>`;
  }
  const midY = (y1 + y2) / 2;
  return `<g class="dimension">${extension}<path d="M${n(dimensionX)} ${n(y1)}V${n(y2)}"/><path d="M${n(dimensionX - tick)} ${n(y1)}H${n(dimensionX + tick)}M${n(dimensionX - tick)} ${n(y2)}H${n(dimensionX + tick)}"/><text x="${n(dimensionX - 7)}" y="${n(midY)}" transform="rotate(-90 ${n(dimensionX - 7)} ${n(midY)})">${esc(label)}</text></g>`;
}

function sectionPositions() {
  const beam = model.beams.find((item) => item.id === "B1");
  const northWall = model.walls.find((item) => item.id === "p-north");
  const wcSouth = model.walls.find((item) => item.id === "p-wc-south");
  return {
    A: beam ? beam.start[0] : model.geometry.width / 2,
    B: northWall && wcSouth ? (northWall.start[1] + wcSouth.start[1]) / 2 : model.geometry.depth / 3,
  };
}

function planDimensionsMarkup(layout) {
  const { project } = layout;
  const width = model.geometry.width;
  const depth = model.geometry.depth;
  const terrace = model.geometry.terrace;
  return `<g class="plan-dimensions" aria-hidden="true">
${horizontalPlanDimension(project, 0, width, -1.05, measure(width), 0)}
${verticalPlanDimension(project, 0, depth, -1.05, measure(depth), 0)}
${horizontalPlanDimension(project, 0, terrace.width, layout.worldMaxY + 0.8, `terasa ${formatNumber(terrace.width, 2)} × ${formatNumber(terrace.depth, 2)} m`, layout.worldMaxY)}
</g>`;
}

function planSectionMarksMarkup(layout) {
  const { project } = layout;
  const positions = sectionPositions();
  const [ax, ay1] = project([positions.A, -0.6]);
  const [, ay2] = project([positions.A, model.geometry.depth + 0.6]);
  const [bx1, by] = project([-0.6, positions.B]);
  const [bx2] = project([model.geometry.width + 0.6, positions.B]);
  return `<g class="section-marks" aria-hidden="true">
<g class="section-mark" data-section="A"><path class="section-line" d="M${n(ax)} ${n(ay1)}V${n(ay2)}"/><path class="section-arrow" d="M${n(ax + 3)} ${n(ay1 - 5)}L${n(ax + 13)} ${n(ay1)}L${n(ax + 3)} ${n(ay1 + 5)}Z"/><path class="section-arrow" d="M${n(ax + 3)} ${n(ay2 - 5)}L${n(ax + 13)} ${n(ay2)}L${n(ax + 3)} ${n(ay2 + 5)}Z"/><circle cx="${n(ax - 16)}" cy="${n(ay1)}" r="9" fill="#fcfbf7" stroke="#8b4d35"/><text class="section-label" x="${n(ax - 16)}" y="${n(ay1 + 4)}">A</text><circle cx="${n(ax - 16)}" cy="${n(ay2)}" r="9" fill="#fcfbf7" stroke="#8b4d35"/><text class="section-label" x="${n(ax - 16)}" y="${n(ay2 + 4)}">A</text></g>
<g class="section-mark" data-section="B"><path class="section-line" d="M${n(bx1)} ${n(by)}H${n(bx2)}"/><path class="section-arrow" d="M${n(bx1 - 5)} ${n(by - 3)}L${n(bx1)} ${n(by - 13)}L${n(bx1 + 5)} ${n(by - 3)}Z"/><path class="section-arrow" d="M${n(bx2 - 5)} ${n(by - 3)}L${n(bx2)} ${n(by - 13)}L${n(bx2 + 5)} ${n(by - 3)}Z"/><circle cx="${n(bx1)}" cy="${n(by - 24)}" r="9" fill="#fcfbf7" stroke="#8b4d35"/><text class="section-label" x="${n(bx1)}" y="${n(by - 20)}">B</text><circle cx="${n(bx2)}" cy="${n(by - 24)}" r="9" fill="#fcfbf7" stroke="#8b4d35"/><text class="section-label" x="${n(bx2)}" y="${n(by - 20)}">B</text></g>
</g>`;
}

function northArrowMarkup(layout) {
  const [x, y] = [layout.width - 95, layout.origin[1] + 45];
  return `<g class="north-arrow" aria-hidden="true" transform="translate(${n(x)} ${n(y)})"><path d="M0 -20L8 8L0 3L-8 8Z"/><path d="M0 3V34" stroke="#3c4a44" stroke-width="1.2" fill="none"/><text x="0" y="-27">S</text><text x="0" y="50">SEVER</text></g>`;
}

export function renderFloorplan({ technical = false } = {}) {
  const layout = planLayout();
  const geometry = createPlanGeometry(layout);
  const rooms = geometry.rooms.map((item) => roomMarkup(item, technical)).join("\n");
  const walls = geometry.walls.map((item) => `<path class="wall wall-${item.wall.exterior ? "exterior" : "interior"}" data-wall="${esc(item.wall.id)}" d="${item.d}"/>`).join("\n");
  const openings = geometry.openings.map((item) => planOpeningMarkup(item)).join("\n");
  const technicalLayer = technical
    ? [
        planAxesMarkup(layout),
        planOpeningAxesMarkup(geometry, layout.project),
        planBeamsMarkup(layout),
        planDimensionsMarkup(layout),
        planSectionMarksMarkup(layout),
      ].join("\n")
    : "";
  const body = `<text class="drawing-title" x="24" y="32">PŮDORYS 1. NP${technical ? " — TECHNICKÝ" : ""}</text>
<text class="drawing-subtitle" x="24" y="50">${esc(model.id)} · ${technical ? "vnější kóty, osy, otvory a nosné prvky" : "prezentační půdorys s místnostmi a otvory"}</text>
${rooms}
<g class="walls" aria-hidden="true">${walls}</g>
<g class="openings" aria-hidden="true">${openings}</g>
${technicalLayer}
${northArrowMarkup(layout)}`;
  return svgDocument({
    kind: "floorplan",
    title: `Půdorys 1. NP — ${model.id}${technical ? " — technický" : ""}`,
    desc: `Půdorys přízemí domu ${model.id} s ${model.rooms.length} místnostmi, stěnami v tloušťkách z modelu a otvory. Plochy místností jsou vypočteny z geometrie. ${technical ? "Technický režim obsahuje vnější kóty, osy, osy otvorů, čisté rozměry, nosné průvlaky, značky řezů A-A a B-B a severku." : "Prezentační režim sdílí stejnou geometrii s technickým půdorysem."}`,
    width: layout.width,
    height: layout.height,
    body,
    drawingScale: layout.factor,
  });
}

function elevationMirror(wall) {
  const wallLen = wallLength(wall);
  if (!wallLen) return false;
  const u = scale(sub(wall.end, wall.start), 1 / wallLen);
  const normalLength = length(wall.inward) || 1;
  const inward = scale(wall.inward, 1 / normalLength);
  const right = [inward[1], -inward[0]];
  return right[0] * u[0] + right[1] * u[1] < 0;
}

function screenVerticalDimension(x, yTop, yBottom, label, textSide = -1) {
  const tick = 5;
  const textX = x + textSide * 7;
  const midY = (yTop + yBottom) / 2;
  return `<g class="dimension"><path d="M${n(x)} ${n(yTop)}V${n(yBottom)}"/><path d="M${n(x - tick)} ${n(yTop)}H${n(x + tick)}M${n(x - tick)} ${n(yBottom)}H${n(x + tick)}"/><text x="${n(textX)}" y="${n(midY)}" transform="rotate(-90 ${n(textX)} ${n(midY)})">${esc(label)}</text></g>`;
}

export function renderElevation(wallId) {
  const wall = model.walls.find((item) => item.id === wallId);
  if (!wall) throw new RangeError(`Neznámý bokorys: ${wallId}`);
  const wallLen = wallLength(wall);
  const factor = 46;
  const originX = 170;
  const originY = 105;
  const parapet = model.geometry.parapetTop;
  const roofTop = model.geometry.roofTop;
  const clearHeight = model.geometry.clearHeight;
  const mirror = elevationMirror(wall);
  const xOf = (along) => originX + (mirror ? wallLen - along : along) * factor;
  const yOf = (z) => originY + (parapet - z) * factor;
  const widthPx = wallLen * factor;
  const heightPx = parapet * factor;
  const width = originX + widthPx + 190;
  const height = originY + heightPx + 130;
  const openings = openingsForWall(wall.id)
    .map((opening) => {
      const from = xOf(opening.from);
      const to = xOf(opening.to);
      return { opening, from: Math.min(from, to), to: Math.max(from, to) };
    })
    .sort((a, b) => a.from - b.from);

  const openingMarkup = openings.map(({ opening, from, to }) => {
    const x = from;
    const w = to - from;
    const top = yOf(opening.bottom + opening.height);
    const bottom = yOf(opening.bottom);
    const h = bottom - top;
    const panels = Math.max(1, Math.round((to - from) / (factor * 1.2)));
    const separators = [];
    for (let index = 1; index < panels; index += 1) {
      const px = x + (w * index) / panels;
      separators.push(`<path class="elevation-glass" d="M${n(px)} ${n(top)}V${n(bottom)}"/>`);
    }
    if (opening.type === "garage") {
      for (const fraction of [0.2, 0.4, 0.6, 0.8]) {
        const py = top + h * fraction;
        separators.push(`<path class="elevation-glass" d="M${n(x)} ${n(py)}H${n(x + w)}"/>`);
      }
    }
    if (opening.type === "door") {
      separators.push(`<circle cx="${n(x + w * 0.78)}" cy="${n(top + h * 0.5)}" r="2" fill="#2f5257"/>`);
    }
    return `<g class="elevation-opening-group" data-opening-group="${esc(opening.id)}"><rect class="elevation-opening opening-${esc(opening.type)}" data-opening="${esc(opening.id)}" data-bottom="${n(opening.bottom)}" data-height="${n(opening.height)}" x="${n(x)}" y="${n(top)}" width="${n(w)}" height="${n(h)}"/><rect class="elevation-frame" x="${n(x + 1)}" y="${n(top + 1)}" width="${n(Math.max(0, w - 2))}" height="${n(Math.max(0, h - 2))}"/>${separators.join("")}<text class="elevation-label" x="${n(x + w / 2)}" y="${n(top - 4)}">${esc(opening.label)}</text></g>`;
  }).join("\n");

  const body = `<text class="drawing-title" x="24" y="32">POHLED ${esc(wall.side.toUpperCase())}</text>
<text class="drawing-subtitle" x="24" y="50">${esc(model.id)} · fasáda ${esc(wall.side.toLowerCase())} · ${measure(wallLen)} · materiál: ${esc(wall.material ?? "—")}</text>
<rect class="elevation-wall" data-wall="${esc(wall.id)}" x="${n(originX)}" y="${n(yOf(parapet))}" width="${n(widthPx)}" height="${n(yOf(0) - yOf(parapet))}"/>
<path class="elevation-roof-line" d="M${n(originX)} ${n(yOf(roofTop))}H${n(originX + widthPx)}"/>
<path class="elevation-line" d="M${n(originX)} ${n(yOf(0))}H${n(originX + widthPx)}"/>
<path class="elevation-line" d="M${n(originX)} ${n(yOf(parapet))}H${n(originX + widthPx)}"/>
${openingMarkup}
<text class="material" x="${n(originX + 8)}" y="${n(yOf(roofTop) - 8)}">${esc(wall.material ?? "")}</text>
${screenVerticalDimension(originX - 55, yOf(parapet), yOf(0), measure(parapet))}
${screenVerticalDimension(originX - 105, yOf(clearHeight), yOf(0), `ČH ${measure(clearHeight)}`)}
${screenVerticalDimension(originX + widthPx + 45, yOf(roofTop), yOf(0), measure(roofTop), 1)}
${screenVerticalDimension(originX + widthPx + 45, yOf(parapet), yOf(roofTop), `atika ${measure(parapet - roofTop)}`, 1)}
${horizontalPlanDimension(([x, y]) => [x, y], originX, originX + widthPx, yOf(0) + 52, measure(wallLen))}`;

  return svgDocument({
    kind: "elevation",
    title: `Pohled — ${wall.side.toLowerCase()} — ${model.id}`,
    desc: `Bokorys fasády ${wall.side.toLowerCase()} domu ${model.id}. Délka stěny ${measure(wallLen)}, výšky a otvory jsou převzaty z modelu. Obsahuje ${openings.length} otvorů a výškové kóty.`,
    width,
    height,
    body,
    drawingScale: factor,
  });
}

function sliceIntervals(polygon, axis, at) {
  const cutIndex = axis === "x" ? 0 : 1;
  const alongIndex = 1 - cutIndex;
  const values = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const da = a[cutIndex] - at;
    const db = b[cutIndex] - at;
    if (Math.abs(da) <= EPS && Math.abs(db) <= EPS) {
      values.push(a[alongIndex], b[alongIndex]);
    } else if ((da <= EPS && db >= -EPS) || (da >= -EPS && db <= EPS)) {
      if (Math.abs(db - da) > EPS) {
        const t = da / (da - db);
        values.push(a[alongIndex] + t * (b[alongIndex] - a[alongIndex]));
      }
    }
  }
  const sorted = uniqueSorted(values);
  const intervals = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index];
    const to = sorted[index + 1];
    if (to - from < 1e-6) continue;
    const mid = (from + to) / 2;
    const point = axis === "x" ? [at, mid] : [mid, at];
    if (pointInPolygon(point, polygon, true)) intervals.push({ from, to });
  }
  const merged = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(interval.from - last.to) < 1e-5) last.to = interval.to;
    else merged.push({ ...interval });
  }
  return merged;
}

function sectionDefinition(id) {
  const positions = sectionPositions();
  if (id === "A") {
    return {
      id: "A",
      label: "A-A",
      axis: "x",
      at: positions.A,
      alongMin: 0,
      alongMax: model.geometry.depth,
      title: "ŘEZ A-A — obytný prostor",
      subtitle: "Podélný řez obytným prostorem, střecha, podlaha, rám a atika.",
    };
  }
  if (id === "B") {
    return {
      id: "B",
      label: "B-B",
      axis: "y",
      at: positions.B,
      alongMin: 0,
      alongMax: model.geometry.width,
      title: "ŘEZ B-B — servisní a ložnicová část",
      subtitle: "Příčný řez servisním zázemím a ložnicovým křídlem.",
    };
  }
  throw new RangeError(`Neznámý řez: ${id}`);
}

function horizontalScreenDimension(x1, x2, y, label) {
  const tick = 5;
  return `<g class="dimension"><path d="M${n(x1)} ${n(y)}H${n(x2)}"/><path d="M${n(x1)} ${n(y - tick)}V${n(y + tick)}M${n(x2)} ${n(y - tick)}V${n(y + tick)}"/><text x="${n((x1 + x2) / 2)}" y="${n(y - 6)}">${esc(label)}</text></g>`;
}

export function renderSection(id = "A") {
  const definition = sectionDefinition(id);
  const factor = 42;
  const originX = 130;
  const originY = 95;
  const parapet = model.geometry.parapetTop;
  const roofTop = model.geometry.roofTop;
  const clearHeight = model.geometry.clearHeight;
  const floorAssembly = model.assemblies.floor;
  const roofAssembly = model.assemblies.roof;
  const floorThickness = assemblyThickness(floorAssembly);
  const xOf = (along) => originX + (along - definition.alongMin) * factor;
  const yOf = (z) => originY + (parapet - z) * factor;
  const widthPx = (definition.alongMax - definition.alongMin) * factor;
  const width = originX + widthPx + 230;
  const height = originY + (parapet + floorThickness) * factor + 130;

  const roomParts = [];
  for (const room of model.rooms) {
    if (room.id === "terrace") continue;
    for (const interval of sliceIntervals(room.polygon, definition.axis, definition.at)) {
      if (interval.to - interval.from < 0.05) continue;
      const x = xOf(interval.from);
      const w = (interval.to - interval.from) * factor;
      const yTop = yOf(clearHeight);
      const yBottom = yOf(0);
      roomParts.push(`<g class="section-room room-${esc(room.zone)}" data-room="${esc(room.id)}"><rect class="section-room-shape" x="${n(x)}" y="${n(yTop)}" width="${n(w)}" height="${n(yBottom - yTop)}"/><text class="section-room-label" x="${n(x + w / 2)}" y="${n(yBottom - 10)}">${esc(room.shortName)}</text></g>`);
    }
  }

  const floorBands = [];
  let floorCursor = yOf(0);
  floorAssembly.layers.forEach((layer, index) => {
    const bandHeight = (Number(layer.d) || 0) * factor;
    floorBands.push(`<rect class="detail-layer" data-layer="${esc(layer.name)}" x="${n(originX)}" y="${n(floorCursor)}" width="${n(widthPx)}" height="${n(bandHeight)}" fill="${LAYER_FILLS[index % LAYER_FILLS.length]}"/>`);
    floorCursor += bandHeight;
  });

  const roofBands = [];
  let roofCursor = yOf(model.geometry.ceilingUnderside);
  roofAssembly.layers.forEach((layer, index) => {
    const bandHeight = (Number(layer.d) || 0) * factor;
    roofBands.push(`<rect class="detail-layer" data-layer="${esc(layer.name)}" x="${n(originX)}" y="${n(roofCursor - bandHeight)}" width="${n(widthPx)}" height="${n(bandHeight)}" fill="${LAYER_FILLS[index % LAYER_FILLS.length]}"/>`);
    roofCursor -= bandHeight;
  });

  const frameLines = [];
  const module = model.geometry.kvhModule;
  if (module > 0) {
    for (let along = definition.alongMin + module; along < definition.alongMax; along += module) {
      const x = xOf(along);
      frameLines.push(`<path class="frame-line" d="M${n(x)} ${n(yOf(roofTop))}V${n(yOf(model.geometry.ceilingUnderside))}"/>`);
    }
  }

  const wallParts = [];
  for (const wall of model.walls) {
    for (const interval of sliceIntervals(wallPolygon(wall), definition.axis, definition.at)) {
      if (interval.to - interval.from < 0.01) continue;
      const x = xOf(interval.from);
      const w = (interval.to - interval.from) * factor;
      const top = wall.exterior ? parapet : model.geometry.ceilingUnderside;
      wallParts.push(`<rect class="wall-cut ${wall.exterior ? "exterior" : "interior"}" data-wall="${esc(wall.id)}" x="${n(x)}" y="${n(yOf(top))}" width="${n(w)}" height="${n(yOf(0) - yOf(top))}"/>`);
    }
  }

  const beamParts = [];
  for (const beam of model.beams) {
    const inPlane = definition.axis === "x"
      ? Math.abs(beam.start[0] - definition.at) < EPS && Math.abs(beam.end[0] - definition.at) < EPS && Math.abs(beam.start[0] - beam.end[0]) < EPS
      : Math.abs(beam.start[1] - definition.at) < EPS && Math.abs(beam.end[1] - definition.at) < EPS && Math.abs(beam.start[1] - beam.end[1]) < EPS;
    if (!inPlane) continue;
    const alongStart = definition.axis === "x" ? Math.min(beam.start[1], beam.end[1]) : Math.min(beam.start[0], beam.end[0]);
    const alongEnd = definition.axis === "x" ? Math.max(beam.start[1], beam.end[1]) : Math.max(beam.start[0], beam.end[0]);
    const x = xOf(alongStart);
    const w = (alongEnd - alongStart) * factor;
    const yTop = yOf(beam.z);
    const yBottom = yOf(beam.z - beam.depth);
    beamParts.push(`<g data-beam="${esc(beam.id)}"><rect class="section-beam" x="${n(x)}" y="${n(yTop)}" width="${n(w)}" height="${n(yBottom - yTop)}"/><text class="beam-label" x="${n(x + w / 2)}" y="${n(yTop - 5)}">${esc(beam.id)} · ${esc(beam.material)} · ${millimeters(beam.depth)}</text></g>`);
  }

  const body = `<g class="section" data-section="${esc(definition.id)}">
<text class="drawing-title" x="24" y="32">${esc(definition.title)}</text>
<text class="drawing-subtitle" x="24" y="50">${esc(model.id)} · ${esc(definition.subtitle)} · ${esc(roofAssembly.label)} · ${esc(floorAssembly.label)}</text>
${roomParts.join("\n")}
<rect class="section-floor" x="${n(originX)}" y="${n(yOf(0))}" width="${n(widthPx)}" height="${n(floorThickness * factor)}"/>
${floorBands.join("\n")}
<rect class="section-roof" x="${n(originX)}" y="${n(yOf(roofTop))}" width="${n(widthPx)}" height="${n((roofTop - model.geometry.ceilingUnderside) * factor)}"/>
${roofBands.join("\n")}
${frameLines.join("\n")}
<g class="section-walls" aria-hidden="true">${wallParts.join("\n")}</g>
${beamParts.join("\n")}
<text class="material" x="${n(originX + 8)}" y="${n(yOf(roofTop) - 8)}">${esc(roofAssembly.label)} · rám KVH ${formatNumber(model.geometry.kvhWidth * 1000, 0)}/${formatNumber(module * 1000, 0)} mm</text>
<text class="atika-label" x="${n(originX + widthPx - 4)}" y="${n(yOf(parapet) + 12)}" text-anchor="end">atika +${measure(parapet - roofTop)}</text>
${screenVerticalDimension(originX + widthPx + 45, yOf(parapet), yOf(0), measure(parapet), 1)}
${screenVerticalDimension(originX + widthPx + 45, yOf(parapet), yOf(roofTop), `atika ${measure(parapet - roofTop)}`, 1)}
${screenVerticalDimension(originX + widthPx + 100, yOf(clearHeight), yOf(0), `čistá výška ${measure(clearHeight)}`, 1)}
${horizontalScreenDimension(originX, originX + widthPx, yOf(0) + 56, measure(definition.alongMax - definition.alongMin))}
</g>`;

  return svgDocument({
    kind: "section",
    title: `${definition.title} — ${model.id}`,
    desc: `Řez ${definition.label} domu ${model.id}. ${definition.subtitle} Střecha, podlaha, nosný rám, čistá výška a atika vycházejí z modelu.`,
    width,
    height,
    body,
    drawingScale: factor,
  });
}

function layerLegend(assembly, x, y, { width = 360, title = null } = {}) {
  const total = assemblyThickness(assembly);
  const rows = assembly.layers.map((layer, index) => {
    const excluded = layer.counted === false;
    const thickness = Number.isFinite(Number(layer.d)) ? millimeters(layer.d) : "—";
    return `<g class="legend-row${excluded ? " excluded" : ""}" data-layer="${esc(layer.name)}"><rect x="${n(x)}" y="${n(y + 24 + index * 20)}" width="16" height="12" fill="${LAYER_FILLS[index % LAYER_FILLS.length]}" stroke="#5e665d"/><text x="${n(x + 24)}" y="${n(y + 34 + index * 20)}">${esc(layer.name)}${excluded ? " (mimo R)" : ""}</text><text x="${n(x + width)}" y="${n(y + 34 + index * 20)}" text-anchor="end">${esc(thickness)}</text></g>`;
  }).join("\n");
  return `<g class="assembly-legend" data-assembly="${esc(assembly.label)}"><text class="legend-title" x="${n(x)}" y="${n(y + 12)}">${esc(title ?? assembly.label)}</text>${rows}<text class="legend-total" x="${n(x)}" y="${n(y + 32 + assembly.layers.length * 20)}">Celkem ${millimeters(total)} · Rsi ${formatNumber(assembly.rsi, 2)} · Rse ${formatNumber(assembly.rse, 2)} m²K/W</text></g>`;
}

function detailHeading(type, title, subtitle) {
  return `<g class="detail" data-detail="${esc(type)}"><text class="drawing-title" x="24" y="32">${esc(title)}</text><text class="drawing-subtitle" x="24" y="50">${esc(subtitle)}</text>`;
}

function verticalLayerStripes(assembly, { x, y, height, factor }) {
  let cursor = x;
  const markup = assembly.layers.map((layer, index) => {
    const bandWidth = (Number(layer.d) || 0) * factor;
    const rect = `<rect class="detail-layer" data-layer="${esc(layer.name)}" x="${n(cursor)}" y="${n(y)}" width="${n(bandWidth)}" height="${n(height)}" fill="${LAYER_FILLS[index % LAYER_FILLS.length]}"/>`;
    cursor += bandWidth;
    return rect;
  }).join("\n");
  return { markup, end: cursor };
}

function horizontalLayerBands(assembly, { x, y, width, factor, direction = 1 }) {
  let cursor = y;
  const markup = assembly.layers.map((layer, index) => {
    const bandHeight = (Number(layer.d) || 0) * factor;
    const bandY = direction > 0 ? cursor : cursor - bandHeight;
    const rect = `<rect class="detail-layer" data-layer="${esc(layer.name)}" x="${n(x)}" y="${n(bandY)}" width="${n(width)}" height="${n(bandHeight)}" fill="${LAYER_FILLS[index % LAYER_FILLS.length]}"/>`;
    cursor += direction * bandHeight;
    return rect;
  }).join("\n");
  return { markup, end: cursor };
}

function noteLines(text, x, y, maxChars = 100) {
  return wrapText(text, maxChars).map((line, index) => `<text class="detail-note" x="${n(x)}" y="${n(y + index * 13)}">${esc(line)}</text>`).join("\n");
}

function renderWallDetail() {
  const assembly = model.assemblies.wall;
  const total = assemblyThickness(assembly);
  const factor = 720;
  const x = 90;
  const y = 150;
  const bandHeight = 250;
  const stripes = verticalLayerStripes(assembly, { x, y, height: bandHeight, factor });
  const body = `${detailHeading("wall", "DETAIL OBVODOVÉ STĚNY", `${assembly.label} · ${millimeters(total)} · ${assembly.note}`)}
${stripes.markup}
<rect class="detail-outline" x="${n(x)}" y="${n(y)}" width="${n(total * factor)}" height="${n(bandHeight)}"/>
<text class="detail-label" x="${n(x - 10)}" y="${n(y + bandHeight / 2)}" text-anchor="end">INTERIÉR</text>
<text class="detail-label" x="${n(x + total * factor + 10)}" y="${n(y + bandHeight / 2)}">EXTERIÉR</text>
${horizontalScreenDimension(x, x + total * factor, y + bandHeight + 38, millimeters(total))}
${layerLegend(assembly, 560, 120, { width: 430 })}
${noteLines(assembly.note, 560, 340, 68)}
${noteLines("Skladba je převzata z model.assemblies.wall; rozměry vrstev jsou pouze schematické.", 560, 394, 68)}
</g>`;
  return svgDocument({
    kind: "detail",
    title: `Detail obvodové stěny — ${model.id}`,
    desc: `Skladba obvodové stěny z model.assemblies.wall: ${assembly.layers.map((layer) => layer.name).join(", ")}. Celková tloušťka ${millimeters(total)}.`,
    width: 1060,
    height: 700,
    body,
  });
}

function renderFoundationDetail() {
  const wall = model.assemblies.wall;
  const floor = model.assemblies.floor;
  const wallTotal = assemblyThickness(wall);
  const floorTotal = assemblyThickness(floor);
  const x = 120;
  const wallTopY = 150;
  const groundY = 330;
  const wallHeight = groundY - wallTopY;
  const wallStripes = verticalLayerStripes(wall, { x, y: wallTopY, height: wallHeight, factor: 600 });
  const floorBands = horizontalLayerBands(floor, { x: 110, y: groundY, width: 560, factor: 380, direction: 1 });
  const body = `${detailHeading("foundation", "DETAIL ZÁKLADU", `${wall.label} + ${floor.label} · schematický základ bez rozměrového posouzení`)}
${wallStripes.markup}
<rect class="detail-outline" x="${n(x)}" y="${n(wallTopY)}" width="${n(wallTotal * 600)}" height="${n(wallHeight)}"/>
<path class="detail-outline" d="M60 ${n(groundY)}H760"/>
${floorBands.markup}
<rect class="detail-layer" x="220" y="${n(floorBands.end)}" width="250" height="62" fill="#b8b2a5" stroke="#504a43"/>
<text class="detail-label" x="345" y="${n(floorBands.end + 36)}" text-anchor="middle">ZÁKLAD — SCHEMATICKY</text>
<text class="detail-label" x="${n(x - 10)}" y="${n(wallTopY + wallHeight / 2)}" text-anchor="end">STĚNA</text>
<text class="detail-label" x="760" y="${n(groundY - 8)}">±0,000</text>
<text class="detail-label" x="760" y="${n(groundY + 20)}">PODLAHA</text>
${layerLegend(wall, 780, 120, { width: 260, title: "Obvodová stěna" })}
${layerLegend(floor, 780, 380, { width: 260, title: "Podlaha domu" })}
${noteLines("Základ je schematický a neslouží k rozměrovému posouzení. Skladba podlahy je převzata z model.assemblies.floor.", 40, 640, 150)}
</g>`;
  return svgDocument({
    kind: "detail",
    title: `Detail základu — ${model.id}`,
    desc: `Schematický detail základu se skladbou stěny a podlahy z modelu. ${model.assemblies.floor.note} Bez rozměrového posouzení základu.`,
    width: 1080,
    height: 700,
    body,
  });
}

function renderParapetDetail() {
  const wall = model.assemblies.wall;
  const roof = model.assemblies.roof;
  const wallTotal = assemblyThickness(wall);
  const roofTotal = assemblyThickness(roof);
  const parapet = model.geometry.parapetTop;
  const roofTop = model.geometry.roofTop;
  const ceiling = model.geometry.ceilingUnderside;
  const factor = 400;
  const wallX = 100;
  const wallTop = 160;
  const wallBottom = 540;
  const yOf = (z) => wallTop + (parapet - z) * factor;
  const wallStripes = verticalLayerStripes(wall, { x: wallX, y: wallTop, height: wallBottom - wallTop, factor: 560 });
  const roofBands = horizontalLayerBands(roof, { x: wallX + wallTotal * 560, y: yOf(ceiling), width: 520, factor: 340, direction: -1 });
  const atika = parapet - roofTop;
  const body = `${detailHeading("parapet", "DETAIL ATIKY", `${wall.label} + ${roof.label} · napojení atiky a střechy · atika +${measure(atika)}`)}
${wallStripes.markup}
<rect class="detail-outline" x="${n(wallX)}" y="${n(wallTop)}" width="${n(wallTotal * 560)}" height="${n(wallBottom - wallTop)}"/>
<rect class="detail-layer" x="${n(wallX - 20)}" y="${n(wallTop - 12)}" width="${n(wallTotal * 560 + 60)}" height="12" fill="#8f887b" stroke="#504a43"/>
${roofBands.markup}
<path class="detail-outline" d="M${n(wallX + wallTotal * 560)} ${n(yOf(roofTop))}H${n(wallX + wallTotal * 560 + 540)}"/>
<text class="detail-label" x="${n(wallX - 10)}" y="${n(wallTop + 180)}" text-anchor="end">STĚNA</text>
<text class="detail-label" x="${n(wallX + wallTotal * 560 + 12)}" y="${n(yOf(ceiling) + 14)}">STŘECHA</text>
<text class="atika-label" x="${n(wallX + wallTotal * 560 + 20)}" y="${n(wallTop + 18)}">ATIKA +${measure(atika)}</text>
<text class="detail-label" x="${n(wallX + wallTotal * 560 + 12)}" y="${n(yOf(roofTop) - 8)}">střecha +${measure(roofTop)}</text>
${layerLegend(wall, 790, 130, { width: 290, title: "Obvodová stěna" })}
${layerLegend(roof, 790, 400, { width: 290, title: "Lehká teplá střecha" })}
${noteLines(`${roof.note} Atika vychází z model.geometry.parapetTop a roofTop.`, 40, 620, 150)}
</g>`;
  return svgDocument({
    kind: "detail",
    title: `Detail atiky — ${model.id}`,
    desc: `Detail napojení atiky a ploché střechy. Skladby ${wall.label} a ${roof.label} vycházejí z model.assemblies. Atika je ${measure(atika)} nad střechou.`,
    width: 1140,
    height: 760,
    body,
  });
}

function renderWindowDetail() {
  const assembly = model.assemblies.wall;
  const total = assemblyThickness(assembly);
  const windows = model.openings.filter((opening) => opening.type === "window");
  const opening = [...windows].sort((a, b) => (b.to - b.from) * b.height - (a.to - a.from) * a.height)[0];
  if (!opening) throw new RangeError("Model neobsahuje žádné okno.");
  const clearHeight = model.geometry.clearHeight;
  const x = 120;
  const y = 120;
  const height = 360;
  const factor = 600;
  const wallWidth = total * factor;
  const verticalFactor = 120;
  const openingTop = y + (clearHeight - opening.bottom - opening.height) * verticalFactor;
  const openingBottom = y + (clearHeight - opening.bottom) * verticalFactor;
  const stripes = verticalLayerStripes(assembly, { x, y, height, factor });
  const frame = `<rect x="${n(x)}" y="${n(openingTop)}" width="${n(wallWidth)}" height="${n(openingBottom - openingTop)}" fill="#fcfbf7" stroke="#385e63"/>
<rect class="detail-layer" x="${n(x + wallWidth * 0.42)}" y="${n(openingTop + 4)}" width="${n(wallWidth * 0.16)}" height="${n(openingBottom - openingTop - 8)}" fill="#cfe3e6" stroke="#385e63"/>
<path d="M${n(x + wallWidth * 0.5)} ${n(openingTop + 4)}V${n(openingBottom - 4)}" stroke="#6c8b90" stroke-width="1" fill="none"/>
<path d="M${n(x - 12)} ${n(openingBottom)}H${n(x + wallWidth + 18)}" stroke="#8b6a45" stroke-width="1.2"/>`;
  const body = `${detailHeading("window", "DETAIL NAPOJENÍ OKNA", `${assembly.label} · okno ${opening.label} · Uw ≈ ${formatNumber(model.windows.uw, 2)} W/(m²K)`)}
${stripes.markup}
<rect class="detail-outline" x="${n(x)}" y="${n(y)}" width="${n(wallWidth)}" height="${n(height)}"/>
${frame}
<text class="detail-label" x="${n(x - 10)}" y="${n(y + height / 2)}" text-anchor="end">INTERIÉR</text>
<text class="detail-label" x="${n(x + wallWidth + 10)}" y="${n(y + height / 2)}">EXTERIÉR</text>
<text class="detail-label" x="${n(x + wallWidth / 2)}" y="${n(openingTop - 10)}" text-anchor="middle">${esc(opening.label)}</text>
<text class="detail-label" x="${n(x + wallWidth / 2)}" y="${n(openingBottom + 26)}" text-anchor="middle">parapet ${measure(opening.bottom)} · výška ${measure(opening.height)}</text>
${layerLegend(assembly, 600, 130, { width: 420, title: "Obvodová stěna" })}
${noteLines(model.windows.note, 600, 350, 70)}
${noteLines("Detail je schematický; skutečné napojení rámu, parapetu a těsnění určí projekt.", 600, 430, 70)}
</g>`;
  return svgDocument({
    kind: "detail",
    title: `Detail okna — ${model.id}`,
    desc: `Detail napojení okna ${opening.label} ve skladbě obvodové stěny. Výška parapetu ${measure(opening.bottom)} a výška okna ${measure(opening.height)} vycházejí z model.openings.`,
    width: 1080,
    height: 700,
    body,
  });
}

export function renderDetail(type) {
  if (!DETAIL_TYPES.includes(type)) {
    throw new RangeError(`Neznámý detail: ${type}`);
  }
  if (type === "wall") return renderWallDetail();
  if (type === "foundation") return renderFoundationDetail();
  if (type === "parapet") return renderParapetDetail();
  return renderWindowDetail();
}

function collectAxoPoints() {
  const points = [];
  const footprint = [[0, 0], [model.geometry.width, 0], [model.geometry.width, model.geometry.depth], [0, model.geometry.depth]];
  for (const [x, y] of footprint) {
    points.push([x, y, 0], [x, y, model.geometry.roofTop]);
  }
  for (const room of model.rooms) {
    for (const [x, y] of room.polygon) {
      points.push([x, y, 0], [x, y, model.geometry.clearHeight]);
    }
  }
  for (const beam of model.beams) {
    points.push([beam.start[0], beam.start[1], beam.z], [beam.end[0], beam.end[1], beam.z]);
    points.push([beam.start[0], beam.start[1], beam.z - beam.depth], [beam.end[0], beam.end[1], beam.z - beam.depth]);
  }
  return points;
}

function beamMarkup(beam, project) {
  const beamLen = distance(beam.start, beam.end);
  if (!beamLen) return "";
  const u = scale(sub(beam.end, beam.start), 1 / beamLen);
  const perpendicular = [-u[1], u[0]];
  const half = beam.width / 2;
  const corners = [
    add(beam.start, scale(perpendicular, half)),
    add(beam.end, scale(perpendicular, half)),
    add(beam.end, scale(perpendicular, -half)),
    add(beam.start, scale(perpendicular, -half)),
  ];
  const top = beam.z;
  const bottom = beam.z - beam.depth;
  const faces = [
    { cls: "side", points: [[...corners[0], top], [...corners[1], top], [...corners[1], bottom], [...corners[0], bottom]] },
    { cls: "side", points: [[...corners[2], top], [...corners[3], top], [...corners[3], bottom], [...corners[2], bottom]] },
    { cls: "top", points: corners.map((corner) => [...corner, top]) },
  ];
  const center = project([(beam.start[0] + beam.end[0]) / 2, (beam.start[1] + beam.end[1]) / 2, top]);
  return `<g data-beam="${esc(beam.id)}">${faces.map((face) => `<path class="axo-beam-face ${face.cls}" d="${path3(face.points, project)}"/>`).join("")}<text class="axo-beam-label" x="${n(center[0])}" y="${n(center[1] - 4)}">${esc(beam.id)} · ${esc(beam.material)}</text></g>`;
}

export function renderAxonometry() {
  const factor = 34;
  const angle = Math.PI / 6;
  const rawProject = (point) => projectPoint(point, { scale: factor, origin: [0, 0], angle });
  const rawPoints = collectAxoPoints().map(rawProject);
  const minX = Math.min(...rawPoints.map((point) => point[0]));
  const maxX = Math.max(...rawPoints.map((point) => point[0]));
  const minY = Math.min(...rawPoints.map((point) => point[1]));
  const maxY = Math.max(...rawPoints.map((point) => point[1]));
  const margin = 70;
  const origin = [margin - minX, margin - minY + 20];
  const project = (point) => projectPoint(point, { scale: factor, origin, angle });
  const width = maxX - minX + margin * 2;
  const height = maxY - minY + margin * 2 + 70;

  const footprint = [[0, 0], [model.geometry.width, 0], [model.geometry.width, model.geometry.depth], [0, model.geometry.depth]];
  const rooms = model.rooms.map((room) => {
    const floor = room.polygon.map(([x, y]) => [x, y, 0.03]);
    const edges = room.polygon.map(([x, y]) => `<path class="axo-edge" d="M${n(project([x, y, 0])[0])} ${n(project([x, y, 0])[1])}L${n(project([x, y, model.geometry.clearHeight])[0])} ${n(project([x, y, model.geometry.clearHeight])[1])}"/>`).join("");
    const labelPoint = project([centroid(room.polygon)[0], centroid(room.polygon)[1], 0.08]);
    return `<g class="axo-room ${esc(room.zone)}" data-room="${esc(room.id)}"><path class="axo-room-shape" d="${path3(floor, project)}"/>${edges}<text class="axo-room-label" x="${n(labelPoint[0])}" y="${n(labelPoint[1])}">${esc(room.shortName)}</text></g>`;
  }).join("\n");

  const beams = model.beams.map((beam) => beamMarkup(beam, project)).join("\n");
  const body = `<text class="drawing-title" x="24" y="32">STATICKÁ AXONOMETRIE</text>
<text class="drawing-subtitle" x="24" y="50">${esc(model.id)} · odkrytý nosný rám, prostory a terasa · statický fallback pro tisk</text>
<path class="axo-floor" d="${path3(footprint.map(([x, y]) => [x, y, 0]), project)}"/>
<path class="axo-terrace" d="${path3((model.rooms.find((room) => room.id === "terrace")?.polygon ?? []).map(([x, y]) => [x, y, 0]), project)}"/>
<path class="axo-roof" d="${path3(footprint.map(([x, y]) => [x, y, model.geometry.roofTop]), project)}"/>
${rooms}
${beams}
<text class="detail-note" x="24" y="${n(height - 70)}">Axonometrie je statická, bez animace a bez skriptů. Nosné průvlaky a prostory vycházejí z modelu.</text>
</g>`;

  return svgDocument({
    kind: "axonometry",
    title: `Statická axonometrie — ${model.id}`,
    desc: `Statická axonometrie domu ${model.id} s odkrytým nosným rámem, hlavními průvlaky, místnostmi a terasou. Projekce vychází z projectPoint a modelu.`,
    width,
    height,
    body,
  });
}
