'use strict';
/*
 * Éditeur de reprises de dressage — site statique (GitHub Pages).
 * Toutes les formes sont stockées en mètres dans le repère de la carrière :
 *   x = largeur (0 = côté gauche K/E/H, 20 = côté droit F/B/M)
 *   y = longueur (0 = A, L = C)
 * Ainsi on peut changer l'orientation sans perdre le dessin.
 */
(() => {
  // ---------------------------------------------------------------- Constantes
  const S = 10;          // unités SVG par mètre
  const PAD = 1;         // écart (m) entre la piste (points d'accroche) et le bord dessiné
  const M = 40 + PAD * S; // marge autour de la piste (bord + lettres)
  const STROKE = 3.5;    // épaisseur des tracés
  const SNAP_R = 1.6;    // rayon d'accroche aux lettres (m)
  const STORAGE_KEY = 'reprises.courante';

  const GAITS = [
    { id: 'pas',        label: 'Pas',              color: '#4a90e2' },
    { id: 'pas_all',    label: 'Pas allongé',      color: '#1a3a8f' },
    { id: 'trot',       label: 'Trot de travail',  color: '#43a047' },
    { id: 'trot_all',   label: 'Trot allongé',     color: '#1b5e20' },
    { id: 'galop',      label: 'Galop de travail', color: '#e53935' },
    { id: 'galop_all',  label: 'Galop allongé',    color: '#8e0000' },
    { id: 'piaffer',    label: 'Piaffer',          color: '#ab47bc' },
    { id: 'passage',    label: 'Passage',          color: '#4a148c' },
  ];
  const GAIT = Object.fromEntries(GAITS.map(g => [g.id, g]));

  const TOOLS = [
    { id: 'free',   label: '✎ Main levée', hint: 'Dessinez librement : le tracé est lissé et ses extrémités s’accrochent aux lettres.' },
    { id: 'line',   label: '╱ Ligne',      hint: 'Cliquez-glissez d’une lettre à une autre.' },
    { id: 'circle', label: '◯ Cercle',     hint: 'Cliquez sur la lettre où le cercle touche la piste, puis glissez vers l’intérieur du cercle.' },
    { id: 'arc',    label: '◠ Arc',        hint: 'Glissez de la lettre de départ à la lettre d’arrivée, puis placez la souris du côté de l’arc et cliquez pour valider (Échap pour annuler).' },
    { id: 'eraser', label: '⌫ Gomme',      hint: 'Cliquez sur un tracé ou un symbole pour le supprimer.' },
  ];

  const SYMBOLS = [
    { id: 'halt',     label: 'Arrêt' },
    { id: 'cession',  label: 'Cession à la jambe' },
    { id: 'shoulder', label: 'Épaule en dedans' },
    { id: 'appuyer',  label: 'Appuyer' },
  ];

  const DIAMS = [6, 10, 12, 15, 20];

  // Position des lettres (distance depuis A, en mètres)
  const LETTERS = {
    40: {
      wall:   [['K', 'F', 6], ['E', 'B', 20], ['H', 'M', 34]],
      center: [['D', 6], ['X', 20], ['G', 34]],
    },
    60: {
      wall:   [['K', 'F', 6], ['V', 'P', 18], ['E', 'B', 30], ['S', 'R', 42], ['H', 'M', 54]],
      center: [['D', 6], ['L', 18], ['X', 30], ['I', 42], ['G', 54]],
    },
  };

  // ---------------------------------------------------------------- Utilitaires
  const $ = sel => document.querySelector(sel);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const r2 = v => Math.round(v * 100) / 100;
  const pt = (x, y) => ({ x: r2(x), y: r2(y) });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Géométrie d'une carrière selon taille et orientation
  function geom(size, orient) {
    const L = size, v = orient !== 'h';
    return {
      L, v,
      W: v ? 20 * S + 2 * M : L * S + 2 * M,
      H: v ? L * S + 2 * M : 20 * S + 2 * M,
      // Verticale : A en bas, C en haut. Horizontale : A à gauche, C à droite, E en haut.
      to: p => v ? { x: M + p.x * S, y: M + (L - p.y) * S } : { x: M + p.y * S, y: M + p.x * S },
      from: q => v ? { x: (q.x - M) / S, y: L - (q.y - M) / S } : { x: (q.y - M) / S, y: (q.x - M) / S },
    };
  }

  function snapPoints(size) {
    const L = size, d = LETTERS[size];
    const pts = [{ n: 'A', x: 10, y: 0 }, { n: 'C', x: 10, y: L }];
    d.wall.forEach(([l, r, y]) => pts.push({ n: l, x: 0, y }, { n: r, x: 20, y }));
    d.center.forEach(([n, y]) => pts.push({ n, x: 10, y }));
    return pts;
  }

  function snap(p, c) {
    if (!ui.snap) return { x: p.x, y: p.y };
    let best = null, bd = SNAP_R;
    for (const s of snapPoints(c.size)) {
      const d = dist(p, s);
      if (d < bd) { bd = d; best = s; }
    }
    return best ? { x: best.x, y: best.y, n: best.n } : { x: p.x, y: p.y };
  }

  // ---------------------------------------------------------------- Lissage main levée
  function rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const a = pts[0], b = pts[pts.length - 1];
    let idx = -1, max = 0;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1e-9;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max <= eps) return [a, b];
    const left = rdp(pts.slice(0, idx + 1), eps);
    return left.slice(0, -1).concat(rdp(pts.slice(idx), eps));
  }

  function processFree(raw, c) {
    let pts = [raw[0]];
    for (const p of raw) if (dist(p, pts[pts.length - 1]) > 0.12) pts.push(p);
    if (pts.length < 2) return [];
    // moyenne glissante (2 passes) en gardant les extrémités
    for (let pass = 0; pass < 2; pass++) {
      pts = pts.map((p, i) => (i === 0 || i === pts.length - 1) ? p : {
        x: (pts[i - 1].x + p.x + pts[i + 1].x) / 3,
        y: (pts[i - 1].y + p.y + pts[i + 1].y) / 3,
      });
    }
    pts = rdp(pts, 0.12);
    // accroche des extrémités aux lettres
    const s0 = snap(pts[0], c), s1 = snap(pts[pts.length - 1], c);
    if (s0.n) pts[0] = s0;
    if (s1.n) pts[pts.length - 1] = s1;
    return pts.map(p => pt(p.x, p.y));
  }

  // Courbe lisse (Catmull-Rom → Bézier) passant par les points écran
  function smoothPath(q) {
    if (q.length < 2) return '';
    if (q.length === 2) return `M${q[0].x},${q[0].y}L${q[1].x},${q[1].y}`;
    let d = `M${q[0].x},${q[0].y}`;
    for (let i = 0; i < q.length - 1; i++) {
      const p0 = q[i - 1] || q[i], p1 = q[i], p2 = q[i + 1], p3 = q[i + 2] || p2;
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      d += `C${r2(c1.x)},${r2(c1.y)} ${r2(c2.x)},${r2(c2.y)} ${r2(p2.x)},${r2(p2.y)}`;
    }
    return d;
  }
  const polyPath = q => q.map((p, i) => `${i ? 'L' : 'M'}${r2(p.x)},${r2(p.y)}`).join('');

  // ---------------------------------------------------------------- Cercles et arcs
  function circleCenter(a, cursor, r, c) {
    let vx = cursor.x - a.x, vy = cursor.y - a.y;
    let len = Math.hypot(vx, vy);
    if (len < 0.6) {
      // direction par défaut : vers l'intérieur de la carrière
      if (a.x <= 0.5) [vx, vy] = [1, 0];
      else if (a.x >= 19.5) [vx, vy] = [-1, 0];
      else if (a.y <= 0.5) [vx, vy] = [0, 1];
      else if (a.y >= c.size - 0.5) [vx, vy] = [0, -1];
      else [vx, vy] = [1, 0];
      len = 1;
    }
    let ang = Math.atan2(vy, vx);
    // aimantation de la direction à 0/90/180/270° (± 15°)
    const q = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(ang - q) < Math.PI / 12) ang = q;
    return pt(a.x + Math.cos(ang) * r, a.y + Math.sin(ang) * r);
  }

  function arcSide(a, b, p) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const s = (p.x - m.x) * -dy + (p.y - m.y) * dx;
    return s >= 0 ? 1 : -1;
  }

  function arcPoints(a, b, r, side) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d < 1e-6) return [a, b];
    if (r < d / 2) r = d / 2;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const n = { x: -dy / d, y: dx / d };
    const h = Math.sqrt(Math.max(0, r * r - d * d / 4));
    const c = { x: m.x - side * h * n.x, y: m.y - side * h * n.y };
    const ta = Math.atan2(a.y - c.y, a.x - c.x);
    const tb = Math.atan2(b.y - c.y, b.x - c.x);
    const tm = Math.atan2(side * n.y, side * n.x); // direction du sommet de l'arc
    const TAU = Math.PI * 2;
    let delta = Math.atan2(Math.sin(tb - ta), Math.cos(tb - ta));
    const passes = delta >= 0
      ? (((tm - ta) % TAU) + TAU) % TAU <= delta + 1e-6
      : -((((ta - tm) % TAU) + TAU) % TAU) >= delta - 1e-6;
    if (!passes) delta = delta > 0 ? delta - TAU : delta + TAU;
    const N = Math.max(8, Math.ceil(Math.abs(delta) / (Math.PI / 32)));
    const out = [];
    for (let i = 0; i <= N; i++) {
      const t = ta + delta * i / N;
      out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
    }
    return out;
  }

  // ---------------------------------------------------------------- Symboles
  function glyph(kind, color) {
    switch (kind) {
      case 'halt': {
        const pts = Array.from({ length: 8 }, (_, k) => {
          const a = Math.PI / 8 + k * Math.PI / 4;
          return `${r2(11 * Math.cos(a))},${r2(11 * Math.sin(a))}`;
        }).join(' ');
        return `<polygon points="${pts}" fill="#222"/><rect x="-6.5" y="-2" width="13" height="4" fill="#fff"/>`;
      }
      case 'cession':
        return `<circle r="11" fill="#fff" stroke="${color}" stroke-width="2.5"/>` +
          `<path d="M-6.5 4L-2.2 -4L2.2 4L6.5 -4" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
      case 'shoulder':
        return `<circle r="11" fill="#fff" stroke="${color}" stroke-width="2.5"/>` +
          `<text text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="700" fill="${color}" font-family="system-ui,sans-serif">ED</text>`;
      case 'appuyer':
        return `<circle r="11" fill="#fff" stroke="${color}" stroke-width="2.5"/>` +
          `<path d="M-6 5L5 -5M5 -5L-1 -5M5 -5L5 1" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    return '';
  }

  // ---------------------------------------------------------------- État
  const newCase = (size = 60, orient = 'v') => ({ id: uid(), size, orient, text: '', shapes: [] });
  const newReprise = () => ({ version: 1, title: '', cases: [newCase()] });

  function normalize(data) {
    if (!data || !Array.isArray(data.cases)) throw new Error('Fichier de reprise invalide');
    return {
      version: 1,
      title: String(data.title || ''),
      cases: data.cases.map(c => ({
        id: uid(),
        size: c.size === 40 ? 40 : 60,
        orient: c.orient === 'h' ? 'h' : 'v',
        text: String(c.text || ''),
        shapes: Array.isArray(c.shapes) ? c.shapes : [],
      })),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch { return null; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* stockage indisponible */ }
  }

  let state = load() || newReprise();
  if (!state.cases.length) state.cases.push(newCase());
  const ui = { tool: 'free', gait: 'trot', diam: 10, snap: true };
  const history = new Map();   // id de case -> piles d'états précédents
  const refs = new Map();      // id de case -> éléments DOM
  let drag = null;
  let lastCaseId = state.cases[0].id;

  function mutate(c, fn) {
    const h = history.get(c.id) || [];
    h.push(JSON.stringify(c.shapes));
    if (h.length > 60) h.shift();
    history.set(c.id, h);
    fn();
    save();
    renderShapes(c);
  }
  function undo(c) {
    const h = history.get(c.id);
    if (!h || !h.length) return;
    c.shapes = JSON.parse(h.pop());
    save();
    renderShapes(c);
  }

  // ---------------------------------------------------------------- Rendu carrière
  function arenaSvg(c, g) {
    const L = c.size, d = LETTERS[c.size];
    // Le bord est dessiné à PAD mètres à l'extérieur de la piste :
    // les points d'accroche (x = 0 / 20, y = 0 / L) restent sur la piste.
    const P = PAD;
    const p0 = g.to({ x: -P, y: -P }), p1 = g.to({ x: 20 + P, y: L + P });
    const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
    const w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
    let s = `<rect class="arena" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
    const a = g.to({ x: 10, y: -P }), cc = g.to({ x: 10, y: L + P });
    s += `<line class="centerline" x1="${a.x}" y1="${a.y}" x2="${cc.x}" y2="${cc.y}"/>`;

    const label = (n, p, cls = 'letter') => {
      const q = g.to(p);
      return `<text class="${cls}" x="${q.x}" y="${q.y}">${n}</text>`;
    };
    const tick = (p1, p2) => {
      const q1 = g.to(p1), q2 = g.to(p2);
      return `<line class="tick" x1="${q1.x}" y1="${q1.y}" x2="${q2.x}" y2="${q2.y}"/>`;
    };
    for (const [l, r, yy] of d.wall) {
      s += tick({ x: -P, y: yy }, { x: -P - 0.7, y: yy }) + label(l, { x: -P - 1.9, y: yy });
      s += tick({ x: 20 + P, y: yy }, { x: 20 + P + 0.7, y: yy }) + label(r, { x: 20 + P + 1.9, y: yy });
    }
    for (const [n, yy] of d.center) s += label(n, { x: 10, y: yy }, 'cletter');
    s += label('A', { x: 10, y: -P - 1.9 }) + label('C', { x: 10, y: L + P + 1.9 });
    return s;
  }

  function shapeSvg(sh, g, i) {
    const col = (GAIT[sh.g] || GAIT.trot).color;
    const arrow = `marker-end="url(#arr-${GAIT[sh.g] ? sh.g : 'trot'})"`;
    const stroke = `fill="none" stroke="${col}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"`;
    let vis = '', hit = '';
    switch (sh.t) {
      case 'line': {
        const d = polyPath(sh.p.map(g.to));
        vis = `<path d="${d}" ${stroke} ${arrow}/>`; hit = `<path class="hit" d="${d}"/>`;
        break;
      }
      case 'free': {
        const d = smoothPath(sh.p.map(g.to));
        vis = `<path d="${d}" ${stroke} ${arrow}/>`; hit = `<path class="hit" d="${d}"/>`;
        break;
      }
      case 'arc': {
        const d = polyPath(arcPoints(sh.a, sh.b, sh.r, sh.side).map(g.to));
        vis = `<path d="${d}" ${stroke} ${arrow}/>`; hit = `<path class="hit" d="${d}"/>`;
        break;
      }
      case 'circle': {
        const q = g.to(sh.c);
        vis = `<circle cx="${q.x}" cy="${q.y}" r="${sh.r * S}" ${stroke}/>`;
        hit = `<circle class="hit" cx="${q.x}" cy="${q.y}" r="${sh.r * S}"/>`;
        break;
      }
      case 'sym': {
        const q = g.to(sh);
        vis = `<g transform="translate(${q.x},${q.y})">${glyph(sh.k, col)}</g>`;
        hit = `<circle class="hit-fill" cx="${q.x}" cy="${q.y}" r="13"/>`;
        break;
      }
      default: return '';
    }
    return `<g class="shape" data-i="${i}">${vis}${hit}</g>`;
  }

  function renderShapes(c) {
    const r = refs.get(c.id);
    if (!r) return;
    const g = geom(c.size, c.orient);
    r.shapes.innerHTML = c.shapes.map((sh, i) => shapeSvg(sh, g, i)).join('');
  }

  function renderCase(c) {
    const r = refs.get(c.id);
    const g = geom(c.size, c.orient);
    r.svg.setAttribute('viewBox', `0 0 ${g.W} ${g.H}`);
    r.base.innerHTML = arenaSvg(c, g);
    renderShapes(c);
    r.preview.innerHTML = '';
  }

  // ---------------------------------------------------------------- Aperçu pendant le tracé
  function drawPreview(c) {
    const r = refs.get(c.id);
    if (!drag || drag.caseId !== c.id) { r.preview.innerHTML = ''; return; }
    const g = geom(c.size, c.orient);
    const col = GAIT[ui.gait].color;
    const st = `fill="none" stroke="${col}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" opacity=".7"`;
    let s = '';
    if (drag.tool === 'free') {
      s = `<path d="${polyPath(drag.pts.map(g.to))}" ${st}/>`;
    } else if (drag.tool === 'line') {
      s = `<path d="${polyPath([drag.a, drag.b].map(g.to))}" ${st} stroke-dasharray="6 5"/>`;
    } else if (drag.tool === 'circle') {
      const ctr = circleCenter(drag.a, drag.raw, ui.diam / 2, c), q = g.to(ctr);
      s = `<circle cx="${q.x}" cy="${q.y}" r="${ui.diam / 2 * S}" ${st} stroke-dasharray="6 5"/>` +
          `<circle cx="${q.x}" cy="${q.y}" r="2.5" fill="${col}"/>`;
    } else if (drag.tool === 'arc') {
      const side = drag.phase === 'side' ? arcSide(drag.a, drag.b, drag.cursor) : 1;
      if (dist(drag.a, drag.b) > 0.3) {
        s = `<path d="${polyPath(arcPoints(drag.a, drag.b, ui.diam / 2, side).map(g.to))}" ${st} stroke-dasharray="6 5"/>`;
      }
    }
    r.preview.innerHTML = s;
  }

  function showSnap(c, raw) {
    const r = refs.get(c.id);
    const usesSnap = ui.tool !== 'eraser';
    const s = usesSnap ? snap(raw, c) : {};
    if (s.n) {
      const q = geom(c.size, c.orient).to(s);
      r.snapind.setAttribute('cx', q.x);
      r.snapind.setAttribute('cy', q.y);
      r.snapind.style.display = '';
    } else {
      r.snapind.style.display = 'none';
    }
  }

  // ---------------------------------------------------------------- Interaction
  function svgPoint(svg, e) {
    const p = svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }

  function cancelDrag() {
    if (drag) {
      const c = state.cases.find(x => x.id === drag.caseId);
      drag = null;
      if (c) drawPreview(c);
    }
  }

  function onDown(e, c) {
    if (e.button !== 0) return;
    lastCaseId = c.id;
    const r = refs.get(c.id);
    const g = geom(c.size, c.orient);
    const raw = g.from(svgPoint(r.svg, e));
    const p = snap(raw, c);
    const tool = ui.tool;
    if (drag && drag.caseId !== c.id) cancelDrag();

    if (tool === 'eraser') {
      const t = e.target.closest('.shape');
      if (t) { const i = +t.dataset.i; mutate(c, () => c.shapes.splice(i, 1)); }
      return;
    }
    if (tool.startsWith('sym:')) {
      mutate(c, () => c.shapes.push({ t: 'sym', k: tool.slice(4), g: ui.gait, x: r2(p.x), y: r2(p.y) }));
      return;
    }
    if (tool === 'arc' && drag && drag.phase === 'side') {
      const sh = { t: 'arc', g: ui.gait, a: drag.a, b: drag.b, r: ui.diam / 2, side: arcSide(drag.a, drag.b, raw) };
      drag = null;
      drawPreview(c);
      mutate(c, () => c.shapes.push(sh));
      return;
    }
    r.svg.setPointerCapture(e.pointerId);
    drag = tool === 'free'
      ? { caseId: c.id, tool, pts: [raw] }
      : { caseId: c.id, tool, a: pt(p.x, p.y), b: pt(p.x, p.y), raw };
    drawPreview(c);
    e.preventDefault();
  }

  function onMove(e, c) {
    const r = refs.get(c.id);
    const g = geom(c.size, c.orient);
    const raw = g.from(svgPoint(r.svg, e));
    showSnap(c, raw);
    if (!drag || drag.caseId !== c.id) return;
    if (drag.phase === 'side') { drag.cursor = raw; drawPreview(c); return; }
    if (drag.tool === 'free') drag.pts.push(raw);
    else { const p = snap(raw, c); drag.b = pt(p.x, p.y); drag.raw = raw; }
    drawPreview(c);
  }

  function onUp(e, c) {
    if (!drag || drag.caseId !== c.id || drag.phase === 'side') return;
    const d = drag;
    let sh = null;
    if (d.tool === 'free') {
      const pts = processFree(d.pts, c);
      if (pts.length >= 2) sh = { t: 'free', g: ui.gait, p: pts };
    } else if (d.tool === 'line') {
      if (dist(d.a, d.b) > 0.3) sh = { t: 'line', g: ui.gait, p: [d.a, d.b] };
    } else if (d.tool === 'circle') {
      sh = { t: 'circle', g: ui.gait, c: circleCenter(d.a, d.raw, ui.diam / 2, c), r: ui.diam / 2 };
    } else if (d.tool === 'arc') {
      if (dist(d.a, d.b) > 0.3) {
        // 2e temps : choisir le côté de l'arc puis cliquer
        d.phase = 'side';
        d.cursor = refs.get(c.id) ? geom(c.size, c.orient).from(svgPoint(refs.get(c.id).svg, e)) : d.b;
        drawPreview(c);
        return;
      }
    }
    drag = null;
    drawPreview(c);
    if (sh) mutate(c, () => c.shapes.push(sh));
  }

  // ---------------------------------------------------------------- Cases
  function buildCase(c, idx) {
    const art = document.createElement('article');
    art.className = 'case';
    art.innerHTML = `
      <div class="case-head">
        <span class="num">Case ${idx + 1}</span>
        <div class="controls no-print">
          <select data-k="size" title="Dimensions">
            <option value="40">20 × 40</option><option value="60">20 × 60</option>
          </select>
          <select data-k="orient" title="Orientation">
            <option value="v">Verticale</option><option value="h">Horizontale</option>
          </select>
          <button class="icon" data-act="undo" title="Annuler (Ctrl+Z)">↶</button>
          <button class="icon" data-act="clear" title="Effacer le dessin">⌧</button>
          <button class="icon" data-act="up" title="Monter">↑</button>
          <button class="icon" data-act="down" title="Descendre">↓</button>
          <button class="icon danger" data-act="del" title="Supprimer la case">✕</button>
        </div>
      </div>
      <div class="drawing">
        <svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
          <g class="base"></g><g class="shapes"></g><g class="preview"></g>
          <circle class="snapind" r="8" style="display:none"/>
        </svg>
      </div>
      <textarea placeholder="Remarques, consignes, notes…"></textarea>
      <div class="print-text print-only"></div>`;

    const svg = art.querySelector('svg');
    const r = {
      el: art, svg,
      base: svg.querySelector('.base'),
      shapes: svg.querySelector('.shapes'),
      preview: svg.querySelector('.preview'),
      snapind: svg.querySelector('.snapind'),
    };
    refs.set(c.id, r);

    const [selSize, selOrient] = art.querySelectorAll('select');
    selSize.value = String(c.size);
    selOrient.value = c.orient;
    selSize.onchange = () => { cancelDrag(); c.size = +selSize.value; save(); renderCase(c); };
    selOrient.onchange = () => { cancelDrag(); c.orient = selOrient.value; save(); renderCase(c); };

    const ta = art.querySelector('textarea');
    const pt_ = art.querySelector('.print-text');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
    ta.value = c.text;
    pt_.textContent = c.text;
    ta.oninput = () => { c.text = ta.value; pt_.textContent = c.text; grow(); save(); };
    requestAnimationFrame(grow);

    art.querySelector('.controls').onclick = ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      const i = state.cases.indexOf(c);
      switch (b.dataset.act) {
        case 'undo': undo(c); break;
        case 'clear':
          if (c.shapes.length && confirm('Effacer tout le dessin de cette case ?')) mutate(c, () => { c.shapes = []; });
          break;
        case 'up':
          if (i > 0) { state.cases.splice(i, 1); state.cases.splice(i - 1, 0, c); save(); renderAll(); }
          break;
        case 'down':
          if (i < state.cases.length - 1) { state.cases.splice(i, 1); state.cases.splice(i + 1, 0, c); save(); renderAll(); }
          break;
        case 'del':
          if ((c.shapes.length || c.text) && !confirm('Supprimer cette case ?')) return;
          state.cases.splice(i, 1);
          if (!state.cases.length) state.cases.push(newCase(c.size, c.orient));
          save(); renderAll();
          break;
      }
    };

    svg.addEventListener('pointerdown', e => onDown(e, c));
    svg.addEventListener('pointermove', e => onMove(e, c));
    svg.addEventListener('pointerup', e => onUp(e, c));
    svg.addEventListener('pointercancel', () => cancelDrag());
    svg.addEventListener('pointerleave', () => { r.snapind.style.display = 'none'; });

    renderCase(c);
    return art;
  }

  function renderAll() {
    cancelDrag();
    refs.clear();
    const wrap = $('#cases');
    wrap.innerHTML = '';
    state.cases.forEach((c, i) => wrap.appendChild(buildCase(c, i)));
    const add = document.createElement('button');
    add.className = 'add-case no-print';
    add.title = 'Ajouter une case';
    add.textContent = '+';
    add.onclick = () => {
      const last = state.cases[state.cases.length - 1];
      const c = newCase(last ? last.size : 60, last ? last.orient : 'v');
      state.cases.push(c);
      save(); renderAll();
      refs.get(c.id).el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    wrap.appendChild(add);
    $('#title').value = state.title;
  }

  // ---------------------------------------------------------------- Barre d'outils
  function buildToolbar() {
    $('#tools').innerHTML = TOOLS.map(t => `<button data-tool="${t.id}">${t.label}</button>`).join('');
    $('#symbols').innerHTML = SYMBOLS.map(s =>
      `<button data-tool="sym:${s.id}" title="${s.label}"><svg viewBox="-13 -13 26 26" width="20" height="20">${glyph(s.id, '#333')}</svg>${s.label}</button>`
    ).join('');
    $('#gaits').innerHTML = GAITS.map(g =>
      `<button data-gait="${g.id}"><span class="swatch" style="background:${g.color}"></span>${g.label}</button>`
    ).join('');
    $('#diams').innerHTML = DIAMS.map(d => `<button data-diam="${d}">${d} m</button>`).join('');

    $('.toolbar').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tool) { cancelDrag(); ui.tool = b.dataset.tool; }
      if (b.dataset.gait) ui.gait = b.dataset.gait;
      if (b.dataset.diam) ui.diam = +b.dataset.diam;
      refreshToolbar();
    });
    $('#snap').onchange = e => { ui.snap = e.target.checked; };

    // flèches de direction
    $('#markers').innerHTML = GAITS.map(g =>
      `<marker id="arr-${g.id}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">` +
      `<path d="M0,0L10,5L0,10z" fill="${g.color}"/></marker>`
    ).join('');

    // légende imprimée
    $('#legend').innerHTML =
      GAITS.map(g => `<span><span class="swatch" style="background:${g.color}"></span>${esc(g.label)}</span>`).join('') +
      SYMBOLS.map(s => `<span><svg viewBox="-13 -13 26 26" width="14" height="14">${glyph(s.id, '#333')}</svg>${esc(s.label)}</span>`).join('');

    refreshToolbar();
  }

  function refreshToolbar() {
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === ui.tool));
    document.querySelectorAll('[data-gait]').forEach(b => b.classList.toggle('active', b.dataset.gait === ui.gait));
    document.querySelectorAll('[data-diam]').forEach(b => b.classList.toggle('active', +b.dataset.diam === ui.diam));
    $('#diam-group').style.visibility = (ui.tool === 'circle' || ui.tool === 'arc') ? 'visible' : 'hidden';
    document.body.classList.toggle('tool-eraser', ui.tool === 'eraser');
    const t = TOOLS.find(x => x.id === ui.tool);
    $('#hint').textContent = t ? t.hint
      : 'Cliquez dans la carrière pour placer le symbole (il s’accroche aux lettres).';
  }

  // ---------------------------------------------------------------- Fichiers
  function fileName() {
    const base = (state.title || 'reprise').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'reprise';
    return base + '.reprise.json';
  }

  function download() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function bindFileActions() {
    $('#btn-new').onclick = () => {
      if (!confirm('Commencer une nouvelle reprise ? Pensez à enregistrer la reprise actuelle.')) return;
      state = newReprise(); history.clear(); save(); renderAll();
    };
    $('#btn-save').onclick = download;
    $('#btn-print').onclick = () => window.print();
    $('#btn-open').onclick = () => $('#file-input').click();
    $('#file-input').onchange = async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        state = normalize(JSON.parse(await f.text()));
        if (!state.cases.length) state.cases.push(newCase());
        history.clear(); save(); renderAll();
      } catch (err) {
        alert('Impossible d’ouvrir ce fichier : ' + err.message);
      }
    };
    $('#title').oninput = e => { state.title = e.target.value; save(); };

    document.addEventListener('keydown', e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === 'Escape') cancelDrag();
      if (!typing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const c = state.cases.find(x => x.id === lastCaseId);
        if (c) { e.preventDefault(); undo(c); }
      }
    });
  }

  // ---------------------------------------------------------------- Démarrage
  buildToolbar();
  bindFileActions();
  renderAll();
})();
