// Yard 9, the Foundry District: a 40 x 36 m dusk yard the two teams fight over.
// EMBER spawns south and pushes up; ASH spawns north and holds. Two charge sites:
// Site A, a warehouse on the west, and Site B, a container yard on the east. Three
// lanes join them: west through the warehouse doors, mid across the open yard, and
// east through the container alley. Every solid box is a collider for bodies and a
// surface a bullet stops on. All textures are painted on canvases at load: no files.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const HALF_X = 20;
const HALF_Z = 18;

function canvasTexture(size, painter, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  painter(g, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function speckle(g, size, count, colors, maxAlpha) {
  for (let i = 0; i < count; i += 1) {
    const c = colors[(Math.random() * colors.length) | 0];
    g.globalAlpha = Math.random() * maxAlpha;
    g.fillStyle = c;
    const s = 1 + Math.random() * 3;
    g.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  g.globalAlpha = 1;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const groundTexture = canvasTexture(256, (g, s) => {
    g.fillStyle = '#2a211a';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 2600, ['#171310', '#3a2e24', '#241c16', '#4a3a2c'], 0.5);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i += 1) {
      g.beginPath(); g.moveTo((i * s) / 4, 0); g.lineTo((i * s) / 4, s); g.stroke();
      g.beginPath(); g.moveTo(0, (i * s) / 4); g.lineTo(s, (i * s) / 4); g.stroke();
    }
  }, 10, 9);
  const wallTexture = canvasTexture(256, (g, s) => {
    g.fillStyle = '#2e2620';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 1800, ['#1c1611', '#3d3228', '#4d3d2e'], 0.45);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 10; i += 1) {
      const x = Math.random() * s;
      g.fillRect(x, 0, 3 + Math.random() * 8, s * (0.3 + Math.random() * 0.6));
    }
  }, 6, 1);
  const rustTexture = canvasTexture(256, (g, s) => {
    g.fillStyle = '#6e3d20';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 1500, ['#8a4a26', '#4a2412', '#a35a2c'], 0.6);
    g.fillStyle = 'rgba(20,10,5,0.5)';
    for (let i = 0; i < 14; i += 1) {
      g.fillRect(0, (i * s) / 14, s, 2);
    }
    g.fillStyle = 'rgba(242,232,220,0.10)';
    g.fillRect(0, 0, s, 10);
  }, 1, 1);
  const crateTexture = canvasTexture(256, (g, s) => {
    g.fillStyle = '#4a3826';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 900, ['#33261a', '#5d4832', '#241c14'], 0.5);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 10;
    g.strokeRect(4, 4, s - 8, s - 8);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(s, 0); g.lineTo(0, s); g.stroke();
  }, 1, 1);

  const materials = {
    ground: new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 0.95, metalness: 0.02 }),
    wall: new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.9, metalness: 0.05 }),
    rust: new THREE.MeshStandardMaterial({ map: rustTexture, roughness: 0.75, metalness: 0.25 }),
    crate: new THREE.MeshStandardMaterial({ map: crateTexture, roughness: 0.85, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: new THREE.Color('#1a1410'), roughness: 0.9 }),
    ember: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.1, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.55 }),
    cyan: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.cyan), roughness: 0.5, metalness: 0.1, emissive: new THREE.Color(PALETTE.cyan), emissiveIntensity: 0.55 }),
    light: new THREE.MeshStandardMaterial({ color: new THREE.Color('#ffd9a0'), emissive: new THREE.Color('#ffb45e'), emissiveIntensity: 1.6 }),
  };

  const colliders = [];
  const shootables = [];
  const minimapWalls = [];

  function box(width, height, depth, x, y, z, material, minimap = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    if (minimap) minimapWalls.push({ x: x - width / 2, z: z - depth / 2, w: width, d: depth });
    return mesh;
  }

  // Floor.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2), materials.ground);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  colliders.push(new THREE.Box3(new THREE.Vector3(-HALF_X, -0.4, -HALF_Z), new THREE.Vector3(HALF_X, 0, HALF_Z)));

  // Perimeter walls, 5 m high.
  box(0.6, 5, HALF_Z * 2 + 1.2, -HALF_X - 0.3, 2.5, 0, 'wall');
  box(0.6, 5, HALF_Z * 2 + 1.2, HALF_X + 0.3, 2.5, 0, 'wall');
  box(HALF_X * 2 + 1.2, 5, 0.6, 0, 2.5, -HALF_Z - 0.3, 'wall');
  box(HALF_X * 2 + 1.2, 5, 0.6, 0, 2.5, HALF_Z + 0.3, 'wall');

  // --- Site A: warehouse, west-north. Walls with a south door and an east door.
  // West wall, north wall, and the south wall split around the door.
  box(0.5, 4.2, 10, -18, 2.1, -11, 'wall');
  box(10.5, 4.2, 0.5, -13, 2.1, -16, 'wall');
  box(4, 4.2, 0.5, -16.2, 2.1, -6, 'wall');
  box(4, 4.2, 0.5, -9.8, 2.1, -6, 'wall');
  box(3.4, 1.2, 0.5, -13, 3.6, -6, 'wall'); // lintel over the south door
  box(0.5, 4.2, 4, -8, 2.1, -14, 'wall');
  box(0.5, 4.2, 3.2, -8, 2.1, -7.6, 'wall');
  box(0.5, 1.2, 2.8, -8, 3.6, -10.8, 'wall'); // lintel over the east door
  // Warehouse interior: a low platform and crates.
  box(3, 0.5, 2, -15.5, 0.25, -13.5, 'crate');
  box(1.4, 1.1, 1.4, -10.5, 0.55, -14, 'crate');
  box(1.4, 1.1, 1.4, -15, 0.55, -8.2, 'crate');
  box(1.2, 2.2, 1.2, -16.8, 1.1, -10, 'rust');

  // --- Site B: container yard, east-north. Stacked containers as cover.
  box(2.4, 2.6, 6, 17.5, 1.3, -12, 'rust');
  box(2.4, 2.6, 6, 17.5, 1.3, -7.5, 'rust');
  box(6, 2.6, 2.4, 11.5, 1.3, -16.2, 'rust');
  box(2.4, 2.6, 4, 9.5, 1.3, -12.5, 'rust');
  box(2.4, 5.2, 2.4, 15.5, 2.6, -15, 'rust'); // stacked pair, second floor
  box(1.2, 1.1, 1.2, 12, 0.55, -8.5, 'crate');
  box(1.2, 1.1, 1.2, 10.5, 0.55, -14.5, 'crate');

  // --- Mid: open yard with cover, a central silo and a low platform.
  box(3, 3.4, 3, 0, 1.7, 0, 'rust'); // silo block
  box(5, 0.5, 3.4, -6, 0.25, 3.5, 'crate'); // low platform west-mid
  box(1.4, 1.1, 1.4, -3.5, 0.55, -4.5, 'crate');
  box(1.4, 1.1, 1.4, 4.5, 0.55, -4.5, 'crate');
  box(1.2, 1.1, 2.6, -9, 0.55, 6, 'crate');
  box(1.2, 1.1, 2.6, 9, 0.55, 6, 'crate');
  box(1.2, 2.4, 1.2, -12, 1.2, -1, 'rust'); // pillar west
  box(1.2, 2.4, 1.2, 12, 1.2, -1, 'rust'); // pillar east
  box(2.2, 0.9, 1.2, -4, 0.45, 10.5, 'crate');
  box(2.2, 0.9, 1.2, 4, 0.45, 10.5, 'crate');
  box(1.4, 1.1, 1.4, 0, 0.55, -10, 'crate');

  // Ember glow strips along the spawn walls, cyan strips at the ASH end.
  box(6, 0.12, 0.12, 0, 2.2, HALF_Z - 0.05, 'ember', false);
  box(6, 0.12, 0.12, 0, 2.2, -HALF_Z + 0.05, 'cyan', false);

  // Site letters, painted on canvas and hung over each site.
  function siteSign(letter, x, z, color) {
    const texture = canvasTexture(256, (g, s) => {
      g.clearRect(0, 0, s, s);
      g.fillStyle = 'rgba(10,8,6,0.85)';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = color;
      g.lineWidth = 10;
      g.strokeRect(8, 8, s - 16, s - 16);
      g.fillStyle = color;
      g.font = `bold ${s * 0.62}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(letter, s / 2, s / 2 + 6);
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }),
    );
    mesh.position.set(x, 3.6, z);
    group.add(mesh);
    return mesh;
  }
  const signA = siteSign('A', -13, -11, PALETTE.accent);
  const signB = siteSign('B', 13, -11, PALETTE.cyan);

  // Dusk sky dome: a gradient shader sphere, warm at the horizon, dark above.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color('#241a2e') },
        mid: { value: new THREE.Color('#5a2c1e') },
        low: { value: new THREE.Color('#ff7a2f') },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low; void main(){ float h = normalize(vP).y; vec3 c = h > 0.25 ? mix(mid, top, smoothstep(0.25, 0.8, h)) : mix(low, mid, smoothstep(-0.05, 0.25, h)); gl_FragColor = vec4(c, 1.0); }',
    }),
  );
  scene.add(sky);

  // Light: low warm sun from the west, cool fill from the east, dusk ambient.
  const hemi = new THREE.HemisphereLight(new THREE.Color('#8a6a55'), new THREE.Color('#1a1210'), 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.4);
  sun.position.set(-26, 12, 14);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5a7a8a'), 0.5);
  fill.position.set(20, 10, -12);
  scene.add(fill);
  const warehouseLamp = new THREE.PointLight(new THREE.Color('#ffb45e'), 14, 14);
  warehouseLamp.position.set(-13, 3.4, -11);
  scene.add(warehouseLamp);
  const yardLamp = new THREE.PointLight(new THREE.Color('#ff7a2f'), 10, 12);
  yardLamp.position.set(0, 3.2, 0);
  scene.add(yardLamp);

  // Charge sites: a floor zone the planter must stand in.
  const sites = {
    A: { center: new THREE.Vector3(-13, 0, -11), zone: new THREE.Box3(new THREE.Vector3(-16.5, 0, -14.5), new THREE.Vector3(-9.5, 2.5, -7.5)), sign: signA },
    B: { center: new THREE.Vector3(13, 0, -11), zone: new THREE.Box3(new THREE.Vector3(9.5, 0, -14.5), new THREE.Vector3(16.5, 2.5, -7.5)), sign: signB },
  };

  const spawns = {
    EMBER: [
      new THREE.Vector3(-4, 0, 15.5), new THREE.Vector3(-2, 0, 15.5), new THREE.Vector3(0, 0, 15.5),
      new THREE.Vector3(2, 0, 15.5), new THREE.Vector3(4, 0, 15.5),
    ],
    ASH: [
      new THREE.Vector3(-4, 0, -15.5), new THREE.Vector3(-2, 0, -15.5), new THREE.Vector3(0, 0, -15.5),
      new THREE.Vector3(2, 0, -15.5), new THREE.Vector3(4, 0, -15.5),
    ],
  };

  // Waypoint graph for the bots. Nodes are open ground; edges are walkable lines.
  const waypoints = {
    emberSpawn: { x: 0, z: 14, links: ['emberWest', 'emberMid', 'emberEast'] },
    emberWest: { x: -11, z: 11, links: ['emberSpawn', 'aLane', 'midWest'] },
    emberMid: { x: 0, z: 9, links: ['emberSpawn', 'midSouth', 'midWest', 'midEast'] },
    emberEast: { x: 11, z: 11, links: ['emberSpawn', 'bAlley', 'midEast'] },
    midSouth: { x: 0, z: 6, links: ['emberMid', 'mid', 'midWest', 'midEast'] },
    midWest: { x: -8, z: 2, links: ['midSouth', 'aLane', 'mid', 'emberWest'] },
    midEast: { x: 8, z: 2, links: ['midSouth', 'bAlley', 'mid', 'emberEast'] },
    mid: { x: 0, z: -1, links: ['midSouth', 'midWest', 'midEast', 'midNorth'] },
    midNorth: { x: 0, z: -6.5, links: ['mid', 'aDoor', 'bDoor', 'ashMid'] },
    aLane: { x: -13, z: 3, links: ['emberWest', 'midWest', 'aDoor'] },
    aDoor: { x: -13, z: -4.5, links: ['aLane', 'midNorth', 'aSite'] },
    aSite: { x: -13, z: -11, links: ['aDoor'] },
    bAlley: { x: 12.5, z: 3, links: ['emberEast', 'midEast', 'bDoor'] },
    bDoor: { x: 13, z: -4.5, links: ['bAlley', 'midNorth', 'bSite'] },
    bSite: { x: 13, z: -11, links: ['bDoor'] },
    ashMid: { x: 0, z: -12, links: ['midNorth', 'ashWest', 'ashEast', 'ashSpawn'] },
    ashWest: { x: -8, z: -12.5, links: ['ashMid', 'aDoor'] },
    ashEast: { x: 8, z: -12.5, links: ['ashMid', 'bDoor'] },
    ashSpawn: { x: 0, z: -15, links: ['ashMid'] },
  };

  return {
    colliders,
    shootables,
    blockers: shootables,
    sites,
    spawns,
    waypoints,
    minimapWalls,
    group,
    bounds: { halfX: HALF_X, halfZ: HALF_Z },
  };
}
