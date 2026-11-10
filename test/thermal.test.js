import test from "node:test";
import assert from "node:assert/strict";
import { model } from "../src/model.js";
import { calculateAssembly, calculateAllThermal } from "../src/thermal.js";

const closeTo = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message ?? "hodnota"}: očekáváno ${expected} ± ${tolerance}, získáno ${actual}`,
  );
};

const wallResult = () => calculateAssembly(model.assemblies.wall);

test("referenční obvodová stěna má U přibližně 0,13464 W/(m²K)", () => {
  const result = wallResult();
  closeTo(result.u, 0.13464, 0.00005, "U stěny");
  assert.equal(result.meetsTarget, true);
  assert.ok(result.u <= result.target);
});

test("kombinovaná metoda ISO 6946 vrací horní a dolní mez a jejich průměr", () => {
  const result = wallResult();
  closeTo(result.resistanceUpper, 7.6783, 0.001, "horní R");
  closeTo(result.resistanceLower, 7.1759, 0.001, "dolní R");
  closeTo(result.resistance, (result.resistanceUpper + result.resistanceLower) / 2, 1e-12, "výsledné R");
  assert.ok(result.resistanceUpper > result.resistance);
  assert.ok(result.resistance > result.resistanceLower);
  closeTo(1 / result.resistance, result.u, 1e-12, "U z výsledného R");
});

test("vrchní mez není průměrem U a dolní mez používá ekvivalentní vrstvu", () => {
  const result = wallResult();
  const averageU = (1 / result.resistanceUpper + 1 / result.resistanceLower) / 2;
  assert.ok(Math.abs(result.u - averageU) > 1e-6, "U nesmí být aritmetickým průměrem mezních U");
  const bridged = result.layers.find((layer) => layer.bridged);
  assert.ok(bridged);
  closeTo(bridged.resistanceInsulation, 0.16 / 0.035, 1e-12, "R izolace ve vrstvě");
  closeTo(bridged.resistanceWood, 0.16 / 0.13, 1e-12, "R dřeva ve vrstvě");
  const expectedEquivalent = 1 / (0.88 / bridged.resistanceInsulation + 0.12 / bridged.resistanceWood);
  closeTo(bridged.resistance, expectedEquivalent, 1e-12, "ekvivalentní R vrstvy");
});

test("vliv sloupku: most zvyšuje U a větší podíl dřeva zhoršuje skladbu", () => {
  const withBridge = wallResult();
  const homogeneous = calculateAssembly({
    ...model.assemblies.wall,
    layers: model.assemblies.wall.layers.map((layer) => {
      if (!layer.bridged) return layer;
      const { bridged, ...rest } = layer;
      return rest;
    }),
  });
  assert.ok(withBridge.u > homogeneous.u, "most musí zvýšit U");
  assert.ok(withBridge.u - homogeneous.u > 0.01, "vliv mostu má být měřitelně velký");
  closeTo(homogeneous.u, 1 / (0.13 + 0.13 + 0.0125 / 0.32 + 0.05 / 0.035 + 0.16 / 0.035 + 0.08 / 0.04), 1e-12, "U bez mostu");

  const moreWood = calculateAssembly({
    ...model.assemblies.wall,
    layers: model.assemblies.wall.layers.map((layer) => layer.bridged
      ? { ...layer, bridged: { ...layer.bridged, woodFraction: 0.24 } }
      : layer),
  });
  assert.ok(moreWood.u > withBridge.u, "vyšší podíl dřeva musí zvýšit U");
});

test("vrstvy counted:false a lambda:null se nezapočítají, tloušťky sedí", () => {
  const result = wallResult();
  assert.equal(result.layers.length, 6);
  assert.equal(result.layers.filter((layer) => layer.counted).length, 4);
  const excluded = result.layers.filter((layer) => !layer.counted);
  assert.deepEqual(excluded.map((layer) => layer.name), ["Odvětrávaná dutina", "Dubový obklad / tenkovrstvá omítka"]);
  excluded.forEach((layer) => {
    assert.equal(layer.resistance, 0);
    assert.equal(layer.lambda, null);
  });
  closeTo(result.thickness, 0.3025, 1e-12, "započítaná tloušťka");
  closeTo(result.totalThickness, 0.36, 1e-12, "celková tloušťka");
  closeTo(result.rsi, 0.13, 1e-12, "Rsi");
  closeTo(result.rse, 0.13, 1e-12, "Rse");
  closeTo(result.layerResistance, result.resistanceLower - result.rsi - result.rse, 1e-12, "součet odporů vrstev");
});

test("všechny skladby modelu splňují své cíle a vrací poměr mezí", () => {
  const results = calculateAllThermal(model);
  assert.deepEqual(results.map((item) => item.id), ["wall", "roof", "floor", "garageFloor"]);
  for (const result of results) {
    assert.equal(typeof result.label, "string");
    assert.ok(result.u > 0);
    closeTo(result.ratio, result.u / result.target, 1e-12, `poměr U/cíl pro ${result.id}`);
    assert.equal(result.meetsTarget, result.u <= result.target, `splnění cíle pro ${result.id}`);
    assert.equal(result.meetsTarget, true, `skladba ${result.id} musí splnit cíl`);
    assert.equal(result.layers.filter((layer) => layer.counted).length >= 1, true);
  }
  const wall = results.find((item) => item.id === "wall");
  closeTo(wall.u, 0.13464, 0.00005, "U stěny z calculateAllThermal");
  closeTo(wall.resistanceLimitRatio, wall.resistanceUpper / wall.resistanceLower, 1e-12, "poměr mezí R");
  assert.equal(wall.combinedMethodValid, true);
  assert.ok(wall.resistanceLimitRatio <= 1.5);
});

test("validate: neplatné vstupy vyhodí srozumitelné chyby", () => {
  assert.throws(() => calculateAssembly(null), /Skladba musí být objekt/);
  assert.throws(
    () => calculateAssembly({ ...model.assemblies.wall, layers: [] }),
    /vrstvy musí být neprázdné pole/,
  );
  assert.throws(
    () => calculateAssembly({ ...model.assemblies.wall, target: 0 }),
    /cíl U musí být větší než 0/,
  );
  assert.throws(
    () => calculateAssembly({ ...model.assemblies.wall, rsi: -0.1 }),
    /Rsi nesmí být záporné/,
  );
  assert.throws(
    () => calculateAssembly({
      ...model.assemblies.wall,
      layers: [{ name: "Špatná vrstva", d: -0.01, lambda: 0.04 }],
    }),
    /tloušťka vrstvy 1 .* nesmí být záporné/,
  );
  assert.throws(
    () => calculateAssembly({
      ...model.assemblies.wall,
      layers: [{ name: "Chybějící lambda", d: 0.1, lambda: null }],
    }),
    /musí mít kladnou λ/,
  );
  assert.throws(
    () => calculateAssembly({
      ...model.assemblies.wall,
      layers: [{ name: "Most", d: 0.16, lambda: 0.035, bridged: { woodFraction: 1, woodLambda: 0.13 } }],
    }),
    /podíl dřeva .* musí ležet mezi 0 a 1/,
  );
  assert.throws(
    () => calculateAssembly({
      ...model.assemblies.wall,
      layers: [{ name: "Most", d: 0.16, lambda: 0.035, bridged: { woodFraction: 0.12, woodLambda: 0 } }],
    }),
    /λ dřeva .* musí být větší než 0/,
  );
  assert.throws(
    () => calculateAssembly({
      ...model.assemblies.wall,
      layers: [{ name: "Mimo výpočet", d: 0.03, lambda: null, counted: false }],
    }),
    /neobsahuje žádnou započítanou vrstvu/,
  );
});

test("validate: calculateAllThermal kontroluje model", () => {
  assert.throws(() => calculateAllThermal(null), /Model musí být objekt/);
  assert.throws(() => calculateAllThermal({}), /neobsahuje objekt assemblies/);
  assert.throws(() => calculateAllThermal({ assemblies: {} }), /neobsahuje žádné skladby/);
  assert.throws(() => calculateAllThermal({ assemblies: { wall: null } }), /Skladba „wall“ musí být objekt/);
});
