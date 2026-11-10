import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { model, openingsForWall } from "./model.js";
import { solidIntervals, wallLength, wallPoint } from "./geometry.js";

const WALL_TOP = model.geometry.ceilingUnderside;
const VIEW_DISTANCE = 60;
const VIEW_HEIGHT = 16;
const VIEW_WIDTH = 22.5;
const AXON_DIRECTION = new THREE.Vector3(-0.55, 0.58, 0.72).normalize();
const ROOM_FILLS = Object.freeze({
  social: 0xe7cdb0,
  private: 0xd5ddcb,
  service: 0xe0dfd7,
  "private-service": 0xdde2d4,
  hall: 0xece9e1,
  garage: 0xd1d4ce,
  terrace: 0xe6d6be,
});
const VIEW_DIRECTIONS = Object.freeze({
  north: new THREE.Vector3(0, 0, -1),
  south: new THREE.Vector3(0, 0, 1),
  east: new THREE.Vector3(1, 0, 0),
  west: new THREE.Vector3(-1, 0, 0),
  axon: AXON_DIRECTION,
});
const VIEW_LABELS = Object.freeze({
  north: "sever",
  south: "jih",
  east: "východ",
  west: "západ",
  axon: "axonometrie",
});
const VIEW_ALIASES = new Map([
  ["s", "north"],
  ["sever", "north"],
  ["north", "north"],
  ["j", "south"],
  ["jih", "south"],
  ["south", "south"],
  ["v", "east"],
  ["vychod", "east"],
  ["east", "east"],
  ["z", "west"],
  ["zapad", "west"],
  ["west", "west"],
  ["axon", "axon"],
  ["axo", "axon"],
  ["axonometrie", "axon"],
]);
const GUIDE_TEXT = "Tažení myší otáčí model, kolečko přibližuje a pravé tlačítko posouvá. Šipky otáčejí, Q/E rotují kolem osy pohledu, +/− mění zoom, Home vrací axonometrii a S/V/J/Z volí pohled od severu, východu, jihu a západu. Na dotykovém displeji otáčí jeden prst, dva prsty zoomují a posouvají.";
const ARIA_LABEL = "Interaktivní 3D model domu JIH 140 s ortografickou kamerou. Tažení myší nebo šipky otáčejí model, Q a E rotují kolem osy pohledu, plus a minus mění přiblížení, Home obnoví axonometrii a klávesy S, V, J, Z nastaví pohled od severu, východu, jihu a západu.";
const WEBGL_MESSAGE = "3D zobrazení nelze spustit, protože prohlížeč nepodporuje WebGL nebo je grafický kontext nedostupný. Zobrazuje se statická axonometrie.";
const BUILD_MESSAGE = "3D model se nepodařilo sestavit. Zobrazuje se statická axonometrie.";
let viewerCounter = 0;

function normalizeViewName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function resolveView(name) {
  const key = VIEW_ALIASES.get(normalizeViewName(name));
  if (!key) return null;
  return { direction: VIEW_DIRECTIONS[key], label: VIEW_LABELS[key] };
}

class Viewer3D {
  constructor(container, onStatus) {
    this.container = container;
    this.onStatus = onStatus;
    this.disposed = false;
    this.root = null;
    this.canvas = null;
    this.guide = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.groups = null;
    this.materialsMap = null;
    this.roomMaterials = null;
    this.edgeMaterial = null;
    this.roomEdgeMaterial = null;
    this.facadeThickness = 0;
    this.target = new THREE.Vector3();
    this.aspect = 1.6;
    this.geometries = [];
    this.materials = [];
    this.activePointers = new Set();
    this.frameId = null;
    this.resizeObserver = null;
    this.resizeListener = null;
    this.motionQuery = null;
    this.motionListener = null;
    this.containerPosition = null;
    this.containerPositionChanged = false;
    this.handleChange = this.handleChange.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.resize = this.resize.bind(this);
  }

