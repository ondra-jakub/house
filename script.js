import { model, roomById, wallById } from "./src/model.js";
import { areaSummary, clearDimensions, formatNumber, polygonArea, validateModel } from "./src/geometry.js";
import { renderAxonometry, renderDetail, renderElevation, renderFloorplan, renderSection } from "./src/drawings.js";
import { calculateAllThermal } from "./src/thermal.js";
import { calculateStructuralReport } from "./src/structural.js";

const summary = areaSummary();
const validationErrors = validateModel();
if (validationErrors.length) throw new Error(`Model není konzistentní: ${validationErrors.join("; ")}`);

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const number = (value, digits = 2) => formatNumber(value, digits);
const percent = (value) => `${number(value * 100, 1)} %`;

function table(caption, headers, rows) {
  return `<table><caption>${esc(caption)}</caption><thead><tr>${headers.map((header) => `<th scope="col">${esc(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderDrawings() {
  document.querySelector("[data-presentation-plan]").innerHTML = renderFloorplan();
  document.querySelector("[data-technical-plan]").innerHTML = renderFloorplan({ technical: true });
  document.querySelectorAll("[data-elevation]").forEach((element) => { element.innerHTML = renderElevation(element.dataset.elevation); });
  document.querySelectorAll(".drawing-scroll[data-section]").forEach((element) => { element.innerHTML = renderSection(element.dataset.section); });
  document.querySelectorAll("[data-detail]").forEach((element) => { element.innerHTML = renderDetail(element.dataset.detail); });
  document.querySelector("[data-axo]").innerHTML = renderAxonometry();
  document.querySelector(".legacy-floorplan")?.remove();
}

function renderSummary() {
  document.querySelectorAll('[data-summary="residential"]').forEach((element) => { element.textContent = `${number(summary.residential, 1)} m²`; });
  document.querySelectorAll('[data-summary="residential-value"]').forEach((element) => { element.textContent = number(summary.residential, 1); });
  document.querySelectorAll('[data-summary="garage"]').forEach((element) => { element.textContent = `${number(summary.garage, 1)} m²`; });
  document.querySelectorAll('[data-summary="garage-value"]').forEach((element) => { element.textContent = number(summary.garage, 1); });
  document.querySelectorAll('[data-summary="built"]').forEach((element) => { element.textContent = `${number(summary.built, 1)} m²`; });

  const cards = [
    ["Zastavěná plocha", summary.built, "17,50 × 11,00 m"],
    ["Čisté místnosti domu", summary.residential, "bez garáže a terasy"],
    ["Čistá podlaží včetně garáže", summary.indoor, "součet vnitřních polygonů"],
    ["Garáž", summary.garage, "samostatně vykazovaná plocha"],
    ["Konstrukce", summary.construction, "rozdíl vůči zastavěné ploše"],
    ["Terasa", summary.terrace, "11,00 × 4,00 m; mimo dům"],
  ];
  document.querySelector("#area-summary-table").innerHTML = cards.map(([label, value, note]) => `<div class="data-card"><span>${esc(label)}</span><strong>${number(value, 1)} m²</strong><small>${esc(note)}</small></div>`).join("");

  document.querySelector("#room-table").innerHTML = table(
    "Čisté plochy a obrysové rozměry místností (nepravoúhlá chodba má uvedený obrys, plochu určuje polygon)",
    ["Místnost", "Čistý obrys", "Plocha", "Vykazování"],
    model.rooms.map((room) => {
      const dimensions = clearDimensions(room.polygon);
      return [esc(room.shortName), `${number(dimensions.width)} × ${number(dimensions.depth)} m`, `${number(polygonArea(room.polygon), 2)} m²`, room.id === "garage" ? "garáž" : room.id === "terrace" ? "exteriér" : "dům bez garáže"];
    }),
  );

  document.querySelector("#opening-table").innerHTML = table(
    "Výkaz otvorů; polohy jsou měřené podél stěny v modelu",
    ["Otvor / stěna", "Šířka", "Parapet", "Výška", "Poznámka"],
    model.openings.map((opening) => {
      const wall = wallById(opening.wall);
      const exteriorWindow = wall?.exterior && ["window", "sliding"].includes(opening.type);
      return [`${esc(opening.label)}<br><small>${esc(wall?.side ?? wall?.id)}</small>`, `${number(opening.to - opening.from)} m`, `${number(opening.bottom)} m`, `${number(opening.height)} m`, exteriorWindow ? `Předpoklad Uw ≈ ${number(model.windows.uw)} W/(m²K)` : esc(opening.type)];
    }),
  );
}

const roomElements = () => [...document.querySelectorAll("[data-room].room")];
function selectRoom(id) {
  const room = roomById(id);
  if (!room) return;
  roomElements().forEach((element) => {
    const selected = element.dataset.room === id;
    element.classList.toggle("is-selected", selected);
    element.setAttribute("aria-pressed", String(selected));
  });
  document.querySelector("#room-number").textContent = `${String(room.order).padStart(2, "0")} / ${model.rooms.length}`;
  document.querySelector("#room-name").textContent = room.name;
  document.querySelector("#room-area").textContent = number(polygonArea(room.polygon), 1);
  document.querySelector("#room-description").textContent = room.description;
  document.querySelector("#room-orientation").textContent = room.orientation;
  document.querySelector("#room-features").replaceChildren(...room.features.map((feature) => {
    const item = document.createElement("li");
    item.textContent = feature;
    return item;
  }));
}

function bindRooms() {
  roomElements().forEach((element) => {
    element.addEventListener("click", () => selectRoom(element.dataset.room));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectRoom(element.dataset.room);
      }
    });
  });
  selectRoom("living");
}

