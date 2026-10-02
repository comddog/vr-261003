import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.getElementById('view');
const layer = document.getElementById('hotspot-layer');
const fade = document.getElementById('fade');
const titleEl = document.getElementById('scene-title');
const descEl = document.getElementById('scene-desc');
const listEl = document.getElementById('scene-list');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const autoBtn = document.getElementById('autorotate-btn');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 0, 0.1);

const controls = new OrbitControls(camera, canvas);
controls.enableZoom = false; // 휠·핀치의 카메라 이동(dolly)은 무의미 → FOV 줌을 직접 구현
controls.enablePan = false;
controls.rotateSpeed = -0.5; // 드래그 방향 자연스럽게
let targetFov = camera.fov;
let lastZsFov = -1;
// 줌 단계: 축소3~확대3 (40~100도, 10도 간격, 기본 70)
const ZOOM_STEP = 10, ZOOM_MIN = 40, ZOOM_MAX = 100, HOME_FOV = 70;
// 극점 정면 주시 방지 (Kuula 방식): 천정·바닥 한 점 뭉개짐이 화면 중앙에 오지 않게
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = Math.PI - 0.35;
controls.autoRotate = false;
controls.autoRotateSpeed = 0.8;

const RADIUS = 50;
const sphereGeo = new THREE.SphereGeometry(RADIUS, 128, 96);
const sphereMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
const sphere = new THREE.Mesh(sphereGeo, sphereMat);
scene.add(sphere);

// 극점 패치: equirect 특성상 천정/바닥 중심은 한 점으로 모여 원본이 뭉개진다.
// 삼각대·이음새를 가리는 원형 패치 (nadir 기본 표시, tour.json으로 교체 가능)
function makeDefaultPatchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(256, 256, 30, 256, 256, 256);
  grad.addColorStop(0, '#17171c');
  grad.addColorStop(0.72, '#101014');
  grad.addColorStop(1, 'rgba(16,16,20,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(256, 256, 256, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.9)';
  g.font = '700 46px "Noto Sans KR", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('© KSMS', 256, 250);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
let poleMeshes = [];
function clearPolePatches() {
  for (const m of poleMeshes) {
    scene.remove(m);
    if (m.material.map && m.material.map.isCanvasTexture) m.material.map.dispose();
    m.material.dispose(); m.geometry.dispose();
  }
  poleMeshes = [];
}
function loadPatchTexture(path) {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      encodeURI(path),
      (tex) => { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); resolve(tex); },
      undefined, () => resolve(makeDefaultPatchTexture()));
  });
}
async function updatePolePatches() {
  clearPolePatches();
  const R = 50;
  const jobs = [];
  if (tour.nadir && typeof tour.nadir === 'object') {
    jobs.push({ cfg: tour.nadir, isNadir: true });
  }
  if (tour.zenith && typeof tour.zenith === 'object') {
    jobs.push({ cfg: tour.zenith, isNadir: false });
  }
  for (const j of jobs) {
    const s = Math.max(2, Math.min(15, j.cfg.size || 6));
    const tex = j.cfg.image ? await loadPatchTexture(j.cfg.image) : makeDefaultPatchTexture();
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(s, 48),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    const y = Math.sqrt(Math.max(R * R - s * s, 1)) - 0.15;
    m.position.set(0, j.isNadir ? -y : y, 0);
    m.rotation.x = j.isNadir ? -Math.PI / 2 : Math.PI / 2;
    m.renderOrder = 2;
    scene.add(m);
    poleMeshes.push(m);
  }
}

