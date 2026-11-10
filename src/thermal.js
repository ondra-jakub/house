const EPSILON = 1e-12;

function fail(label, message) {
  const prefix = label ? `Neplatná skladba „${label}“: ` : "Neplatná skladba: ";
  throw new Error(prefix + message);
}

function requireFinite(value, description, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(label, `${description} musí být konečné číslo.`);
  }
  return value;
}

function requirePositive(value, description, label) {
  requireFinite(value, description, label);
  if (value <= 0) fail(label, `${description} musí být větší než 0.`);
  return value;
}

function requireNonNegative(value, description, label) {
  requireFinite(value, description, label);
  if (value < 0) fail(label, `${description} nesmí být záporné.`);
  return value;
}

function normalizeBridged(layer, index, label) {
  const bridged = layer.bridged;
  if (!bridged || typeof bridged !== "object" || Array.isArray(bridged)) {
    fail(label, `most ve vrstvě ${index} (${layer.name ?? "bez názvu"}) musí být objekt.`);
  }
  const woodFraction = requireFinite(bridged.woodFraction, `podíl dřeva ve vrstvě ${index}`, label);
  if (woodFraction <= 0 || woodFraction >= 1) {
    fail(label, `podíl dřeva ve vrstvě ${index} musí ležet mezi 0 a 1.`);
  }
  const woodLambda = requirePositive(bridged.woodLambda, `λ dřeva ve vrstvě ${index}`, label);
  return { woodFraction, woodLambda };
}

/**
 * Vypočítá tepelně-technické parametry jedné skladby.
 * Pro vrstvy s mostem používá kombinovanou metodu ČSN EN ISO 6946:
 * horní mez R' = 1 / Σ(f / R_cesta), dolní mez R'' = Rsi + Σ R_vrstva + Rse
 * s ekvivalentní nehomogenní vrstvou. Výsledné R je aritmetický průměr mezí.
 */
