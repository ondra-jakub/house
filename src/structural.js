import { model as defaultModel } from "./model.js";

const GRAVITY = 9.81;
const WOOD_DENSITY = 500;
const BEARING_LENGTH = 0.15;
const EPS = 1e-12;

const DISCLAIMER = "Zjednodušený koncepční výpočet pro orientaci a předběžné dimenzování. Nenahrazuje statický výpočet, posouzení požární odolnosti, spojů, detailů, stability, vlhkosti ani ověření místních normových hodnot. Zatížení sněhem, větrem a údržbou jsou převzata z modelu pouze jako ilustrační vstupy.";

const ASSUMPTIONS = {
  roofSelfWeight: "Vlastní tíha střechy je součet d · ρ · g všech započtených vrstev model.assemblies.roof.",
  maintenance: "Údržba z model.structural.maintenanceArea je konzervativně přičtena ke stálému zatížení.",
  snow: "Sníh z model.structural.snowArea je uvažován jako proměnné zatížení; nejde o místní normovou hodnotu.",
  beamSelfWeight: `Vlastní tíha dřevěného nosníku uvažuje referenční objemovou hmotnost ${WOOD_DENSITY} kg/m³.`,
  bearing: `Podporový tlak se počítá na délce uložení ${BEARING_LENGTH} m (explicitní konzervativní předpoklad).`,
  lateralTorsion: "Účinná délka pro klopení nosníku je lef = 0,9 L + 2 h; jde o explicitní konzervativní předpoklad.",
  deflection: "Okamžitý průhyb je od charakteristické kombinace G + sníh. Konečný průhyb je konzervativně u_inst · (1 + kdef).",
  column: "Svislé zatížení sloupku je reakce z hlavního průvlaku + explicitní předpoklad 10 kN; ohybový moment 2 kNm je zadaný příklad.",
  iteration: "Pokud původní průřez nevyhoví, zkoušejí se větší průřezy z pevně dané tabulky. Report uchovává původní i finální průřez a všechny kroky.",
};

