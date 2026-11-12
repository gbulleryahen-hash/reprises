'use strict';
/*
 * Éditeur de reprises de dressage
 * Copyright (C) 2026 gbulleryahen-hash
 *
 * Ce programme est un logiciel libre, distribué sous licence GNU GPL version 3
 * ou ultérieure. Voir le fichier LICENSE.
 */
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

  // Allures : le MOTIF de la ligne dit l'allure, la COULEUR (+ épaisseur, espacement) dit l'intensité.
  // Couleurs choisies pour rester distinctes une fois imprimées en niveaux de gris.
  const LEVELS = [
    { id: 'ras',  label: 'rassemblé',  short: 'ras.',  color: '#F2B01E', w: 2.6, f: 0.85 },
    { id: 'trav', label: 'de travail', short: 'trav.', color: '#4A9BE8', w: 2.9, f: 1.0 },
    { id: 'moy',  label: 'moyen',      short: 'moy.',  color: '#007F5F', w: 3.2, f: 1.1 },
    { id: 'all',  label: 'allongé',    short: 'all.',  color: '#18265A', w: 3.5, f: 1.2 },
  ];
  const KINDS = [
    { id: 'pas', label: 'Pas' }, { id: 'trot', label: 'Trot' },
    { id: 'galopD', label: 'Galop à droite' }, { id: 'galopG', label: 'Galop à gauche' },
  ];
  const gaitName = (k, l) => k.id === 'pas'
    ? { ras: 'Pas rassemblé', trav: 'Pas de travail', moy: 'Pas moyen', all: 'Pas allongé' }[l.id]
    : `${k.label} ${l.label}`;
  const GAITS = [];
  for (const k of KINDS) for (const l of LEVELS) {
    GAITS.push({ id: `${k.id}_${l.id}`, kind: k.id, lv: l.id, label: gaitName(k, l), color: l.color, w: l.w, f: l.f });
  }
  GAITS.push(
    { id: 'piaffer', kind: 'piaffer', lv: 'ras',  label: 'Piaffer', color: '#D32F2F', w: 2.9, f: 0.9 },
    { id: 'passage', kind: 'passage', lv: 'ras',  label: 'Passage', color: '#F2B01E', w: 2.6, f: 0.85 },
    { id: 'reculer', kind: 'reculer', lv: 'trav', label: 'Reculer', color: '#7B1FA2', w: 2.9, f: 1.0 },
  );
  const SPECIAL_GAITS = ['piaffer', 'passage', 'reculer'];
  const GAIT = Object.fromEntries(GAITS.map(g => [g.id, g]));
  // anciens identifiants (fichiers enregistrés avant le changement de code couleur)
  const GAIT_ALIAS = { pas: 'pas_moy', trot: 'trot_trav', galop_ras: 'galopD_ras', galop: 'galopD_trav', galop_all: 'galopD_all' };
  const gaitOf = id => GAIT[id] || GAIT[GAIT_ALIAS[id]] || GAIT.trot_trav;
  const shapeGait = sh => (sh.m === 'reculer' ? GAIT.reculer : gaitOf(sh.g));

  const TOOLS = [
    { id: 'free',   label: '✎ Main levée', hint: 'Dessinez librement : le tracé est lissé et ses extrémités s’accrochent aux lettres.' },
    { id: 'line',   label: '╱ Ligne',      hint: 'Cliquez point après point (lettres, coins…). Double-clic ou Entrée pour terminer, Échap ou clic droit pour annuler. Les angles sont arrondis en arcs de 6 m.' },
    { id: 'circle', label: '◯ Cercle',     hint: '1) Cliquez sur la lettre où le cercle touche la piste et glissez vers l’intérieur, relâchez. 2) Cliquez du côté où le cheval part (ex. depuis E : vers C ou vers A) : les flèches suivent la souris. Échap pour annuler.' },
    { id: 'arc',    label: '◠ Arc',        hint: 'Demi-cercle du diamètre choisi : cliquez au départ et glissez dans la direction voulue (l’arrivée se place toute seule), relâchez, puis cliquez du côté de l’arc. Maintenez Maj pour un arc libre jusqu’à une lettre. Échap ou clic droit pour annuler.' },
    { id: 'eraser', label: '⌫ Gomme',      hint: 'Cliquez sur un tracé ou un symbole pour le supprimer.' },
  ];

  const TOOL_ICONS = {
    free: 'M4 17c3-8 6 4 9-3s5-6 7-4', line: 'M5 19L19 5', circle: 'M12 5a7 7 0 1 0 0.01 0',
    arc: 'M5 17a7 7 0 0 1 14 0', eraser: 'M4 15l8-8 6 6-6 6H8zM10 19h10',
  };
  const toolName = t => t.label.replace(/^\S+\s/, '');

  // Figures ponctuelles : clic pour poser, cliquer-glisser pour orienter
  const SYMBOLS = [
    { id: 'halt',        label: 'Arrêt' },
    { id: 'transition',  label: 'Transition' },
    { id: 'dt_hanches',  label: 'Demi-tour sur les hanches' },
    { id: 'dt_epaules',  label: 'Demi-tour sur les épaules' },
    { id: 'qt_hanches',  label: 'Quart de tour sur les hanches' },
    { id: 'qt_epaules',  label: 'Quart de tour sur les épaules' },
    { id: 'pirouette_g', label: 'Pirouette à gauche' },
    { id: 'pirouette_d', label: 'Pirouette à droite' },
    { id: 'simple',      label: 'Changement de pied simple' },
    { id: 'une_main',    label: 'Guides / rênes dans une main' },
    { id: 'cone',        label: 'Cône' },
    { id: 'barre',       label: 'Barre au sol' },
    { id: 'croisillon',  label: 'Croisillon' },
  ];
  const UNROTATED = ['halt', 'cone', 'simple', 'une_main'];
  const GEAR = ['cone', 'barre', 'croisillon'];   // section « Matériel »
  const BLACK_SYMBOLS = ['halt', 'transition', 'cone', 'barre', 'croisillon'];
  // figures de rotation : plus grandes sur la carrière (pas dans le panneau)
  const BIG_SYMBOLS = ['pirouette_g', 'pirouette_d', 'pirouette', 'dt_hanches', 'dt_epaules', 'qt_hanches', 'qt_epaules'];
  const symScale = k => r2(1.35 * K() * (BIG_SYMBOLS.includes(k) ? 1.35 : 1));

  // Types de déplacement : restent enclenchés et décorent automatiquement le parcours
  // Ordre et noms du panneau ; wall = trait beige de la paroi sur l'icône (jamais sur le dessin)
  const MOVES = [
    { id: 'droit',     label: 'Droit' },
    { id: 'shoulder',  label: 'Épaule en dedans', wall: true },
    { id: 'ced',       label: 'Contre-épaule en dedans', wall: true },
    { id: 'hdedans',   label: 'Travers', wall: true },
    { id: 'hdehors',   label: 'Renvers', wall: true },
    { id: 'ea',        label: 'Épaule devant' },
    { id: 'cession',   label: 'Déplacement latéral (cession à la jambe)' },
    { id: 'appuyer',   label: 'Appuyer' },
    { id: 'pasdecote', label: 'Pas de côté' },
  ];
  const MOVE_IDS = MOVES.map(m => m.id);

  const DIAMS = [6, 10, 12, 15, 20, 30, 40];

  // Position des lettres (distance depuis A, en mètres)
  const LETTERS = {
    // 20 × 40 complet (comme les reprises Club / Poney) : lettres espacées de 7 m
    40: {
      wall:   [['K', 'F', 6], ['V', 'P', 13], ['E', 'B', 20], ['S', 'R', 27], ['H', 'M', 34]],
      center: [['D', 6], ['L', 13], ['X', 20], ['I', 27], ['G', 34]],
    },
    60: {
      wall:   [['K', 'F', 6], ['V', 'P', 18], ['E', 'B', 30], ['S', 'R', 42], ['H', 'M', 54]],
      center: [['D', 6], ['L', 18], ['X', 30], ['I', 42], ['G', 54]],
    },
    // 80 × 40 (rectangle d'attelage) : lettres à 10 m des coins, puis tous les 15 m
    80: {
      wall:   [['K', 'F', 10], ['V', 'P', 25], ['E', 'B', 40], ['S', 'R', 55], ['H', 'M', 70]],
      center: [['D', 10], ['L', 25], ['X', 40], ['I', 55], ['G', 70]],
    },
  };

  // Largeur de la carrière selon sa longueur : 40 × 20, 60 × 20, 80 × 40
  const arenaW = size => (size === 80 ? 40 : 20);
  const sizeLabel = size => `${size} × ${arenaW(size)}`;

  // ---------------------------------------------------------------- Utilitaires
  const $ = sel => document.querySelector(sel);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const r2 = v => Math.round(v * 100) / 100;
  const pt = (x, y) => ({ x: r2(x), y: r2(y) });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Géométrie d'une carrière selon taille et orientation
  // orient : 'v' (C en haut), 'v2' (C en bas), 'h' (C à droite), 'h2' (C à gauche)
  function geom(size, orient) {
    const L = size, v = !String(orient).startsWith('h'), flip = String(orient).endsWith('2');
    const w = arenaW(size);
    const W = v ? w * S + 2 * M : L * S + 2 * M;
    const H = v ? L * S + 2 * M : w * S + 2 * M;
    // Verticale : A en bas, C en haut. Horizontale : A à gauche, C à droite, E en haut.
    const to0 = p => v ? { x: M + p.x * S, y: M + (L - p.y) * S } : { x: M + p.y * S, y: M + p.x * S };
    const from0 = q => v ? { x: (q.x - M) / S, y: L - (q.y - M) / S } : { x: (q.y - M) / S, y: (q.x - M) / S };
    // carrière inversée = demi-tour (rotation de 180°) du dessin
    const turn = q => ({ x: W - q.x, y: H - q.y });
    return {
      L, v, W, H, w,
      to: flip ? p => turn(to0(p)) : to0,
      from: flip ? q => from0(turn(q)) : from0,
    };
  }

  const quarterXs = size => [arenaW(size) / 4, arenaW(size) * 3 / 4];

  function snapPoints(size) {
    const L = size, d = LETTERS[size], w = arenaW(size), h = w / 2;
    const pts = [
      { n: 'A', x: h, y: 0 }, { n: 'C', x: h, y: L },
      // coins de la piste
      { n: 'coin', x: 0, y: 0 }, { n: 'coin', x: w, y: 0 },
      { n: 'coin', x: 0, y: L }, { n: 'coin', x: w, y: L },
    ];
    d.wall.forEach(([l, r, y]) => pts.push({ n: l, x: 0, y }, { n: r, x: w, y }));
    d.center.forEach(([n, y]) => pts.push({ n, x: h, y }));
    // lignes du quart, à hauteur des lettres et aux extrémités
    for (const y of [0, L, ...d.wall.map(q => q[2])]) for (const qx of quarterXs(size)) pts.push({ n: 'quart', x: qx, y });
    return pts;
  }

  // extrémités des tracés déjà dessinés dans la figure (pour enchaîner les tracés)
  function shapeEnds(c) {
    const out = [];
    for (const sh of c.shapes) {
      if ((sh.t === 'line' || sh.t === 'free') && sh.p && sh.p.length) out.push(sh.p[0], sh.p[sh.p.length - 1]);
      else if (sh.t === 'arc') out.push(sh.a, sh.b);
      else if (sh.t === 'circle' && sh.a) out.push(sh.a);
    }
    return out.filter(Boolean).map(q => ({ n: 'fin', x: q.x, y: q.y }));
  }
  function snap(p, c) {
    if (!ui.snap) return { x: p.x, y: p.y };
    let best = null, bd = SNAP_R;
    for (const s of shapeEnds(c).concat(snapPoints(c.size))) {
      const d = dist(p, s);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) return { x: best.x, y: best.y, n: best.n };
    // sinon : accroche n'importe où le long des lignes (piste des grands côtés, quarts, ligne du milieu)…
    const w = arenaW(c.size);
    if (p.y >= 0 && p.y <= c.size) {
      for (const qx of [0, w / 4, w / 2, w * 3 / 4, w]) if (Math.abs(p.x - qx) < 0.6) return { x: qx, y: p.y, n: 'ligne' };
    }
    // … et des petits côtés (A et C)
    if (p.x >= 0 && p.x <= w) {
      for (const qy of [0, c.size]) if (Math.abs(p.y - qy) < 0.6) return { x: p.x, y: qy, n: 'ligne' };
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
      else if (a.x >= arenaW(c.size) - 0.5) [vx, vy] = [-1, 0];
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
      // repère écran vu de dessus : cheval tourné vers +x, sa gauche est vers -y
      case 'pirouette_g':
        return ln('M0,0H7', color) + dot(8, 0, color, 2) + dot(0, 0, '#222', 2.6) + arcArrow(12, 25, -285, color);
      case 'pirouette_d':
        return ln('M0,0H7', color) + dot(8, 0, color, 2) + dot(0, 0, '#222', 2.6) + arcArrow(12, -25, 285, color);
      case 'pirouette':   // ancien symbole (fichiers déjà enregistrés)
        return ln('M0,0H7', color) + dot(8, 0, color, 2) + dot(0, 0, '#222', 2.6) + arcArrow(12, -140, 140, color, true);
      case 'simple':   // couleur fixe (cyan), comme sur les fiches
        return `<circle r="8" fill="#26c6da" stroke="#fff" stroke-width="1.5"/>`;
      case 'une_main':   // petite main (paume + doigts + pouce)
        return `<g fill="${color}">` +
          `<rect x="-6.6" y="-12" width="3.1" height="11" rx="1.55"/>` +
          `<rect x="-3.1" y="-13.5" width="3.1" height="12.5" rx="1.55"/>` +
          `<rect x="0.4" y="-13" width="3.1" height="12" rx="1.55"/>` +
          `<rect x="3.9" y="-11" width="3.1" height="10" rx="1.55"/>` +
          `<rect x="-6.8" y="-3.5" width="14" height="13" rx="4.5"/>` +
          `</g><path d="M-5,4.5L-10.5,-1.5" stroke="${color}" stroke-width="3.3" stroke-linecap="round" fill="none"/>`;
      case 'transition':   // barre en travers du tracé + petite flèche : changement d'allure
        return ln('M-3,-10V10', color, 3.4) + `<path d="M2,-4.5L9,0L2,4.5Z" fill="${color}"/>`;
      case 'piaffer':    // piaffer posé sur place : une ellipse
        return `<ellipse rx="13" ry="4.6" fill="${color}"/>`;
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
  const MOVE_GEOM = {
    droit:     { d: 'M-5,-5.5L3,0L-5,5.5', w: 3 },
    shoulder:  { d: 'M-8,0L2,3.5Q5,5 5.5,8.5', dots: [[5.5, 9]] },
    ea:        { d: 'M-9,0H5', dots: [[7.5, 3.6]] },
    ced:       { d: 'M-8,0L2,-3.5Q5,-5 5.5,-8.5', dots: [[5.5, -9]] },
    hdedans:   { d: 'M-7,7L2,0Q5,-2 8,-0.5', dots: [[8.5, -0.3]] },
    hdehors:   { d: 'M-7,-7L2,0Q5,2 8,0.5', dots: [[8.5, 0.3]] },
    cession:   { d: 'M-9,0H8M3,-4L8.5,0L3,4', w: 2.2 },
    appuyer:   { d: 'M-13,0H11M5.5,-4.2L11.5,0L5.5,4.2M-9,-3.6L-4,3.6M-9,3.6L-4,-3.6', w: 2.2 },
    pasdecote: { d: 'M-11,0H11M-2.6,-3.8L2.6,3.8M-2.6,3.8L2.6,-3.8', w: 2.2 },
    reculer:   { d: 'M-8,0H8M-4,-3.5L-8.5,0L-4,3.5M4,-3.5L8.5,0L4,3.5', w: 2 },
  };
  function moveGlyph(kind, color) {
    const G = MOVE_GEOM[kind];
    if (!G) return '';
    return ln(G.d, color, G.w || 2.4) + (G.dots || []).map(([x, y]) => dot(x, y, color)).join('');
  }
  // Découpe un chemin simple (M, L, H, Q) en polylignes de points rapprochés
  function glyphPolys(d) {
    const polys = []; let cur = null, x = 0, y = 0;
    const push = (nx, ny) => {   // points intermédiaires : le symbole pourra suivre une courbe
      const n = Math.max(1, Math.ceil(Math.hypot(nx - x, ny - y) / 1.5));
      for (let i = 1; i <= n; i++) cur.push([x + (nx - x) * i / n, y + (ny - y) * i / n]);
      x = nx; y = ny;
    };
    const re = /([MLHQ])([^MLHQ]*)/g; let m;
    while ((m = re.exec(d))) {
      const v = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (m[1] === 'M') { x = v[0]; y = v[1]; cur = [[x, y]]; polys.push(cur); }
      else if (m[1] === 'L') push(v[0], v[1]);
      else if (m[1] === 'H') push(v[0], y);
      else if (m[1] === 'Q') {
        const [cx, cy, ex, ey] = v, x0 = x, y0 = y;
        for (let i = 1; i <= 8; i++) {
          const t = i / 8, u = 1 - t;
          cur.push([u * u * x0 + 2 * u * t * cx + t * t * ex, u * u * y0 + 2 * u * t * cy + t * t * ey]);
        }
        x = ex; y = ey;
      }
    }
    return polys;
  }
  function moveExtent(kind) {
    const G = MOVE_GEOM[kind]; if (!G) return [0, 0];
    const xs = glyphPolys(G.d).flat().map(q => q[0]).concat((G.dots || []).map(q => q[0]));
    return [Math.min(...xs), Math.max(...xs)];
  }
  const MOVE_SC = 1.65;   // taille des symboles de déplacement sur le dessin (× curseur)
  // longueur laissée libre dans le motif pour un symbole de déplacement
  const lateralSlot = kind => { const [a, b] = moveExtent(kind); return ((b - a) * MOVE_SC + 6) * K(); };

  // ---------------------------------------------------------------- État
  const newCase = (size = 60, orient = 'v2') => ({ id: uid(), size, orient, textL: '', textR: '', note: '', shapes: [] });
  const newReprise = () => ({ version: 3, title: '', cases: [newCase()] });

  // Repère des dessins (version 3, comme la version 1) : 0 = piste, clôture dessinée 1 m plus loin.
  // - version 2 (essai du 12/11) : 0 = clôture, piste à 1 m → on revient au repère de la piste ;
  // - 80 × 40 enregistré avant les lettres d'attelage : lettres déplacées (6, 23… → 10, 25…).
  const interp = (v, from, to) => {
    for (let i = 0; i < from.length - 1; i++) {
      if (v <= from[i + 1] || i === from.length - 2) return to[i] + (v - from[i]) * (to[i + 1] - to[i]) / (from[i + 1] - from[i]);
    }
    return v;
  };
  function convertShapes(shapes, size, version) {
    const w = arenaW(size), L = size, q = w / 4, T = 1;
    let fx = x => x, fy = y => y;
    if (version === 2) {
      const f = size === 80 ? 10 : 6;
      fx = x => interp(x, [T, q, w - q, w - T], [0, q, w - q, w]);
      fy = y => interp(y, [T, f, L - f, L - T], [0, f, L - f, L]);
    } else if (size === 80) {
      fy = y => interp(y, [0, 6, 23, 40, 57, 74, 80], [0, 10, 25, 40, 55, 70, 80]);
    } else return shapes;
    const P = o => (o && typeof o.x === 'number' ? { ...o, x: r2(fx(o.x)), y: r2(fy(o.y)) } : o);
    return shapes.map(sh => {
      const n = { ...sh };
      if (Array.isArray(n.p)) n.p = n.p.map(P);
      if (n.t === 'circle' && n.a && n.c) {
        // cercle : on déplace son point de contact, le centre suit (le rayon ne change pas)
        const a2 = P(n.a);
        n.c = { x: r2(a2.x + n.c.x - n.a.x), y: r2(a2.y + n.c.y - n.a.y) };
        n.a = a2;
      } else {
        if (n.a && typeof n.a === 'object') n.a = P(n.a);
        if (n.b) n.b = P(n.b);
        if (n.c) n.c = P(n.c);
      }
      if (n.t === 'sym') { const m = P(n); n.x = m.x; n.y = m.y; }
      return n;
    });
  }

  // Mouvements sur deux colonnes : lettres (textL) | consignes (textR), ligne par ligne.
  // Les anciens fichiers (un seul champ « text ») sont découpés automatiquement.
  function splitText(c) {
    if (typeof c.textL === 'string' || typeof c.textR === 'string') {
      return { textL: String(c.textL || ''), textR: String(c.textR || '') };
    }
    const L = [], R = [];
    for (const line of String(c.text || '').split('\n')) {
      const m = line.trim().match(/^([A-Z]{1,6})(?:\s+|$)(.*)$/);
      L.push(m ? m[1] : ''); R.push(m ? m[2] : line.trim());
    }
    while (L.length && !L[L.length - 1] && !R[R.length - 1]) { L.pop(); R.pop(); }
    return { textL: L.join('\n'), textR: R.join('\n') };
  }
  // taille des symboles (curseur), 1 = taille normale
  const clampScale = v => (typeof v === 'number' && v >= 0.5 && v <= 2 ? v : 1);
  // caseK : correction par carrière pour que traits et symboles aient à l'écran la même taille
  // que sur une 60 × 20 (une vignette de taille fixe agrandit davantage une petite carrière).
  let caseK = 1;
  const K = () => 0.85 * clampScale(state.symScale) * caseK;   // 100 % = ancienne taille à 85 %
  function sizeFactor(c) {
    const g = geom(c.size, c.orient), ref = geom(60, String(c.orient).startsWith('h') ? 'h' : 'v');
    let w = 380, h = 460;
    const r = refs.get(c.id);
    if (r) { const b = r.svg.getBoundingClientRect(); if (b.width > 0 && b.height > 0) { w = b.width; h = b.height; } }
    const fit = x => Math.min(w / x.W, h / x.H);
    return fit(ref) / fit(g);
  }
  // largeur de la colonne des lettres, en % (séparateur mobile)
  const clampSplit = v => (typeof v === 'number' && v >= 8 && v <= 60 ? v : 18);
  const applySplit = () => document.documentElement.style.setProperty('--split', clampSplit(state.split) + '%');

  function normalize(data) {
    if (!data || !Array.isArray(data.cases)) throw new Error('Fichier de reprise invalide');
    return {
      version: 3,
      title: String(data.title || ''),
      page: data.page === 'portrait' ? 'portrait' : 'paysage',
      split: clampSplit(data.split),
      symScale: clampScale(data.symScale),
      cases: data.cases.map(c => ({
        id: uid(),
        size: [40, 60, 80].includes(c.size) ? c.size : 60,
        orient: ['v', 'v2', 'h', 'h2'].includes(c.orient) ? c.orient : 'v',
        ...splitText(c),
        note: String(c.note || ''),
        shapes: !Array.isArray(c.shapes) ? []
          : data.version === 3 ? c.shapes
          : convertShapes(c.shapes, [40, 60, 80].includes(c.size) ? c.size : 60, data.version),
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
    updateTotal();
  }

  // Longueur totale (m) de tous les tracés de toutes les figures
  function totalLength() {
    let m = 0;
    for (const c of state.cases) {
      const g = geom(c.size, c.orient);
      for (const sh of c.shapes) {
        if (sh.t === 'sym' || shapeGait(sh).kind === 'piaffer') continue;   // le piaffer est sur place
        m += sh.t === 'circle' ? 2 * Math.PI * sh.r : polyLength(screenPolyline(sh, g)) / S;
      }
    }
    return Math.round(m);
  }
  // Temps estimé : vitesses moyennes approximatives (m/s) et durées des figures (s).
  // Ce sont des ordres de grandeur, à ajuster selon le cheval et le niveau.
  const SPEED = {
    pas:  { ras: 1.4, trav: 1.6, moy: 1.7, all: 2.0 },
    trot: { ras: 2.9, trav: 3.4, moy: 3.9, all: 4.5 },
    galop: { ras: 4.2, trav: 5.0, moy: 5.8, all: 6.5 },
    passage: 1.5, reculer: 0.7,
  };
  const SYM_TIME = { halt: 6, piaffer: 10, pirouette_g: 6, pirouette_d: 6, pirouette: 6,
    dt_hanches: 4, dt_epaules: 4, qt_hanches: 2, qt_epaules: 2, simple: 4 };
  function speedOf(gait) {
    if (gait.kind === 'passage' || gait.kind === 'reculer') return SPEED[gait.kind];
    if (gait.kind === 'piaffer') return 0;
    const k = gait.kind.startsWith('galop') ? 'galop' : gait.kind;
    return (SPEED[k] || SPEED.trot)[gait.lv] || 3.4;
  }
  function totalTime() {
    let t = 0;
    for (const c of state.cases) {
      const g = geom(c.size, c.orient);
      for (const sh of c.shapes) {
        if (sh.t === 'sym') { t += SYM_TIME[sh.k] || 0; continue; }
        const gait = shapeGait(sh), v = speedOf(gait);
        if (gait.kind === 'piaffer') { t += SYM_TIME.piaffer; continue; }
        const m = sh.t === 'circle' ? 2 * Math.PI * sh.r : polyLength(screenPolyline(sh, g)) / S;
        if (v > 0) t += m / v;
      }
    }
    return Math.round(t);
  }
  const fmtTime = t => (t >= 60 ? `${Math.floor(t / 60)} min ${String(t % 60).padStart(2, '0')} s` : `${t} s`);
  const totalText = () => `(${totalLength().toLocaleString('fr-FR')} m · ≈ ${fmtTime(totalTime())})`;
  function updateTotal() {
    const el = document.getElementById('total-len');
    if (el) el.textContent = totalText();
    // le champ du titre prend la largeur de son texte, pour que la longueur soit juste à côté
    const t = document.getElementById('title');
    if (t) t.size = Math.max(16, (t.value || '').length + 2);
  }

  let state = load() || newReprise();
  if (!state.cases.length) state.cases.push(newCase());
  // Réglages de la barre d'outils : ils restent enclenchés (et sont mémorisés)
  const UI_KEY = 'reprises.outils';
  const ui = { tool: 'line', gait: 'trot_trav', move: 'droit', diam: 10, snap: true };
  try {
    const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    // l'outil n'est pas repris d'une visite à l'autre : on démarre toujours sur « Ligne »
    if (saved.gait) ui.gait = gaitOf(saved.gait).id;
    if (MOVE_IDS.includes(saved.move)) ui.move = saved.move;
    if (DIAMS.includes(saved.diam)) ui.diam = saved.diam;
    if (typeof saved.snap === 'boolean') ui.snap = saved.snap;
  } catch { /* rien */ }
  const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* rien */ } };
  const history = new Map();   // id de case -> piles d'états précédents
  const refs = new Map();      // id de case -> éléments DOM
  let drag = null;
  let lastCaseId = state.cases[0].id;

  const redoStack = new Map();   // id de case -> états annulés (pour « Restaurer »)
  function mutate(c, fn) {
    const h = history.get(c.id) || [];
    h.push(JSON.stringify(c.shapes));
    if (h.length > 60) h.shift();
    history.set(c.id, h);
    redoStack.delete(c.id);       // une nouvelle action efface ce qui pouvait être restauré
    fn();
    save();
    renderShapes(c);
  }
  function undo(c) {
    const h = history.get(c.id);
    if (!h || !h.length) return;
    const r = redoStack.get(c.id) || [];
    r.push(JSON.stringify(c.shapes));
    redoStack.set(c.id, r);
    c.shapes = JSON.parse(h.pop());
    save();
    renderShapes(c);
  }
  function redo(c) {
    const r = redoStack.get(c.id);
    if (!r || !r.length) return;
    const h = history.get(c.id) || [];
    h.push(JSON.stringify(c.shapes));
    history.set(c.id, h);
    c.shapes = JSON.parse(r.pop());
    save();
    renderShapes(c);
  }

  // ---------------------------------------------------------------- Rendu carrière
  function arenaSvg(c, g) {
    const L = c.size, d = LETTERS[c.size];
    // Le bord est dessiné à PAD mètres à l'extérieur de la piste :
    // les points d'accroche (x = 0 / largeur, y = 0 / L) restent sur la piste.
    const P = PAD, w = g.w, h = w / 2;
    const p0 = g.to({ x: -P, y: -P }), p1 = g.to({ x: w + P, y: L + P });
    const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
    const rw = Math.abs(p1.x - p0.x), rh = Math.abs(p1.y - p0.y);
    let s = `<rect class="arena" x="${x}" y="${y}" width="${rw}" height="${rh}"/>`;
    const a = g.to({ x: h, y: -P }), cc = g.to({ x: h, y: L + P });
    s += `<line class="centerline" x1="${a.x}" y1="${a.y}" x2="${cc.x}" y2="${cc.y}"/>`;
    for (const qx of quarterXs(c.size)) {
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
      s += tick({ x: w + P, y: yy }, { x: w + P + 0.7, y: yy }) + label(r, { x: w + P + 1.9, y: yy });
    }
    for (const [n, yy] of d.center) s += label(n, { x: h, y: yy }, 'cletter');
    s += label('A', { x: h, y: -P - 1.9 }) + label('C', { x: h, y: L + P + 1.9 });
    return s;
  }

  // Points (écran) le long du tracé, pour y poser les flèches / symboles
  function screenPolyline(sh, g) {
    switch (sh.t) {
      case 'line': return filletPoints(sh.p, CORNER_R).map(g.to);
      case 'arc': return arcPoints(sh.a, sh.b, sh.r, sh.side).map(g.to);
      case 'circle': {
        if (sh.dir) return circlePoints(sh).map(g.to);
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

  // Cercle parcouru depuis son point de départ, dans le sens choisi (dir = +1 / -1)
  function circlePoints(sh) {
    const t0 = Math.atan2(sh.a.y - sh.c.y, sh.a.x - sh.c.x);
    return Array.from({ length: 97 }, (_, k) => {
      const t = t0 + sh.dir * k / 96 * Math.PI * 2;
      return { x: sh.c.x + sh.r * Math.cos(t), y: sh.c.y + sh.r * Math.sin(t) };
    });
  }
  // Sens de rotation d'après la position de la souris par rapport au point de départ
  function circleDir(a, ctr, cursor) {
    const t0 = Math.atan2(a.y - ctr.y, a.x - ctr.x);
    const tan = { x: -Math.sin(t0), y: Math.cos(t0) };
    return (cursor.x - a.x) * tan.x + (cursor.y - a.y) * tan.y >= 0 ? 1 : -1;
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

  // ---------------------------------------------------------------- Motifs des allures
  // Le long d'une polyligne (unités écran) : pas = 4 points + flèche ; trot = 2 tirets + flèche ;
  // galop = 2 points + 1 tiret + demi-flèche (côté droit ou gauche) ; passage = vague + flèche ;
  // piaffer = ellipses ; reculer = doubles flèches. single : un seul motif, centré (icônes).
  // slot > 0 : laisse après chaque motif une place libre (pour le symbole d'un déplacement latéral)
  // et renvoie les distances de ces places dans « slots ».
  function gaitMotif(poly, gait, sc, single, slot) {
    const segs = []; let L = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i], b = poly[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 1e-6) { segs.push({ a, b, len, start: L }); L += len; }
    }
    const sw = r2(gait.w * sc);
    if (!segs.length) return { s: '', f: '', w: sw, c: gait.color };
    const at = d => {
      d = Math.max(0, Math.min(L, d));
      let sg = segs[segs.length - 1];
      for (const x of segs) { if (d <= x.start + x.len) { sg = x; break; } }
      const t = (d - sg.start) / sg.len;
      return { x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t,
        tx: (sg.b.x - sg.a.x) / sg.len, ty: (sg.b.y - sg.a.y) / sg.len };
    };
    const u = 6.5 * gait.f * sc, A = (4 + gait.w * 1.4) * sc, W = (2.2 + gait.w * 0.9) * sc;
    let S = '', F = '';
    const dot = d => {   // un peu plus gros que la moitié du trait : à l'œil, il paraît de même largeur
      const p = at(d), r = sw * 0.62;
      F += `M${r2(p.x - r)},${r2(p.y)}a${r2(r)},${r2(r)} 0 1 0 ${r2(2 * r)},0a${r2(r)},${r2(r)} 0 1 0 ${r2(-2 * r)},0Z`;
    };
    const dash = (d0, d1) => { const a = at(d0), b = at(d1); S += `M${r2(a.x)},${r2(a.y)}L${r2(b.x)},${r2(b.y)}`; };
    const wave = (d0, d1, amp) => {
      const N = 24;
      for (let i = 0; i <= N; i++) {
        const p = at(d0 + (d1 - d0) * i / N), o = amp * Math.sin(4 * Math.PI * i / N);
        S += (i ? 'L' : 'M') + r2(p.x - p.ty * o) + ',' + r2(p.y + p.tx * o);
      }
    };
    const arrow = (d0, half, back) => {
      const b = at(d0), k = back ? -1 : 1, tx = b.tx * k, ty = b.ty * k, w = half ? W * 1.35 : W;
      const tip = { x: b.x + tx * A, y: b.y + ty * A }, rx = -ty, ry = tx;   // (rx, ry) : côté droit du cheval
      const p1 = { x: b.x + rx * w, y: b.y + ry * w }, p2 = { x: b.x - rx * w, y: b.y - ry * w };
      const pts = half === 'R' ? [tip, p1, b] : half === 'L' ? [tip, b, p2] : [tip, p1, p2];
      F += 'M' + pts.map(q => `${r2(q.x)},${r2(q.y)}`).join('L') + 'Z';
    };
    const erx = (9 + gait.w) * sc, ery = (3.2 + gait.w * 0.4) * sc;
    const ellipse = d => {
      const p = at(d), ang = r2(Math.atan2(p.ty, p.tx) * 180 / Math.PI);
      const ax = p.x - p.tx * erx, ay = p.y - p.ty * erx, bx = p.x + p.tx * erx, by = p.y + p.ty * erx;
      F += `M${r2(ax)},${r2(ay)}A${r2(erx)},${r2(ery)} ${ang} 1 0 ${r2(bx)},${r2(by)}A${r2(erx)},${r2(ery)} ${ang} 1 0 ${r2(ax)},${r2(ay)}Z`;
    };
    const K = {
      pas:     { len: 3.9 * u + A, draw: s0 => { dot(s0); dot(s0 + u); dot(s0 + 2 * u); dot(s0 + 3 * u); arrow(s0 + 3.9 * u); } },
      trot:    { len: 4.8 * u + A, draw: s0 => { dash(s0, s0 + 1.6 * u); dash(s0 + 2.4 * u, s0 + 4 * u); arrow(s0 + 4.8 * u); } },
      galopD:  { len: 4.3 * u + A, draw: s0 => { dot(s0); dot(s0 + u); dash(s0 + 2 * u, s0 + 3.5 * u); arrow(s0 + 4.3 * u, 'R'); } },
      galopG:  { len: 4.3 * u + A, draw: s0 => { dot(s0); dot(s0 + u); dash(s0 + 2 * u, s0 + 3.5 * u); arrow(s0 + 4.3 * u, 'L'); } },
      passage: { len: 4.6 * u + A, draw: s0 => { wave(s0, s0 + 3.8 * u, (1.8 + gait.w * 0.5) * sc); arrow(s0 + 4.6 * u); } },
      piaffer: { len: 2 * erx, draw: s0 => ellipse(s0 + erx) },
      reculer: { len: 2 * A + 2.4 * u, draw: s0 => { arrow(s0 + A, null, true); dash(s0 + A, s0 + A + 2.4 * u); arrow(s0 + A + 2.4 * u); } },
    }[gait.kind] || null;
    if (!K) return { s: '', f: '', w: sw, c: gait.color };
    const gap = gait.kind === 'piaffer' ? erx : 1.3 * u + 2 * sc;
    if (slot > 0 && gait.kind !== 'piaffer') {
      // motif, place libre, motif, place libre… en alternance
      const gs = gap * 0.35;                      // symbole tout près des flèches
      const unit = K.len + slot + 2 * gs;
      const count = Math.max(1, Math.floor((L + 2 * gs) / unit));
      let st = Math.max(0, (L - (count * unit - 2 * gs)) / 2);
      const slots = [];
      for (let i = 0; i < count; i++) {
        K.draw(st);
        const c = st + K.len + gs + slot / 2;
        if (c < L - slot / 4) slots.push(c);
        st += unit;
      }
      if (!slots.length) slots.push(L / 2);
      return { s: S, f: F, w: sw, c: gait.color, slots };
    }
    if (gait.kind === 'piaffer') single = true;   // le piaffer est sur place : une seule ellipse
    const count = single ? 1 : Math.max(1, Math.floor((L - 2 + gap) / (K.len + gap)));
    let st = Math.max(0, (L - (count * (K.len + gap) - gap)) / 2);
    for (let i = 0; i < count; i++) { K.draw(st); st += K.len + gap; }
    return { s: S, f: F, w: sw, c: gait.color };
  }
  const MOTIF_SC = 1.25;   // taille des motifs dans les vignettes (multipliée par le curseur)
  // Petit échantillon de motif pour les boutons et légendes (SVG autonome)
  function motifIcon(gait, w, h, color) {
    const m = gait.kind === 'piaffer'
      ? gaitMotif([{ x: w / 2 - 1, y: h / 2 }, { x: w / 2 + 1, y: h / 2 }], gait, 0.85, true)
      : gaitMotif([{ x: 4, y: h / 2 }, { x: w - 4, y: h / 2 }], gait, 0.85, true);
    const c = color || m.c;
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">` +
      `<path d="${m.s}" fill="none" stroke="${c}" stroke-width="${m.w}" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${m.f}" fill="${c}"/></svg>`;
  }

  function polyLength(poly) {
    let L = 0;
    for (let i = 0; i < poly.length - 1; i++) L += Math.hypot(poly[i + 1].x - poly[i].x, poly[i + 1].y - poly[i].y);
    return L;
  }

  // Décorations automatiques selon le type de déplacement
  function decorations(sh, g, col, slots) {
    // « droit » : rien à ajouter, les flèches font partie du motif de l'allure
    const move = MOVE_IDS.includes(sh.m) ? sh.m : 'droit';
    if (move === 'droit') return '';
    const poly = screenPolyline(sh, g);
    const len = polyLength(poly);
    if (len < 15) return '';
    const closed = sh.t === 'circle';
    // Déplacements latéraux : le symbole est répété le long du parcours,
    // orienté selon le sens de la marche et le côté intérieur.
    const step = 72 * K();
    const n = Math.max(1, Math.round(len / step));
    const ds = slots && slots.length ? slots : Array.from({ length: n }, (_, i) => (i + (closed ? 0 : 0.5)) * len / n);
    // côté « intérieur » : centre du cercle, sinon centre de la carrière
    const ref = closed ? g.to(sh.c) : g.to({ x: g.w / 2, y: g.L / 2 });
    const tr = makeTrack(poly);
    const sc = MOVE_SC * K();
    // axe des grands côtés à l'écran
    const o = g.to({ x: 0, y: 0 }), o1 = g.to({ x: 0, y: 1 });
    const ey = { x: (o1.x - o.x) / S, y: (o1.y - o.y) / S };
    const G = MOVE_GEOM[move] || MOVE_GEOM.droit;
    const polys = glyphPolys(G.d);
    const [x0, x1] = moveExtent(move), mid = (x0 + x1) / 2;
    return ds.map(dc => {
      const pc = tr.at(dc);
      const nIn = { x: -pc.ty, y: pc.tx };
      const side = (ref.x - pc.x) * nIn.x + (ref.y - pc.y) * nIn.y >= 0 ? 1 : -1;
      if (move === 'pasdecote') {   // perpendiculaire au tracé, tête vers l'extérieur
        const ang = Math.atan2(pc.ty, pc.tx) * 180 / Math.PI;
        return `<g transform="translate(${r2(pc.x)},${r2(pc.y)}) rotate(${r2(ang)}) scale(1,${side}) rotate(-90) scale(${r2(sc)})">${moveGlyph(move, col)}</g>`;
      }
      if (move === 'cession' || move === 'appuyer') {
        // cheval parallèle au grand côté : la flèche reste parallèle au grand côté,
        // et part du tracé (sa queue est posée dessus)
        const k = pc.tx * ey.x + pc.ty * ey.y;
        if (Math.abs(k) > 0.2) {
          const dir = { x: ey.x * Math.sign(k), y: ey.y * Math.sign(k) };
          const half = (x1 - x0) * sc * Math.abs(k) / 2;            // projection de la flèche sur le tracé
          const p0 = tr.at(dc - half);
          const ang = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
          return `<g transform="translate(${r2(p0.x)},${r2(p0.y)}) rotate(${r2(ang)}) scale(${r2(sc)}) translate(${r2(-x0)},0)">${moveGlyph(move, col)}</g>`;
        }
      }
      // chaque point du symbole est reporté le long du tracé : il part du tracé et en suit la courbe
      const warp = (x, y) => {
        const p = tr.at(dc + (x - mid) * sc);
        return [p.x - p.ty * y * sc * side, p.y + p.tx * y * sc * side];
      };
      const d = polys.map(pl => 'M' + pl.map(([x, y]) => warp(x, y).map(r2).join(',')).join('L')).join('');
      const dots = (G.dots || []).map(([x, y]) => { const [cx, cy] = warp(x, y); return `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(2.4 * sc)}" fill="${col}"/>`; }).join('');
      return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${r2((G.w || 2.4) * sc)}" stroke-linecap="round" stroke-linejoin="round"/>` + dots;
    }).join('');
  }

  // Avancer le long d'une polyligne : position et direction à une distance donnée
  function makeTrack(poly) {
    const segs = []; let L = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i], b = poly[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 1e-6) { segs.push({ a, b, len, start: L }); L += len; }
    }
    const at = d => {
      if (!segs.length) return { x: poly[0].x, y: poly[0].y, tx: 1, ty: 0 };
      // au-delà des extrémités on prolonge en ligne droite
      let sg = d <= 0 ? segs[0] : segs[segs.length - 1];
      if (d > 0 && d < L) for (const x of segs) { if (d <= x.start + x.len) { sg = x; break; } }
      const t = (d - sg.start) / sg.len;
      return { x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t,
        tx: (sg.b.x - sg.a.x) / sg.len, ty: (sg.b.y - sg.a.y) / sg.len };
    };
    return { L, at };
  }

  // Angle à l'écran d'une figure (angle stocké en degrés dans le repère de la carrière, 90 = vers C)
  function symScreenAngle(sh, g) {
    if (UNROTATED.includes(sh.k)) return 0;
    const a = (typeof sh.a === 'number' ? sh.a : 90) * Math.PI / 180;
    const q0 = g.to(sh), q1 = g.to({ x: sh.x + Math.cos(a), y: sh.y + Math.sin(a) });
    return Math.atan2(q1.y - q0.y, q1.x - q0.x) * 180 / Math.PI;
  }

  let lastSlots = null;   // places libres laissées par le dernier motif dessiné
  function shapeSvg(sh, g, i) {
    const vis = shapeVisual(sh, g, i);
    if (!vis || sh.t === 'sym') return vis;
    const col = shapeGait(sh).color;
    // les décorations s'insèrent juste avant la zone de clic (fin du groupe)
    return vis.replace(/<\/g>$/, `<g class="deco">${decorations(sh, g, col, lastSlots)}</g></g>`);
  }

  function shapeVisual(sh, g, i) {
    const gait = shapeGait(sh), col = gait.color;
    let vis = '', hit = '';
    switch (sh.t) {
      case 'line': case 'free': case 'arc': case 'circle': {
        const poly = screenPolyline(sh, g);
        // déplacement latéral : on alterne motif et symbole au lieu de les superposer
        const lateral = MOVE_IDS.includes(sh.m) && sh.m !== 'droit';
        const m = gaitMotif(poly, gait, MOTIF_SC * K(), false, lateral ? lateralSlot(sh.m) : 0);
        lastSlots = m.slots || null;
        vis = `<path d="${m.s}" fill="none" stroke="${m.c}" stroke-width="${m.w}" stroke-linecap="round" stroke-linejoin="round"/>` +
          `<path d="${m.f}" fill="${m.c}"/>`;
        hit = `<path class="hit" d="${polyPath(poly)}"/>`;
        break;
      }
      case 'sym': {
        const q = g.to(sh);
        const scol = BLACK_SYMBOLS.includes(sh.k) ? '#222' : col;
        vis = `<g transform="translate(${q.x},${q.y}) rotate(${r2(symScreenAngle(sh, g))}) scale(${symScale(sh.k)})">${glyph(sh.k, scol)}</g>`;
        hit = `<circle class="hit-fill" cx="${q.x}" cy="${q.y}" r="${r2(18 * symScale(sh.k) / 1.35)}"/>`;
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
    caseK = sizeFactor(c);
    try { r.shapes.innerHTML = c.shapes.map((sh, i) => shapeSvg(sh, g, i)).join(''); }
    finally { caseK = 1; }
  }

  // ---------------------------------------------------------------- Zoom (molette, ×3 max) et déplacement de la vue
  function applyView(c) {
    const r = refs.get(c.id), g = geom(c.size, c.orient);
    const v = r.view || (r.view = { k: 1, x: 0, y: 0 });
    const w = g.W / v.k, h = g.H / v.k;
    v.x = Math.max(0, Math.min(g.W - w, v.x));
    v.y = Math.max(0, Math.min(g.H - h, v.y));
    r.svg.setAttribute('viewBox', `${r2(v.x)} ${r2(v.y)} ${r2(w)} ${r2(h)}`);
    r.svg.dataset.full = `0 0 ${g.W} ${g.H}`;
    r.el.classList.toggle('zoomed', v.k > 1.01);
  }
  function onWheel(e, c) {
    const r = refs.get(c.id), g = geom(c.size, c.orient);
    const v = r.view || (r.view = { k: 1, x: 0, y: 0 });
    const k2 = Math.max(1, Math.min(3, v.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    if (k2 === v.k) return;            // déjà au minimum ou au maximum : la page défile normalement
    e.preventDefault();
    const q = svgPoint(r.svg, e);      // point sous la souris : il reste en place
    const w1 = g.W / v.k, w2 = g.W / k2, h1 = g.H / v.k, h2 = g.H / k2;
    v.x = q.x - (q.x - v.x) * (w2 / w1);
    v.y = q.y - (q.y - v.y) * (h2 / h1);
    v.k = k2;
    applyView(c);
  }
  function startPan(e, c) {
    const r = refs.get(c.id), g = geom(c.size, c.orient);
    const v = r.view || (r.view = { k: 1, x: 0, y: 0 });
    e.preventDefault();
    r.svg.setPointerCapture(e.pointerId);
    const box = r.svg.getBoundingClientRect();
    const sx = (g.W / v.k) / box.width, sy = (g.H / v.k) / box.height, s0 = Math.max(sx, sy);
    const x0 = e.clientX, y0 = e.clientY, vx = v.x, vy = v.y;
    const move = ev => { v.x = vx - (ev.clientX - x0) * s0; v.y = vy - (ev.clientY - y0) * s0; applyView(c); };
    const up = () => { r.svg.removeEventListener('pointermove', move); r.svg.removeEventListener('pointerup', up); };
    r.svg.addEventListener('pointermove', move);
    r.svg.addEventListener('pointerup', up);
  }

  function renderCase(c) {
    const r = refs.get(c.id);
    const g = geom(c.size, c.orient);
    r.svg.setAttribute('viewBox', `0 0 ${g.W} ${g.H}`);
    applyView(c);
    r.base.innerHTML = arenaSvg(c, g);
    renderShapes(c);
    r.preview.innerHTML = '';
  }

  // ---------------------------------------------------------------- Aperçu pendant le tracé
  function drawPreview(c) {
    caseK = sizeFactor(c);
    try { drawPreviewIn(c); } finally { caseK = 1; }
  }
  function drawPreviewIn(c) {
    const r = refs.get(c.id);
    if (!drag || drag.caseId !== c.id) { r.preview.innerHTML = ''; return; }
    const g = geom(c.size, c.orient);
    const col = gaitOf(ui.gait).color;
    const st = `fill="none" stroke="${col}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" opacity=".7"`;
    let s = '';
    if (drag.tool === 'sym') {
      const sh = { k: drag.k, x: drag.a.x, y: drag.a.y, a: symAngle(drag) }, q = g.to(sh);
      const scol = BLACK_SYMBOLS.includes(sh.k) ? '#222' : col;
      s = `<g opacity=".6" transform="translate(${q.x},${q.y}) rotate(${r2(symScreenAngle(sh, g))}) scale(${symScale(sh.k)})">${glyph(sh.k, scol)}</g>`;
    } else if (drag.tool === 'free') {
      s = `<path d="${polyPath(drag.pts.map(g.to))}" ${st}/>`;
    } else if (drag.tool === 'line') {
      const all = drag.pts.concat(drag.cursor ? [drag.cursor] : []);
      s = `<path d="${polyPath(filletPoints(all, CORNER_R).map(g.to))}" ${st} stroke-dasharray="6 5"/>` +
        drag.pts.map(p => { const q = g.to(p); return `<circle cx="${q.x}" cy="${q.y}" r="3.5" fill="${col}"/>`; }).join('');
    } else if (drag.tool === 'circle' && drag.phase === 'dir') {
      const sh = { t: 'circle', g: ui.gait, m: ui.move, c: drag.ctr, r: drag.r, a: drag.a, dir: circleDir(drag.a, drag.ctr, drag.cursor) };
      s = `<g opacity=".75">${shapeSvg(sh, g, -1)}</g>`;
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
    else if (pts.length === 1 && gaitOf(ui.gait).kind === 'piaffer') {
      // piaffer sur place : double-clic sur un point
      mutate(c, () => c.shapes.push({ t: 'sym', k: 'piaffer', g: 'piaffer', x: pts[0].x, y: pts[0].y, a: 90 }));
    }
  }

  // Orientation d'une figure d'après le glissé (degrés, aimantée tous les 15°)
  function symAngle(d) {
    const vx = d.raw.x - d.a.x, vy = d.raw.y - d.a.y;
    if (Math.hypot(vx, vy) < 0.8) return 90;
    return (Math.round(Math.atan2(vy, vx) * 180 / Math.PI / 15) * 15 + 360) % 360;
  }

  function onDown(e, c) {
    if (e.button === 2) {                // clic droit : annule le tracé en cours, sinon la dernière action
      e.preventDefault();
      if (drag) cancelDrag(); else { lastCaseId = c.id; undo(c); }
      return;
    }
    if (e.button === 1) { startPan(e, c); return; }                     // molette maintenue : déplacer la vue
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
    // piaffer : c'est sur place → un clic pose l'ellipse (cliquer-glisser l'oriente), quel que soit l'outil de tracé
    const piafferPoint = gaitOf(ui.gait).kind === 'piaffer' && !tool.startsWith('sym:');
    if (tool.startsWith('sym:') || piafferPoint) {
      // clic = pose ; cliquer-glisser = orienter la figure
      if (drag) cancelDrag();
      r.svg.setPointerCapture(e.pointerId);
      drag = { caseId: c.id, tool: 'sym', k: piafferPoint ? 'piaffer' : tool.slice(4), a: pt(p.x, p.y), b: pt(p.x, p.y), raw };
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
    if (tool === 'circle' && drag && drag.phase === 'dir') {
      // on presse du côté voulu (ou on glisse), le cercle est validé au relâchement
      r.svg.setPointerCapture(e.pointerId);
      drag.pressed = true;
      drag.cursor = raw;
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
    if (drag.phase) { drag.cursor = raw; drawPreview(c); return; }
    if (drag.tool === 'free') drag.pts.push(raw);
    else if (drag.tool === 'line') { const p = snap(raw, c); drag.cursor = pt(p.x, p.y); }
    else if (drag.tool === 'arc' && !e.shiftKey) {
      // demi-cercle : l'arrivée est à exactement un diamètre du départ, dans la direction de la souris
      // (aimantée sur les axes de la carrière à ±20°)
      let ang = Math.atan2(raw.y - drag.a.y, raw.x - drag.a.x);
      const q = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(ang - q) < Math.PI / 9) ang = q;
      const dm = ui.diam;
      drag.b = pt(drag.a.x + Math.cos(ang) * dm, drag.a.y + Math.sin(ang) * dm);
      drag.raw = raw;
    }
    else { const p = snap(raw, c); drag.b = pt(p.x, p.y); drag.raw = raw; }
    drawPreview(c);
  }

  function onUp(e, c) {
    if (drag && drag.caseId === c.id && drag.phase === 'dir' && drag.pressed) {
      const raw = geom(c.size, c.orient).from(svgPoint(refs.get(c.id).svg, e));
      const sh = { t: 'circle', g: ui.gait, m: ui.move, c: drag.ctr, r: drag.r, a: drag.a, dir: circleDir(drag.a, drag.ctr, raw) };
      drag = null;
      drawPreview(c);
      mutate(c, () => c.shapes.push(sh));
      return;
    }
    if (!drag || drag.caseId !== c.id || drag.phase || drag.tool === 'line') return;
    const d = drag;
    let sh = null;
    if (d.tool === 'free') {
      const pts = processFree(d.pts, c);
      if (pts.length >= 2) sh = { t: 'free', g: ui.gait, m: ui.move, p: pts };
    } else if (d.tool === 'sym') {
      sh = { t: 'sym', k: d.k, g: d.k === 'piaffer' ? 'piaffer' : ui.gait, x: d.a.x, y: d.a.y, a: symAngle(d) };
    } else if (d.tool === 'circle') {
      // 2e temps : le sens de rotation suit la souris, un clic valide
      d.r = ui.diam / 2;
      d.ctr = circleCenter(d.a, d.raw, d.r, c);
      const tc = Math.atan2(d.a.y - d.ctr.y, d.a.x - d.ctr.x);
      d.a = pt(d.ctr.x + ui.diam / 2 * Math.cos(tc), d.ctr.y + ui.diam / 2 * Math.sin(tc));
      d.phase = 'dir';
      d.cursor = geom(c.size, c.orient).from(svgPoint(refs.get(c.id).svg, e));
      drawPreview(c);
      return;
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
        <span class="num">Figure ${idx + 1}</span>
        <div class="controls no-print">
          <div class="ctl-row">
            <select data-k="size" title="Dimensions">
              <option value="40">40 × 20</option><option value="60">60 × 20</option><option value="80">80 × 40</option>
            </select>
            <select data-k="orient" title="Orientation">
              <option value="v">Verticale, C en haut</option><option value="v2">Verticale, C en bas</option>
              <option value="h">Horizontale, C à droite</option><option value="h2">Horizontale, C à gauche</option>
            </select>
          </div>
          <div class="ctl-row">
            <button class="icon" data-act="undo" title="Annuler (Ctrl+Z ou clic droit)">↶</button>
            <button class="icon" data-act="redo" title="Restaurer (Ctrl+Y)">↷</button>
            <button class="icon" data-act="clear" title="Effacer le dessin">⌧</button>
            <button class="icon" data-act="up" title="Monter">↑</button>
            <button class="icon" data-act="down" title="Descendre">↓</button>
            <button class="icon danger" data-act="del" title="Supprimer la figure">✕</button>
          </div>
        </div>
      </div>
      <div class="drawing">
        <svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
          <g class="base"></g><g class="shapes"></g><g class="preview"></g>
          <circle class="snapind" r="8" style="display:none"/>
        </svg>
      </div>
      <div class="split">
        <textarea class="ta-l" placeholder="Lettres&#10;A&#10;X" spellcheck="false"></textarea>
        <div class="split-handle" title="Glisser pour ajuster la largeur des colonnes (double-clic : par défaut)"></div>
        <textarea class="ta-r" placeholder="Mouvements, un par ligne&#10;Entrée au trot de travail&#10;Arrêt, immobilité, salut"></textarea>
      </div>
      <textarea class="ta-note" placeholder="Commentaire / critères du juge (encadré jaune à l’impression)"></textarea>`;

    const svg = art.querySelector('svg');
    const r = {
      el: art, svg, grow: () => {},
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

    // les deux colonnes ont toujours la même hauteur pour que les lignes restent en face
    const taL = art.querySelector('.ta-l'), taR = art.querySelector('.ta-r');
    const growPair = () => {
      taL.style.height = taR.style.height = 'auto';
      const h = Math.max(taL.scrollHeight, taR.scrollHeight) + 2;
      taL.style.height = taR.style.height = h + 'px';
    };
    taL.value = c.textL || ''; taR.value = c.textR || '';
    taL.oninput = () => { c.textL = taL.value; growPair(); save(); };
    taR.oninput = () => { c.textR = taR.value; growPair(); save(); };
    requestAnimationFrame(growPair);
    r.grow = growPair;
    const taN = art.querySelector('.ta-note');
    const growN = () => { taN.style.height = 'auto'; taN.style.height = taN.scrollHeight + 2 + 'px'; };
    taN.value = c.note || '';
    taN.oninput = () => { c.note = taN.value; growN(); save(); };
    requestAnimationFrame(growN);

    // séparateur mobile (commun à toutes les cases)
    const handle = art.querySelector('.split-handle'), box = art.querySelector('.split');
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const move = ev => {
        const r = box.getBoundingClientRect();
        state.split = Math.round(Math.min(60, Math.max(8, (ev.clientX - r.left) / r.width * 100)));
        applySplit();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        save();
        state.cases.forEach(x => { const rr = refs.get(x.id); if (rr) rr.grow(); });
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    handle.addEventListener('dblclick', () => { state.split = 18; applySplit(); save(); });

    art.querySelector('.controls').onclick = ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      const i = state.cases.indexOf(c);
      switch (b.dataset.act) {
        case 'undo': undo(c); break;
        case 'redo': redo(c); break;
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
          if ((c.shapes.length || c.textL || c.textR || c.note) && !confirm('Supprimer cette figure ?')) return;
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
    svg.addEventListener('wheel', e => onWheel(e, c), { passive: false });
    svg.addEventListener('contextmenu', e => e.preventDefault());
    svg.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
    svg.addEventListener('dblclick', e => { if (e.button === 1) { r.view = { k: 1, x: 0, y: 0 }; applyView(c); } });

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
    add.title = 'Ajouter une figure';
    add.textContent = '+';
    add.onclick = () => {
      const last = state.cases[state.cases.length - 1];
      const c = newCase(last ? last.size : 60, last ? last.orient : 'v2');
      state.cases.push(c);
      save(); renderAll();
      refs.get(c.id).el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    wrap.appendChild(add);
    $('#title').value = state.title;
    updateTotal();
    // une fois les vignettes en place, on redessine avec leur taille réelle (épaisseurs homogènes)
    requestAnimationFrame(() => state.cases.forEach(renderShapes));
    $('#sym-scale').value = K();
    $('#sym-scale-val').textContent = Math.round(K() * 100) + ' %';
    applySplit();
    $('#page-orient').value = state.page === 'portrait' ? 'portrait' : 'paysage';
  }

  // ---------------------------------------------------------------- Barre d'outils
  function buildToolbar() {
    const ib = (attrs, title, inner) =>
      `<button ${attrs} title="${esc(title)}" aria-label="${esc(title)}">${inner}</button>`;
    $('#tools').innerHTML = TOOLS.map(t => ib(`data-tool="${t.id}"`, toolName(t),
      `<svg viewBox="0 0 24 24"><path d="${TOOL_ICONS[t.id]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`)).join('');
    const symBtn = f => ib(`data-tool="sym:${f.id}"`, f.label,
      `<svg viewBox="-16 -16 32 32"><g transform="rotate(${UNROTATED.includes(f.id) ? 0 : -90})">${glyph(f.id, '#2b2420')}</g></svg>`);
    $('#symbols').innerHTML = SYMBOLS.filter(f => !GEAR.includes(f.id)).map(symBtn).join('');
    $('#gear').innerHTML = SYMBOLS.filter(f => GEAR.includes(f.id)).map(symBtn).join('');
    // déplacements : le cheval monte, la paroi (trait beige) est à gauche pour ceux qui la longent
    $('#moves').innerHTML = MOVES.map(m => ib(`data-move="${m.id}"`, m.label,
      `<svg viewBox="-13 -13 26 26"><g transform="rotate(-90)">` +
      (m.wall ? `<path d="M-12,-11.5H12" stroke="#d8c3a0" stroke-width="3" stroke-linecap="round"/>` : '') +
      `${moveGlyph(m.id, 'currentColor')}</g></svg>`)).join('');
    // allures : une ligne par allure — [rassemblé] [travail = bouton motif] [moyen] [allongé]
    const dotBtn = g => `<button class="gdot" data-gait="${g.id}" title="${esc(g.label)}" aria-label="${esc(g.label)}" style="--c:${g.color}"></button>`;
    $('#gaits').innerHTML = LEVELS.map(l => `<span class="ghead" title="${esc(l.label)}">${l.short}</span>`).join('') +
      KINDS.map(k => {
        const g = lk => GAIT[`${k.id}_${lk}`];
        return dotBtn(g('ras')) +
          `<button class="gpill" data-gait="${g('trav').id}" title="${esc(g('trav').label)}" aria-label="${esc(g('trav').label)}" style="--c:${g('trav').color}">${motifIcon(g('trav'), 92, 22, 'currentColor')}</button>` +
          dotBtn(g('moy')) + dotBtn(g('all'));
      }).join('');
    $('#gaits-x').innerHTML = SPECIAL_GAITS.map(id => GAIT[id]).map(g =>
      `<button class="gpill gfix" data-gait="${g.id}" title="${esc(g.label)}" aria-label="${esc(g.label)}" style="--c:${g.color}">${motifIcon(g, 52, 22)}</button>`).join('');
    $('#diams').innerHTML = DIAMS.map(d => `<button data-diam="${d}">${d} m</button>`).join('');

    $('.toolbar').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tool) { if (drag && drag.tool === 'line') finishLine(); else cancelDrag(); ui.tool = b.dataset.tool; }
      if (b.dataset.gait) ui.gait = b.dataset.gait;
      if (b.dataset.move) {
        ui.move = b.dataset.move;
        // choisir un déplacement réactive un outil de tracé si besoin
        if (ui.tool === 'eraser' || ui.tool.startsWith('sym:')) ui.tool = 'line';
      }
      if (b.dataset.diam) ui.diam = +b.dataset.diam;
      saveUi();
      refreshToolbar();
    });
    // curseur de taille des symboles (enregistré avec la reprise)
    $('#sym-scale').oninput = e => {
      state.symScale = clampScale(+e.target.value);
      $('#sym-scale-val').textContent = Math.round(state.symScale * 100) + ' %';
      state.cases.forEach(renderShapes);
    };
    $('#sym-scale').onchange = save;
    $('#sym-scale').ondblclick = () => { state.symScale = 1; renderAll(); save(); };
    $('#snap').checked = ui.snap;
    $('#snap').onchange = e => { ui.snap = e.target.checked; saveUi(); };

    // flèches de direction
    $('#markers').innerHTML = GAITS.map(g =>
      `<marker id="arr-${g.id}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">` +
      `<path d="M0,0L10,5L0,10z" fill="${g.color}"/></marker>`
    ).join('');

    // légende imprimée
    $('#legend').innerHTML =
      GAITS.map(g => `<span>${motifIcon(g, 40, 14)}${esc(g.label)}</span>`).join('') +
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
      const gg = gaitOf(ui.gait), mm = MOVES.find(m => m.id === ui.move) || MOVES[0];
      cur.innerHTML = `${motifIcon(gg, 50, 16)}<b>${esc(gg.label)}</b> · ${esc(mm.label)}`;
      cur.style.borderColor = gg.color;
    }
    document.querySelectorAll('[data-diam]').forEach(b => b.classList.toggle('active', +b.dataset.diam === ui.diam));
    $('#diam-group').style.display = (ui.tool === 'circle' || ui.tool === 'arc') ? '' : 'none';
    document.body.classList.toggle('tool-eraser', ui.tool === 'eraser');
    const t = TOOLS.find(x => x.id === ui.tool);
    $('#hint').textContent = gaitOf(ui.gait).kind === 'piaffer' && t && t.id !== 'eraser'
      ? 'Piaffer (sur place) : cliquez pour poser l’ellipse, ou cliquez-glissez dans la direction du cheval pour l’orienter.'
      : t ? t.hint
      : 'Cliquez pour poser la figure (elle s’accroche aux lettres), ou cliquez-glissez dans la direction du cheval pour l’orienter.';
  }

  // ---------------------------------------------------------------- Impression
  // Mise en page « fiche de reprise » : A4 paysage, 4 colonnes × 3 rangées par page,
  // case numérotée, carrière, mouvements (lettres | consigne), encadré jaune.
  // paysage : 4 × 3 = 12 cases ; portrait : 4 × 4 = 16 cases
  const perPage = () => (state.page === 'portrait' ? 16 : 12);

  function descHtml(c) {
    const L = (c.textL || '').split('\n'), R = (c.textR || '').split('\n');
    const n = Math.max(L.length, R.length);
    let out = '';
    for (let i = 0; i < n; i++) {
      const l = (L[i] || '').trim(), t = (R[i] || '').trim();
      if (!l && !t) continue;
      out += `<div class="pl"><span class="pk">${esc(l)}</span><span>${esc(t)}</span></div>`;
    }
    return out;
  }

  function legendCell() {
    // allures, déplacements et figures réellement utilisés dans la reprise
    const used = { g: new Set(), m: new Set(), k: new Set() };
    for (const c of state.cases) for (const sh of c.shapes) {
      if (sh.g || sh.m === 'reculer') used.g.add(shapeGait(sh).id);
      if (sh.t === 'sym') used.k.add(sh.k);
      else if (sh.m && sh.m !== 'droit') used.m.add(sh.m);
    }
    const gaits = GAITS.filter(g => used.g.has(g.id));
    const rows = (gaits.length ? gaits : GAITS).map(g =>
      `<div class="lg">${motifIcon(g, 40, 14).replace('<svg ', '<svg class="lmo" ')}${esc(g.label)}</div>`).join('') +
      MOVES.filter(m => used.m.has(m.id)).map(m =>
        `<div class="lg"><svg viewBox="-13 -13 26 26" class="lic">${moveGlyph(m.id, '#333')}</svg>${esc(m.label)}</div>`).join('') +
      SYMBOLS.filter(f => used.k.has(f.id)).map(f =>
        `<div class="lg"><svg viewBox="-16 -16 32 32" class="lic"><g transform="rotate(${UNROTATED.includes(f.id) ? 0 : -90})">${glyph(f.id, '#333')}</g></svg>${esc(f.label)}</div>`).join('');
    return `<div class="pcell plegend"><div class="ptitle-lg">Légende</div><div class="lgrid">${rows}</div></div>`;
  }

  // Copie autonome d'un dessin : styles écrits dans le SVG et flèches incluses,
  // pour qu'il s'affiche pareil à l'impression et dans le PDF.
  const PRINT_STYLES = {
    arena: 'fill:#fff;stroke:#333;stroke-width:1.5',
    centerline: 'stroke:#9bb3d1;stroke-width:1',
    quarterline: 'stroke:#9bb3d1;stroke-width:1;opacity:.7',
    tick: 'stroke:#333;stroke-width:2',
    letter: 'font:700 20px "Times New Roman",Times,serif;fill:#111;text-anchor:middle;dominant-baseline:central',
    cletter: 'font:700 15px "Times New Roman",Times,serif;fill:#6b5a4c;opacity:.5;text-anchor:middle;dominant-baseline:central',
  };
  function standaloneSvg(src) {
    const svg = src.cloneNode(true);
    if (src.dataset.full) svg.setAttribute('viewBox', src.dataset.full);   // impression : carrière entière, sans zoom
    svg.querySelectorAll('.preview, .snapind, .hit, .hit-fill').forEach(n => n.remove());
    svg.removeAttribute('style');
    for (const [cls, st] of Object.entries(PRINT_STYLES)) {
      svg.querySelectorAll('.' + cls).forEach(n => n.setAttribute('style', st));
    }
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = $('#markers').innerHTML;
    svg.insertBefore(defs, svg.firstChild);
    return svg;
  }

  function buildPrint() {
    let root = $('#print-root');
    if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
    const sizes = [...new Set(state.cases.map(c => c.size))];
    const sizeTxt = sizes.length === 1 ? sizeLabel(sizes[0]) : '';
    const cells = state.cases.map((c, i) => {
      const r = refs.get(c.id);
      const svg = standaloneSvg(r.svg);
      return `<div class="pcell">
        <div class="ptop"><div class="pnum">${i + 1}</div><div class="psvg">${svg.outerHTML}</div></div>
        <div class="pdesc">${descHtml(c)}</div>
        ${c.note && c.note.trim() ? `<div class="pnote">${esc(c.note.trim()).replace(/\n/g, '<br>')}</div>` : ''}
      </div>`;
    });
    cells.push(legendCell());
    const pages = [];
    const PER_PAGE = perPage();
    for (let i = 0; i < cells.length; i += PER_PAGE) pages.push(cells.slice(i, i + PER_PAGE));
    const title = esc(state.title || 'Reprise');
    // orientation de la page (paysage : 4 × 3 cases ; portrait : 3 × 4 cases)
    const portrait = state.page === 'portrait';
    root.classList.toggle('portrait', portrait);
    let ps = $('#page-style');
    if (!ps) { ps = document.createElement('style'); ps.id = 'page-style'; document.head.appendChild(ps); }
    ps.textContent = `@page { size: A4 ${portrait ? 'portrait' : 'landscape'}; margin: 7mm; }`;
    root.innerHTML = pages.map((pc, n) => `
      <section class="ppage">
        <header class="phead">
          <span class="ptitle">${title}</span><span class="ptotal">${totalText()}</span><span class="psize">${sizeTxt}</span>
          <span class="ppnum">Page ${n + 1}${pages.length > 1 ? ' / ' + pages.length : ''}</span>
        </header>
        <div class="pgrid">${pc.join('')}${'<div class="pcell pempty"></div>'.repeat(PER_PAGE - pc.length)}</div>
      </section>`).join('');
  }

  // ---------------------------------------------------------------- Export PDF
  // Les pages de la fiche sont photographiées (html2canvas) puis assemblées en PDF A4 paysage (jsPDF).
  const PDF_LIBS = [
    ['html2canvas', 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'],
    ['jspdf', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'],
  ];
  function loadScript(src) {
    return new Promise((ok, ko) => {
      const sc = document.createElement('script');
      sc.src = src; sc.onload = ok; sc.onerror = () => ko(new Error('chargement impossible : ' + src));
      document.head.appendChild(sc);
    });
  }

  async function exportPdf() {
    const btn = $('#btn-pdf'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'PDF en cours…';
    const overlay = document.createElement('div');
    overlay.className = 'pdf-overlay';
    overlay.textContent = 'Création du PDF…';
    document.body.appendChild(overlay);
    const root = () => $('#print-root');
    try {
      for (const [g, src] of PDF_LIBS) if (!window[g]) await loadScript(src);
      buildPrint();
      window.scrollTo(0, 0);
      root().classList.add('exporting');
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const portrait = state.page === 'portrait';
      const pdf = new window.jspdf.jsPDF({ orientation: portrait ? 'portrait' : 'landscape', unit: 'mm', format: 'a4' });
      const pages = [...root().querySelectorAll('.ppage')];
      for (let i = 0; i < pages.length; i++) {
        overlay.textContent = `Création du PDF… page ${i + 1} / ${pages.length}`;
        const canvas = await window.html2canvas(pages[i], { scale: 2.5, backgroundColor: '#ffffff', logging: false });
        if (i) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 7, 7, portrait ? 196 : 283, portrait ? 283 : 195);
      }
      // Lien de téléchargement cliqué par l'utilisateur : fonctionne aussi sur Safari / iPad,
      // qui bloquent les téléchargements lancés automatiquement après un long calcul.
      const name = fileName().replace(/\.reprise\.json$/, '.pdf');
      const url = URL.createObjectURL(pdf.output('blob'));
      await new Promise(done => {
        overlay.innerHTML = `<div class="pdf-ready"><p>Le PDF est prêt.</p>
          <a class="pdf-dl" href="${url}" download="${esc(name)}">Télécharger le PDF</a>
          <button type="button" class="pdf-close">Fermer</button></div>`;
        overlay.querySelector('.pdf-dl').addEventListener('click', () => setTimeout(done, 300));
        overlay.querySelector('.pdf-close').onclick = done;
      });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error(err);
      alert('L’export PDF direct n’a pas fonctionné (une connexion internet est nécessaire).\n' +
        'La fenêtre d’impression va s’ouvrir : choisissez « Enregistrer au format PDF » comme imprimante.');
      buildPrint();
      window.print();
    } finally {
      root()?.classList.remove('exporting');
      overlay.remove();
      btn.disabled = false; btn.textContent = label;
    }
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
      state = newReprise(); history.clear(); redoStack.clear(); save(); renderAll();
    };
    $('#btn-save').onclick = download;
    $('#btn-print').onclick = () => { buildPrint(); window.print(); };
    $('#btn-pdf').onclick = exportPdf;
    // plein écran
    const fsBtn = $('#btn-full');
    const fsOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    const fsLabel = () => { fsBtn.textContent = fsOn() ? '✕ Quitter le plein écran' : '⛶ Plein écran'; };
    if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) fsBtn.hidden = true;
    fsBtn.onclick = () => {
      const de = document.documentElement;
      if (fsOn()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else (de.requestFullscreen || de.webkitRequestFullscreen).call(de);
    };
    document.addEventListener('fullscreenchange', fsLabel);
    document.addEventListener('webkitfullscreenchange', fsLabel);
    $('#page-orient').onchange = e => { state.page = e.target.value; save(); };
    window.addEventListener('beforeprint', buildPrint);   // aussi pour Ctrl+P
    $('#btn-open').onclick = () => $('#file-input').click();
    $('#file-input').onchange = async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        state = normalize(JSON.parse(await f.text()));
        if (!state.cases.length) state.cases.push(newCase());
        history.clear(); redoStack.clear(); save(); renderAll();
      } catch (err) {
        alert('Impossible d’ouvrir ce fichier : ' + err.message);
      }
    };
    $('#title').oninput = e => { state.title = e.target.value; save(); };  // save() met aussi à jour la largeur

    document.addEventListener('keydown', e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === 'Escape') cancelDrag();
      if (e.key === 'Enter' && drag && drag.tool === 'line') { e.preventDefault(); finishLine(); }
      const key = e.key.toLowerCase();
      if (!typing && (e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
        const c = state.cases.find(x => x.id === lastCaseId);
        if (c) { e.preventDefault(); (key === 'y' || e.shiftKey) ? redo(c) : undo(c); }
      }
    });
  }

  let resizeT = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => state.cases.forEach(renderShapes), 200); });

  // ---------------------------------------------------------------- Démarrage
  buildToolbar();
  bindFileActions();
  renderAll();
})();
