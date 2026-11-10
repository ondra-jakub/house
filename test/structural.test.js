import test from "node:test";
import assert from "node:assert/strict";

import { model } from "../src/model.js";
import {
  calculateStructuralReport,
  columnBuckling,
  deflection,
  lateralTorsionalFactor,
  rectSection,
  simplySupported,
} from "../src/structural.js";

function close(actual, expected, tolerance = 1e-9, message = "") {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= tolerance * scale,
    message || `Očekáváno ${expected}, skutečnost ${actual}`,
  );
}

test("rectSection vrací obdélníkové charakteristiky", () => {
  const section = rectSection(0.1, 0.32);
  close(section.A, 0.1 * 0.32);
  close(section.I, (0.1 * 0.32 ** 3) / 12);
  close(section.W, (0.1 * 0.32 ** 2) / 6);
  close(section.i, Math.sqrt(section.I / section.A));
  assert.equal(section.area, section.A);
  assert.equal(section.secondMoment, section.I);
  assert.equal(section.sectionModulus, section.W);
});

test("simplySupported odpovídá R = qL/2, V = qL/2, M = qL²/8", () => {
  const result = simplySupported(10, 4);
  close(result.R, 20);
  close(result.reaction, 20);
  close(result.Vmax, 20);
  close(result.V, 20);
  close(result.maxShear, 20);
  close(result.Mmax, 20);
  close(result.M, 20);
  close(result.maxMoment, 20);
  close(result.totalLoad, 40);
});

test("deflection odpovídá 5qL⁴/(384EI)", () => {
  const q = 10;
  const L = 4;
  const E = 11000;
  const I = 1e-4;
  const expected = (5 * q * L ** 4) / (384 * E * 1000 * I);
  close(deflection(q, L, E, I), expected);
});

test("columnBuckling počítá štíhlost, λrel a kc podle EN 1995-1-1", () => {
  const b = 0.16;
  const h = 0.16;
  const lef = 2.78;
  const E005 = 7400;
  const fc0 = 21;
  const betaC = 0.2;
  const result = columnBuckling({ b, h, lef, E005, fc0, betaC });
  const i = h / Math.sqrt(12);
  const lambda = lef / i;
  const lambdaRel = (lambda / Math.PI) * Math.sqrt(fc0 / E005);
  const k = 0.5 * (1 + betaC * (lambdaRel - 0.3) + lambdaRel ** 2);
  const kc = 1 / (k + Math.sqrt(k ** 2 - lambdaRel ** 2));
  close(result.i, i);
  close(result.slenderness, lambda);
  close(result.lambdaRel, lambdaRel);
  close(result.k, k);
  close(result.kc, kc);
  assert.ok(result.kc > 0 && result.kc < 1);
  assert.equal(result.betaC, betaC);

  const positional = columnBuckling(b, h, lef, E005, fc0, betaC);
  close(positional.kc, result.kc);
  close(positional.lambdaRel, result.lambdaRel);
  const rectangular = columnBuckling({ b: 0.10, h: 0.20, lef, E005, fc0, betaC });
  close(rectangular.I, Math.min(0.10 * 0.20 ** 3, 0.20 * 0.10 ** 3) / 12);
});

test("lateralTorsionalFactor respektuje všechny tři větve kcrit", () => {
  const short = lateralTorsionalFactor({ b: 0.2, h: 0.6, lef: 1, E005: 9600, fm: 24 });
  close(short.sigmaCrit, (0.78 * 0.2 ** 2 * 9600) / (0.6 * 1));
  assert.ok(short.lambdaRel <= 0.75);
  assert.equal(short.kcrit, 1);
  assert.equal(short.region, "plný");

  const transition = lateralTorsionalFactor({ b: 0.1, h: 0.3, lef: 8, E005: 7400, fm: 24 });
  assert.ok(transition.lambdaRel > 0.75 && transition.lambdaRel <= 1.4);
  close(transition.kcrit, 1.56 - 0.75 * transition.lambdaRel);
  assert.equal(transition.region, "přechod");

  const slender = lateralTorsionalFactor({ b: 0.1, h: 0.3, lef: 20, E005: 7400, fm: 24 });
  assert.ok(slender.lambdaRel > 1.4);
  close(slender.kcrit, 1 / slender.lambdaRel ** 2);
  assert.equal(slender.region, "štíhlý");
  assert.ok(slender.kcrit > 0 && slender.kcrit < 1);

  const positional = lateralTorsionalFactor(0.1, 0.3, 20, 7400, 24);
  close(positional.kcrit, slender.kcrit);
});