function renderThermal() {
  const results = calculateAllThermal(model);
  document.querySelector("#thermal-results").innerHTML = results.map((result) => {
    const limitRatio = result.resistanceUpper / result.resistanceLower;
    const formula = result.layers.some((layer) => layer.bridged)
      ? `<p class="formula">R′ = 1 / Σ(fᵢ / Rcesta,i) = <strong>${number(result.resistanceUpper, 3)} m²K/W</strong><br>R″ = Rsi + ΣRvrstev + Rse = <strong>${number(result.resistanceLower, 3)} m²K/W</strong><br>R = (R′ + R″) / 2 = <strong>${number(result.resistance, 3)} m²K/W</strong>; U = 1 / R = <strong>${number(result.u, 3)} W/(m²·K)</strong></p><p>Opakovaný KVH most: podíl dřeva 12 %, izolace 88 %. Poměr mezí R′/R″ = ${number(limitRatio, 3)} ≤ 1,5; kombinovaná metoda je v tomto rozsahu přípustná. Korekce mechanických spojů a mezer zde nejsou započteny.</p>`
      : `<p class="formula">R = Rsi + Σ(d / λ) + Rse = <strong>${number(result.resistance, 3)} m²K/W</strong>; U = 1 / R = <strong>${number(result.u, 3)} W/(m²·K)</strong></p>`;
    return `<article class="calc-card"><div class="calc-heading"><div><p class="eyebrow">Referenční skladba</p><h3>${esc(result.label)}</h3></div><strong class="result-badge ${result.meetsTarget ? "is-ok" : "is-bad"}">U = ${number(result.u, 3)} · cíl ≤ ${number(result.target, 2)}</strong></div><p>${esc(result.note)}</p>${formula}${table(`Vrstvy — ${result.label}`, ["Vrstva", "d [mm]", "λ [W/(m·K)]", "R [m²K/W]", "Původ / předpoklad"], result.layers.map((layer) => [esc(layer.name), number(layer.thickness * 1000, 1), layer.lambda == null ? "—" : number(layer.lambda, 3), layer.counted ? number(layer.resistance, 3) : "mimo R", esc(layer.source)]))}<p class="calc-footnote">Povrchové odpory: Rsi = ${number(result.rsi)} m²K/W, Rse = ${number(result.rse)} m²K/W. Deklarované λ a návrhové hodnoty podle ISO 10456 musí dodat a potvrdit výrobce/projekt.</p></article>`;
  }).join("") + `<article class="calc-card window-calc"><h3>Okna jako celek</h3><p><strong>Uw ≈ ${number(model.windows.uw)} W/(m²·K)</strong>. ${esc(model.windows.note)}</p></article>`;
}