// 바닥 진행 화살표 (네이버/구글 지도 스타일) 공용 리소스
// 둥근 꼭지점 삼각형 (shape +Y가 앞) → rotateX로 눕히면 +Z(앞)
function roundedArrowGeo() {
  const T = [0, 1.8], R = [1.1, -1.2], L = [-1.1, -1.2];
  const vs = [{ p: T, r: 0.3 }, { p: R, r: 0.38 }, { p: L, r: 0.38 }];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const norm = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
  const s = new THREE.Shape();
  for (let i = 0; i < 3; i++) {
    const prev = vs[(i + 2) % 3], cur = vs[i], next = vs[(i + 1) % 3];
    const d1 = norm(sub(cur.p, prev.p)), d2 = norm(sub(next.p, cur.p));
    const p1 = add(cur.p, mul(d1, -cur.r)), p2 = add(cur.p, mul(d2, cur.r));
    if (i === 0) s.moveTo(p1[0], p1[1]); else s.lineTo(p1[0], p1[1]);
    s.quadraticCurveTo(cur.p[0], cur.p[1], p2[0], p2[1]);
  }
  s.closePath();
  const g = new THREE.ShapeGeometry(s, 6);
  g.rotateX(Math.PI / 2);
  return g;
}
const arrowGeo = roundedArrowGeo();
const arrowMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
const arrowHit = [];
const raycaster = new THREE.Raycaster();
let downXY = null;

let tour = null;
let currentId = null;
let hotspotObjs = []; // { data, anchor: Object3D, el }
let autoRotateWanted = false;
let idleTimer = null;

function normDeg(d) {
  d = Math.round(d * 10) / 10;
  while (d > 180) d -= 360; while (d <= -180) d += 360;
  return d;
}
function yawPitchToVec(yawDeg, pitchDeg) {
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  // yaw=0 정면(-Z), yaw+ 오른쪽(+X), pitch+ 위
  const x = RADIUS * Math.cos(pitch) * Math.sin(yaw);
  const y = RADIUS * Math.sin(pitch);
  const z = -RADIUS * Math.cos(pitch) * Math.cos(yaw);
  return new THREE.Vector3(x, y, z);
}
// 정면(빨간 변 방향) 바라보기 — 공간 진입 시 360 이미지 중앙과 일치
function faceYawPitch(yaw, pitch) {
  const d = yawPitchToVec(yaw ?? 0, pitch ?? 0).normalize().multiplyScalar(-0.1);
  camera.position.copy(d);
  controls.target.set(0, 0, 0);
  controls.update();
}

function showLoading(msg) {
  loadingText.textContent = msg || '파노라마 로딩 중…';
  loadingEl.classList.remove('hidden');
}
function hideLoading() {
  loadingEl.classList.add('hidden');
}