export function calculateAssembly(assembly) {
  if (!assembly || typeof assembly !== "object" || Array.isArray(assembly)) {
    throw new Error("Skladba musí být objekt.");
  }

  const label = typeof assembly.label === "string" && assembly.label.trim() ? assembly.label.trim() : null;
  const target = requirePositive(assembly.target, "cíl U", label);
  const rsi = requireNonNegative(assembly.rsi, "Rsi", label);
  const rse = requireNonNegative(assembly.rse, "Rse", label);

  if (!Array.isArray(assembly.layers) || assembly.layers.length === 0) {
    fail(label, "vrstvy musí být neprázdné pole.");
  }

  const layers = [];
  const bridgedLayers = [];
  let countedThickness = 0;
  let totalThickness = 0;
  let homogeneousResistance = 0;

  assembly.layers.forEach((layer, position) => {
    const index = position + 1;
    const name = typeof layer?.name === "string" && layer.name.trim() ? layer.name.trim() : `Vrstva ${index}`;
    const thickness = requireNonNegative(layer?.d, `tloušťka vrstvy ${index} (${name})`, label);
    totalThickness += thickness;

    const counted = layer?.counted !== false;
    const hasLambda = typeof layer?.lambda === "number" && Number.isFinite(layer.lambda) && layer.lambda > 0;

    if (!counted) {
      if (layer?.lambda != null && !hasLambda) {
        fail(label, `λ vrstvy ${index} (${name}) musí být kladné číslo nebo null.`);
      }
      layers.push({
        index,
        name,
        thickness,
        lambda: hasLambda ? layer.lambda : null,
        density: typeof layer?.density === "number" ? layer.density : null,
        source: typeof layer?.source === "string" ? layer.source : null,
        counted: false,
        resistance: 0,
        resistanceInsulation: null,
        resistanceWood: null,
        bridged: false,
      });
      return;
    }

    if (thickness <= 0) {
      fail(label, `tloušťka započítané vrstvy ${index} (${name}) musí být větší než 0.`);
    }
    if (!hasLambda) {
      fail(label, `započítaná vrstva ${index} (${name}) musí mít kladnou λ, nebo být označena counted: false.`);
    }

    countedThickness += thickness;
    const lambda = layer.lambda;

    if (layer.bridged != null) {
      const { woodFraction, woodLambda } = normalizeBridged(layer, index, label);
      const resistanceInsulation = thickness / lambda;
      const resistanceWood = thickness / woodLambda;
      const woodShare = woodFraction;
      const insulationShare = 1 - woodShare;
      const resistance = 1 / (insulationShare / resistanceInsulation + woodShare / resistanceWood);

      bridgedLayers.push({ woodFraction, woodLambda });
      layers.push({
        index,
        name,
        thickness,
        lambda,
        density: typeof layer?.density === "number" ? layer.density : null,
        source: typeof layer?.source === "string" ? layer.source : null,
        counted: true,
        resistance,
        resistanceInsulation,
        resistanceWood,
        bridged: true,
        woodFraction,
        woodLambda,
      });
      return;
    }

    const resistance = thickness / lambda;
    homogeneousResistance += resistance;
    layers.push({
      index,
      name,
      thickness,
      lambda,
      density: typeof layer?.density === "number" ? layer.density : null,
      source: typeof layer?.source === "string" ? layer.source : null,
      counted: true,
      resistance,
      resistanceInsulation: resistance,
      resistanceWood: null,
      bridged: false,
    });
  });

  if (layers.every((layer) => !layer.counted)) {
    fail(label, "neobsahuje žádnou započítanou vrstvu.");
  }

  const layerResistance = layers.reduce((sum, layer) => sum + layer.resistance, 0);
  const resistanceLower = rsi + rse + layerResistance;

  let resistanceUpper = resistanceLower;
  if (bridgedLayers.length > 0) {
    const woodFraction = bridgedLayers[0].woodFraction;
    if (bridgedLayers.some((item) => Math.abs(item.woodFraction - woodFraction) > EPSILON)) {
      fail(label, "všechny přerušované vrstvy musí mít stejný podíl dřeva (woodFraction).");
    }
    const insulationShare = 1 - woodFraction;
    const pathInsulation = rsi + rse + homogeneousResistance
      + layers.filter((layer) => layer.bridged).reduce((sum, layer) => sum + layer.resistanceInsulation, 0);
    const pathWood = rsi + rse + homogeneousResistance
      + layers.filter((layer) => layer.bridged).reduce((sum, layer) => sum + layer.resistanceWood, 0);
    resistanceUpper = 1 / (insulationShare / pathInsulation + woodFraction / pathWood);
  }

  const resistance = bridgedLayers.length > 0 ? (resistanceUpper + resistanceLower) / 2 : resistanceLower;
  if (!(resistance > 0) || !Number.isFinite(resistance)) {
    fail(label, "výsledný odpor musí být kladný a konečný.");
  }

  const u = 1 / resistance;
  const ratio = u / target;

  return {
    label,
    target,
    rsi,
    rse,
    thickness: countedThickness,
    totalThickness,
    layers,
    layerResistance,
    resistanceLower,
    resistanceUpper,
    resistance,
    u,
    ratio,
    resistanceLimitRatio: resistanceUpper / resistanceLower,
    combinedMethodValid: resistanceUpper / resistanceLower <= 1.5,
    meetsTarget: u <= target,
    note: typeof assembly.note === "string" ? assembly.note : null,
  };
}

/**
 * Vypočítá všechny skladby z modelu a vrátí pole výsledků v pořadí model.assemblies.
 * Každý výsledek obsahuje navíc klíč skladby (id), takže je přímo použitelný pro HTML tabulku.
 */
export function calculateAllThermal(model) {
  if (!model || typeof model !== "object" || Array.isArray(model)) {
    throw new Error("Model musí být objekt.");
  }
  const assemblies = model.assemblies;
  if (!assemblies || typeof assemblies !== "object" || Array.isArray(assemblies)) {
    throw new Error("Model neobsahuje objekt assemblies.");
  }
  const entries = Object.entries(assemblies);
  if (entries.length === 0) {
    throw new Error("Model neobsahuje žádné skladby.");
  }

  return entries.map(([id, assembly]) => {
    if (!assembly || typeof assembly !== "object" || Array.isArray(assembly)) {
      throw new Error(`Skladba „${id}“ musí být objekt.`);
    }
    return { id, ...calculateAssembly(assembly) };
  });
}
