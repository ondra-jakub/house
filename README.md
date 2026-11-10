# JIH 140

Statická prezentace a technický koncept přízemní rámové dřevostavby pro čtyřčlennou rodinu. Oba režimy používají jediný geometrický model v metrech. Pracovní název **JIH 140** zůstává zachován, plochy jsou však přepočtené podle skutečných polygonů po odečtení koncepcí navržených konstrukcí.

> Sladěný koncept, nikoli projekt pro povolení nebo provedení stavby. Výpočty a rozměry vyžadují ověření oprávněným projektantem, statikem a dalšími specialisty.

## Spuštění

Vyžaduje Node.js 20 nebo novější.

```sh
npm install
npm run dev
```

- Prezentace: `http://localhost:5173/`
- Technika: `http://localhost:5173/?rezim=technika`
- Přímá kotva: například `http://localhost:5173/?rezim=technika#technika-statika`

Prezentace je výchozí a její textový obsah je čitelný i bez JavaScriptu. Přepínač funguje bez reloadu, používá `history.pushState`, podporuje zpět/vpřed a aktualizuje navigaci, titulek i tiskový obsah. Neplatný parametr `rezim` se vrátí k prezentaci.

## Kontroly

```sh
npm run check
```

Spustí kontrolu syntaxe všech modulů a jednotkové testy `node:test`: plochy a součty, překryvy, rozměry, projekce, otvory, SVG, kombinovanou metodu U, statické reakce/momenty/smyk/průhyby a iterace průřezů.

Pro skutečné prohlížečové testy:

```sh
PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers npx playwright install chromium
npm run test:browser
```

Testy ověřují režimy a historii, přímé URL s kotvou, klávesnici, mobilní posouvání výkresů, lokální načtení Three.js bez CDN, 3D ovládání, reduced motion, výpadek WebGL i importu, statický 3D fallback a tisk A3. Snímky a kontrolní PDF se ukládají do `test-results/`.

## Přepočtené plochy

| Údaj | Hodnota |
| --- | ---: |
| Vnější hmota / zastavěná plocha | 17,50 × 11,00 m / **192,50 m²** |
| Čisté místnosti domu bez garáže a terasy | **147,73 m²** |
| Čistá podlaží včetně garáže | **166,00 m²** |
| Podíl vnitřních a vnějších konstrukcí | **26,50 m²** |
| Garáž | **18,27 m²** |
| Jižní terasa | **44,00 m²** |

| Místnost | Čistý obrys | Plocha polygonu |
| --- | ---: | ---: |
| Obytný prostor s kuchyní a jídelnou | 9,99 × 4,79 m | 47,85 m² |
| Hlavní ložnice | 3,99 × 3,79 m | 15,12 m² |
| Dětský pokoj 1 | 3,99 × 3,39 m | 13,53 m² |
| Dětský pokoj 2 | 3,99 × 2,90 m | 11,57 m² |
| Hlavní koupelna | 3,10 × 2,39 m | 7,41 m² |
| Koupelna hlavní ložnice | 2,60 × 1,79 m | 4,65 m² |
| Šatna | 2,60 × 1,90 m | 4,94 m² |
| WC | 1,50 × 1,50 m | 2,25 m² |
| Vstup a zádveří | 3,30 × 2,39 m | 7,89 m² |
| Chodba, nepravoúhlý polygon | obrys 6,80 × 3,90 m | 19,92 m² |
| Spíž | 1,10 × 2,90 m | 3,19 m² |
| Technická místnost | 1,10 × 2,90 m | 3,19 m² |
| Prádelna | 2,60 × 2,39 m | 6,21 m² |
| Garáž | 3,39 × 5,39 m | 18,27 m² |
| Terasa | 11,00 × 4,00 m | 44,00 m² |

Plocha nepravoúhlé chodby se počítá z polygonu, nikoli z uvedeného obrysu. Vestavěné skříně nejsou připočítávány jako další plocha. Dispozice je koncepční; zejména servisní plochu technické místnosti a komunikační plochy je potřeba optimalizovat v další fázi.

## Modelová architektura

- `src/model.js` — závazný souřadnicový systém, místnosti, stěny, otvory, nosné prvky, výšky, skladby, materiály a technické předpoklady.
- `src/geometry.js` — plochy polygonů, čisté rozměry, součty, průsečíky, projekce a validace modelu.
- `src/drawings.js` — generované SVG půdorysy, čtyři bokorysy, dva řezy, čtyři detaily a statická axonometrie.
- `src/thermal.js` — výpočet U včetně opakovaných KVH tepelných mostů.
- `src/structural.js` — čisté funkce referenčního statického příkladu a dokumentované iterace.
- `src/viewer3d.js` — dynamicky importovaný Three.js prohlížeč odvozený pouze z modelu.
- `script.js` — režimy, navigace, výběr místností, tabulky, 3D a tisk.
- `index.html`, `styles.css` — obsah, responzivní rozhraní a kalibrovaný tisk.
- `server.mjs` — statický server bez aplikačních závislostí.
- `test/`, `browser-tests/` — jednotkové a prohlížečové testy.

### Technické výkresy a tisk