  async init() {
    if (!this.container || typeof this.container.appendChild !== "function") {
      throw new Error("3D model nelze zobrazit: chybí cílový kontejner.");
    }

    this.status("Připravuji 3D model…");

    const canvas = document.createElement("canvas");
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", ARIA_LABEL);
    canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;cursor:grab;outline-offset:-3px;";
    this.canvas = canvas;

    const guide = document.createElement("div");
    guide.id = `viewer3d-guide-${viewerCounter += 1}`;
    guide.textContent = GUIDE_TEXT;
    guide.style.cssText = "position:absolute;left:12px;right:12px;bottom:12px;max-width:640px;padding:8px 10px;border:1px solid rgba(61,70,63,.18);border-radius:4px;background:rgba(248,246,240,.9);color:#3d473f;font:12px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;pointer-events:none;z-index:2;";
    this.guide = guide;
    canvas.setAttribute("aria-describedby", guide.id);

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch (error) {
      this.status("3D zobrazení není dostupné. Zobrazuje se statická axonometrie.");
      const failure = new Error(WEBGL_MESSAGE);
      failure.cause = error;
      throw failure;
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0xf4f1e8, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    const root = document.createElement("div");
    root.className = "viewer3d-root";
    root.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#f4f1e8;z-index:1;";
    root.append(canvas, guide);
    this.root = root;

    if (this.container.style) {
      this.containerPosition = this.container.style.position;
      if (window.getComputedStyle(this.container).position === "static") {
        this.container.style.position = "relative";
        this.containerPositionChanged = true;
      }
    }
    this.container.appendChild(root);

    try {
      this.buildScene();
      this.setupCamera();
      this.resize();
      this.setupControls();
      this.setupEvents();
      this.applyView("axon", false);
      this.status("3D model je připraven.");
    } catch (error) {
      this.dispose();
      this.status("3D model se nepodařilo sestavit. Zobrazuje se statická axonometrie.");
      const failure = new Error(BUILD_MESSAGE);
      failure.cause = error;
      throw failure;
    }

    return this;
  }

  status(message) {
    if (typeof this.onStatus !== "function") return;
    try {
      this.onStatus(message);
    } catch {
      this.onStatus = null;
    }
  }

  material(material) {
    this.materials.push(material);
    return material;
  }

  meshMaterial(options) {
    return this.material(new THREE.MeshStandardMaterial(options));
  }

  addGeometries(geometry) {
    this.geometries.push(geometry);
    return geometry;
  }

  buildScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f1e8);
    this.scene = scene;

    this.edgeMaterial = this.material(new THREE.LineBasicMaterial({
      color: 0x3d463f,
      transparent: true,
      opacity: 0.55,
    }));
    this.roomEdgeMaterial = this.material(new THREE.LineBasicMaterial({
      color: 0x677268,
      transparent: true,
      opacity: 0.7,
    }));

    this.groups = {
      roof: this.createGroup("roof"),
      facade: this.createGroup("facade"),
      envelope: this.createGroup("envelope"),
      frame: this.createGroup("frame"),
      rooms: this.createGroup("rooms"),
    };
    Object.values(this.groups).forEach((group) => scene.add(group));

    this.target.set(
      model.geometry.width / 2,
      model.geometry.clearHeight * 0.5,
      model.geometry.depth / 2,
    );