function checkRows(member) {
  return Object.values(member.checks).map((check) => {
    const deflection = check.id.startsWith("deflection");
    const demand = deflection ? `${number(check.demand * 1000, 2)} mm` : `${number(check.demand, 3)} ${check.unit}`;
    const capacity = deflection ? `${number(check.capacity * 1000, 2)} mm` : `${number(check.capacity, 3)} ${check.unit}`;
    return [esc(check.label), demand, capacity, `${number(check.eta, 3)}`, `<span class="check-state ${check.ok ? "is-ok" : "is-bad"}">${check.ok ? "vyhovuje" : "nevyhovuje"}</span><br><small>${esc(check.note)}</small>`];
  });
}

function renderStructural() {
  const report = calculateStructuralReport(model);
  const factors = table("Pevné vstupy a součinitele", ["Veličina", "Hodnota", "Poznámka"], [
    ["γG / γQ", `${number(report.factors.gammaG, 2)} / ${number(report.factors.gammaQ, 2)}`, "Referenční doporučené hodnoty EN 1990; NDP je nutné ověřit"],
    ["ψ0 sníh / vítr", `${number(report.factors.psiSnow, 2)} / ${number(report.factors.psiWind, 2)}`, "Sníh do 1000 m; bez lokality se nepoužívá jako návrhová hodnota"],
    ["kmod / kdef", `${number(report.factors.kmod, 2)} / ${number(report.factors.kdef, 2)}`, "Servisní třída 1; kmod zvolen konzervativně pro střednědobé zatížení"],
    ["MSÚ", "1,35 G + 1,50 S", "Údržba je v tomto zjednodušení konzervativně přiřazena ke G"],
    ["MSPŘ", "G + S", "Charakteristická kombinace pro průhyb; konečný průhyb uinst(1+kdef)"],
  ]);
  const roof = table("Vlastní tíha střechy ze skladeb", ["Vrstva", "d [m]", "ρ [kg/m³]", "gₖ [kN/m²]"], report.roof.layers.map((layer) => [esc(layer.name), number(layer.d, 3), number(layer.density, 0), number(layer.areaLoad, 4)]));
  const members = report.members.map((member) => {
    const isBeam = member.kind === "beam";
    const properties = isBeam ? [
      ["Schéma", `Prostý nosník, L = ${number(member.span)} m, zatěžovací šířka ${number(member.tributary)} m`],
      ["Průřez", `${member.material.key}; ${number(member.section.b * 1000, 0)} × ${number(member.section.h * 1000, 0)} mm`],
      ["A / I / W", `${number(member.section.A, 4)} m² / ${number(member.section.I, 6)} m⁴ / ${number(member.section.W, 6)} m³`],
      ["qₖ / qd", `${number(member.loads.qCharacteristic, 3)} / ${number(member.loads.qDesign, 3)} kN/m`],
      ["R = V = qL/2", `${number(member.analysis.reaction, 3)} kN`],
      ["M = qL²/8", `${number(member.analysis.Mmax, 3)} kNm`],
      ["σm / τ / σc,90", `${number(member.stresses.bending, 3)} / ${number(member.stresses.shear, 3)} / ${number(member.stresses.bearing, 3)} MPa`],
      ["Klopení", `lef = ${number(member.analysis.lateralTorsionalLength, 3)} m; σm,crit = ${number(member.strengths.sigmaCrit, 3)} MPa; kcrit = ${number(member.strengths.kcrit, 3)}`],
      ["Průhyb", `uinst = ${number(member.analysis.deflectionInstantMm, 2)} mm; ufin = ${number(member.analysis.deflectionFinalMm, 2)} mm`],
    ] : [
      ["Schéma", `Kloubově vedený sloupek, lef = ${number(member.lef)} m`],
      ["Průřez", `${member.material.key}; ${number(member.section.b * 1000, 0)} × ${number(member.section.h * 1000, 0)} mm`],
      ["N / M", `${number(member.loads.axialDesign, 3)} kN / ${number(member.loads.bendingMoment, 3)} kNm`],
      ["Vzpěr", `i = ${number(member.analysis.buckling.i, 4)} m; λ = ${number(member.analysis.buckling.lambda, 2)}; λrel = ${number(member.analysis.buckling.lambdaRel, 3)}; kc = ${number(member.analysis.buckling.kc, 3)}`],
      ["Interakce", "σc,0,d/(kc·fc,0,d) + σm,d/(kcrit·fm,d) ≤ 1; lineární konzervativní vztah"],
    ];
    const iteration = table("Dokumentovaná iterace průřezu", ["Pokus", "Průřez", "Rozhodující kontrola", "η", "Výsledek"], member.iterations.attempts.map((attempt, index) => [String(index + 1), `${number(attempt.section.b * 1000, 0)} × ${number(attempt.section.h * 1000, 0)} mm`, esc(attempt.governingLabel), number(attempt.eta, 3), attempt.ok ? "přijato" : "zvětšit"]));
    return `<article class="calc-card"><div class="calc-heading"><div><p class="eyebrow">${isBeam ? "Prostý nosník" : "Tlak a ohyb"}</p><h3>${esc(member.label)}</h3></div><strong class="result-badge ${member.overall.ok ? "is-ok" : "is-bad"}">ηmax = ${number(member.overall.eta, 3)}</strong></div><p>${esc(member.example)}. Modelový výpočet vyžadující kontrolu statikem.</p>${table(`Schéma a mezivýsledky — ${member.label}`, ["Veličina", "Výsledek"], properties)}${table(`Posouzení — ${member.label}`, ["Kontrola", "Zatížení", "Odolnost / mez", "η", "Výsledek"], checkRows(member))}${iteration}</article>`;
  }).join("");

  const windCharacteristic = model.structural.windPressure * model.geometry.width * model.geometry.parapetTop;
  const windDesign = model.structural.gammaQ * windCharacteristic;
  const foundations = `<article class="calc-card"><h3>Ztužení a reakce do základů</h3><p>Princip dráhy: střešní deska jako horizontální ztužidlo → ztužující stěny → svislé a vodorovné reakce do základů. Zadání spojů, deskových přízvuků, kotev a skutečných ztužujících stěn je další projektová fáze.</p><p>Ilustrační vítr na severní/jižní obrys: wₖ = ${number(model.structural.windPressure)} kN/m² × ${number(model.geometry.width)} m × ${number(model.geometry.parapetTop)} m = <strong>${number(windCharacteristic, 2)} kN</strong>; návrhově γQ·wₖ = <strong>${number(windDesign, 2)} kN</strong>. Při zjednodušeném rozdělení do dvou ztužujících stěn ${number(windDesign / 2, 2)} kN na stěnu. Neobsahuje návrh kotvení ani nadzdvižení.</p>${table("Pouze reakce typových prvků — bez posouzení základů", ["Prvek", "Svislá reakce", "Význam"], report.foundations.reactions.map((reaction) => [esc(reaction.label), `${number(reaction.reaction, 2)} kN`, esc(reaction.note)]))}<p><strong>Neprovádí se:</strong> únosnost, sedání, rozměry patů, výztuž ani způsobilost základů. Chybí lokalita a geotechnický průzkum.</p></article>`;
  document.querySelector("#structural-results").innerHTML = `<article class="calc-card"><h3>Normový rámec a zatížení</h3><p>${esc(report.basis)}</p><p>${esc(report.loadNote)}</p>${factors}${roof}<p>Vlastní tíha střešní skladby celkem <strong>${number(report.roof.selfWeight, 4)} kN/m²</strong>. Materiálové hodnoty C24 a GL24h jsou uvedeny u prvků; γM je ${model.structural.materials.C24.gammaM} pro C24 a ${model.structural.materials.GL24h.gammaM} pro GL24h.</p></article>${members}${foundations}<article class="method-note"><h3>Povinné odborné ověření</h3><p>${esc(report.disclaimer)}</p><ul>${report.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></article>`;
}

