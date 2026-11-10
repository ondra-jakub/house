import test from "node:test";
import assert from "node:assert/strict";
import { model } from "../src/model.js";
import {
  areaSummary,
  clearDimensions,
  polygonArea,
  polygonsOverlap,
  projectPoint,
  roomAreas,
  solidIntervals,
  validateModel,
  wallLength,
} from "../src/geometry.js";

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

test("model nemá překryvy místností ani otvory mimo stěny", () => {
  assert.deepEqual(validateModel(), []);
  assert.equal(model.rooms.length, 15);
  assert.equal(new Set(model.openings.map((opening) => opening.id)).size, model.openings.length);
});

test("plochy polygonů a součty odpovídají skutečné geometrii", () => {
  const areas = roomAreas();
  close(areas.living, 9.99 * 4.79);
  close(areas.garage, 3.39 * 5.39);
  close(areas.terrace, 44);
  const summary = areaSummary();
  close(summary.built, 192.5);
  close(summary.indoor, summary.residential + summary.garage);
  close(summary.construction, summary.built - summary.indoor);
  close(summary.residential, model.rooms.filter((room) => room.residential).reduce((sum, room) => sum + polygonArea(room.polygon), 0));
});

test("čisté rozměry pocházejí z obrysu a vnější tloušťka je započtena", () => {
  const living = model.rooms.find((room) => room.id === "living");
  const dimensions = clearDimensions(living.polygon);
  close(dimensions.width, 10.4 - 0.05 - model.geometry.exteriorWall);
  close(dimensions.depth, 11 - 5.8 - 0.05 - model.geometry.exteriorWall);
  assert.ok(dimensions.width > 0 && dimensions.depth > 0);
});

test("nepravoúhlé místnosti se po odečtení stěn nepřekrývají", () => {
  const hall = model.rooms.find((room) => room.id === "hall").polygon;
  const wc = model.rooms.find((room) => room.id === "wc").polygon;
  assert.equal(polygonsOverlap(hall, wc), false);
  assert.equal(polygonsOverlap([[0, 0], [2, 0], [2, 2], [0, 2]], [[1, 1], [3, 1], [3, 3], [1, 3]]), true);
});

test("odečtení otvorů zachová plné úseky stěny", () => {
  const north = model.walls.find((wall) => wall.id === "north");
  const intervals = solidIntervals(north);
  close(intervals.reduce((sum, interval) => sum + interval.to - interval.from, 0), wallLength(north) - model.openings.filter((opening) => opening.wall === "north").reduce((sum, opening) => sum + opening.to - opening.from, 0));
  for (let index = 1; index < intervals.length; index += 1) assert.ok(intervals[index].from >= intervals[index - 1].to);
});

test("axonometrická projekce má analytický výsledek", () => {
  const projected = projectPoint([1, 0, 0], { scale: 10, origin: [0, 0], angle: Math.PI / 6 });
  close(projected[0], 10 * Math.cos(Math.PI / 6));
  close(projected[1], 10 * Math.sin(Math.PI / 6));
  const elevated = projectPoint([0, 0, 2], { scale: 10, origin: [0, 0] });
  close(elevated[1], -20);
});

test("nosníky, střecha a odvodnění respektují čistou výšku", () => {
  const main = model.beams.find((beam) => beam.id === "B1");
  const lintel = model.beams.find((beam) => beam.id === "L1");
  const glazing = model.openings.find((opening) => opening.id === "living-s-large");
  close(main.z - main.depth, model.geometry.clearHeight);
  close(lintel.z - lintel.depth, glazing.bottom + glazing.height);
  assert.ok(model.geometry.roofTop > model.geometry.ceilingUnderside);
  for (const drain of model.roofDrainage.drains) {
    assert.ok(drain.x > 0 && drain.x < model.geometry.width && drain.y > 0 && drain.y < model.geometry.depth);
  }
  const southRoof = model.geometry.roofTop + model.geometry.depth / 2 * model.geometry.roofSlope;
  assert.ok(model.roofDrainage.emergencyOverflow.z > southRoof);
  assert.ok(model.roofDrainage.emergencyOverflow.z < model.geometry.parapetTop);
});

test("validace odhalí otvor mimo stěnu a zápornou plochu", () => {
  const invalid = structuredClone(model);
  invalid.openings[0].to = 99;
  assert.ok(validateModel(invalid).some((error) => error.includes("Otvor mimo stěnu")));
  const negative = structuredClone(model);
  negative.rooms[0].polygon = [[0, 0], [1, 0], [1, 0]];
  assert.ok(validateModel(negative).some((error) => error.includes("Neplatný polygon")));
});
