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
    { id: 'line',   label: '╱ Ligne',      hint: 'Cliquez point après point (lettres, coins…). Double-clic ou Entrée pour terminer, Échap pour annuler. Les angles sont arrondis en arcs de 6 m.' },
    { id: 'circle', label: '◯ Cercle',     hint: 'Cliquez sur la lettre où le cercle touche la piste, puis glissez vers l’intérieur du cercle.' },
    { id: 'arc',    label: '◠ Arc',        hint: 'Glissez de la lettre de départ à la lettre d’arrivée, puis placez la souris du côté de l’arc et cliquez pour valider (Échap pour annuler).' },
    { id: 'eraser', label: '⌫ Gomme',      hint: 'Cliquez sur un tracé ou un symbole pour le supprimer.' },
  ];

  // Figures ponctuelles : clic pour poser, cliquer-glisser pour orienter
  const SYMBOLS = [
    { id: 'halt',        label: 'Arrêt' },
    { id: 'dt_hanches',  label: 'Demi-tour sur les hanches' },
    { id: 'dt_epaules',  label: 'Demi-tour sur les épaules' },
    { id: 'qt_hanches',  label: 'Quart de tour sur les hanches' },
    { id: 'qt_epaules',  label: 'Quart de tour sur les épaules' },
    { id: 'pirouette',   label: 'Pirouette' },
    { id: 'cone',        label: 'Cône' },
    { id: 'barre',       label: 'Barre au sol' },
    { id: 'croisillon',  label: 'Croisillon' },
  ];
  const UNROTATED = ['halt', 'cone'];
  const BLACK_SYMBOLS = ['halt', 'cone', 'barre', 'croisillon'];

  // Types de déplacement : restent enclenchés et décorent automatiquement le parcours
  const MOVES = [
    { id: 'droit',     label: 'Droit' },
    { id: 'shoulder',  label: 'Épaule en dedans' },
    { id: 'ea',        label: 'Épaule en avant' },
    { id: 'ced',       label: 'Contre-épaule en dedans' },
    { id: 'hdedans',   label: 'Hanches en dedans' },
    { id: 'hdehors',   label: 'Hanches en dehors' },
    { id: 'cession',   label: 'Cession à la jambe' },
    { id: 'appuyer',   label: 'Appuyer' },
    { id: 'pasdecote', label: 'Pas de côté' },
    { id: 'reculer',   label: 'Reculer' },
  ];
  const MOVE_IDS = MOVES.map(m => m.id);

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
    const pts = [
      { n: 'A', x: 10, y: 0 }, { n: 'C', x: 10, y: L },
      // coins de la piste
      { n: 'coin', x: 0, y: 0 }, { n: 'coin', x: 20, y: 0 },
      { n: 'coin', x: 0, y: L }, { n: 'coin', x: 20, y: L },
    ];
    d.wall.forEach(([l, r, y]) => pts.push({ n: l, x: 0, y }, { n: r, x: 20, y }));
    d.center.forEach(([n, y]) => pts.push({ n, x: 10, y }));
    // lignes du quart (5 m des grands côtés), à hauteur des lettres et aux extrémités
    for (const y of [0, L, ...d.wall.map(w => w[2])]) pts.push({ n: 'quart', x: 5, y }, { n: 'quart', x: 15, y });
    return pts;
  }

  function snap(p, c) {
    if (!ui.snap) return { x: p.x, y: p.y };
    let best = null, bd = SNAP_R;
    for (const s of snapPoints(c.size)) {
      const d = dist(p, s);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) return { x: best.x, y: best.y, n: best.n };
    // sinon : accroche n'importe où le long des deux lignes du quart
    if (p.y >= 0 && p.y <= c.size) {
      for (const qx of [5, 15]) if (Math.abs(p.x - qx) < 0.6) return { x: qx, y: p.y, n: 'quart' };
    }
    return { x: p.x, y: p.y };
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

  // Ligne brisée dont les angles sont arrondis par des arcs (rayon r, en m)
  function filletPoints(pts, r) {
    if (pts.length < 3) return pts.slice();
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const A = pts[i - 1], B = pts[i], C = pts[i + 1];
      const lab = dist(A, B), lbc = dist(B, C);
      if (lab < 1e-6 || lbc < 1e-6) continue;
      const u1 = { x: (A.x - B.x) / lab, y: (A.y - B.y) / lab };
      const u2 = { x: (C.x - B.x) / lbc, y: (C.y - B.y) / lbc };
      const theta = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
      if (theta > Math.PI - 0.02 || theta < 0.02) { out.push(B); continue; }   // pas d'angle
      // distance du sommet aux points de tangence, limitée à la moitié des segments
      let t = r / Math.tan(theta / 2);
      t = Math.min(t, lab / 2, lbc / 2);
      const rr = t * Math.tan(theta / 2);
      const T1 = { x: B.x + u1.x * t, y: B.y + u1.y * t };
      const T2 = { x: B.x + u2.x * t, y: B.y + u2.y * t };
      const bis = { x: u1.x + u2.x, y: u1.y + u2.y };
      const bl = Math.hypot(bis.x, bis.y);
      const dc = rr / Math.sin(theta / 2);
      const O = { x: B.x + bis.x / bl * dc, y: B.y + bis.y / bl * dc };
      const a1 = Math.atan2(T1.y - O.y, T1.x - O.x), a2 = Math.atan2(T2.y - O.y, T2.x - O.x);
      const da = Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1));   // le plus court chemin
      const N = Math.max(4, Math.ceil(Math.abs(da) / (Math.PI / 24)));
      for (let k = 0; k <= N; k++) {
        const a = a1 + da * k / N;
        out.push({ x: O.x + rr * Math.cos(a), y: O.y + rr * Math.sin(a) });
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  const CORNER_R = 3;   // arcs de 6 m de diamètre dans les angles

  // ---------------------------------------------------------------- Symboles
  const ln = (d, color, w = 2.4) =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const dot = (x, y, color, r = 2.4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;

  // Arc fléché centré en (0,0) ; angles en degrés (0 = avant du cheval, sens horaire à l'écran)
  function arcArrow(r, a0, a1, color, both = false) {
    const rad = a => a * Math.PI / 180;
    const P = a => ({ x: r2(r * Math.cos(rad(a))), y: r2(r * Math.sin(rad(a))) });
    const p0 = P(a0), p1 = P(a1);
    const sweep = a1 > a0 ? 1 : 0, large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    const head = (a, dir) => {
      const p = P(a);
      const t = { x: -Math.sin(rad(a)) * dir, y: Math.cos(rad(a)) * dir };   // tangente
      const n = { x: -t.y, y: t.x };
      const tip = { x: p.x + t.x * 2, y: p.y + t.y * 2 };
      const b1 = { x: p.x - t.x * 3.5 + n.x * 3.2, y: p.y - t.y * 3.5 + n.y * 3.2 };
      const b2 = { x: p.x - t.x * 3.5 - n.x * 3.2, y: p.y - t.y * 3.5 - n.y * 3.2 };
      return `<polygon points="${r2(tip.x)},${r2(tip.y)} ${r2(b1.x)},${r2(b1.y)} ${r2(b2.x)},${r2(b2.y)}" fill="${color}"/>`;
    };
    const dir = a1 > a0 ? 1 : -1;
    return ln(`M${p0.x},${p0.y}A${r},${r} 0 ${large} ${sweep} ${p1.x},${p1.y}`, color, 2) +
      head(a1, dir) + (both ? head(a0, -dir) : '');
  }

  // Figures ponctuelles. Repère local : +x = vers l'avant du cheval.
  function glyph(kind, color) {
    switch (kind) {
      case 'halt': {
        const pts = Array.from({ length: 8 }, (_, k) => {
          const a = Math.PI / 8 + k * Math.PI / 4;
          return `${r2(11 * Math.cos(a))},${r2(11 * Math.sin(a))}`;
        }).join(' ');
        return `<polygon points="${pts}" fill="#222"/><rect x="-6.5" y="-2" width="13" height="4" fill="#fff"/>`;
      }
      // pivot = gros point noir ; trait = corps ; petit point = tête
      case 'dt_hanches':
        return ln('M0,0H8', color) + dot(9, 0, color, 2) + dot(0, 0, '#222', 2.6) + arcArrow(11, 0, 180, color);
      case 'dt_epaules':
        return ln('M0,0H-9', color) + dot(2.5, 0, color, 2) + dot(0, 0, '#222', 2.6) + arcArrow(11, 180, 360, color);
      case 'qt_hanches':
        return ln('M0,0H8', color) + dot(9, 0, color, 2) + dot(0, 0, '#222', 2.6) + arcArrow(11, 0, 90, color);
      case 'qt_epaules':
        return ln('M0,0H-9', color) + dot(2.5, 0, color, 2) + dot(0, 0, '#222', 2.6) + arcArrow(11, 180, 270, color);
      case 'pirouette':
        return ln('M0,0H7', color) + dot(8, 0, color, 2) + dot(0, 0, '#222', 2.6) + arcArrow(12, -140, 140, color, true);
      case 'cone':
        return `<polygon points="0,-10 8.5,7 -8.5,7" fill="#222"/>`;
      case 'barre': {
        let r = `<rect x="-16" y="-2.2" width="32" height="4.4" fill="#fff" stroke="#222" stroke-width="1"/>`;
        for (let k = 0; k < 4; k++) r += `<rect x="${-16 + k * 8}" y="-2.2" width="4" height="4.4" fill="#222"/>`;
        return r;
      }
      case 'croisillon':
        return `<path d="M-15,-7L0,-1.5L15,-7V7L0,1.5L-15,7Z" fill="#fff" stroke="#222" stroke-width="1.6" stroke-linejoin="round"/>` +
          `<path d="M-15,-7V7L-8,4.5V-4.5ZM15,-7V7L8,4.5V-4.5Z" fill="#222"/><rect x="-3" y="-1.8" width="6" height="3.6" fill="#222"/>`;
      // anciens symboles ponctuels (compatibilité avec les fichiers déjà enregistrés)
      case 'cession': case 'shoulder': case 'appuyer':
        return `<circle r="11" fill="#fff" stroke="${color}" stroke-width="2.5"/>` +
          `<g transform="scale(.8)">${moveGlyph(kind, color)}</g>`;
    }
    return '';
  }

  // Symboles des déplacements. Repère local : +x = sens de la marche, +y = côté intérieur.
  // Les « crochets » représentent le cheval vu de dessus : trait = corps, point = tête.
  function moveGlyph(kind, color) {
    switch (kind) {
      case 'droit':     return ln('M-5,-5.5L3,0L-5,5.5', color, 3);
      case 'shoulder':  return ln('M-8,-1L2,3.5Q5,5 5.5,8.5', color) + dot(5.5, 9, color);
      case 'ea':        return ln('M-8,0L3,2Q6,3 6.5,5.5', color) + dot(6.5, 6, color);
      case 'ced':       return ln('M-8,1L2,-3.5Q5,-5 5.5,-8.5', color) + dot(5.5, -9, color);
      case 'hdedans':   return ln('M-7,7L2,0Q5,-2 8,-0.5', color) + dot(8.5, -0.3, color);
      case 'hdehors':   return ln('M-7,-7L2,0Q5,2 8,0.5', color) + dot(8.5, 0.3, color);
      case 'cession':   return ln('M-9,0H8M3,-4L8.5,0L3,4', color, 2.2);
      case 'appuyer':   return ln('M-9,0H8M3,-4L8.5,0L3,4M-5,-4L0,4M-5,4L0,-4', color, 2.2);
      case 'pasdecote': return ln('M-9,0H8M3,-4L8.5,0L3,4M-3,-4L2,4M-3,4L2,-4', color, 2.2);
      case 'reculer':   return ln('M-8,0H8M-4,-3.5L-8.5,0L-4,3.5M4,-3.5L8.5,0L4,3.5', color, 2);
    }
    return '';
  }

  // ---------------------------------------------------------------- État
  const newCase = (size = 60, orient = 'v') => ({ id: uid(), size, orient, text: '', note: '', shapes: [] });
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
        note: String(c.note || ''),
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
  // Réglages de la barre d'outils : ils restent enclenchés (et sont mémorisés)
  const UI_KEY = 'reprises.outils';
  const ui = { tool: 'free', gait: 'trot', move: 'droit', diam: 10, snap: true };
  try {
    const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    if (saved.tool && (TOOLS.some(t => t.id === saved.tool) || (saved.tool.startsWith('sym:') && SYMBOLS.some(f => 'sym:' + f.id === saved.tool)))) ui.tool = saved.tool;
    if (GAIT[saved.gait]) ui.gait = saved.gait;
    if (MOVE_IDS.includes(saved.move)) ui.move = saved.move;
    if (DIAMS.includes(saved.diam)) ui.diam = saved.diam;
    if (typeof saved.snap === 'boolean') ui.snap = saved.snap;
  } catch { /* rien */ }
  const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* rien */ } };
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
    for (const qx of [5, 15]) {
      const q1 = g.to({ x: qx, y: 0 }), q2 = g.to({ x: qx, y: L });
      s += `<line class="quarterline" x1="${q1.x}" y1="${q1.y}" x2="${q2.x}" y2="${q2.y}"/>`;
    }

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

  // Points (écran) le long du tracé, pour y poser les flèches / symboles
  function screenPolyline(sh, g) {
    switch (sh.t) {
      case 'line': return filletPoints(sh.p, CORNER_R).map(g.to);
      case 'arc': return arcPoints(sh.a, sh.b, sh.r, sh.side).map(g.to);
      case 'circle': {
        const q = g.to(sh.c), R = sh.r * S;
        return Array.from({ length: 73 }, (_, k) => {
          const t = k / 72 * Math.PI * 2;
          return { x: q.x + R * Math.cos(t), y: q.y + R * Math.sin(t) };
        });
      }
      case 'free': {
        const q = sh.p.map(g.to);
        if (q.length < 3) return q;
        const out = [q[0]];
        for (let i = 0; i < q.length - 1; i++) {
          const p0 = q[i - 1] || q[i], p1 = q[i], p2 = q[i + 1], p3 = q[i + 2] || p2;
          const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
          const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
          for (let k = 1; k <= 12; k++) {
            const t = k / 12, u = 1 - t;
            out.push({
              x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
              y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
            });
          }
        }
        return out;
      }
    }
    return [];
  }

  // Position et angle (degrés) aux distances demandées le long d'une polyligne
  function pointsAlong(poly, dists) {
    const res = [];
    let acc = 0, k = 0;
    for (let i = 0; i < poly.length - 1 && k < dists.length; i++) {
      const a = poly[i], b = poly[i + 1];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      while (k < dists.length && dists[k] <= acc + seg) {
        const t = seg ? (dists[k] - acc) / seg : 0;
        res.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          ang: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI,
        });
        k++;
      }
      acc += seg;
    }
    return res;
  }

  function polyLength(poly) {
    let L = 0;
    for (let i = 0; i < poly.length - 1; i++) L += Math.hypot(poly[i + 1].x - poly[i].x, poly[i + 1].y - poly[i].y);
    return L;
  }

  // Décorations automatiques selon le type de déplacement
  function decorations(sh, g, col) {
    const move = MOVE_IDS.includes(sh.m) ? sh.m : 'droit';
    const poly = screenPolyline(sh, g);
    const len = polyLength(poly);
    if (len < 15) return '';
    const closed = sh.t === 'circle';
    if (move === 'droit') {
      if (closed) return '';                       // un cercle n'a pas de sens défini
      const usable = len - 25;                     // la flèche de fin existe déjà
      const n = Math.max(1, Math.round(usable / 60));
      const ds = Array.from({ length: n }, (_, i) => (i + 0.5) * usable / n);
      return pointsAlong(poly, ds).map(p =>
        `<path transform="translate(${r2(p.x)},${r2(p.y)}) rotate(${r2(p.ang)})" d="M-5,-5.5L3,0L-5,5.5" ` +
        `fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
      ).join('');
    }
    // Déplacements latéraux : le symbole est répété le long du parcours,
    // orienté selon le sens de la marche et le côté intérieur.
    const step = 58;
    const n = Math.max(1, Math.round(len / step));
    const ds = Array.from({ length: n }, (_, i) => (i + (closed ? 0 : 0.5)) * len / n);
    // côté « intérieur » : centre du cercle, sinon centre de la carrière
    const ref = closed ? g.to(sh.c) : g.to({ x: 10, y: g.L / 2 });
    // axe des grands côtés à l'écran (pour cession / appuyer : le cheval reste parallèle au grand côté)
    const o = g.to({ x: 0, y: 0 }), o1 = g.to({ x: 0, y: 1 });
    const ey = { x: (o1.x - o.x) / S, y: (o1.y - o.y) / S };
    return pointsAlong(poly, ds).map(p => {
      const a = p.ang * Math.PI / 180;
      const t = { x: Math.cos(a), y: Math.sin(a) };
      const nIn = { x: -t.y, y: t.x };
      const side = (ref.x - p.x) * nIn.x + (ref.y - p.y) * nIn.y >= 0 ? 1 : -1;
      let tr = `translate(${r2(p.x)},${r2(p.y)}) `;
      if (move === 'cession' || move === 'appuyer') {
        const k = t.x * ey.x + t.y * ey.y;
        const dir = Math.abs(k) > 0.2 ? { x: ey.x * Math.sign(k), y: ey.y * Math.sign(k) } : t;
        tr += `rotate(${r2(Math.atan2(dir.y, dir.x) * 180 / Math.PI)})`;
      } else if (move === 'pasdecote') {
        tr += `rotate(${r2(p.ang)}) scale(1,${side}) rotate(-90)`;   // tête vers l'extérieur
      } else {
        tr += `rotate(${r2(p.ang)}) scale(1,${side})`;
      }
      return `<g transform="${tr} scale(1.25)">${moveGlyph(move, col)}</g>`;
    }).join('');
  }

  // Angle à l'écran d'une figure (angle stocké en degrés dans le repère de la carrière, 90 = vers C)
  function symScreenAngle(sh, g) {
    if (UNROTATED.includes(sh.k)) return 0;
    const a = (typeof sh.a === 'number' ? sh.a : 90) * Math.PI / 180;
    const q0 = g.to(sh), q1 = g.to({ x: sh.x + Math.cos(a), y: sh.y + Math.sin(a) });
    return Math.atan2(q1.y - q0.y, q1.x - q0.x) * 180 / Math.PI;
  }

  function shapeSvg(sh, g, i) {
    const vis = shapeVisual(sh, g, i);
    if (!vis || sh.t === 'sym') return vis;
    const col = (GAIT[sh.g] || GAIT.trot).color;
    // les décorations s'insèrent juste avant la zone de clic (fin du groupe)
    return vis.replace(/<\/g>$/, `<g class="deco">${decorations(sh, g, col)}</g></g>`);
  }

  function shapeVisual(sh, g, i) {
    const col = (GAIT[sh.g] || GAIT.trot).color;
    const arrow = `marker-end="url(#arr-${GAIT[sh.g] ? sh.g : 'trot'})"`;
    const lateral = sh.m && sh.m !== 'droit';
    const stroke = `fill="none" stroke="${col}" stroke-width="${lateral ? 2.2 : STROKE}" stroke-linecap="round" stroke-linejoin="round"` +
      (lateral ? ' stroke-opacity=".45"' : '');
    let vis = '', hit = '';
    switch (sh.t) {
      case 'line': {
        const d = polyPath(filletPoints(sh.p, CORNER_R).map(g.to));
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
        const scol = BLACK_SYMBOLS.includes(sh.k) ? '#222' : col;
        vis = `<g transform="translate(${q.x},${q.y}) rotate(${r2(symScreenAngle(sh, g))}) scale(1.35)">${glyph(sh.k, scol)}</g>`;
        hit = `<circle class="hit-fill" cx="${q.x}" cy="${q.y}" r="18"/>`;
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
    if (drag.tool === 'sym') {
      const sh = { k: drag.k, x: drag.a.x, y: drag.a.y, a: symAngle(drag) }, q = g.to(sh);
      const scol = BLACK_SYMBOLS.includes(sh.k) ? '#222' : col;
      s = `<g opacity=".6" transform="translate(${q.x},${q.y}) rotate(${r2(symScreenAngle(sh, g))}) scale(1.35)">${glyph(sh.k, scol)}</g>`;
    } else if (drag.tool === 'free') {
      s = `<path d="${polyPath(drag.pts.map(g.to))}" ${st}/>`;
    } else if (drag.tool === 'line') {
      const all = drag.pts.concat(drag.cursor ? [drag.cursor] : []);
      s = `<path d="${polyPath(filletPoints(all, CORNER_R).map(g.to))}" ${st} stroke-dasharray="6 5"/>` +
        drag.pts.map(p => { const q = g.to(p); return `<circle cx="${q.x}" cy="${q.y}" r="3.5" fill="${col}"/>`; }).join('');
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

  // Termine la ligne en cours (points cliqués successivement)
  function finishLine() {
    if (!drag || drag.tool !== 'line') return;
    const c = state.cases.find(x => x.id === drag.caseId);
    const pts = drag.pts.filter((p, i, arr) => i === 0 || dist(p, arr[i - 1]) > 0.3);
    drag = null;
    if (!c) return;
    drawPreview(c);
    if (pts.length >= 2) mutate(c, () => c.shapes.push({ t: 'line', g: ui.gait, m: ui.move, p: pts }));
  }

  // Orientation d'une figure d'après le glissé (degrés, aimantée tous les 15°)
  function symAngle(d) {
    const vx = d.raw.x - d.a.x, vy = d.raw.y - d.a.y;
    if (Math.hypot(vx, vy) < 0.8) return 90;
    return (Math.round(Math.atan2(vy, vx) * 180 / Math.PI / 15) * 15 + 360) % 360;
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
      // clic = pose ; cliquer-glisser = orienter la figure
      r.svg.setPointerCapture(e.pointerId);
      drag = { caseId: c.id, tool: 'sym', k: tool.slice(4), a: pt(p.x, p.y), b: pt(p.x, p.y), raw };
      drawPreview(c);
      e.preventDefault();
      return;
    }
    if (tool === 'line') {
      const q = pt(p.x, p.y);
      if (!drag) {
        drag = { caseId: c.id, tool, pts: [q], cursor: q };
      } else {
        const last = drag.pts[drag.pts.length - 1];
        // double-clic, ou clic sur le dernier point : on termine
        if (e.detail >= 2 || dist(last, q) < 0.4) { finishLine(); return; }
        drag.pts.push(q);
      }
      drawPreview(c);
      e.preventDefault();
      return;
    }
    if (tool === 'arc' && drag && drag.phase === 'side') {
      const sh = { t: 'arc', g: ui.gait, m: ui.move, a: drag.a, b: drag.b, r: ui.diam / 2, side: arcSide(drag.a, drag.b, raw) };
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
    else if (drag.tool === 'line') { const p = snap(raw, c); drag.cursor = pt(p.x, p.y); }
    else { const p = snap(raw, c); drag.b = pt(p.x, p.y); drag.raw = raw; }
    drawPreview(c);
  }

  function onUp(e, c) {
    if (!drag || drag.caseId !== c.id || drag.phase === 'side' || drag.tool === 'line') return;
    const d = drag;
    let sh = null;
    if (d.tool === 'free') {
      const pts = processFree(d.pts, c);
      if (pts.length >= 2) sh = { t: 'free', g: ui.gait, m: ui.move, p: pts };
    } else if (d.tool === 'sym') {
      sh = { t: 'sym', k: d.k, g: ui.gait, x: d.a.x, y: d.a.y, a: symAngle(d) };
    } else if (d.tool === 'circle') {
      sh = { t: 'circle', g: ui.gait, m: ui.move, c: circleCenter(d.a, d.raw, ui.diam / 2, c), r: ui.diam / 2 };
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
      <textarea class="ta-text" placeholder="Mouvements, un par ligne. Ex. :&#10;A  Entrée au trot de travail&#10;X  Arrêt, immobilité, salut"></textarea>
      <textarea class="ta-note" placeholder="Commentaire / critères du juge (encadré jaune à l’impression)"></textarea>`;

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

    for (const [sel, key] of [['.ta-text', 'text'], ['.ta-note', 'note']]) {
      const ta = art.querySelector(sel);
      const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
      ta.value = c[key] || '';
      ta.oninput = () => { c[key] = ta.value; grow(); save(); };
      requestAnimationFrame(grow);
    }

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
      `<button data-tool="sym:${s.id}" title="${s.label}"><svg viewBox="-16 -16 32 32" width="22" height="22"><g transform="rotate(${UNROTATED.includes(s.id) ? 0 : -90})">${glyph(s.id, '#333')}</g></svg>${s.label}</button>`
    ).join('');
    $('#moves').innerHTML = MOVES.map(m =>
      `<button data-move="${m.id}" title="${m.label}"><svg viewBox="-13 -13 26 26" width="20" height="20">${moveGlyph(m.id, '#333')}</svg>${m.label}</button>`
    ).join('');
    $('#gaits').innerHTML = GAITS.map(g =>
      `<button data-gait="${g.id}" style="--c:${g.color}"><span class="swatch" style="background:${g.color}"></span>${g.label}</button>`
    ).join('');
    $('#diams').innerHTML = DIAMS.map(d => `<button data-diam="${d}">${d} m</button>`).join('');

    $('.toolbar').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tool) { if (drag && drag.tool === 'line') finishLine(); else cancelDrag(); ui.tool = b.dataset.tool; }
      if (b.dataset.gait) ui.gait = b.dataset.gait;
      if (b.dataset.move) {
        ui.move = b.dataset.move;
        // choisir un déplacement réactive un outil de tracé si besoin
        if (ui.tool === 'eraser' || ui.tool.startsWith('sym:')) ui.tool = 'free';
      }
      if (b.dataset.diam) ui.diam = +b.dataset.diam;
      saveUi();
      refreshToolbar();
    });
    $('#snap').checked = ui.snap;
    $('#snap').onchange = e => { ui.snap = e.target.checked; saveUi(); };

    // flèches de direction
    $('#markers').innerHTML = GAITS.map(g =>
      `<marker id="arr-${g.id}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">` +
      `<path d="M0,0L10,5L0,10z" fill="${g.color}"/></marker>`
    ).join('');

    // légende imprimée
    $('#legend').innerHTML =
      GAITS.map(g => `<span><span class="swatch" style="background:${g.color}"></span>${esc(g.label)}</span>`).join('') +
      MOVES.map(m => `<span><svg viewBox="-13 -13 26 26" width="14" height="14">${moveGlyph(m.id, '#333')}</svg>${esc(m.label)}</span>`).join('') +
      SYMBOLS.map(f => `<span><svg viewBox="-16 -16 32 32" width="16" height="16"><g transform="rotate(${UNROTATED.includes(f.id) ? 0 : -90})">${glyph(f.id, '#333')}</g></svg>${esc(f.label)}</span>`).join('');

    refreshToolbar();
  }

  function refreshToolbar() {
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === ui.tool));
    document.querySelectorAll('[data-gait]').forEach(b => b.classList.toggle('active', b.dataset.gait === ui.gait));
    document.querySelectorAll('[data-move]').forEach(b => b.classList.toggle('active', b.dataset.move === ui.move));
    const cur = $('#current');
    if (cur) {
      const gg = GAIT[ui.gait], mm = MOVES.find(m => m.id === ui.move);
      cur.innerHTML = `<span class="swatch" style="background:${gg.color}"></span><b>${esc(gg.label)}</b> · ${esc(mm.label)}`;
      cur.style.borderColor = gg.color;
    }
    document.querySelectorAll('[data-diam]').forEach(b => b.classList.toggle('active', +b.dataset.diam === ui.diam));
    $('#diam-group').style.visibility = (ui.tool === 'circle' || ui.tool === 'arc') ? 'visible' : 'hidden';
    document.body.classList.toggle('tool-eraser', ui.tool === 'eraser');
    const t = TOOLS.find(x => x.id === ui.tool);
    $('#hint').textContent = t ? t.hint
      : 'Cliquez pour poser la figure (elle s’accroche aux lettres), ou cliquez-glissez dans la direction du cheval pour l’orienter.';
  }

  // ---------------------------------------------------------------- Impression
  // Mise en page « fiche de reprise » : A4 paysage, 4 colonnes × 3 rangées par page,
  // case numérotée, carrière, mouvements (lettres | consigne), encadré jaune.
  const PER_PAGE = 12;

  function descHtml(text) {
    return text.split('\n').filter(l => l.trim()).map(l => {
      const m = l.trim().match(/^([A-Z]{1,6})(?:\s+|$)(.*)$/);
      return m
        ? `<div class="pl"><span class="pk">${esc(m[1])}</span><span>${esc(m[2])}</span></div>`
        : `<div class="pl"><span class="pk"></span><span>${esc(l.trim())}</span></div>`;
    }).join('');
  }

  function legendCell() {
    // allures, déplacements et figures réellement utilisés dans la reprise
    const used = { g: new Set(), m: new Set(), k: new Set() };
    for (const c of state.cases) for (const sh of c.shapes) {
      if (sh.g) used.g.add(sh.g);
      if (sh.t === 'sym') used.k.add(sh.k);
      else if (sh.m && sh.m !== 'droit') used.m.add(sh.m);
    }
    const gaits = GAITS.filter(g => used.g.has(g.id));
    const rows = (gaits.length ? gaits : GAITS).map(g =>
      `<div class="lg"><span class="lsq" style="background:${g.color}"></span>${esc(g.label)}</div>`).join('') +
      MOVES.filter(m => used.m.has(m.id)).map(m =>
        `<div class="lg"><svg viewBox="-13 -13 26 26" class="lic">${moveGlyph(m.id, '#333')}</svg>${esc(m.label)}</div>`).join('') +
      SYMBOLS.filter(f => used.k.has(f.id)).map(f =>
        `<div class="lg"><svg viewBox="-16 -16 32 32" class="lic"><g transform="rotate(${UNROTATED.includes(f.id) ? 0 : -90})">${glyph(f.id, '#333')}</g></svg>${esc(f.label)}</div>`).join('');
    return `<div class="pcell plegend"><div class="ptitle-lg">Code couleur</div><div class="lgrid">${rows}</div></div>`;
  }

  function buildPrint() {
    let root = $('#print-root');
    if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
    const sizes = [...new Set(state.cases.map(c => c.size))];
    const sizeTxt = sizes.length === 1 ? `20 x ${sizes[0]}` : '';
    const cells = state.cases.map((c, i) => {
      const r = refs.get(c.id);
      const svg = r.svg.cloneNode(true);
      svg.querySelector('.preview')?.remove();
      svg.querySelector('.snapind')?.remove();
      svg.removeAttribute('style');
      return `<div class="pcell">
        <div class="ptop"><div class="pnum">${i + 1}</div><div class="psvg">${svg.outerHTML}</div></div>
        <div class="pdesc">${descHtml(c.text || '')}</div>
        ${c.note && c.note.trim() ? `<div class="pnote">${esc(c.note.trim()).replace(/\n/g, '<br>')}</div>` : ''}
      </div>`;
    });
    cells.push(legendCell());
    const pages = [];
    for (let i = 0; i < cells.length; i += PER_PAGE) pages.push(cells.slice(i, i + PER_PAGE));
    const title = esc(state.title || 'Reprise');
    root.innerHTML = pages.map((pc, n) => `
      <section class="ppage">
        <header class="phead">
          <span class="ptitle">${title}</span><span class="psize">${sizeTxt}</span>
          <span class="ppnum">Page ${n + 1}${pages.length > 1 ? ' / ' + pages.length : ''}</span>
        </header>
        <div class="pgrid">${pc.join('')}${'<div class="pcell pempty"></div>'.repeat(PER_PAGE - pc.length)}</div>
      </section>`).join('');
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
    $('#btn-print').onclick = () => { buildPrint(); window.print(); };
    window.addEventListener('beforeprint', buildPrint);   // aussi pour Ctrl+P
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
      if (e.key === 'Enter' && drag && drag.tool === 'line') { e.preventDefault(); finishLine(); }
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