function assertPositive(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} musí být kladné číslo.`);
  }
}

function normalizeSection(section) {
  if (Array.isArray(section)) {
    return { b: Number(section[0]), h: Number(section[1]) };
  }
  if (section && typeof section === "object") {
    return {
      b: Number(section.b ?? section.width),
      h: Number(section.h ?? section.depth),
    };
  }
  throw new TypeError("Průřez musí být { b, h } nebo [b, h].");
}

function sameSection(a, b) {
  return Math.abs(a.b - b.b) < 1e-9 && Math.abs(a.h - b.h) < 1e-9;
}

function check(id, label, demand, capacity, unit, note = "") {
  assertPositive(`${label} – kapacita`, capacity);
  const eta = demand / capacity;
  return {
    id,
    label,
    demand,
    capacity,
    eta,
    unit,
    ok: eta <= 1 + 1e-9,
    note,
  };
}

function overallFrom(checks) {
  const list = Object.values(checks);
  let governing = list[0];
  for (const item of list) {
    if (item.eta > governing.eta) governing = item;
  }
  return {
    eta: governing.eta,
    ok: list.every((item) => item.ok),
    governing: governing.id,
    governingLabel: governing.label,
  };
}

/**
 * Obdélníkový průřez. Vstupy b, h jsou v metrech, výstupy A v m², I v m⁴, W v m³.
 */
export function rectSection(b, h) {
  assertPositive("b", b);
  assertPositive("h", h);
  const A = b * h;
  const I = (b * h ** 3) / 12;
  const W = (b * h ** 2) / 6;
  const i = Math.sqrt(I / A);
  return {
    b,
    h,
    A,
    area: A,
    I,
    secondMoment: I,
    W,
    sectionModulus: W,
    i,
    radiusOfGyration: i,
    units: "m, m², m⁴, m³, m",
  };
}

/**
 * Prostý nosník zatížený rovnoměrným spojitým zatížením.
 * q v kN/m, L v m; R a V v kN, M v kNm.
 */
export function simplySupported(q, L) {
  if (!Number.isFinite(q)) throw new RangeError("q musí být konečné číslo.");
  assertPositive("L", L);
  const R = (q * L) / 2;
  const Mmax = (q * L ** 2) / 8;
  return {
    q,
    L,
    totalLoad: q * L,
    R,
    reaction: R,
    V: R,
    Vmax: R,
    maxShear: R,
    M: Mmax,
    Mmax,
    maxMoment: Mmax,
    formula: "R = V = qL/2, M = qL²/8",
  };
}

/**
 * Průhyb prostého nosníku od rovnoměrného zatížení.
 * q v kN/m, L v m, E v MPa, I v m⁴; výsledek v metrech.
 */
export function deflection(q, L, E, I) {
  if (!Number.isFinite(q)) throw new RangeError("q musí být konečné číslo.");
  assertPositive("L", L);
  assertPositive("E", E);
  assertPositive("I", I);
  return (5 * q * L ** 4) / (384 * (E * 1000) * I);
}

/**
 * Vzpěr tlačeného obdélníkového prvku podle EN 1995-1-1, 6.3.2.
 * b, h, lef v m; E005 a fc0 v MPa.
 */
export function columnBuckling(input, ...rest) {
  const options = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : { b: input, h: rest[0], lef: rest[1], E005: rest[2], fc0: rest[3], betaC: rest[4] };
  const { b, h, lef, E005, fc0, betaC } = options;
  assertPositive("b", b);
  assertPositive("h", h);
  assertPositive("lef", lef);
  assertPositive("E005", E005);
  assertPositive("fc0", fc0);
  assertPositive("betaC", betaC);
  const area = b * h;
  const I = Math.min((b * h ** 3) / 12, (h * b ** 3) / 12);
  const i = Math.sqrt(I / area);
  const lambda = lef / i;
  const lambdaRel = (lambda / Math.PI) * Math.sqrt(fc0 / E005);
  const k = 0.5 * (1 + betaC * (lambdaRel - 0.3) + lambdaRel ** 2);
  const kc = lambdaRel <= 0.3 ? 1 : 1 / (k + Math.sqrt(Math.max(0, k ** 2 - lambdaRel ** 2)));
  return {
    area,
    I,
    i,
    slenderness: lambda,
    lambda,
    lambdaRel,
    betaC,
    k,
    kc,
    formula: "λ = lef/i; λrel = λ/π · √(fc0/E005); kc = 1/(k + √(k² − λrel²))",
  };
}

/**
 * Klopení obdélníkového nosníku podle EN 1995-1-1, 6.3.3.
 * b, h, lef v m; E005 a fm v MPa. Vzorec je jednotkově konzistentní i v metrech.
 */
export function lateralTorsionalFactor(input, ...rest) {
  const options = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : { b: input, h: rest[0], lef: rest[1], E005: rest[2], fm: rest[3] };
  const { b, h, lef, E005, fm } = options;
  assertPositive("b", b);
  assertPositive("h", h);
  assertPositive("lef", lef);
  assertPositive("E005", E005);
  assertPositive("fm", fm);
  const sigmaCrit = (0.78 * b ** 2 * E005) / (h * lef);
  const lambdaRel = Math.sqrt(fm / sigmaCrit);
  let kcrit;
  let region;
  if (lambdaRel <= 0.75) {
    kcrit = 1;
    region = "plný";
  } else if (lambdaRel <= 1.4) {
    kcrit = 1.56 - 0.75 * lambdaRel;
    region = "přechod";
  } else {
    kcrit = 1 / lambdaRel ** 2;
    region = "štíhlý";
  }
  return {
    b,
    h,
    lef,
    sigmaCrit,
    lambdaRel,
    kcrit,
    region,
    formula: "σm,crit = 0,78 b² E005/(h lef); λrel,m = √(fm/σm,crit)",
  };
}

function materialFor(structural, key) {
  const material = structural.materials?.[key];
  if (!material) throw new Error(`Materiál ${key} není v model.structural.materials.`);
  return { key, ...material };
}

function roofLoad(model) {
  const assembly = model.assemblies?.roof;
  if (!assembly?.layers?.length) throw new Error("Model neobsahuje assemblies.roof.layers.");
  let selfWeight = 0;
  const layers = assembly.layers.map((layer) => {
    const counted = layer.counted !== false && Number.isFinite(layer.d) && Number.isFinite(layer.density);
    const areaLoad = counted ? (layer.d * layer.density * GRAVITY) / 1000 : 0;
    selfWeight += areaLoad;
    return {
      name: layer.name,
      d: layer.d ?? 0,
      density: layer.density ?? 0,
      source: layer.source ?? "",
      counted,
      areaLoad,
    };
  });
  return {
    label: assembly.label,
    note: assembly.note,
    rsi: assembly.rsi,
    rse: assembly.rse,
    selfWeight,
    gk: selfWeight,
    layers,
    units: "kN/m²",
  };
}

function candidateLadder(original, candidates = []) {
  const start = normalizeSection(original);
  const list = candidates.map(normalizeSection);
  const containsOriginal = list.some((item) => sameSection(item, start));
  const withOriginal = containsOriginal ? list : [start, ...list];
  const filtered = withOriginal
    .filter((item) => item.b >= start.b - 1e-9 && item.h >= start.h - 1e-9)
    .sort((a, b) => (a.b * a.h - b.b * b.h) || (a.h - b.h) || (a.b - b.b));
  return filtered.length ? filtered : [start];
}

function beamDefinitions(source) {
  const main = source.beams?.find((beam) => beam.id === "B1");
  const lintel = source.beams?.find((beam) => beam.id === "L1");
  const spanOf = (beam, fallback) => (beam
    ? Math.hypot(beam.end[0] - beam.start[0], beam.end[1] - beam.start[1])
    : fallback);
  return [
    {
      id: "roof-joist",
      label: "Typový střešní nosník",
      kind: "beam",
      material: "C24",
      span: 4.4,
      tributary: 0.6,
      original: { b: source.geometry?.roofJoistWidth ?? 0.10, h: source.geometry?.roofJoistDepth ?? 0.32 },
      candidates: [
        [0.10, 0.24], [0.10, 0.28], [0.10, 0.32], [0.125, 0.32],
        [0.15, 0.36], [0.15, 0.40], [0.18, 0.44],
      ],
      example: "C24, L = 4,4 m, trib. 0,6 m, 100 × 320 mm",
    },
    {
      id: "living-joist",
      label: "Nosník nad otevřeným obytným prostorem",
      kind: "beam",
      material: "C24",
      span: 7.0,
      tributary: 0.6,
      original: { b: source.geometry?.longRoofJoistWidth ?? 0.18, h: source.geometry?.longRoofJoistDepth ?? 0.44 },
      candidates: [[0.15, 0.40], [0.18, 0.44], [0.20, 0.48], [0.22, 0.52]],
      example: "C24, L = 7,0 m, trib. 0,6 m, 180 × 440 mm; dlouhé pole v 3D rámu",
    },
    {
      id: "main-beam",
      label: "Hlavní lepený průvlak",
      kind: "beam",
      material: main?.material ?? "GL24h",
      span: spanOf(main, 5.2),
      tributary: 5.2,
      original: main ? { b: main.width, h: main.depth } : { b: 0.20, h: 0.60 },
      candidates: [
        [0.18, 0.52], [0.20, 0.60], [0.20, 0.68], [0.24, 0.72],
        [0.24, 0.80], [0.28, 0.88], [0.30, 0.96],
      ],
      example: "GL24h, L = 5,2 m, trib. 5,2 m, 200 × 600 mm",
    },
    {
      id: "lintel",
      label: "Nadpraží jižního prosklení",
      kind: "beam",
      material: lintel?.material ?? "GL24h",
      span: spanOf(lintel, 6.0),
      tributary: 2.0,
      original: lintel ? { b: lintel.width, h: lintel.depth } : { b: 0.20, h: 0.52 },
      candidates: [
        [0.18, 0.44], [0.20, 0.52], [0.20, 0.60], [0.24, 0.64],
        [0.24, 0.72], [0.28, 0.80],
      ],
      example: "GL24h, L = 6,0 m, trib. 2,0 m, 200 × 520 mm",
    },
    {
      id: "column",
      label: "Sloupek C24",
      kind: "column",
      material: "C24",
      lef: source.geometry?.ceilingUnderside ?? 3.30,
      bendingMoment: 2.0,
      axialAssumption: 10.0,
      original: { b: 0.16, h: 0.16 },
      candidates: [
        [0.14, 0.14], [0.16, 0.16], [0.18, 0.18], [0.20, 0.20],
        [0.22, 0.22], [0.24, 0.24], [0.26, 0.26],
      ],
      example: `C24, 160 × 160 mm, lef = ${(source.geometry?.ceilingUnderside ?? 3.30).toFixed(2).replace(".", ",")} m, N = reakce průvlaku + 10 kN, M = 2 kNm`,
    },
  ];
}

function resolveDefinitions(source, overrides = {}) {
  return beamDefinitions(source).map((definition) => {
    const override = overrides[definition.id] ?? {};
    return {
      ...definition,
      ...override,
      original: override.original ?? definition.original,
      candidates: override.candidates ?? definition.candidates,
    };
  });
}

function evaluateBeam(definition, sectionInput, context) {
  const { structural, roof } = context;
  const material = materialFor(structural, definition.material);
  const { b, h } = normalizeSection(sectionInput);
  const section = rectSection(b, h);
  const selfWeightLine = (b * h * WOOD_DENSITY * GRAVITY) / 1000;
  const permanentArea = roof.selfWeight + structural.maintenanceArea;
  const permanentLine = permanentArea * definition.tributary + selfWeightLine;
  const snowLine = structural.snowArea * definition.tributary;
  const qCharacteristic = permanentLine + snowLine;
  const qDesign = structural.gammaG * permanentLine + structural.gammaQ * snowLine;
  const analysis = simplySupported(qDesign, definition.span);
  const deflectionInstant = deflection(qCharacteristic, definition.span, material.Emean, section.I);
  const deflectionFinal = deflectionInstant * (1 + structural.kdef);

  const fmDesign = (structural.kmod * material.fm) / material.gammaM;
  const fvDesign = (structural.kmod * material.fv) / material.gammaM;
  const fc90Design = (structural.kmod * material.fc90) / material.gammaM;
  const effectiveLength = 0.9 * definition.span + 2 * h;
  const lateral = lateralTorsionalFactor({
    b,
    h,
    lef: effectiveLength,
    E005: material.E005,
    fm: material.fm,
  });

  const bendingStress = analysis.Mmax / section.W / 1000;
  const shearStress = (1.5 * analysis.Vmax) / section.A / 1000;
  const bearingStress = analysis.reaction / (b * BEARING_LENGTH) / 1000;
  const limitInstant = definition.span / structural.limits.instantaneous;
  const limitFinal = definition.span / structural.limits.final;

  const checks = {
    bending: check(
      "bending", "Ohyb", bendingStress, lateral.kcrit * fmDesign, "MPa",
      `kcrit = ${lateral.kcrit.toFixed(3)}; lef = ${effectiveLength.toFixed(3)} m`,
    ),
    shear: check("shear", "Smyk", shearStress, fvDesign, "MPa", "τ = 1,5 V/A"),
    bearing: check(
      "bearing", "Podporový tlak", bearingStress, fc90Design, "MPa",
      `délka uložení ${BEARING_LENGTH} m`,
    ),
    deflectionInstant: check(
      "deflectionInstant", "Okamžitý průhyb", deflectionInstant, limitInstant, "m",
      `mez L/${structural.limits.instantaneous}`,
    ),
    deflectionFinal: check(
      "deflectionFinal", "Konečný průhyb", deflectionFinal, limitFinal, "m",
      `mez L/${structural.limits.final}`,
    ),
  };

  return {
    id: definition.id,
    label: definition.label,
    kind: "beam",
    material,
    example: definition.example,
    span: definition.span,
    tributary: definition.tributary,
    section,
    originalSection: normalizeSection(definition.original),
    finalSection: { b, h },
    loads: {
      roofSelfWeightArea: roof.selfWeight,
      maintenanceArea: structural.maintenanceArea,
      snowArea: structural.snowArea,
      permanentArea,
      beamSelfWeightLine: selfWeightLine,
      permanentLine,
      snowLine,
      qCharacteristic,
      qk: qCharacteristic,
      qDesign,
      qd: qDesign,
      combination: `${structural.gammaG} · G + ${structural.gammaQ} · sníh`,
      units: "kN/m², kN/m",
    },
    analysis: {
      ...analysis,
      reaction: analysis.R,
      R: analysis.R,
      M: analysis.Mmax,
      V: analysis.Vmax,
      deflectionInstant,
      deflectionFinal,
      deflectionInstantMm: deflectionInstant * 1000,
      deflectionFinalMm: deflectionFinal * 1000,
      lateralTorsionalLength: effectiveLength,
    },
    strengths: {
      fmDesign,
      fvDesign,
      fc90Design,
      ...lateral,
    },
    stresses: {
      bending: bendingStress,
      shear: shearStress,
      bearing: bearingStress,
      units: "MPa",
    },
    checks,
    overall: overallFrom(checks),
  };
}

function evaluateColumn(definition, sectionInput, context) {
  const { structural, mainBeamReaction } = context;
  const material = materialFor(structural, definition.material);
  const { b, h } = normalizeSection(sectionInput);
  const section = rectSection(b, h);
  const selfWeight = (b * h * definition.lef * WOOD_DENSITY * GRAVITY) / 1000;
  const axialFromBeam = mainBeamReaction;
  const axialDesign = axialFromBeam + definition.axialAssumption + selfWeight;
  const bendingMoment = definition.bendingMoment;

  const fc0Design = (structural.kmod * material.fc0) / material.gammaM;
  const fmDesign = (structural.kmod * material.fm) / material.gammaM;
  const buckling = columnBuckling({
    b,
    h,
    lef: definition.lef,
    E005: material.E005,
    fc0: material.fc0,
    betaC: material.betaC,
  });
  const lateral = lateralTorsionalFactor({
    b,
    h,
    lef: definition.lef,
    E005: material.E005,
    fm: material.fm,
  });

  const axialStress = axialDesign / section.A / 1000;
  const bendingStress = bendingMoment / section.W / 1000;
  const compressionCheck = check(
    "compression", "Tlak se vzpěrem", axialStress, buckling.kc * fc0Design, "MPa",
    `kc = ${buckling.kc.toFixed(3)}, βc = ${material.betaC}`,
  );
  const bendingCheck = check(
    "bending", "Ohyb", bendingStress, lateral.kcrit * fmDesign, "MPa",
    `kcrit = ${lateral.kcrit.toFixed(3)}`,
  );
  const interactionCheck = check(
    "interaction", "Lineární interakce", compressionCheck.eta + bendingCheck.eta, 1, "–",
    "σc0/(kc fc0,d) + σm/(kcrit fm,d) ≤ 1",
  );

  const checks = {
    compression: compressionCheck,
    bending: bendingCheck,
    interaction: interactionCheck,
  };

  return {
    id: definition.id,
    label: definition.label,
    kind: "column",
    material,
    example: definition.example,
    lef: definition.lef,
    section,
    originalSection: normalizeSection(definition.original),
    finalSection: { b, h },
    loads: {
      axialFromBeam,
      axialAssumption: definition.axialAssumption,
      selfWeight,
      axialDesign,
      N: axialDesign,
      bendingMoment,
      M: bendingMoment,
      note: ASSUMPTIONS.column,
      units: "kN, kNm",
    },
    analysis: {
      axialForce: axialDesign,
      N: axialDesign,
      reaction: axialDesign,
      bendingMoment,
      M: bendingMoment,
      maxMoment: bendingMoment,
      maxShear: 0,
      V: 0,
      buckling,
    },
    strengths: {
      fc0Design,
      fmDesign,
      ...lateral,
      kc: buckling.kc,
    },
    stresses: {
      axialCompression: axialStress,
      bending: bendingStress,
      shear: 0,
      units: "MPa",
    },
    checks,
    overall: overallFrom(checks),
  };
}

function evaluate(definition, section, context) {
  return definition.kind === "column"
    ? evaluateColumn(definition, section, context)
    : evaluateBeam(definition, section, context);
}

function designMember(definition, context) {
  const ladder = candidateLadder(definition.original, definition.candidates);
  const start = normalizeSection(definition.original);
  const startIndex = Math.max(0, ladder.findIndex((item) => sameSection(item, start)));
  const attempts = [];
  let selected = null;
  let selectedIndex = startIndex;

  for (let index = startIndex; index < ladder.length; index += 1) {
    const result = evaluate(definition, ladder[index], context);
    attempts.push({
      section: { ...ladder[index] },
      ok: result.overall.ok,
      eta: result.overall.eta,
      governing: result.overall.governing,
      governingLabel: result.overall.governingLabel,
    });
    if (result.overall.ok) {
      selected = result;
      selectedIndex = index;
      break;
    }
  }

  if (!selected) {
    selected = evaluate(definition, ladder[ladder.length - 1], context);
    selectedIndex = ladder.length - 1;
  }

  const original = evaluate(definition, start, context);
  const changed = !sameSection(original.finalSection, selected.finalSection);

  return {
    ...selected,
    original: {
      section: original.section,
      sectionProperties: original.section,
      overall: original.overall,
      checks: original.checks,
      loads: original.loads,
      analysis: original.analysis,
    },
    final: {
      section: selected.section,
      sectionProperties: selected.section,
      overall: selected.overall,
      checks: selected.checks,
      loads: selected.loads,
      analysis: selected.analysis,
    },
    iterations: {
      changed,
      startIndex,
      finalIndex: selectedIndex,
      attempts,
      note: ASSUMPTIONS.iteration,
    },
  };
}

function foundationReport(members, structural) {
  return {
    note: "Základy se v tomto koncepčním reportu nedimenzují. Uvádějí se pouze reakce typových prvků a zatěžovací dráha; skutečný počet podpor, jejich rozmístění a základové konstrukce je nutné ověřit projektem.",
    reactions: members.map((member) => ({
      id: member.id,
      label: member.label,
      kind: member.kind,
      reaction: member.analysis.reaction,
      unit: "kN",
      note: member.kind === "beam"
        ? `reakce na jeden podporový bod typového nosníku; celkem 2 podpory, R = ${member.analysis.reaction.toFixed(2)} kN`
        : "svislá reakce v patě sloupku",
    })),
    loadPath: [
      "Střecha: skladba a střešní nosníky → hlavní průvlak → sloupek / obvodová stěna.",
      "Nadpraží: zatížení střechy a přilehlé stěny → nadpraží → svislé zdivo a ostění.",
      "Svislé zatížení: stěny a sloupek → základové pasy nebo deska; základy nejsou předmětem tohoto reportu.",
    ],
    windPath: [
      "Vítr: střecha → obvodové stěny → základová konstrukce.",
      "Tlak větru je v modelu pouze ilustrační; report neprovádí návrh ztužení ani kotev.",
    ],
    windPressure: structural.windPressure,
    windPressureUnit: "kN/m²",
  };
}

/**
 * Reprodukovatelný report z model.structural. Volitelný druhý argument umožňuje
 * přepsat definice typových prvků (používá se zejména v testech iterace).
 */
export function calculateStructuralReport(model = defaultModel, options = {}) {
  if (!model?.structural) throw new Error("Model neobsahuje structural.");
  const structural = model.structural;
  const roof = roofLoad(model);
  const definitions = resolveDefinitions(model, options.members ?? {});
  const baseContext = { model, structural, roof };
  const byId = {};

  const members = [];
  for (const definition of definitions) {
    if (definition.id === "main-beam") {
      const main = designMember(definition, baseContext);
      members.push(main);
      byId[main.id] = main;
      continue;
    }
    if (definition.id === "column") {
      const mainBeamReaction = byId["main-beam"]?.analysis.reaction ?? 0;
      const column = designMember(definition, { ...baseContext, mainBeamReaction });
      members.push(column);
      byId[column.id] = column;
      continue;
    }
    const member = designMember(definition, baseContext);
    members.push(member);
    byId[member.id] = member;
  }

  const materialSources = [...new Set(members.map((member) => member.material.source).filter(Boolean))];

  return {
    schema: "structural-report/v1",
    id: model.id,
    title: `Předběžný statický report — ${model.id}`,
    status: model.status,
    disclaimer: DISCLAIMER,
    basis: structural.basis,
    units: {
      length: "m",
      force: "kN",
      lineLoad: "kN/m",
      areaLoad: "kN/m²",
      moment: "kNm",
      stress: "MPa",
      deflection: "m (mm je uvedeno v *_Mm)",
    },
    factors: {
      gammaG: structural.gammaG,
      gammaQ: structural.gammaQ,
      psiSnow: structural.psiSnow,
      psiWind: structural.psiWind,
      serviceClass: structural.serviceClass,
      kmod: structural.kmod,
      kdef: structural.kdef,
    },
    assumptions: { ...ASSUMPTIONS },
    roof,
    limits: structural.limits,
    loadNote: structural.loadNote,
    members,
    byId,
    foundations: foundationReport(members, structural),
    sources: [...(model.sources ?? []), ...materialSources],
    warnings: [
      structural.loadNote,
      structural.limits?.note,
      "Kombinace zatížení je zjednodušena na stálé zatížení G + sníh S; údržba je přiřazena ke G.",
      "Report neobsahuje návrh spojů, požární odolnost, imperfekce, dynamiku ani místní normové hodnoty.",
    ],
  };
}