async function loadTour() {
  const res = await fetch('./tour.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('tour.json 로드 실패: ' + res.status);
  tour = await res.json();
  await updatePolePatches();
  currentId = tour.startScene || tour.scenes[0]?.id;
  buildSceneList();
  await switchScene(currentId);
}

function buildSceneList() {
  listEl.innerHTML = '';
  for (const s of tour.scenes) {
    const b = document.createElement('button');
    b.textContent = s.name;
    b.dataset.id = s.id;
    if (s.id === currentId) b.classList.add('active');
    b.onclick = () => switchScene(s.id);
    listEl.appendChild(b);
  }
}

function clearHotspots() {
  for (const h of hotspotObjs) {
    h.el.remove();
    scene.remove(h.anchor);
    if (h.arrow) scene.remove(h.arrow);
    if (h.chevs) for (const c of h.chevs) { scene.remove(c.mesh); c.mat.dispose(); }
  }
  hotspotObjs = [];
  layer.innerHTML = '';
  arrowHit.length = 0;
}

function buildHotspots(sceneDef) {
  clearHotspots();
  (sceneDef.hotspots || []).forEach((h, idx) => {
    const el = document.createElement('button');
    el.className = 'hotspot';
    el.innerHTML = h.text ? `<span class="label">${h.text}</span>` : '';
    el.onclick = (e) => {
      e.stopPropagation();
      switchScene(h.target, currentId);
    };
    layer.appendChild(el);
    const anchor = new THREE.Object3D();
    anchor.position.copy(yawPitchToVec(h.yaw ?? 0, h.pitch ?? 0));
    scene.add(anchor);
    // 바닥에 눕힌 진행 화살표: 눈높이 아래, 목표 방향을 향해 고정
    const out = yawPitchToVec(h.yaw ?? 0, 0).normalize().clone();
    const P = out.clone().multiplyScalar(14); P.y = -3;
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.copy(P);
    arrow.lookAt(P.x * 2, -3, P.z * 2);
    arrow.userData.target = h.target;
    scene.add(arrow);
    arrowHit.push(arrow);
    // 진행방향으로 흐르는 반투명 파장 3개 (버튼 아래쪽부터 시작해 위로)
    const chevs = [];
    for (let k = 0; k < 3; k++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      const m = new THREE.Mesh(arrowGeo, mat);
      m.quaternion.copy(arrow.quaternion);
      m.position.copy(P);
      scene.add(m);
      chevs.push({ mesh: m, mat });
    }
    hotspotObjs.push({ data: h, anchor, el, arrow, out, chevs, phase: idx * 0.45 });
  });
  // 인앱팝업 마커 (이동이 아닌 팝업 열기)
  // - 텍스트: 아이콘 없이 내용을 VR 화면에 직접 표시
  // - 그 외: 제목 자체가 노란 아이콘 (P번호는 메이커 내부용으로 표시 안 함)
  (sceneDef.popups || []).forEach((p) => {
    if (p.kind === 'text') {
      const el = document.createElement('div');
      el.className = 'ptext';
      el.style.fontSize = (p.fontSize || 20) + 'px';
      el.style.fontWeight = p.bold ? '800' : '400';
      el.style.color = p.color || '#fff';
      const ba = (p.bgAlpha != null ? p.bgAlpha : 0);
      if (ba > 0) {
        el.style.background = hexA(p.bg || '#000000', Math.min(1, ba));
        el.style.padding = '.3em .6em';
        el.style.borderRadius = '12px';
      }
      el.textContent = p.text || '';
      layer.appendChild(el);
      hotspotObjs.push({ popup: p, el });
      return;
    }
    const el = document.createElement('button');
    el.className = 'popbtn';
    el.innerHTML = `<span class="ptitle k-${p.kind || 'web'}">${p.name || '•'}</span>`;
    el.onclick = (e) => { e.stopPropagation(); openPopup(p); };
    layer.appendChild(el);
    hotspotObjs.push({ popup: p, el });
  });
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      encodeURI(url),
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        // 구 안쪽(BackSide)에서 보면 좌우가 뒤집혀 보이므로 U를 반전해 정상화
        tex.wrapS = THREE.RepeatWrapping;
        tex.repeat.x = -1;
        // 이미지 중앙(u=0.5)이 정면(yaw 0, 빨간 변 방향)에 오도록
        tex.offset.x = 0.25;
        // 밉맵 없이 원본 해상도로 샘플링 (축소 흐림 방지)
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        resolve(tex);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

async function switchScene(id, fromId = null) {
  const def = tour.scenes.find(s => s.id === id);
  if (!def) { alert('씬을 찾을 수 없음: ' + id); return; }
  currentId = id;
  document.querySelectorAll('#scene-list button').forEach(b => {
    b.classList.toggle('active', b.dataset.id === id);
  });
  const curBtn = document.querySelector('#scene-list button.active');
  if (curBtn) curBtn.scrollIntoView({ inline: 'center', block: 'nearest' });
  if (fromId) fade.classList.remove('hide');
  showLoading(def.name + ' 로딩 중…');
  try {
    const tex = await loadTexture(def.image);
    if (sphereMat.map) sphereMat.map.dispose();
    sphereMat.map = tex;
    sphereMat.needsUpdate = true;
    titleEl.textContent = def.name || id;
    descEl.textContent = def.description || '';
    buildHotspots(def);
    // 진입 시야: 들어온 연결의 반대방향(진행 방향)을 정면으로.
    // 목록 점프·첫 진입은 사진 정면. initialYaw가 있으면 우선.
    let yaw = def.initialYaw ?? 0, pitch = def.initialPitch ?? 0;
    if (fromId && fromId !== id && def.initialYaw == null) {
      const back = (def.hotspots || []).find(h => h.target === fromId);
      if (back) yaw = normDeg(back.yaw - 180);
    }
    faceYawPitch(yaw, pitch);
    resetIdleTimer();
  } catch (e) {
    console.error(e);
    loadingText.textContent = '이미지 로드 실패: ' + def.image + ' (panoramas 폴더 확인)';
    return;
  }
  hideLoading();
  requestAnimationFrame(() => fade.classList.add('hide'));
}

function showEl(el) {
  el.style.display = 'flex';
  fitWidths(el);
}
// 텍스트 상자 폭 고정 (회전 방향과 무관하게 모양 유지)
function fitWidths(el) {
  const t = (el.classList && el.classList.contains('ptext')) ? el : (el.querySelector ? el.querySelector('.ptext') : null);
  if (!t || !t.clientWidth) return;
  t.style.width = 'max-content';
  t.style.width = Math.min(t.scrollWidth || 0, window.innerWidth * 0.85) + 'px';
}
function updateHotspotProjection() {
  const w = window.innerWidth, h = window.innerHeight;
  const v = new THREE.Vector3();
  for (const hs of hotspotObjs) {
    if (hs.popup) {
      v.copy(yawPitchToVec(hs.popup.yaw ?? 0, hs.popup.pitch ?? 0));
    } else {
      hs.anchor.getWorldPosition(v);
    }
    // 카메라 뒤쪽이면 숨김
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const facing = camDir.dot(v.clone().normalize());
    if (facing < 0.15) {
      hs.el.style.display = 'none';
      for (const c of (hs.chevs || [])) c.mesh.visible = false;
      continue;
    }
    for (const c of (hs.chevs || [])) c.mesh.visible = true;
    if (hs.popup) {
      // 인앱팝업 마커: 사진 위치에 고정 표시
      v.copy(yawPitchToVec(hs.popup.yaw ?? 0, hs.popup.pitch ?? 0)).project(camera);
    } else {
      v.copy(hs.arrow.position).project(camera);
      if (v.z > 1) { hs.el.style.display = 'none'; continue; }
      // 글씨 버튼: 파장 흐름의 위쪽에서 2/3 지점 (바닥 기준점 -2.6)
      v.copy(hs.arrow.position).addScaledVector(hs.out, -2.6).project(camera);
    }
    if (v.z > 1) { hs.el.style.display = 'none'; continue; }
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-v.y * 0.5 + 0.5) * h;
    showEl(hs.el);
    hs.el.style.left = x + 'px';
    hs.el.style.top = y + 'px';
    hs.el.style.opacity = String(THREE.MathUtils.clamp(facing, 0.6, 1));
  }
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  controls.autoRotate = false;
  if (!autoRotateWanted) return;
  idleTimer = setTimeout(() => { controls.autoRotate = true; }, 3000);
}

['pointerdown', 'wheel', 'touchstart'].forEach(ev => {
  canvas.addEventListener(ev, () => {
    controls.autoRotate = false;
    resetIdleTimer();
  }, { passive: true });
});
// FOV 줌: 휠·핀치·버튼 (한 장 파노라마에 깊이 정보가 없어 위치 이동은 왜곡만 생기므로 FOV만 사용)
function applyZoom(df) {
  targetFov = THREE.MathUtils.clamp(targetFov + df, ZOOM_MIN, ZOOM_MAX);
}
canvas.addEventListener('wheel', (e) => { e.preventDefault(); applyZoom(e.deltaY * 0.05); }, { passive: false });
const pinchPts = new Map();
let lastPinch = null;
canvas.addEventListener('pointerdown', (e) => pinchPts.set(e.pointerId, [e.clientX, e.clientY]));
canvas.addEventListener('pointermove', (e) => {
  if (!pinchPts.has(e.pointerId)) return;
  pinchPts.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinchPts.size === 2) {
    const [a, b] = [...pinchPts.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (lastPinch != null) applyZoom((lastPinch - d) * 0.15);
    lastPinch = d;
  }
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => {
  canvas.addEventListener(ev, (e) => {
    pinchPts.delete(e.pointerId);
    if (pinchPts.size < 2) lastPinch = null;
  });
});
document.getElementById('zoom-in').onclick = () => applyZoom(-ZOOM_STEP);
document.getElementById('zoom-reset').onclick = () => { targetFov = HOME_FOV; };
document.getElementById('zoom-out').onclick = () => applyZoom(ZOOM_STEP);
// 바닥 화살표 클릭 이동 (드래그와 구분)
canvas.addEventListener('pointerdown', (e) => { downXY = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downXY) return;
  const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
  downXY = null;
  if (moved > 6 || !arrowHit.length) return;
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1
  ), camera);
  const hits = raycaster.intersectObjects(arrowHit, false);
  if (hits.length && hits[0].object.userData.target) {
    switchScene(hits[0].object.userData.target, currentId);
  }
});

