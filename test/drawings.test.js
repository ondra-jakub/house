import test from "node:test";
import assert from "node:assert/strict";

import { model, openingsForWall } from "../src/model.js";
import {
  clearDimensions,
  formatNumber,
  polygonArea,
  wallLength,
} from "../src/geometry.js";
import {
  renderAxonometry,
  renderDetail,
  renderElevation,
  renderFloorplan,
  renderSection,
} from "../src/drawings.js";

function assertSvg(svg, label = "výkres") {
  assert.equal(typeof svg, "string", `${label} musí vracet string`);
  assert.match(svg, /^<svg /, `${label} musí začínat SVG elementem`);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${label} musí mít xmlns`);
  assert.match(svg, /viewBox="0 0 [0-9.]+ [0-9.]+"/, `${label} musí mít platný viewBox`);
  assert.match(svg, /role="img"/, `${label} musí mít role="img"`);
  assert.match(svg, /<title id="[^"]+">/, `${label} musí mít title s ID`);
  assert.match(svg, /<desc id="[^"]+">/, `${label} musí mít desc s ID`);
  assert.match(svg, /Jednotky: m/, `${label} musí uvádět jednotky`);
  assert.match(
    svg,
    /M 1:100 pouze při kalibrovaném tisku A3|bez závazného měřítka/,
    `${label} musí obsahovat korektní text měřítka`,
  );
  const titleId = svg.match(/<title id="([^"]+)"/)[1];
  const descId = svg.match(/<desc id="([^"]+)"/)[1];
  assert.notEqual(titleId, descId, `${label} musí mít odlišná ID title a desc`);
  assert.match(svg, new RegExp(`aria-labelledby="${titleId} ${descId}"`), `${label} musí odkazovat title a desc`);
  assert.doesNotMatch(svg, /\bNaN\b/, `${label} nesmí obsahovat NaN`);
  assert.doesNotMatch(svg, /\bundefined\b/, `${label} nesmí obsahovat undefined`);
  assert.doesNotMatch(svg, /\bInfinity\b/, `${label} nesmí obsahovat Infinity`);
  assert.doesNotMatch(svg, /<script\b/i, `${label} nesmí obsahovat skript`);
  assert.doesNotMatch(svg, /\son[a-z]+\s*=/i, `${label} nesmí obsahovat event handler atributy`);
}

function roomGroup(svg, roomId) {
  const marker = `data-room="${roomId}"`;
  const index = svg.indexOf(marker);
  assert.ok(index >= 0, `Chybí místnost ${roomId}`);
  const start = svg.lastIndexOf("<g ", index);
  const end = svg.indexOf("</g>", index);
  return svg.slice(start, end + 4);
}

function allDrawings() {
  return [
    ["půdorys", renderFloorplan()],
    ["technický půdorys", renderFloorplan({ technical: true })],
    ...["north", "east", "south", "west"].map((id) => [`bokorys ${id}`, renderElevation(id)]),
    ["řez A", renderSection("A")],
    ["řez B", renderSection("B")],
    ...["wall", "foundation", "parapet", "window"].map((type) => [`detail ${type}`, renderDetail(type)]),
    ["axonometrie", renderAxonometry()],
  ];
}

test("všechny výkresy mají platný SVG obal, jednotky a měřítko", () => {
  const drawings = allDrawings();
  assert.equal(drawings.length, 13);
  const titleIds = [];
  for (const [label, svg] of drawings) {
    assertSvg(svg, label);
    titleIds.push(svg.match(/<title id="([^"]+)"/)[1]);
  }
  assert.equal(new Set(titleIds).size, titleIds.length, "ID title musí být napříč výkresy unikátní");
});

test("půdorys obsahuje skutečné polygony místností s vypočtenou plochou", () => {
  const svg = renderFloorplan();
  for (const room of model.rooms) {
    const group = roomGroup(svg, room.id);
    const area = polygonArea(room.polygon);
    assert.match(group, new RegExp(`class="room room-${room.zone}"`), `Zóna místnosti ${room.id}`);
    assert.match(group, /tabindex="0"/, `Místnost ${room.id} musí být fokusovatelná`);
    assert.match(group, /role="button"/, `Místnost ${room.id} musí mít roli button`);
    assert.match(group, /class="room-shape"/, `Místnost ${room.id} musí mít room-shape`);
    assert.ok(group.includes(`data-room="${room.id}"`));
    assert.ok(group.includes(formatNumber(area, 1)), `Aria-label místnosti ${room.id} musí obsahovat vypočtenou plochu`);
    assert.match(group, /aria-label="[^"]+m²"/, `Aria-label místnosti ${room.id}`);
    assert.ok(group.includes(`data-area="${Number(area.toFixed(3))}"`), `Data-area místnosti ${room.id}`);
  }
});

test("prezentační a technický půdorys sdílí stejnou geometrii", () => {
  const presentation = renderFloorplan();
  const technical = renderFloorplan({ technical: true });
  for (const room of model.rooms) {
    const presentationPath = roomGroup(presentation, room.id).match(/<path class="room-shape" d="([^"]+)"/)[1];
    const technicalPath = roomGroup(technical, room.id).match(/<path class="room-shape" d="([^"]+)"/)[1];
    assert.equal(technicalPath, presentationPath, `Polygon místnosti ${room.id} musí být shodný`);
  }
  assert.equal((technical.match(/class="opening opening-/g) ?? []).length, model.openings.length);
  assert.equal((technical.match(/class="wall wall-/g) ?? []).length, model.walls.length);
  assert.match(technical, /class="axes"/);
  assert.match(technical, /data-opening-axis="entrance"/);
  assert.match(technical, /data-beam="B1"/);
  assert.match(technical, /class="section-mark" data-section="A"/);
  assert.match(technical, /class="section-mark" data-section="B"/);
  assert.match(technical, /class="north-arrow"/);
  assert.match(technical, /data-calibrated="true"/);
  assert.match(technical, /--print-width:261\.364mm/);
  assert.match(renderElevation("north"), /data-calibrated="true"/);
  assert.match(renderSection("A"), /data-calibrated="true"/);
  assert.match(renderDetail("wall"), /data-calibrated="false"/);
  assert.match(renderAxonometry(), /data-calibrated="false"/);
  assert.ok(technical.includes(formatNumber(model.geometry.width, 2)));
  assert.ok(technical.includes(formatNumber(model.geometry.depth, 2)));
  const living = model.rooms.find((room) => room.id === "living");
  const dims = clearDimensions(living.polygon);
  assert.ok(technical.includes(`${formatNumber(dims.width, 2)} × ${formatNumber(dims.depth, 2)} m`));
  assert.doesNotMatch(presentation, /data-section="[AB]"/);
});

test("čtyři bokorysy přebírají otvory i výšky z modelu", () => {
  const ids = ["north", "east", "south", "west"];
  for (const wallId of ids) {
    const wall = model.walls.find((item) => item.id === wallId);
    const svg = renderElevation(wallId);
    assertSvg(svg, `bokorys ${wallId}`);
    assert.match(svg, new RegExp(`data-wall="${wallId}"`));
    assert.ok(svg.includes(formatNumber(wallLength(wall), 2)), `Délka stěny ${wallId}`);
    assert.ok(svg.includes(formatNumber(model.geometry.parapetTop, 2)), `Výška atiky ${wallId}`);
    assert.ok(svg.includes(formatNumber(model.geometry.clearHeight, 2)), `Čistá výška ${wallId}`);
    assert.ok(svg.includes(wall.material), `Materiál ${wallId}`);
    const openings = openingsForWall(wallId);
    for (const opening of openings) {
      assert.match(svg, new RegExp(`data-opening="${opening.id}"`), `Otvor ${opening.id}`);
      const tag = svg.match(new RegExp(`<rect[^>]*data-opening="${opening.id}"[^>]*>`))[0];
      assert.equal(Number(tag.match(/data-bottom="([^"]+)"/)[1]), opening.bottom, `Spodní hrana ${opening.id}`);
      assert.equal(Number(tag.match(/data-height="([^"]+)"/)[1]), opening.height, `Výška ${opening.id}`);
      assert.ok(svg.includes(opening.label), `Popis otvoru ${opening.id}`);
    }
  }
});

test("dva řezy A a B mají střechu, podlahu, rám, čistou výšku a atiku", () => {
  const sectionA = renderSection();
  const sectionB = renderSection("B");
  assertSvg(sectionA, "řez A");
  assertSvg(sectionB, "řez B");
  assert.match(sectionA, /data-section="A"/);
  assert.match(sectionB, /data-section="B"/);
  assert.ok(sectionA.includes("ŘEZ A-A — obytný prostor"));
  assert.ok(sectionB.includes("ŘEZ B-B — servisní a ložnicová část"));
  for (const roomId of ["living", "hall", "entry"]) {
    assert.ok(sectionA.includes(`data-room="${roomId}"`), `Řez A má obsahovat ${roomId}`);
  }
  for (const roomId of ["garage", "utility", "wc", "child-one"]) {
    assert.ok(sectionB.includes(`data-room="${roomId}"`), `Řez B má obsahovat ${roomId}`);
  }
  assert.match(sectionA, /data-beam="B1"/);
  for (const svg of [sectionA, sectionB]) {
    assert.ok(svg.includes(model.assemblies.roof.label), "Musí být uvedena skladba střechy");
    assert.ok(svg.includes(model.assemblies.floor.label), "Musí být uvedena skladba podlahy");
    assert.ok(svg.includes("čistá výška"), "Musí být uvedena čistá výška");
    assert.ok(svg.includes("atika"), "Musí být uvedena atika");
    assert.match(svg, /class="frame-line"/);
    assert.match(svg, /class="section-floor"/);
    assert.match(svg, /class="section-roof"/);
    assert.match(svg, /class="wall-cut/);
  }
});

test("čtyři detaily používají skladby z model.assemblies", () => {
  const types = ["wall", "foundation", "parapet", "window"];
  for (const type of types) {
    const svg = renderDetail(type);
    assertSvg(svg, `detail ${type}`);
    assert.match(svg, new RegExp(`data-detail="${type}"`));
  }
  const wall = renderDetail("wall");
  for (const layer of model.assemblies.wall.layers) {
    assert.ok(wall.includes(layer.name), `Detail stěny musí obsahovat vrstvu ${layer.name}`);
  }
  assert.ok(wall.includes("INTERIÉR") && wall.includes("EXTERIÉR"));

  const foundation = renderDetail("foundation");
  for (const layer of model.assemblies.floor.layers) {
    assert.ok(foundation.includes(layer.name), `Detail základu musí obsahovat vrstvu ${layer.name}`);
  }
  assert.ok(foundation.includes("ZÁKLAD — SCHEMATICKY"));
  assert.ok(foundation.includes("bez rozměrového posouzení") || foundation.includes("Bez rozměrového posouzení"));

  const parapet = renderDetail("parapet");
  assert.ok(parapet.includes(model.assemblies.wall.label));
  assert.ok(parapet.includes(model.assemblies.roof.label));
  assert.match(parapet, /ATIKA \+/i);
  for (const layer of model.assemblies.roof.layers) {
    assert.ok(parapet.includes(layer.name), `Detail atiky musí obsahovat vrstvu ${layer.name}`);
  }

  const window = renderDetail("window");
  assert.ok(window.includes("Uw"));
  assert.ok(window.includes("Detail napojení okna") || window.includes("DETAIL NAPOJENÍ OKNA"));
  for (const layer of model.assemblies.wall.layers) {
    assert.ok(window.includes(layer.name), `Detail okna má obsahovat vrstvu ${layer.name}`);
  }
  assert.throws(() => renderDetail("roof"), /Neznámý detail/);
  assert.throws(() => renderDetail(), /Neznámý detail/);
});

test("statická axonometrie zobrazuje rám i místnosti a neobsahuje animace", () => {
  const svg = renderAxonometry();
  assertSvg(svg, "axonometrie");
  assert.ok(svg.includes("STATICKÁ AXONOMETRIE"));
  assert.match(svg, /data-room="living"/);
  assert.match(svg, /data-room="terrace"/);
  assert.match(svg, /data-beam="B1"/);
  assert.match(svg, /data-beam="L1"/);
  assert.doesNotMatch(svg, /<animate\b/i);
  assert.doesNotMatch(svg, /animation:/i);
});

test("žádný výkres neobsahuje skripty ani obslužné atributy", () => {
  for (const [label, svg] of allDrawings()) {
    assert.doesNotMatch(svg, /<script\b/i, label);
    assert.doesNotMatch(svg, /\son[a-z]+\s*=/i, label);
    assert.doesNotMatch(svg, /\bNaN\b|\bundefined\b|\bInfinity\b/, label);
  }
});