    this.materialsMap = {
      envelope: this.meshMaterial({ color: 0xd8cbb8, roughness: 0.92, metalness: 0 }),
      facade: this.meshMaterial({ color: 0xbcae98, roughness: 0.95, metalness: 0 }),
      roof: this.meshMaterial({ color: 0xa9ada6, roughness: 0.94, metalness: 0 }),
      slab: this.meshMaterial({ color: 0xd0ccc2, roughness: 0.95, metalness: 0 }),
      frame: this.meshMaterial({ color: 0x4a514d, roughness: 0.5, metalness: 0.3 }),
      timber: this.meshMaterial({ color: 0xb5844f, roughness: 0.78, metalness: 0 }),
      beam: this.meshMaterial({ color: 0x8a5d33, roughness: 0.72, metalness: 0 }),
      door: this.meshMaterial({ color: 0x8a6746, roughness: 0.7, metalness: 0 }),
      doorFrame: this.meshMaterial({ color: 0x76563a, roughness: 0.7, metalness: 0 }),
      garage: this.meshMaterial({ color: 0x707672, roughness: 0.55, metalness: 0.25 }),
      metal: this.meshMaterial({ color: 0x454b4b, roughness: 0.45, metalness: 0.55 }),
      glass: this.meshMaterial({
        color: 0x9fbdc3,
        roughness: 0.08,
        metalness: 0.05,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    };

    this.roomMaterials = {};
    for (const [zone, color] of Object.entries(ROOM_FILLS)) {
      this.roomMaterials[zone] = this.meshMaterial({
        color,
        roughness: 0.96,
        metalness: 0,
        side: THREE.DoubleSide,
      });
    }
    this.roomMaterials.default = this.meshMaterial({
      color: 0xdedad0,
      roughness: 0.96,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    this.facadeThickness = this.outerLayerThickness();
    this.addLights();
    this.buildFloor();
    this.buildRooms();
    this.buildWalls();
    this.buildOpenings();
    this.buildFrame();
    this.buildRoof();
    this.buildBeams();
  }

  createGroup(name) {
    const group = new THREE.Group();
    group.name = name;
    return group;
  }

  outerLayerThickness() {
    const layers = model.assemblies?.wall?.layers ?? [];
    const outer = layers.slice(-3).reduce((sum, layer) => sum + (Number(layer.d) || 0), 0);
    return Math.min(model.geometry.exteriorWall * 0.55, Math.max(0.06, outer));
  }

  addLights() {
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0xc8cbc2, 2.1);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(this.target.x + 14, 24, this.target.z + 18);
    key.target.position.copy(this.target);
    this.scene.add(key, key.target);

    const fill = new THREE.DirectionalLight(0xf7f6f1, 1);
    fill.position.set(this.target.x - 18, 12, this.target.z - 16);
    fill.target.position.copy(this.target);
    this.scene.add(fill, fill.target);
  }

  addEdges(mesh, material = this.edgeMaterial, threshold = 20) {
    const edges = this.addGeometries(new THREE.EdgesGeometry(mesh.geometry, threshold));
    const lines = new THREE.LineSegments(edges, material);
    mesh.add(lines);
    return lines;
  }

  addBox(group, sizeX, sizeY, sizeZ, material, x, y, z, rotationY = 0, edges = true) {
    const geometry = this.addGeometries(new THREE.BoxGeometry(sizeX, sizeY, sizeZ));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotationY;
    group.add(mesh);
    if (edges) this.addEdges(mesh);
    return mesh;
  }

  addWallBox(group, wall, from, to, bottom, top, offset, thickness, material, edges = true) {
    const along = to - from;
    const height = top - bottom;
    if (along <= 1e-5 || height <= 1e-5 || thickness <= 1e-5) return null;
    const point = wallPoint(wall, (from + to) / 2, offset + thickness / 2);
    return this.addBox(
      group,
      along,
      height,
      thickness,
      material,
      point[0],
      (bottom + top) / 2,
      point[1],
      Math.atan2(wall.inward[0], wall.inward[1]),
      edges,
    );
  }

  buildFloor() {
    const { width, depth, terrace } = model.geometry;
    const slabHeight = 0.18;
    this.addBox(
      this.groups.frame,
      width,
      slabHeight,
      depth,
      this.materialsMap.slab,
      width / 2,
      -slabHeight / 2,
      depth / 2,
      0,
      true,
    );

    const terraceHeight = 0.12;
    this.addBox(
      this.groups.frame,
      terrace.width,
      terraceHeight,
      terrace.depth,
      this.materialsMap.slab,
      terrace.width / 2,
      -terraceHeight / 2,
      depth + terrace.depth / 2,
      0,
      true,
    );
  }

  buildRooms() {
    for (const room of model.rooms) {
      const shape = new THREE.Shape();
      room.polygon.forEach(([x, y], index) => {
        if (index === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      });
      shape.closePath();

      const geometry = this.addGeometries(new THREE.ShapeGeometry(shape));
      geometry.rotateX(Math.PI / 2);

      const material = this.roomMaterials[room.zone] ?? this.roomMaterials.default;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = 0.012;
      mesh.name = `room-${room.id}`;
      this.groups.rooms.add(mesh);
      this.addEdges(mesh, this.roomEdgeMaterial);
    }
  }

  buildWalls() {
    for (const wall of model.walls) {
      const exterior = Boolean(wall.exterior);
      const facade = exterior
        ? Math.min(this.facadeThickness, wall.thickness - 0.06)
        : 0;
      const core = wall.thickness - facade;

      if (core > 0.01) {
        this.buildWallLayer(this.groups.envelope, wall, facade, core, this.materialsMap.envelope);
      }
      if (facade > 0.01) {
        this.buildWallLayer(this.groups.facade, wall, 0, facade, this.materialsMap.facade);
      }
    }
  }

  buildWallLayer(group, wall, offset, thickness, material) {
    const openings = openingsForWall(wall.id);

    for (const interval of solidIntervals(wall, openings)) {
      this.addWallBox(group, wall, interval.from, interval.to, 0, WALL_TOP, offset, thickness, material);
    }

    for (const opening of openings) {
      const top = opening.bottom + opening.height;
      const bottomBand = Math.min(opening.bottom, WALL_TOP);
      if (bottomBand > 0.001) {
        this.addWallBox(group, wall, opening.from, opening.to, 0, bottomBand, offset, thickness, material);
      }
      if (top < WALL_TOP - 0.001) {
        this.addWallBox(group, wall, opening.from, opening.to, Math.max(top, 0), WALL_TOP, offset, thickness, material);
      }
    }
  }

  buildOpenings() {
    for (const opening of model.openings) {
      const wall = model.walls.find((item) => item.id === opening.wall);
      if (!wall) continue;
      const group = wall.exterior ? this.groups.facade : this.groups.envelope;
      this.buildOpening(group, wall, opening);
    }
  }

  buildOpening(group, wall, opening) {
    const width = opening.to - opening.from;
    const height = opening.height;
    const top = opening.bottom + height;
    if (width <= 0.05 || height <= 0.05) return;

    const frameDepth = Math.min(0.14, Math.max(0.06, wall.thickness * 0.5));
    const frameOffset = Math.max(0.01, (wall.thickness - frameDepth) / 2);
    const border = Math.min(0.07, Math.max(0.04, Math.min(width, height) * 0.14));
    const innerFrom = opening.from + border;
    const innerTo = opening.to - border;
    const innerBottom = opening.bottom + border;
    const innerTop = top - border;
    const frameMaterial = opening.type === "door"
      ? this.materialsMap.doorFrame
      : this.materialsMap.frame;

    this.addWallBox(group, wall, opening.from, innerFrom, opening.bottom, top, frameOffset, frameDepth, frameMaterial);
    this.addWallBox(group, wall, innerTo, opening.to, opening.bottom, top, frameOffset, frameDepth, frameMaterial);
    this.addWallBox(group, wall, innerFrom, innerTo, opening.bottom, innerBottom, frameOffset, frameDepth, frameMaterial);
    this.addWallBox(group, wall, innerFrom, innerTo, innerTop, top, frameOffset, frameDepth, frameMaterial);

    if (innerTo - innerFrom <= 0.01 || innerTop - innerBottom <= 0.01) return;

    if (opening.type === "garage") {
      this.buildGaragePanel(group, wall, opening, innerFrom, innerTo, innerBottom, innerTop, frameOffset, frameDepth);
      return;
    }
    if (opening.type === "door") {
      this.buildDoorLeaf(group, wall, opening, innerFrom, innerTo, innerBottom, innerTop, frameOffset, frameDepth);
      return;
    }
    this.buildGlazing(group, wall, opening, innerFrom, innerTo, innerBottom, innerTop, frameOffset, frameDepth);
  }

  buildGlazing(group, wall, opening, innerFrom, innerTo, innerBottom, innerTop, frameOffset, frameDepth) {
    const glassOffset = frameOffset + frameDepth * 0.35;
    this.addWallBox(
      group,
      wall,
      innerFrom,
      innerTo,
      innerBottom,
      innerTop,
      glassOffset,
      0.018,
      this.materialsMap.glass,
      false,
    );

    const clearWidth = innerTo - innerFrom;
    const panels = Math.max(1, Math.round(clearWidth / 1.55));
    for (let index = 1; index < panels; index += 1) {
      const at = innerFrom + (clearWidth * index) / panels;
      this.addWallBox(
        group,
        wall,
        at - 0.025,
        at + 0.025,
        innerBottom,
        innerTop,
        frameOffset + frameDepth * 0.12,
        frameDepth * 0.76,
        this.materialsMap.frame,
      );
    }

    if (opening.type === "window" && innerTop - innerBottom > 1.4) {
      const railY = innerBottom + (innerTop - innerBottom) * 0.58;
      this.addWallBox(
        group,
        wall,
        innerFrom,
        innerTo,
        railY - 0.02,
        railY + 0.02,
        frameOffset + frameDepth * 0.12,
        frameDepth * 0.76,
        this.materialsMap.frame,
      );
    }
  }

  buildDoorLeaf(group, wall, opening, innerFrom, innerTo, innerBottom, innerTop, frameOffset, frameDepth) {
    this.addWallBox(
      group,
      wall,
      innerFrom + 0.005,
      innerTo - 0.005,
      opening.bottom + 0.012,
      innerTop - 0.005,
      frameOffset + frameDepth * 0.38,
      0.045,
      this.materialsMap.door,
    );
  }

  buildGaragePanel(group, wall, opening, innerFrom, innerTo, innerBottom, innerTop, frameOffset, frameDepth) {
    const count = 5;
    const gap = 0.015;
    const available = innerTop - innerBottom;
    const slatHeight = (available - gap * (count - 1)) / count;
    if (slatHeight <= 0.03) return;

    for (let index = 0; index < count; index += 1) {
      const bottom = innerBottom + index * (slatHeight + gap);
      this.addWallBox(
        group,
        wall,
        innerFrom,
        innerTo,
        bottom,
        bottom + slatHeight,
        frameOffset + frameDepth * 0.22,
        0.06,
        this.materialsMap.garage,
      );
    }
  }

  buildFrame() {
    const { kvhModule, kvhWidth } = model.geometry;

    for (const wall of model.walls) {
      const total = wallLength(wall);
      if (total <= 0.01) continue;

      const exterior = Boolean(wall.exterior);
      const facade = exterior
        ? Math.min(this.facadeThickness, wall.thickness - 0.06)
        : 0;
      const core = wall.thickness - facade;
      const depth = Math.max(0.045, core * (exterior ? 0.62 : 0.55));
      const offset = facade + (core - depth) / 2;
      const frameBottom = 0.004;
      const frameTop = WALL_TOP - 0.004;
      const plate = Math.min(kvhWidth, Math.max(0.045, frameTop - frameBottom));
      const openings = openingsForWall(wall.id);

      const positions = [];
      for (let along = kvhWidth / 2; along < total - kvhWidth / 2 - 0.001; along += kvhModule) {
        positions.push(along);
      }
      const lastAlong = positions.length ? positions[positions.length - 1] : 0;
      if (total > kvhWidth && total - lastAlong > kvhModule * 0.5) {
        positions.push(total - kvhWidth / 2);
      }
      const uniquePositions = [...new Set(positions.map((value) => Number(value.toFixed(4))))];

      for (const along of uniquePositions) {
        const blocked = openings.some((opening) => (
          opening.bottom < frameTop
          && along > opening.from - kvhWidth / 2
          && along < opening.to + kvhWidth / 2
        ));
        if (blocked) continue;
        this.addWallBox(
          this.groups.frame,
          wall,
          along - kvhWidth / 2,
          along + kvhWidth / 2,
          frameBottom,
          frameTop,
          offset,
          depth,
          this.materialsMap.timber,
        );
      }

      const groundOpenings = openings.filter((opening) => opening.bottom <= 0.01);
      for (const interval of solidIntervals(wall, groundOpenings)) {
        this.addWallBox(
          this.groups.frame,
          wall,
          interval.from,
          interval.to,
          frameBottom,
          frameBottom + plate,
          offset,
          depth,
          this.materialsMap.timber,
        );
      }

      this.addWallBox(
        this.groups.frame,
        wall,
        0,
        total,
        frameTop - plate,
        frameTop,
        offset,
        depth,
        this.materialsMap.timber,
      );
    }

    const joistTop = model.geometry.ceilingUnderside;
    const joistDepth = model.geometry.roofJoistDepth;
    const joistWidth = model.geometry.roofJoistWidth;
    const supports = [0, 7, 10.4, 13.1, model.geometry.width];
    for (let y = model.geometry.kvhModule / 2; y < model.geometry.depth; y += model.geometry.kvhModule) {
      for (let index = 0; index < supports.length - 1; index += 1) {
        const from = supports[index];
        const to = supports[index + 1];
        const longSpan = to - from > 4.4;
        const sectionWidth = longSpan ? model.geometry.longRoofJoistWidth : joistWidth;
        const sectionDepth = longSpan ? model.geometry.longRoofJoistDepth : joistDepth;
        this.addBox(
          this.groups.frame,
          to - from,
          sectionDepth,
          sectionWidth,
          this.materialsMap.timber,
          (from + to) / 2,
          joistTop - sectionDepth / 2,
          y,
          0,
          false,
        );
      }
    }
  }

  buildRoof() {
    const { width, depth, ceilingUnderside, roofTop, parapetTop, roofSlope } = model.geometry;
    const topNorth = roofTop - depth / 2 * roofSlope;
    const topSouth = roofTop + depth / 2 * roofSlope;
    const positions = [
      0, ceilingUnderside, 0, width, ceilingUnderside, 0, width, ceilingUnderside, depth, 0, ceilingUnderside, depth,
      0, topNorth, 0, width, topNorth, 0, width, topSouth, depth, 0, topSouth, depth,
    ];
    const indices = [
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1,
      3, 2, 6, 3, 6, 7,
      0, 3, 7, 0, 7, 4,
      1, 5, 6, 1, 6, 2,
    ];
    const geometry = this.addGeometries(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const roofMesh = new THREE.Mesh(geometry, this.materialsMap.roof);
    this.groups.roof.add(roofMesh);
    this.addEdges(roofMesh);
    roofMesh.name = `Teplá střecha, rovné podhledové podloží a spád ${roofSlope * 100} %`;
    for (const drain of model.roofDrainage.drains) {
      const drainY = roofTop + (drain.y - depth / 2) * roofSlope + 0.025;
      this.addBox(this.groups.roof, 0.16, 0.05, 0.16, this.materialsMap.metal, drain.x, drainY, drain.y, 0, true).name = drain.id;
    }
    const overflow = model.roofDrainage.emergencyOverflow;
    this.addBox(this.groups.roof, 0.28, 0.10, 0.08, this.materialsMap.metal, overflow.x, overflow.z, depth - 0.04, 0, true).name = overflow.id;

    const parapetBase = topNorth;
    const parapetHeight = parapetTop - parapetBase;
    if (parapetHeight <= 0.01) return;

    const parapetThickness = Math.min(0.18, model.geometry.exteriorWall * 0.5);
    const y = parapetBase + parapetHeight / 2;
    this.addBox(
      this.groups.roof,
      width,
      parapetHeight,
      parapetThickness,
      this.materialsMap.roof,
      width / 2,
      y,
      parapetThickness / 2,
      0,
      true,
    );
    this.addBox(
      this.groups.roof,
      width,
      parapetHeight,
      parapetThickness,
      this.materialsMap.roof,
      width / 2,
      y,
      depth - parapetThickness / 2,
      0,
      true,
    );
    this.addBox(
      this.groups.roof,
      parapetThickness,
      parapetHeight,
      depth - parapetThickness * 2,
      this.materialsMap.roof,
      parapetThickness / 2,
      y,
      depth / 2,
      0,
      true,
    );
    this.addBox(
      this.groups.roof,
      parapetThickness,
      parapetHeight,
      depth - parapetThickness * 2,
      this.materialsMap.roof,
      width - parapetThickness / 2,
      y,
      depth / 2,
      0,
      true,
    );
  }

  buildBeams() {
    for (const beam of model.beams) {
      const dx = beam.end[0] - beam.start[0];
      const dz = beam.end[1] - beam.start[1];
      const span = Math.hypot(dx, dz);
      if (span <= 0.01) continue;

      const x = (beam.start[0] + beam.end[0]) / 2;
      const z = (beam.start[1] + beam.end[1]) / 2;
      const y = beam.z - beam.depth / 2;
      const rotation = Math.atan2(-dz / span, dx / span);

      this.addBox(
        this.groups.frame,
        span,
        beam.depth,
        beam.width,
        this.materialsMap.beam,
        x,
        y,
        z,
        rotation,
        true,
      );
    }
  }

  setupCamera() {
    const width = Math.max(2, Math.floor(this.container.clientWidth || 640));
    const height = Math.max(2, Math.floor(this.container.clientHeight || 420));
    this.aspect = width / height;
    const viewHeight = this.viewHeightFor(this.aspect);

    this.camera = new THREE.OrthographicCamera(
      -viewHeight * this.aspect / 2,
      viewHeight * this.aspect / 2,
      viewHeight / 2,
      -viewHeight / 2,
      0.1,
      300,
    );
    this.camera.position.copy(this.target).addScaledVector(AXON_DIRECTION, VIEW_DISTANCE);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
  }

  viewHeightFor(aspect) {
    return Math.max(VIEW_HEIGHT, VIEW_WIDTH / Math.max(aspect, 0.2));
  }

  setupControls() {
    const controls = new TrackballControls(this.camera, this.canvas);
    controls.target.copy(this.target);
    controls.rotateSpeed = 0.9;
    controls.zoomSpeed = 1.15;
    controls.panSpeed = 0.4;
    controls.minZoom = 0.35;
    controls.maxZoom = 8;
    controls.staticMoving = true;
    controls.dynamicDampingFactor = 0.25;
    controls.keys = ["F13", "F14", "F15"];
    this.controls = controls;

    this.motionQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    this.applyMotionPreference();

    if (this.motionQuery) {
      this.motionListener = () => this.applyMotionPreference();
      if (typeof this.motionQuery.addEventListener === "function") {
        this.motionQuery.addEventListener("change", this.motionListener);
      } else if (typeof this.motionQuery.addListener === "function") {
        this.motionQuery.addListener(this.motionListener);
      }
    }
  }

  applyMotionPreference() {
    if (!this.controls) return;
    const reduce = this.motionQuery ? this.motionQuery.matches : true;
    this.controls.staticMoving = reduce;
    this.controls.dynamicDampingFactor = reduce ? 1 : 0.25;
  }

  setupEvents() {
    this.controls.addEventListener("change", this.handleChange);
    this.canvas.addEventListener("keydown", this.handleKeyDown);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove, { passive: true });
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerUp);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: true });

    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(this.container);
    } else {
      this.resizeListener = this.resize;
      window.addEventListener("resize", this.resizeListener);
    }
  }

  handleChange() {
    this.render();
  }

  handlePointerDown(event) {
    this.activePointers.add(event.pointerId);
    if (this.canvas) {
      try {
        this.canvas.focus({ preventScroll: true });
      } catch {
        this.canvas.focus();
      }
    }
    this.scheduleUpdate();
  }

  handlePointerMove() {
    if (this.activePointers.size > 0) this.scheduleUpdate();
  }

  handlePointerUp(event) {
    this.activePointers.delete(event.pointerId);
    this.scheduleUpdate();
  }

  handleWheel() {
    this.scheduleUpdate();
  }

  scheduleUpdate() {
    if (this.disposed || this.frameId !== null) return;
    this.frameId = window.requestAnimationFrame(() => {
      this.frameId = null;
      if (this.disposed || !this.controls) return;
      this.controls.update();
    });
  }

  syncControls() {
    if (!this.controls) return;
    const staticMoving = this.controls.staticMoving;
    this.controls.staticMoving = true;
    this.controls.update();
    this.controls.staticMoving = staticMoving;
  }

  handleKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key;

    if (key === "ArrowLeft") {
      this.orbit(new THREE.Vector3(0, 1, 0), Math.PI / 36);
    } else if (key === "ArrowRight") {
      this.orbit(new THREE.Vector3(0, 1, 0), -Math.PI / 36);
    } else if (key === "ArrowUp") {
      this.orbit(this.cameraRight(), -Math.PI / 36);
    } else if (key === "ArrowDown") {
      this.orbit(this.cameraRight(), Math.PI / 36);
    } else if (key === "q" || key === "Q") {
      this.roll(Math.PI / 36);
    } else if (key === "e" || key === "E") {
      this.roll(-Math.PI / 36);
    } else if (key === "+" || key === "=") {
      this.zoom(1.12);
    } else if (key === "-" || key === "_") {
      this.zoom(1 / 1.12);
    } else if (key === "Home") {
      this.reset();
    } else if (/^[svjzSVJZ]$/.test(key)) {
      this.setView(key);
    } else {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  cameraRight() {
    const pivot = this.controls ? this.controls.target : this.target;
    const direction = new THREE.Vector3().subVectors(pivot, this.camera.position).normalize();
    const right = new THREE.Vector3().crossVectors(direction, this.camera.up);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    return right.normalize();
  }

  orbit(axis, angle) {
    if (this.disposed || !this.camera || !this.controls) return;
    const pivot = this.controls.target;
    const normalizedAxis = axis.clone();
    if (normalizedAxis.lengthSq() < 1e-8) return;
    const offset = this.camera.position.clone().sub(pivot);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(normalizedAxis.normalize(), angle);
    offset.applyQuaternion(quaternion);
    this.camera.position.copy(pivot).add(offset);
    this.camera.up.applyQuaternion(quaternion).normalize();
    this.camera.lookAt(pivot);
    this.syncControls();
    this.render();
  }

  roll(angle) {
    if (this.disposed || !this.camera || !this.controls) return;
    const pivot = this.controls.target;
    const direction = new THREE.Vector3().subVectors(pivot, this.camera.position).normalize();
    const quaternion = new THREE.Quaternion().setFromAxisAngle(direction, angle);
    this.camera.up.applyQuaternion(quaternion).normalize();
    this.camera.lookAt(pivot);
    this.syncControls();
    this.render();
  }

  zoom(factor) {
    if (this.disposed || !this.camera || !this.controls) return;
    const zoom = Math.min(
      this.controls.maxZoom,
      Math.max(this.controls.minZoom, this.camera.zoom * factor),
    );
    if (zoom === this.camera.zoom) return;
    this.camera.zoom = zoom;
    this.camera.updateProjectionMatrix();
    this.syncControls();
    this.render();
  }

  applyView(name, notify) {
    if (this.disposed || !this.camera || !this.controls) return false;
    const view = resolveView(name);
    if (!view) return false;

    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(this.target).addScaledVector(view.direction, VIEW_DISTANCE);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.target);
    this.controls.target.copy(this.target);
    this.syncControls();
    this.render();

    if (notify) this.status(`Pohled: ${view.label}.`);
    return true;
  }

  setView(name) {
    return this.applyView(name, true);
  }

  reset() {
    return this.applyView("axon", true);
  }

  setLayer(name, visible) {
    if (this.disposed || !this.groups) return false;
    if (!["roof", "facade", "envelope", "rooms"].includes(name)) return false;
    const group = this.groups[name];
    if (!group) return false;
    group.visible = Boolean(visible);
    this.render();
    return true;
  }

  resize() {
    if (this.disposed || !this.renderer || !this.camera) return;
    const width = Math.max(2, Math.floor(this.container.clientWidth || 640));
    const height = Math.max(2, Math.floor(this.container.clientHeight || 420));
    this.aspect = width / height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);

    const viewHeight = this.viewHeightFor(this.aspect);
    this.camera.left = -viewHeight * this.aspect / 2;
    this.camera.right = viewHeight * this.aspect / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();

    if (this.controls) this.controls.handleResize();
    this.render();
  }

  render() {
    if (this.disposed || !this.renderer || !this.scene || !this.camera) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    if (this.frameId !== null) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }

    if (this.motionQuery && this.motionListener) {
      if (typeof this.motionQuery.removeEventListener === "function") {
        this.motionQuery.removeEventListener("change", this.motionListener);
      } else if (typeof this.motionQuery.removeListener === "function") {
        this.motionQuery.removeListener(this.motionListener);
      }
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.resizeListener) {
      window.removeEventListener("resize", this.resizeListener);
      this.resizeListener = null;
    }

    if (this.canvas) {
      this.canvas.removeEventListener("keydown", this.handleKeyDown);
      this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
      this.canvas.removeEventListener("pointermove", this.handlePointerMove);
      this.canvas.removeEventListener("pointerup", this.handlePointerUp);
      this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
      this.canvas.removeEventListener("wheel", this.handleWheel);
    }

    if (this.controls) {
      this.controls.removeEventListener("change", this.handleChange);
      this.controls.dispose();
    }

    this.activePointers.clear();

    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
    if (this.container && this.container.style && this.containerPositionChanged) {
      this.container.style.position = this.containerPosition ?? "";
    }

    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries = [];
    this.materials = [];

    if (this.scene) {
      this.scene.clear();
      this.scene.background = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      if (typeof this.renderer.forceContextLoss === "function") {
        try {
          this.renderer.forceContextLoss();
        } catch {
          this.renderer = null;
        }
      }
    }

    this.controls = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.groups = null;
    this.materialsMap = null;
    this.roomMaterials = null;
    this.edgeMaterial = null;
    this.roomEdgeMaterial = null;
    this.root = null;
    this.guide = null;
    this.canvas = null;
    this.container = null;
    this.motionQuery = null;
    this.motionListener = null;
  }
}

export async function createViewer3D(container, { onStatus } = {}) {
  const viewer = new Viewer3D(container, onStatus);
  await viewer.init();
  return {
    dispose: () => viewer.dispose(),
    reset: () => viewer.reset(),
    setView: (name) => viewer.setView(name),
    setLayer: (name, visible) => viewer.setLayer(name, visible),
  };
}