autoBtn.onclick = () => {
  autoRotateWanted = !autoRotateWanted;
  autoBtn.classList.toggle('active', autoRotateWanted);
  if (autoRotateWanted) resetIdleTimer();
  else { clearTimeout(idleTimer); controls.autoRotate = false; }
};

document.getElementById('fullscreen-btn').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
};

// ---------- 인앱팝업 (실행 전용) ----------
function hexA(hex, a) {
  const h = String(hex || '#000000').replace('#', '');
  const v = ((h.length === 3 ? h.split('').map(c => c + c).join('') : h) + '000000').slice(0, 6);
  const n = parseInt(v, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function parseYouTube(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
  return m ? m[1] : null;
}
function parseDriveId(url) {
  const m = String(url || '').match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?.*?id=)([\w-]+)|[?&]id=([\w-]+)/);
  return m ? (m[1] || m[2]) : null;
}
function openPopup(p) {
  const modal = document.getElementById('popup-modal');
  const body = document.getElementById('popup-body');
  document.getElementById('popup-title').textContent = p.name || '';
  body.innerHTML = '';
  const ifr = (src) => {
    const f = document.createElement('iframe');
    f.src = src;
    f.allow = 'autoplay; fullscreen; picture-in-picture';
    f.allowFullscreen = true;
    body.appendChild(f);
  };
  const note = (href) => {
    const d = document.createElement('div');
    d.className = 'popup-note';
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = '새 창에서 열기';
    d.appendChild(a);
    body.appendChild(d);
  };
  if (p.kind === 'video') {
    const yt = parseYouTube(p.url), dv = parseDriveId(p.url);
    if (yt) ifr(`https://www.youtube.com/embed/${yt}?rel=0`);
    else if (dv) ifr(`https://drive.google.com/file/d/${dv}/preview`);
    else if (p.url) ifr(p.url);
    else body.textContent = '등록된 영상이 없습니다.';
    if (p.url) note(p.url);
  } else if (p.kind === 'image') {
    const dv = parseDriveId(p.url);
    const wrap = document.createElement('div');
    wrap.className = 'imgview';
    const img = document.createElement('img');
    img.draggable = false;
    img.alt = p.name || '';
    wrap.appendChild(img);
    body.appendChild(wrap);
    initImgView(wrap, img, dv ? `https://drive.google.com/thumbnail?id=${dv}&sz=w1920` : (p.url || ''));
  } else if (p.kind === 'web') {
    const dv = parseDriveId(p.url);
    if (dv) ifr(`https://drive.google.com/file/d/${dv}/preview`);
    else if (p.url) ifr(p.url);
    else body.textContent = '등록된 주소가 없습니다.';
    if (p.url && !dv) note(p.url);
  } else if (p.kind === 'pdf') {
    const dv = parseDriveId(p.url);
    if (dv) ifr(`https://drive.google.com/file/d/${dv}/preview`);
    else if (p.url) ifr(p.url.includes('#') ? p.url : p.url + '#page=1&zoom=page-fit');
    else body.textContent = '등록된 주소가 없습니다.';
  } else if (p.kind === 'text') {
    const d = document.createElement('div');
    d.className = 'popup-text';
    d.style.fontSize = (p.fontSize || 20) + 'px';
    d.style.fontWeight = p.bold ? '800' : '400';
    if (p.color) d.style.color = p.color;
    d.textContent = p.text || '';
    body.appendChild(d);
  }
  modal.classList.add('open');
}
function closePopup() {
  document.getElementById('popup-modal').classList.remove('open');
  document.getElementById('popup-body').innerHTML = '';
  imgViewState = null;
}
// 이미지 팝업 전용 뷰어: 꽉 맞춤 표시, 휠·핀치 줌(최소=맞춤), 확대 시 드래그 이동
let imgViewState = null;
function initImgView(wrap, img, src) {
  let s = 1, tx = 0, ty = 0;
  const pts = new Map();
  let lastD = null, pan = null;
  function render() {
    img.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
  }
  function clamp() {
    const bx = Math.max(0, (img.clientWidth * s - wrap.clientWidth) / 2);
    const by = Math.max(0, (img.clientHeight * s - wrap.clientHeight) / 2);
    tx = Math.max(-bx, Math.min(bx, tx));
    ty = Math.max(-by, Math.min(by, ty));
  }
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    s = Math.min(8, Math.max(1, s * Math.exp(-e.deltaY * 0.0012)));
    clamp(); render();
  }, { passive: false });
  wrap.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) { pan = { x: e.clientX, y: e.clientY }; wrap.classList.add('grabbing'); }
    else pan = null;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      lastD = Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
    try { wrap.setPointerCapture(e.pointerId); } catch {}
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (lastD) s = Math.min(8, Math.max(1, s * d / lastD));
      lastD = d;
      clamp(); render();
    } else if (pan && s > 1.01) {
      tx += e.clientX - pan.x; ty += e.clientY - pan.y;
      pan = { x: e.clientX, y: e.clientY };
      clamp(); render();
    }
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) lastD = null;
    if (pts.size === 0) { pan = null; wrap.classList.remove('grabbing'); }
  };
  wrap.addEventListener('pointerup', up);
  wrap.addEventListener('pointercancel', up);
  img.onload = () => { s = 1; tx = ty = 0; render(); };
  img.src = src;
  imgViewState = { refit: () => { s = 1; tx = ty = 0; render(); } };
}
document.getElementById('popup-close').onclick = closePopup;
document.getElementById('popup-modal').addEventListener('click', (e) => {
  if (e.target.id === 'popup-modal') closePopup();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopup(); });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.querySelectorAll('#hotspot-layer .ptext').forEach(fitWidths);
  if (imgViewState) imgViewState.refit();
});