const header = document.querySelector("[data-header]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const navigation = document.querySelector("#main-navigation");
let sectionObserver;
const modeContent = {
  prezentace: {
    title: "JIH 140 — Domov otočený za sluncem",
    links: [["#koncept", "Koncept"], ["#pudorys", "Půdorys"], ["#materialy", "Materiály"], ["#pozemek", "Pozemek"]],
  },
  technika: {
    title: "JIH 140 — Technický koncept dřevostavby",
    links: [["#technika-pudorys", "Půdorys"], ["#technika-rezy", "Bokorysy a řezy"], ["#technika-konstrukce", "Konstrukce"], ["#technika-3d", "3D"], ["#technika-statika", "Statika"]],
  },
};

function closeMenu({ focus = false } = {}) {
  document.body.classList.remove("nav-open");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Otevřít navigaci");
  if (focus) menuToggle.focus();
}

function observeNavigation() {
  sectionObserver?.disconnect();
  const links = [...navigation.querySelectorAll("a")];
  const sections = links.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
  if (!("IntersectionObserver" in window)) return;
  sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    links.forEach((link) => link.classList.toggle("is-active", link.getAttribute("href") === `#${visible.target.id}`));
  }, { rootMargin: "-18% 0px -55%", threshold: [0, 0.1, 0.35] });
  sections.forEach((section) => sectionObserver.observe(section));
}