Všechny výkresy obsahují `<title>`, `<desc>`, jednotky a popis měřítka. Půdorys, bokorysy a řezy mají v SVG uloženou kalibrovanou šířku pro **A3 na šířku, M 1:100**. Na obrazovce je měřítko vždy jen orientační. Detaily a axonometrie jsou výslovně bez závazného měřítka. Na mobilu se výkresy kontrolovaně horizontálně posouvají a doprovázejí je textové tabulky.

Tlačítko tisku zpracuje pouze aktivní režim. Technický tisk obsahuje všechny výkresy a výpočty; živý canvas se nahradí statickou axonometrií.

## Skladby a tepelné výpočty

Nosný systém je rámová KVH dřevostavba, nad velkými otvory jsou lepené dřevěné nosníky. Energetickým cílem je nízkoenergetický dům, ne nepodložené tvrzení o pasivním standardu.

| Skladba | Referenční U | Cíl |
| --- | ---: | ---: |
| Obvodová stěna s KVH mosty | 0,135 W/(m²·K) | ≤ 0,15 |
| Lehká teplá střecha | 0,099 W/(m²·K) | ≤ 0,12 |
| Podlaha domu, zjednodušený 1D model | 0,112 W/(m²·K) | ≤ 0,20 |
| Podlaha garáže, zjednodušený 1D model | 0,139 W/(m²·K) | ≤ 0,20 |
| Okna | Uw ≈ 0,80 W/(m²·K), předpoklad | nikoli Ug |

Stěna používá kombinovanou metodu ČSN EN ISO 6946:2020 / ISO 6946:2017. Horní a dolní mez tepelného odporu se průměrují **v odporech**, nikoli v U. Model počítá 12 % dřeva v opakované KVH zóně. Silně větraná dutina a obklad se do odporu nezapočítávají. Deklarované λ, korekce spojů a výrobkové údaje je nutné potvrdit.

Střecha má rovnou spodní vrstvu a spádovaný povrch 2 % k severním vpustím VP1/VP2; nouzový přepad NP1 je v jižní atice. Hlavní průvlak začíná až nad čistou výškou 2,70 m a nadpraží navazuje na horní hranu prosklení.

U je oddělené od Ψ mostů, difuze, kondenzace, vzduchotěsnosti, požárního detailu a PENB. Podlahu na terénu je v projektu nutné posoudit podle ISO 13370. Vlhkostní režim ani celkovou energetickou bilanci tento výpočet neprokazuje.

## Technické 3D

- Three.js **0.180.0**, pevná verze v `package.json` a `package-lock.json`.
- Lokální ES moduly z `node_modules`, licence MIT v `node_modules/three/LICENSE`; žádné CDN ani síťové požadavky na externí servery.
- Dynamický import až po stisku **Spustit technické 3D**.
- Ortografická kamera, TrackballControls, rotace všemi osami, zoom, dotyk, klávesnice, reset a pohledy S/V/J/Z/axonometrie.
- Samostatné odkrytí střechy, fasádních vrstev, obálky a místností; bez automatické rotace a realistických textur.
- Při nedostupném WebGL, chybě importu a při tisku se použije statická axonometrie. Zbytek technického režimu zůstává funkční.

## Referenční statické předdimenzování

Report obsahuje typový střešní nosník C24, dlouhý 7m nosník nad otevřeným obytným prostorem, hlavní průvlak GL24h, nadpraží 6 m jižního prosklení a obvodový sloupek C24 včetně vzpěru a interakce tlak–ohyb. Uvádí zatížení, reakce, průřezové charakteristiky, ohyb, smyk, podporový tlak, klopení/vzpěr, okamžitý a konečný průhyb, využití η a dokumentovanou iteraci. Ztužení je popsáno dráhou střecha → ztužující stěny → reakce do základů.

Použitá je **referenční sada 1. generace Eurokódů**: EN 1990, EN 1991-1-1/-1-3/-1-4 a EN 1995-1-1, C24 podle EN 338 a GL24h podle EN 14080. V letech 2024–2026 vycházejí nová česká vydání norem, zejména ČSN EN 1990 ed. 3 (2024) a ČSN EN 1995-1-1 ed. 2 (2026). Národní dodatky a přechodná pravidla musí skutečný projekt znovu ověřit.

Sníh 1,20 kN/m², údržba 0,40 kN/m² a vítr 0,65 kN/m² jsou **ilustrační vstupy bez lokality**, nikoli normové hodnoty pro stavbu. Údržba je v zjednodušeném příkladu konzervativně přiřazena ke stálému zatížení. `kmod = 0,80` je zvolen konzervativně pro střednědobé zatížení, `kdef = 0,60`, servisní třída 1. Základy se nedimenzují: chybí lokalita a geotechnický průzkum.

## Hranice a další fáze

Mimo rozsah jsou projekt pro povolení/provedení, certifikace pasivního domu, PENB/PHPP, hydrotermální simulace, konkrétní lokalita a geologie, únosnost a sedání základů, rozměry patů a výztuž, návrh spojů a kotvení, odborný podpis a obecná webová statická kalkulačka.

Další fáze vyžaduje pozemek a místní zatížení, geotechnický průzkum, výrobkové parametry, skutečné ztužující stěny a spoje, vlhkostní a požární posouzení, optimalizaci dispozice a odbornou projektovou kontrolu.

Vaše připomínky?