test("report je reprodukovatelný a vychází z model.structural", () => {
  const first = calculateStructuralReport(model);
  const second = calculateStructuralReport(model);
  assert.equal(JSON.stringify(first), JSON.stringify(second));

  assert.equal(first.id, model.id);
  assert.equal(first.basis, model.structural.basis);
  assert.equal(first.factors.gammaG, 1.35);
  assert.equal(first.factors.gammaQ, 1.5);
  assert.equal(first.factors.kmod, 0.8);
  assert.equal(first.factors.kdef, 0.6);
  assert.equal(first.members.length, 5);
  assert.equal(first.limits.instantaneous, 300);
  assert.equal(first.limits.final, 200);
  assert.match(first.disclaimer, /Nenahrazuje statický výpočet/i);
  assert.ok(first.sources.includes(model.sources[0]));
  assert.equal(first.warnings[0], model.structural.loadNote);
  assert.ok(first.foundations.windPath.some((item) => item.includes("střecha")));
  assert.equal(first.foundations.windPressure, model.structural.windPressure);
});

test("vlastní tíha střechy je součtem hustot a tlouštěk model.assemblies.roof", () => {
  const report = calculateStructuralReport(model);
  const expected = model.assemblies.roof.layers.reduce(
    (sum, layer) => sum + layer.d * layer.density * 9.81 / 1000,
    0,
  );
  close(report.roof.selfWeight, expected);
  assert.equal(report.roof.layers.length, model.assemblies.roof.layers.length);
  close(
    report.roof.layers.reduce((sum, layer) => sum + layer.areaLoad, 0),
    expected,
  );
});

test("report konzistentně dopočítá zatížení, reakce, M, V a průhyby nosníků", () => {
  const report = calculateStructuralReport(model);
  const beams = ["roof-joist", "living-joist", "main-beam", "lintel"];

  for (const id of beams) {
    const member = report.byId[id];
    assert.equal(member.kind, "beam");
    assert.equal(member.finalSection.b, member.section.b);
    assert.equal(member.finalSection.h, member.section.h);
    assert.equal(member.originalSection.b, member.original.section.b);
    assert.equal(member.originalSection.h, member.original.section.h);
    assert.equal(member.iterations.changed, false);

    close(member.loads.qDesign, 1.35 * member.loads.permanentLine + 1.5 * member.loads.snowLine);
    close(member.analysis.reaction, member.loads.qDesign * member.span / 2);
    close(member.analysis.maxShear, member.analysis.reaction);
    close(member.analysis.maxMoment, member.loads.qDesign * member.span ** 2 / 8);

    close(member.stresses.bending, member.analysis.maxMoment / member.section.W / 1000);
    close(member.stresses.shear, 1.5 * member.analysis.maxShear / member.section.A / 1000);
    close(member.stresses.bearing, member.analysis.reaction / (member.section.b * 0.15) / 1000);

    close(
      member.analysis.deflectionInstant,
      5 * member.loads.qCharacteristic * member.span ** 4
        / (384 * member.material.Emean * 1000 * member.section.I),
    );
    close(member.analysis.deflectionFinal, member.analysis.deflectionInstant * 1.6);
    close(member.checks.deflectionInstant.capacity, member.span / 300);
    close(member.checks.deflectionFinal.capacity, member.span / 200);

    close(
      member.checks.bending.eta,
      member.stresses.bending / (member.strengths.kcrit * member.strengths.fmDesign),
    );
    close(
      member.checks.shear.eta,
      member.stresses.shear / member.strengths.fvDesign,
    );
    close(
      member.checks.bearing.eta,
      member.stresses.bearing / member.strengths.fc90Design,
    );
    assert.equal(member.overall.eta, Math.max(...Object.values(member.checks).map((item) => item.eta)));
    assert.equal(
      member.overall.ok,
      Object.values(member.checks).every((item) => item.ok),
    );
    assert.ok(member.checks.deflectionInstant.unit === "m");
  }
});