function currentMode() {
  return new URL(window.location.href).searchParams.get("rezim") === "technika" ? "technika" : "prezentace";
}

function applyMode(mode, { scrollToHash = false } = {}) {
  const selected = modeContent[mode] ? mode : "prezentace";
  document.body.dataset.mode = selected;
  document.querySelectorAll("[data-mode-panel]").forEach((panel) => { panel.hidden = panel.dataset.modePanel !== selected; });
  document.querySelectorAll("[data-set-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.setMode === selected)));
  navigation.innerHTML = modeContent[selected].links.map(([href, label]) => `<a href="${href}">${label}</a>`).join("");
  navigation.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => closeMenu()));
  document.title = modeContent[selected].title;
  document.querySelector(".header-action span").textContent = selected === "technika" ? "Tisk techniky" : "Uložit koncept";
  closeMenu();
  observeNavigation();
  if (scrollToHash && window.location.hash) {
    requestAnimationFrame(() => document.querySelector(window.location.hash)?.scrollIntoView());
  }
}

function navigateMode(mode) {
  const url = new URL(window.location.href);
  url.searchParams.set("rezim", mode);
  url.hash = "";
  window.history.pushState({ mode }, "", url);
  applyMode(mode);
}

document.querySelectorAll("[data-set-mode]").forEach((button) => button.addEventListener("click", () => navigateMode(button.dataset.setMode)));
window.addEventListener("popstate", () => applyMode(currentMode(), { scrollToHash: true }));

menuToggle.addEventListener("click", () => {
  const isOpen = document.body.classList.toggle("nav-open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Zavřít navigaci" : "Otevřít navigaci");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu({ focus: true });
});
window.addEventListener("scroll", () => header.classList.toggle("is-scrolled", window.scrollY > 24), { passive: true });
document.querySelectorAll("[data-print]").forEach((button) => button.addEventListener("click", () => window.print()));

let viewer;
const viewerStart = document.querySelector("[data-start-3d]");
const viewerStatus = document.querySelector("[data-viewer-status]");
viewerStart.addEventListener("click", async () => {
  viewerStart.disabled = true;
  viewerStart.textContent = "Načítám lokální 3D…";
  viewerStatus.textContent = "Načítání modulů Three.js z tohoto serveru.";
  try {
    const { createViewer3D } = await import("./src/viewer3d.js");
    viewer = await createViewer3D(document.querySelector("[data-viewer-stage]"), { onStatus: (message) => { viewerStatus.textContent = message; } });
    document.querySelector("[data-viewer]").classList.add("has-live-viewer");
    document.querySelector("[data-viewer-controls]").hidden = false;
    document.querySelector(".viewer-start").hidden = true;
    viewerStatus.textContent = "3D je připravené. Vrstvy lze odkrýt; žádná automatická rotace.";
  } catch (error) {
    viewerStatus.textContent = `Živé 3D nelze spustit (${error.message}). Zobrazuji statickou axonometrii; ostatní technický režim funguje.`;
    viewerStart.hidden = true;
    document.querySelector("[data-viewer]").classList.add("viewer-failed");
  }
});
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => viewer?.setView(button.dataset.view)));
document.querySelector("[data-viewer-reset]").addEventListener("click", () => viewer?.reset());
document.querySelectorAll("[data-layer]").forEach((input) => input.addEventListener("change", () => viewer?.setLayer(input.dataset.layer, input.checked)));
window.addEventListener("pagehide", () => viewer?.dispose(), { once: true });

renderDrawings();
renderSummary();
renderThermal();
renderStructural();
bindRooms();

const initialUrl = new URL(window.location.href);
if (initialUrl.searchParams.has("rezim") && !["prezentace", "technika"].includes(initialUrl.searchParams.get("rezim"))) {
  initialUrl.searchParams.delete("rezim");
  window.history.replaceState({ mode: "prezentace" }, "", initialUrl);
}
applyMode(currentMode(), { scrollToHash: true });
