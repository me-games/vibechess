import * as THREE from "three";
import { Color, PieceType } from "./chess";

// Neon palette: white army glows cyan, black army glows hot magenta.
const SKIN: Record<Color, { color: number; emissive: number }> = {
  w: { color: 0x0a2a33, emissive: 0x00e5ff },
  b: { color: 0x330a26, emissive: 0xff2bd6 },
};

function material(color: Color): THREE.MeshStandardMaterial {
  const s = SKIN[color];
  return new THREE.MeshStandardMaterial({
    color: s.color,
    emissive: s.emissive,
    emissiveIntensity: 1.15,
    metalness: 0.55,
    roughness: 0.25,
  });
}

function lathe(
  points: [number, number][],
  mat: THREE.Material,
  segments = 40,
): THREE.Mesh {
  const v = points.map((p) => new THREE.Vector2(p[0], p[1]));
  const geo = new THREE.LatheGeometry(v, segments);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function ball(r: number, y: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  return m;
}

const PAWN: [number, number][] = [
  [0, 0], [0.3, 0], [0.3, 0.05], [0.18, 0.12], [0.15, 0.3], [0.21, 0.34],
  [0.13, 0.4], [0.12, 0.46],
];
const ROOK: [number, number][] = [
  [0, 0], [0.34, 0], [0.34, 0.06], [0.2, 0.14], [0.18, 0.5], [0.26, 0.56],
  [0.3, 0.6], [0.3, 0.74],
];
const BISHOP: [number, number][] = [
  [0, 0], [0.32, 0], [0.32, 0.05], [0.18, 0.12], [0.14, 0.42], [0.23, 0.48],
  [0.12, 0.54], [0.1, 0.66], [0.16, 0.74], [0.1, 0.84], [0, 0.94],
];
const QUEEN: [number, number][] = [
  [0, 0], [0.36, 0], [0.36, 0.06], [0.18, 0.15], [0.13, 0.62], [0.22, 0.72],
  [0.25, 0.8],
];
const KING: [number, number][] = [
  [0, 0], [0.36, 0], [0.36, 0.06], [0.18, 0.15], [0.13, 0.7], [0.22, 0.8],
  [0.25, 0.88],
];
const KNIGHT_BASE: [number, number][] = [
  [0, 0], [0.34, 0], [0.34, 0.06], [0.2, 0.13], [0.17, 0.3], [0.21, 0.36],
];

export function buildPiece(type: PieceType, color: Color): THREE.Group {
  const g = new THREE.Group();
  const mat = material(color);

  switch (type) {
    case "p": {
      g.add(lathe(PAWN, mat));
      g.add(ball(0.17, 0.6, mat));
      break;
    }
    case "r": {
      g.add(lathe(ROOK, mat));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const c = box(0.1, 0.12, 0.1, mat);
        c.position.set(Math.cos(a) * 0.24, 0.78, Math.sin(a) * 0.24);
        g.add(c);
      }
      break;
    }
    case "b": {
      g.add(lathe(BISHOP, mat));
      g.add(ball(0.1, 0.99, mat));
      break;
    }
    case "n": {
      g.add(lathe(KNIGHT_BASE, mat));
      const head = new THREE.Group();
      const neck = box(0.22, 0.4, 0.18, mat);
      neck.position.set(0, 0.2, 0);
      neck.rotation.x = -0.35;
      head.add(neck);
      const snout = box(0.18, 0.16, 0.32, mat);
      snout.position.set(0, 0.36, 0.12);
      snout.rotation.x = 0.2;
      head.add(snout);
      const ear1 = box(0.05, 0.14, 0.05, mat);
      ear1.position.set(0.07, 0.46, -0.06);
      head.add(ear1);
      const ear2 = ear1.clone();
      ear2.position.x = -0.07;
      head.add(ear2);
      head.position.y = 0.32;
      head.rotation.y = color === "w" ? 0 : Math.PI; // face the enemy
      g.add(head);
      break;
    }
    case "q": {
      g.add(lathe(QUEEN, mat));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const b = ball(0.06, 0.9, mat);
        b.position.x = Math.cos(a) * 0.2;
        b.position.z = Math.sin(a) * 0.2;
        g.add(b);
      }
      g.add(ball(0.1, 0.97, mat));
      break;
    }
    case "k": {
      g.add(lathe(KING, mat));
      const v = box(0.08, 0.34, 0.08, mat);
      v.position.y = 1.02;
      g.add(v);
      const h = box(0.24, 0.08, 0.08, mat);
      h.position.y = 1.0;
      g.add(h);
      break;
    }
  }

  g.traverse((c: THREE.Object3D) => {
    c.castShadow = true;
  });
  return g;
}