// 휠/핀치 줌을 FOV로 매핑 (OrbitControls 기본 dolly와 충돌 방지용 보정)
controls.addEventListener('change', () => {
  // OrbitControls가 카메라를 이동시키므로 위치 고정
  camera.position.setLength(0.1);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  camera.position.setLength(0.1);
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov += (targetFov - camera.fov) * 0.2;
    camera.updateProjectionMatrix();
  }
  // 줌 단계에 맞춘 오버레이 스케일 (기본 70도 기준)
  if (Math.abs(camera.fov - lastZsFov) > 0.05) {
    lastZsFov = camera.fov;
    layer.style.setProperty('--zs', (Math.tan(THREE.MathUtils.degToRad(35)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))).toFixed(3));
  }
  updateHotspotProjection();
  // 진행방향으로 흐르는 파장 애니메이션
  const tNow = performance.now() / 1000;
  for (const hs of hotspotObjs) {
    if (!hs.chevs || !hs.out) continue;
    hs.chevs.forEach((c, k) => {
      const t = ((tNow * 0.45 + (hs.phase || 0) + k / 3) % 1);
      c.mesh.position.copy(hs.arrow.position);
      c.mesh.position.addScaledVector(hs.out, -4.5 + t * 5.7);
      c.mesh.position.y = -2.96;
      c.mat.opacity = Math.sin(t * Math.PI) * 0.65;
      // 뒤쪽(시작)은 크게, 앞쪽으로 갈수록 작게 — 중간 자동 보간
      const sc = 1.0 - 0.35 * t;
      c.mesh.scale.set(sc, 1, sc);
    });
  }
  renderer.render(scene, camera);
}

loadTour().catch(err => {
  console.error(err);
  loadingText.textContent = 'tour.json 로드 실패. 로컬 서버로 실행했는지 확인 (예: python -m http.server)';
});
animate();