test("report obsahuje původní i finální průřez a sloupek používá interakci", () => {
  const report = calculateStructuralReport(model);
  const column = report.byId.column;
  const main = report.byId["main-beam"];

  assert.equal(column.kind, "column");
  assert.equal(column.originalSection.b, 0.16);
  assert.equal(column.originalSection.h, 0.16);
  assert.equal(column.finalSection.b, 0.16);
  assert.equal(column.finalSection.h, 0.16);
  assert.equal(column.material.betaC, model.structural.materials.C24.betaC);
  close(column.analysis.buckling.kc, column.strengths.kc);
  close(column.loads.axialFromBeam, main.analysis.reaction);
  close(column.loads.axialDesign, column.loads.axialFromBeam + 10 + column.loads.selfWeight);
  close(column.stresses.axialCompression, column.loads.axialDesign / column.section.A / 1000);
  close(
    column.checks.compression.eta,
    column.stresses.axialCompression / (column.strengths.kc * column.strengths.fc0Design),
  );
  close(
    column.checks.interaction.eta,
    column.checks.compression.eta + column.checks.bending.eta,
  );
  assert.equal(column.checks.interaction.ok, column.checks.interaction.eta <= 1);
  assert.equal(
    column.overall.eta,
    Math.max(...Object.values(column.checks).map((item) => item.eta)),
  );
});

test("iterace zvětší nevyhovující průřez a uchová původní i finální stav", () => {
  const report = calculateStructuralReport(model, {
    members: {
      "roof-joist": {
        original: { b: 0.06, h: 0.12 },
      },
    },
  });
  const member = report.byId["roof-joist"];

  assert.equal(member.originalSection.b, 0.06);
  assert.equal(member.originalSection.h, 0.12);
  assert.equal(member.original.section.b, 0.06);
  assert.equal(member.original.section.h, 0.12);
  assert.equal(member.original.overall.ok, false);
  assert.equal(member.iterations.changed, true);
  assert.ok(member.iterations.attempts.length >= 2);
  assert.ok(member.finalSection.b * member.finalSection.h > 0.06 * 0.12);
  assert.equal(member.overall.ok, true);
  assert.equal(member.finalSection.b, member.section.b);
  assert.equal(member.finalSection.h, member.section.h);
  assert.equal(member.iterations.attempts[0].ok, false);
  assert.equal(member.iterations.attempts.at(-1).ok, true);
});

test("původní průřezy v reportu odpovídají zadání a modelu", () => {
  const report = calculateStructuralReport(model);
  assert.deepEqual(report.byId["roof-joist"].originalSection, { b: 0.1, h: 0.32 });
  assert.deepEqual(report.byId["living-joist"].originalSection, { b: 0.18, h: 0.44 });
  assert.deepEqual(report.byId["main-beam"].originalSection, { b: 0.2, h: 0.6 });
  assert.deepEqual(report.byId.lintel.originalSection, { b: 0.2, h: 0.52 });
  assert.deepEqual(report.byId.column.originalSection, { b: 0.16, h: 0.16 });
  close(report.byId["main-beam"].span, 5.2);
  close(report.byId.lintel.span, 6.0);
  close(report.byId.column.lef, 3.30);
});

test("vzpěr se podle EN 1995 neaplikuje při relativní štíhlosti do 0,3", () => {
  const stocky = columnBuckling({ b: 0.4, h: 0.4, lef: 0.5, E005: 7400, fc0: 21, betaC: 0.2 });
  assert.ok(stocky.lambdaRel <= 0.3);
  assert.equal(stocky.kc, 1);
});
