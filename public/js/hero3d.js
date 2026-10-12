/*
 * La radio in 3D della schermata d'accesso (three.js).
 * Modello costruito qui: scocca in plastica con grana, display retroilluminato con testo vivo,
 * tastierino, manopola zigrinata, antenna, tasto emergenza, LED e PTT laterale.
 */
import * as THREE from '../vendor/three.module.min.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { reducedMotion } from './util.js';

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) {
    return false;
  }
}

function canvasTex(w, h, draw, srgb) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.canvas = c;
  t.userData.ctx = g;
  return t;
}

// grana della plastica (per la ruvidità)
function grainTexture() {
  const t = canvasTex(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 150 + Math.random() * 70;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 6);
  return t;
}
// zigrinatura verticale (mappa delle normali)
function ribTexture(n) {
  const t = canvasTex(256, 16, (g, w) => {
    for (let x = 0; x < w; x++) {
      const s = Math.sin((x / w) * Math.PI * 2 * n);
      g.fillStyle = `rgb(${Math.round(128 + s * 110)},128,230)`;
      g.fillRect(x, 0, 1, 16);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// fori dell'altoparlante
function grilleTexture() {
  return canvasTex(512, 160, (g, w, h) => {
    g.fillStyle = '#121418';
    g.fillRect(0, 0, w, h);
    for (let y = 14; y < h - 8; y += 18) {
      for (let x = 14 + ((y / 18) % 2) * 9; x < w - 8; x += 18) {
        const gr = g.createRadialGradient(x - 1, y - 1, 0, x, y, 6);
        gr.addColorStop(0, '#000');
        gr.addColorStop(0.75, '#020203');
        gr.addColorStop(1, 'rgba(60,66,74,.9)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, 5.6, 0, Math.PI * 2);
        g.fill();
      }
    }
  }, true);
}
// scritte del tastierino e della scocca (la tela copre il tastierino: 1 unità = 500 px)
function labelsTexture() {
  return canvasTex(600, 500, (g, w) => {
    g.clearRect(0, 0, w, 500);
    const keys = [
      ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
      ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
      ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
      ['*', 'SCAN'], ['0', 'CH'], ['#', 'STATO'],
    ];
    keys.forEach(([d, l], i) => {
      const cx = 100 + (i % 3) * 200;
      const cy = 50 + Math.floor(i / 3) * 90;
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(236,240,245,.92)';
      g.font = '600 44px "Chakra Petch", sans-serif';
      g.textAlign = 'right';
      g.fillText(d, cx + 4, cy + 1);
      g.fillStyle = 'rgba(150,160,172,.85)';
      g.font = '600 15px "Chakra Petch", sans-serif';
      g.textAlign = 'left';
      g.fillText(l, cx + 12, cy + 4);
    });
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.font = '700 24px "Chakra Petch", sans-serif';
    g.fillText('URP · T1', w / 2, 405);
    g.fillStyle = 'rgba(255,255,255,.3)';
    g.font = '600 15px "Chakra Petch", sans-serif';
    g.fillText('RADIO UFFICIALE · UDINE RP ITA', w / 2, 445);
  }, true);
}

/** Display: disegnato su una tela e aggiornato dal vivo */
function makeLcd() {
  const tex = canvasTex(640, 470, () => {}, true);
  const c = tex.userData.canvas;
  const g = tex.userData.ctx;
  const W = c.width;
  const H = c.height;
  let t0 = performance.now();
  const lines = ['IN ATTESA', 'ACCESSO RETE', 'TG 2001 · UDINE'];
  function draw(now, online, canali) {
    const t = (now - t0) / 1000;
    const bg = g.createRadialGradient(W * 0.4, 0, 20, W * 0.5, H * 0.4, W * 0.9);
    bg.addColorStop(0, '#ffd27a');
    bg.addColorStop(1, '#ee8f18');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    const ink = 'rgba(40,22,2,.92)';
    g.fillStyle = ink;
    g.strokeStyle = ink;
    // riga di stato
    g.font = '40px VT323, monospace';
    g.textBaseline = 'top';
    for (let i = 0; i < 4; i++) g.fillRect(24 + i * 12, 44 - i * 9, 8, 10 + i * 9);
    g.fillText('TETRA', 92, 18);
    const d = new Date();
    const clock = `${String(d.getHours()).padStart(2, '0')}${d.getSeconds() % 2 ? ':' : ' '}${String(d.getMinutes()).padStart(2, '0')}`;
    g.textAlign = 'right';
    g.fillText(clock, W - 80, 18);
    g.textAlign = 'left';
    g.lineWidth = 3;
    g.strokeRect(W - 66, 26, 40, 22);
    g.fillRect(W - 62, 30, 32, 14);
    // modo
    g.font = '50px VT323, monospace';
    g.fillText('RADIO UFFICIALE', 24, 74);
    // riga a segmenti con i segmenti spenti
    g.fillStyle = 'rgba(40,22,2,.08)';
    g.font = 'bold 66px DSEG14, monospace';
    g.fillText('~~~~~~~~~', 24, 140);
    g.fillStyle = ink;
    const main = 'UDINE!RP!';
    g.fillText(main, 24, 140);
    g.fillRect(16, 128, W - 32, 3);
    g.fillRect(16, 226, W - 32, 3);
    // sotto
    g.font = '46px VT323, monospace';
    const sub = Math.floor(t / 2.4) % lines.length;
    g.fillText(sub === 0 && online != null ? `${online} IN LINEA · ${canali} CANALI` : lines[sub], 24, 240);
    // oscilloscopio
    g.globalAlpha = 0.14;
    g.fillRect(16, 344, W - 32, 2);
    g.globalAlpha = 1;
    g.lineWidth = 5;
    g.beginPath();
    for (let x = 0; x <= W - 32; x += 6) {
      const k = x / (W - 32);
      const burst = Math.max(0, Math.sin(t * 0.9)) ** 6;
      const y = 345 + Math.sin(k * 40 + t * 9) * 14 * burst * Math.sin(k * Math.PI) + (Math.random() - 0.5) * 3;
      if (x === 0) g.moveTo(16 + x, y);
      else g.lineTo(16 + x, y);
    }
    g.stroke();
    // tasti funzione
    g.font = '40px VT323, monospace';
    g.textAlign = 'center';
    ['MENU', 'ACCEDI', 'SCAN'].forEach((s, i) => {
      const x = 24 + i * ((W - 48) / 3);
      const bw = (W - 48) / 3 - 10;
      g.fillStyle = ink;
      g.fillRect(x, 404, bw, 46);
      g.fillStyle = '#ffd27a';
      g.fillText(s, x + bw / 2, 406);
    });
    g.textAlign = 'left';
    // pixel
    g.fillStyle = 'rgba(40,22,2,.05)';
    for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    tex.needsUpdate = true;
  }
  return { tex, draw };
}

export async function startHero(canvas) {
  if (!webglOk()) return null;
  try {
    await Promise.all([document.fonts.load('46px VT323'), document.fonts.load('bold 66px DSEG14'), document.fonts.load('600 64px "Chakra Petch"')]);
  } catch (e) {}

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
  const CAM = new THREE.Vector3(0, 0.35, 8.6);
  camera.position.copy(CAM);

  // luci: principale calda, controluce azzurra, bagliore ambra del display
  const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
  key.position.set(-3.5, 4.5, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x59c6ff, 3.2);
  rim.position.set(4.5, 2.5, -4);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xffa640, 1.6);
  rim2.position.set(-5, -1, -3);
  scene.add(rim2);
  const lcdGlow = new THREE.PointLight(0xffa62a, 2.4, 3.2, 2);
  lcdGlow.position.set(0, 0.35, 0.9);
  scene.add(lcdGlow);

  // ---------------------------------------------------------------- materiali
  const grain = grainTexture();
  const body = new THREE.MeshPhysicalMaterial({ color: 0x1a1d22, roughness: 0.58, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.5, roughnessMap: grain, sheen: 0.2, sheenColor: new THREE.Color(0x3a4048) });
  const face = new THREE.MeshPhysicalMaterial({ color: 0x111317, roughness: 0.48, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.35, roughnessMap: grain });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.82, metalness: 0 });
  const rubberKey = new THREE.MeshPhysicalMaterial({ color: 0x24272c, roughness: 0.7, clearcoat: 0.15 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x6b727c, roughness: 0.35, metalness: 0.9 });
  const orange = new THREE.MeshPhysicalMaterial({ color: 0xff6a12, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2, emissive: 0x401000, emissiveIntensity: 0.6 });
  const glossBlack = new THREE.MeshPhysicalMaterial({ color: 0x07080a, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 });

  const radio = new THREE.Group();
  scene.add(radio);

  // scocca
  const shell = new THREE.Mesh(new RoundedBoxGeometry(1.42, 2.82, 0.56, 8, 0.2), body);
  radio.add(shell);
  // fianchi gommati con zigrinatura
  const ribs = ribTexture(28);
  ribs.repeat.set(1, 1);
  for (const sx of [-1, 1]) {
    const m = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9, normalMap: ribs, normalScale: new THREE.Vector2(0.6, 0.6) });
    const side = new THREE.Mesh(new RoundedBoxGeometry(0.06, 1.7, 0.46, 3, 0.03), m);
    side.position.set(sx * 0.705, -0.15, 0);
    side.rotation.z = Math.PI / 2;
    side.rotation.z = 0;
    radio.add(side);
  }
  // frontale leggermente rialzato
  const plate = new THREE.Mesh(new RoundedBoxGeometry(1.26, 2.62, 0.06, 6, 0.03), face);
  plate.position.set(0, -0.02, 0.27);
  radio.add(plate);

  // altoparlante (in alto)
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 0.3), new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.7 }));
  grille.position.set(0, 1.07, 0.302);
  radio.add(grille);

  // display con cornice e vetro
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.88, 0.04, 4, 0.05), glossBlack);
  bezel.position.set(0, 0.42, 0.3);
  radio.add(bezel);
  const lcd = makeLcd();
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.705), new THREE.MeshBasicMaterial({ map: lcd.tex, toneMapped: false }));
  screen.position.set(0, 0.42, 0.322);
  radio.add(screen);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.75),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.08, clearcoat: 1, envMapIntensity: 1.6 })
  );
  glass.position.set(0, 0.42, 0.326);
  radio.add(glass);

  // tasti funzione e navigatore
  for (const sx of [-1, 1]) {
    const k = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.1, 0.06, 3, 0.03), rubberKey);
    k.position.set(sx * 0.36, -0.12, 0.31);
    radio.add(k);
  }
  const nav = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 40), rubberKey);
  nav.rotation.x = Math.PI / 2;
  nav.position.set(0, -0.12, 0.31);
  radio.add(nav);
  const navRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 8, 48), metal);
  navRing.position.set(0, -0.12, 0.31);
  radio.add(navRing);

  // tastierino 3x4
  const keyGeo = new RoundedBoxGeometry(0.33, 0.15, 0.06, 3, 0.04);
  for (let i = 0; i < 12; i++) {
    const k = new THREE.Mesh(keyGeo, rubberKey);
    k.position.set(-0.4 + (i % 3) * 0.4, -0.42 - Math.floor(i / 3) * 0.18, 0.31);
    radio.add(k);
  }
  const labels = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.0), new THREE.MeshBasicMaterial({ map: labelsTexture(), transparent: true, toneMapped: false, opacity: 0.95 }));
  labels.position.set(0, -0.82, 0.342);
  radio.add(labels);

  // sopra: antenna, tasto emergenza, LED, manopola
  const antPts = [];
  antPts.push(new THREE.Vector2(0, 0));
  for (let i = 0; i <= 60; i++) {
    const y = (i / 60) * 1.15;
    let r = 0.105 - y * 0.03;
    if (y > 0.18 && y < 0.85) r += 0.009 * Math.max(0, Math.sin(y * 70));
    antPts.push(new THREE.Vector2(r, y));
  }
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    antPts.push(new THREE.Vector2(Math.cos(a) * 0.07, 1.15 + Math.sin(a) * 0.07));
  }
  const antenna = new THREE.Mesh(new THREE.LatheGeometry(antPts, 40), rubber);
  antenna.position.set(-0.4, 1.4, -0.02);
  radio.add(antenna);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.15, 0.1, 40), metal);
  collar.position.set(-0.4, 1.42, -0.02);
  radio.add(collar);

  const emerg = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.12, 0.2, 3, 0.04), orange);
  emerg.position.set(0.06, 1.44, 0);
  radio.add(emerg);

  const ledMat = new THREE.MeshStandardMaterial({ color: 0x2b0e0b, emissive: 0x36e07d, emissiveIntensity: 0 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), ledMat);
  led.position.set(0.26, 1.415, 0.1);
  radio.add(led);

  const knurl = ribTexture(40);
  knurl.repeat.set(1, 1);
  const knobMat = new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.55, metalness: 0.2, normalMap: knurl, normalScale: new THREE.Vector2(1.1, 1.1) });
  const knob = new THREE.Group();
  const kBody = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.3, 64, 1, false), [knobMat, new THREE.MeshStandardMaterial({ color: 0x24282d, roughness: 0.4, metalness: 0.3 }), knobMat]);
  knob.add(kBody);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.13), new THREE.MeshBasicMaterial({ color: 0xf2f5f8 }));
  mark.position.set(0, 0.152, 0.06);
  knob.add(mark);
  const kBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.06, 48), metal);
  kBase.position.y = -0.17;
  knob.add(kBase);
  knob.position.set(0.44, 1.55, 0);
  radio.add(knob);

  // PTT laterale
  const ptt = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.62, 0.3, 3, 0.03), new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.8, normalMap: ribs, normalScale: new THREE.Vector2(0.4, 0.4) }));
  ptt.position.set(-0.74, 0.32, 0);
  radio.add(ptt);

  // ombra morbida sotto
  const shadowTex = canvasTex(256, 256, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(0,0,0,.55)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, -1.95, 0);
  scene.add(shadow);

  radio.position.y = 0.05;
  radio.scale.setScalar(0.94);

  // ---------------------------------------------------------------- animazione
  let running = false;
  let raf = 0;
  let mx = 0;
  let my = 0;
  let sx = 0;
  let sy = 0;
  let zoom = null;
  let online = null;
  let canali = null;
  const still = reducedMotion();
  const onMove = (e) => {
    mx = (e.clientX / window.innerWidth) * 2 - 1;
    my = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('pointermove', onMove);

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    // sul telefono la scena è bassa: allontano un po' la camera
    camera.position.z = CAM.z * (camera.aspect < 0.9 ? 1.25 : camera.aspect > 2 ? 0.85 : 1);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  let lastLcd = 0;
  const t0 = performance.now();
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const t = (now - t0) / 1000;
    sx += (mx - sx) * 0.05;
    sy += (my - sy) * 0.05;
    if (zoom) {
      const k = Math.min(1, (now - zoom.start) / 650);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      radio.rotation.y = zoom.ry * (1 - e);
      radio.rotation.x = zoom.rx * (1 - e);
      camera.position.set(0, zoom.cy + (0.42 * 0.94 + 0.05 - zoom.cy) * e, zoom.cz + (2.2 - zoom.cz) * e);
      camera.lookAt(0, 0.42 * 0.94 * e, 0);
    } else {
      const yaw = still ? -0.42 : -0.42 + Math.sin(t * 0.35) * 0.28;
      radio.rotation.y = yaw + sx * 0.35;
      radio.rotation.x = -0.06 + sy * 0.12 + (still ? 0 : Math.sin(t * 0.5) * 0.03);
      radio.position.y = 0.05 + (still ? 0 : Math.sin(t * 0.8) * 0.05);
      knob.rotation.y = still ? 0 : Math.sin(t * 0.25) * 1.2;
      camera.lookAt(0, 0.05, 0);
    }
    // LED verde che lampeggia come sulle radio vere
    ledMat.emissiveIntensity = t % 3 < 0.12 ? 3 : 0;
    if (now - lastLcd > 90) {
      lastLcd = now;
      lcd.draw(now, online, canali);
    }
    renderer.render(scene, camera);
  }

  const api = {
    start() {
      if (running) return;
      running = true;
      zoom = null;
      camera.position.copy(CAM);
      resize();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    /** Accensione: la camera entra nel display */
    zoomIn() {
      zoom = { start: performance.now(), ry: radio.rotation.y, rx: radio.rotation.x, cz: camera.position.z, cy: camera.position.y };
    },
    setInfo(o, c) {
      online = o;
      canali = c;
    },
  };
  const info = () => {
    const a = document.getElementById('infoOnline');
    const b = document.getElementById('infoCanali');
    if (a && /^\d+$/.test(a.textContent)) api.setInfo(Number(a.textContent), Number(b.textContent));
  };
  info();
  setTimeout(info, 1500);
  api.start();
  return api;
}
