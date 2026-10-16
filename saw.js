/* ============================================================
   AUTO SAW BOX  --  single-file stress-relief toy  (part 1/5)
   Play: the log rides the conveyor from the left into a closed
         saw box. Inside, one cut happens with a "bzzz" sound.
         Then the right-side chute spits out FOUR blocks at once.
   No deps: just open index.html.
   ============================================================ */
(() => {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const el = (name, attrs) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);

  /* ---------- wood species ---------- */
  const WOODS = [
    { id: "pine",  key: "pine",  name: "pine",  light: "#efd3a3", mid: "#dda96a", dark: "#a8762f", deep: "#7d5420" },
    { id: "beech", key: "beech", name: "beech", light: "#e6bd8d", mid: "#c98a55", dark: "#8f5b2c", deep: "#6a4020" },
    { id: "oak",   key: "oak",   name: "oak",   light: "#d19a67", mid: "#a96f45", dark: "#6f4425", deep: "#50301a" }
  ];
  const TXT = window.__SAWBOX_TXT__ || {};
  WOODS.forEach((w) => {
    if (TXT[w.key + "_tag"]) w.tag = TXT[w.key + "_tag"];
    if (TXT[w.key + "_name"]) w.name = TXT[w.key + "_name"];
  });
  const woodByName = (n) => WOODS.find((w) => w.name === n) || WOODS[0];

  /* ---------- machine config ---------- */
  const cfg = { grip: 0.30, dust: 1.9, speed: 1, haptics: true, sound: true, auto: true, wood: "pine" };

  /* ---------- geometry (viewBox units) ---------- */
  // The stage aspect ratio varies a lot between windows, so the viewBox is
  // fitted at runtime (see fitScene): the drawing is laid out once here and
  // the visible band is chosen around the content, never uniformly shrunk.
  const VW = 900, VH = 500;
  // Visible content band: the machine + belt occupy roughly y 104..436, the
  // rest is empty background that would only shrink the scene under "meet".
  const BAND_TOP = 104, BAND_BOT = 436;
  // Vertical band the machine lives in. Everything is derived from these so the
  // belt, the queue and the box mouth can never drift apart.
  const BELT_TOP = 352, BELT_H = 16;   // conveyor surface + its thickness
  const BOX_L = 358, BOX_R = 504;      // sealed saw box: 146 wide x 194 tall
  const BOX_TOP = 140, BOX_BOT = 334;  // ... a near-square, chunky-but-tidy unit
  const LOG_H = 21;
  const LOG_LEN = 46;                  // log length on the belt
  const QUEUE_GAP = 12;                // visible gap between two queued logs
  const QUEUE_PITCH = LOG_LEN + QUEUE_GAP;  // spacing: never overlaps
  // The belt is long but breathes inside the frame: it spans 82% of the width
  // and stops well clear of both edges, so nothing is ever clipped.
  const BELT_L = 82;
  const BELT_R = VW - 82;
  const BELT_QUEUE_TAIL = BELT_L + 6;   // x of the leftmost (queue tail) slot
  const CHUTE_Y = 330;                 // chute mouth centered on the block exit line (BELT_TOP - LOG_H/2)
  const CATCH_X = 690;
  const CATCH_Y = 402;
  /* ---------- per-phase durations (seconds) ---------- */
  const T = { feed: 1.55, hold: 0.22, saw: 1.20, burst: 0.12, eject: 0.95, settle: 0.55, clear: 0.30 };

  /* ---------- runtime state ---------- */
  const st = {
    phase: "feed", t: 0, logT: 0, sawT: 0, ejectT: 0, pieces: 0, target: 4,
    logsOut: 0, blocksOut: 0, tray: [], tween: [], grit: [], idle: 0,
    queue: [],           // logs still waiting on the belt (front first)
    beltBase: BOX_L - LOG_LEN - QUEUE_GAP, // x of the head slot (box mouth)
    carryFrom: 0,        // start x of the log currently being carried in
    carryTo: 0           // box-mouth x of the log currently being carried in
  };

  const view = {
    svg: null, belt: null, beltLines: null, log: null, box: null, chute: null, queueLayer: null,
    chips: null, sparks: null, trayG: null, logLayer: null, glow: null, sawArc: null,
    lamp: null, mouth: null, meterBar: null
  };
  let paused = false;
  let lastTs = 0;
  let boxShake = 0;
  let anim = 0;

  function svgText(x, y, str, opts) {
    const o = opts || {};
    const t = el("text", {
      x: x, y: y, "font-size": o.size || 12,
      "text-anchor": o.anchor || "middle",
      fill: o.fill || "#3a2f24",
      "font-weight": o.weight || 600,
      opacity: o.opacity == null ? 1 : o.opacity
    });
    t.textContent = str;
    return t;
  }

  /* ---------- conveyor belt ---------- */
  function buildBelt() {
    const g = el("g", { class: "conveyor" });
    g.appendChild(el("rect", { x: BELT_L, y: BELT_TOP, width: BELT_R - BELT_L, height: BELT_H, rx: 6, fill: "#5c6672" }));
    g.appendChild(el("rect", { x: BELT_L + 3, y: BELT_TOP + 3, width: BELT_R - BELT_L - 6, height: BELT_H - 6, rx: 4, fill: "#3f4855" }));
    // legs are hung off the belt itself (a fraction of its length), so they
    // follow the belt wherever it goes instead of sitting at fixed pixels
    const beltW = BELT_R - BELT_L;
    const legY = BELT_TOP + BELT_H;
    const legs = [BELT_L + beltW * 0.20, BOX_R + beltW * 0.10, BELT_L + beltW * 0.72, BELT_R - beltW * 0.10];
    legs.forEach((lx) => {
      g.appendChild(el("rect", { x: lx.toFixed(1), y: legY, width: 6, height: 26, rx: 1.6, fill: "#4a5361" }));
      g.appendChild(el("rect", { x: (lx - 2.5).toFixed(1), y: legY + 26, width: 11, height: 3.5, rx: 1.6, fill: "#3f4855" }));
    });
    const innerW = BELT_R - BELT_L - 6;
    const innerH = BELT_H - 6;
    const viewport = el("svg", {
      x: BELT_L + 3, y: BELT_TOP + 3, width: innerW, height: innerH,
      viewBox: "0 0 " + innerW + " " + innerH,
      overflow: "hidden", class: "treadview"
    });
    const lines = el("g", { class: "treads" });
    // tread ticks run edge to edge; the viewport clips the part that hangs off
    // the left, so no dot ever escapes past the belt ends
    for (let x = 0; x < innerW + 20; x += 20) {
      lines.appendChild(el("rect", { x: x, y: 2, width: 5, height: innerH - 4, rx: 1.5, fill: "#9aa4b1", opacity: 0.32 }));
    }
    viewport.appendChild(lines);
    view.beltLines = lines;
    g.appendChild(viewport);
    view.belt = g;
    return g;
  }

  /* ---------- sealed saw box ---------- */
  function buildBox() {
    const g = el("g", { class: "sawbox" });
    const w = BOX_R - BOX_L, h = BOX_BOT - BOX_TOP;
    const cx = (BOX_L + BOX_R) / 2;
    // a thin contact shadow cast onto the belt surface under the machine
    g.appendChild(el("ellipse", { cx: cx, cy: BELT_TOP + 5, rx: w * 0.5, ry: 4.5, fill: "rgba(30,25,20,.16)" }));
    // feet reach down to the belt surface (2 units into it) so the box does
    // not look like it is floating above the conveyor line
    const footH = BELT_TOP - BOX_BOT + 3;
    g.appendChild(el("rect", { x: BOX_L + 16, y: BOX_BOT - 1, width: 9, height: footH, rx: 2.2, fill: "#39404b" }));
    g.appendChild(el("rect", { x: BOX_R - 25, y: BOX_BOT - 1, width: 9, height: footH, rx: 2.2, fill: "#39404b" }));
    // outer shell
    g.appendChild(el("rect", { x: BOX_L, y: BOX_TOP, width: w, height: h, rx: 9, fill: "#4d5663" }));
    // face plate inset
    g.appendChild(el("rect", { x: BOX_L + 5, y: BOX_TOP + 5, width: w - 10, height: h - 10, rx: 7, fill: "#59636f", stroke: "#454e5b", "stroke-width": 1 }));
    // raised top cap
    g.appendChild(el("rect", { x: BOX_L + 12, y: BOX_TOP - 7, width: w - 24, height: 10, rx: 3, fill: "#3f4753" }));
    // structural ribs down the sides: this is what stops it reading as a blob
    [0.30, 0.56, 0.80].forEach((f) => {
      g.appendChild(el("rect", { x: BOX_L + 6, y: BOX_TOP + 8 + f * (h - 26), width: w - 12, height: 2, rx: 1, fill: "#454e5b", opacity: 0.55 }));
    });
    // inlet collar the log disappears into
    g.appendChild(el("rect", { x: BOX_L - 9, y: BELT_TOP - LOG_H - 8, width: 14, height: LOG_H + 20, rx: 3, fill: "#3f4753" }));
    g.appendChild(el("rect", { x: BOX_L - 9, y: BELT_TOP - 2, width: 14, height: 3, rx: 1.5, fill: "#f0b429", opacity: 0.8 }));
    // outlet collar on the right
    g.appendChild(el("rect", { x: BOX_R - 5, y: CHUTE_Y - 22, width: 14, height: LOG_H + 22, rx: 3, fill: "#3f4753" }));
    const stripes = el("g", { class: "stripes" });
    const sy = BOX_BOT - 30;
    for (let i = 0; i < 7; i++) {
      const x0 = BOX_L + 13 + i * ((w - 26) / 7);
      stripes.appendChild(el("path", { d: "M" + x0.toFixed(1) + " " + sy + " l6 0 l-6 14 l-6 0 z", fill: "#f0b429", opacity: 0.86 }));
    }
    stripes.appendChild(el("rect", { x: BOX_L + 13, y: sy - 2, width: w - 26, height: 18, rx: 2.5, fill: "none", stroke: "#2f3742", "stroke-width": 1.2, opacity: 0.4 }));
    g.appendChild(stripes);
    // brand plate
    g.appendChild(el("rect", { x: cx - 27, y: BOX_TOP + 12, width: 54, height: 17, rx: 3.5, fill: "#39424e" }));
    g.appendChild(svgText(cx, BOX_TOP + 24.5, TXT.brand || "SawUnit", { size: 10.5, fill: "#e9dcc6", weight: 700 }));
    // viewing slot so the cut feels like it happens behind glass
    g.appendChild(el("rect", { x: BOX_L + 14, y: BOX_TOP + 40, width: w - 28, height: 26, rx: 3, fill: "#39424e" }));
    g.appendChild(el("rect", { x: BOX_L + 17, y: BOX_TOP + 43, width: w - 34, height: 20, rx: 2, fill: "#232a33", opacity: 0.9 }));
    const lamp = el("circle", { cx: BOX_R - 17, cy: BOX_TOP + 20, r: 4, fill: "#7fe0a0" });
    g.appendChild(lamp);
    view.lamp = lamp;
    [[BOX_L + 12, BOX_TOP + 12], [BOX_R - 12, BOX_TOP + 12], [BOX_L + 12, BOX_BOT - 12], [BOX_R - 12, BOX_BOT - 12]].forEach((p) => {
      g.appendChild(el("circle", { cx: p[0], cy: p[1], r: 1.9, fill: "#39424e", opacity: 0.66 }));
    });
    g.appendChild(el("line", { x1: BOX_L + 12, y1: BOX_TOP + 84, x2: BOX_R - 12, y2: BOX_TOP + 84, stroke: "#454e5b", "stroke-width": 1, opacity: 0.45 }));
    view.box = g;
    return g;
  }

  /* ---------- inner glow + saw arc (peeks through the inlet) ---------- */
  function buildInner() {
    const g = el("g", { class: "inner" });
    const cy = BELT_TOP - LOG_H / 2;
    const glow = el("ellipse", { cx: (BOX_L + BOX_R) / 2, cy: cy, rx: 40, ry: 22, fill: "#ffd27a", opacity: 0 });
    g.appendChild(glow); view.glow = glow;
    const arc = el("circle", { cx: (BOX_L + BOX_R) / 2, cy: cy, r: 16, fill: "none", stroke: "#e5e9ef", "stroke-width": 2.2, "stroke-dasharray": "5 4", opacity: 0 });
    g.appendChild(arc); view.sawArc = arc;
    return g;
  }

  /* ---------- output chute ---------- */
  function buildChute() {
    const g = el("g", { class: "chute" });
    g.appendChild(el("path", {
      d: "M" + (BOX_R + 4) + " " + (CHUTE_Y - 22) + " L" + (BOX_R + 34) + " " + (CHUTE_Y - 15) +
         " L" + (BOX_R + 34) + " " + (CHUTE_Y + 24) + " L" + (BOX_R + 4) + " " + (CHUTE_Y + 24) + " Z",
      fill: "#4a5361"
    }));
    g.appendChild(el("path", {
      d: "M" + (BOX_R + 9) + " " + (CHUTE_Y - 16) + " L" + (BOX_R + 29) + " " + (CHUTE_Y - 11) +
         " L" + (BOX_R + 29) + " " + (CHUTE_Y + 19) + " L" + (BOX_R + 9) + " " + (CHUTE_Y + 19) + " Z",
      fill: "#2b323c"
    }));
    const mouth = el("rect", { x: BOX_R + 8, y: CHUTE_Y - 15, width: 21, height: 33, rx: 3, fill: "#161a20" });
    g.appendChild(mouth); view.mouth = mouth;
    view.chute = g;
    return g;
  }

  /* ---------- catch tray ---------- */
  function buildTray() {
    const g = el("g", { class: "tray" });
    g.appendChild(el("path", {
      d: "M" + (CATCH_X - 74) + " " + (CATCH_Y - 4) + " L" + (CATCH_X + 74) + " " + (CATCH_Y - 4) +
         " L" + (CATCH_X + 63) + " " + (CATCH_Y + 26) + " L" + (CATCH_X - 63) + " " + (CATCH_Y + 26) + " Z",
      fill: "#6b5a45"
    }));
    g.appendChild(el("path", {
      d: "M" + (CATCH_X - 67) + " " + (CATCH_Y) + " L" + (CATCH_X + 67) + " " + (CATCH_Y) +
         " L" + (CATCH_X + 56) + " " + (CATCH_Y + 20) + " L" + (CATCH_X - 56) + " " + (CATCH_Y + 20) + " Z",
      fill: "#826d53"
    }));
    for (let i = 0; i < 5; i++) {
      const x = CATCH_X - 50 + i * 25;
      g.appendChild(el("line", { x1: x, y1: CATCH_Y + 3, x2: x + 6, y2: CATCH_Y + 18, stroke: "#6f5c45", "stroke-width": 1, opacity: 0.35 }));
    }
    return g;
  }

  function buildParticles() {
    const g = el("g", { class: "particles" });
    const chips = el("g", { class: "chips" });
    const sparks = el("g", { class: "sparks" });
    g.appendChild(chips); g.appendChild(sparks);
    view.chips = chips; view.sparks = sparks;
    return g;
  }

  /* ---------- a block of wood ---------- */
  function blockShape(w, len, h) {
    const g = el("g", { class: "block" });
    g.appendChild(el("rect", { x: 0, y: 0, width: len, height: h, rx: 2, fill: w.mid }));
    g.appendChild(el("rect", { x: 0, y: 0, width: len, height: Math.max(3, h * 0.15), fill: w.light, opacity: 0.9 }));
    g.appendChild(el("rect", { x: 0, y: h - Math.max(3, h * 0.2), width: len, height: Math.max(3, h * 0.2), fill: w.dark, opacity: 0.32 }));
    g.appendChild(el("ellipse", { cx: len - 2, cy: h / 2, rx: 3.6, ry: h / 2 - 1.5, fill: w.light, opacity: 0.75 }));
    g.appendChild(el("ellipse", { cx: len - 2, cy: h / 2, rx: 1.8, ry: h / 3.4, fill: w.dark, opacity: 0.3 }));
    const gg = el("g", { class: "grain" });
    const rows = Math.max(2, Math.round(h / 9));
    for (let i = 1; i <= rows; i++) {
      const y = (h / (rows + 1)) * i;
      gg.appendChild(el("line", { x1: 4, y1: y.toFixed(1), x2: len - 8, y2: y.toFixed(1), stroke: w.dark, "stroke-width": 0.8, opacity: 0.14 }));
    }
    g.appendChild(gg);
    return g;
  }

  /* ============================================================
     MOUNT
     ============================================================ */
  function mount() {
    const host = $("scene");
    if (!host) return;
    host.innerHTML = "";
    host.style.overflow = "hidden";
    // Initial viewBox; fitScene() refines it to the real stage ratio below.
    const svg = el("svg", { viewBox: "0 " + BAND_TOP + " " + VW + " " + (BAND_BOT - BAND_TOP), preserveAspectRatio: "xMidYMid meet" });
    view.svg = svg;
    // floor line: it sits a little under the belt and stops inside the frame
    svg.appendChild(el("rect", { x: BELT_L + 4, y: BELT_TOP + BELT_H + 30, width: (BELT_R - BELT_L) - 8, height: 2.5, rx: 1.25, fill: "rgba(60,48,36,.10)" }));
    svg.appendChild(buildBelt());
    svg.appendChild(buildTray());
    svg.appendChild(buildInner());
    // log/queue layers sit BELOW the box so a carried log disappears into the
    // inlet collar instead of sliding over the box face
    const queueLayer = el("g", { class: "queuelayer" });
    svg.appendChild(queueLayer); view.queueLayer = queueLayer;
    const logLayer = el("g", { class: "loglayer" });
    svg.appendChild(logLayer); view.logLayer = logLayer;
    svg.appendChild(buildBox());
    svg.appendChild(buildChute());
    const trayG = el("g", { class: "trayitems" });
    svg.appendChild(trayG); view.trayG = trayG;
    svg.appendChild(buildParticles());

    // gauge sits inside the visible band (BAND_TOP..BAND_BOT), top-left
    const g = el("g", { class: "gauge", transform: "translate(30,112)" });
    g.appendChild(el("rect", { x: 0, y: 0, width: 124, height: 36, rx: 9, fill: "rgba(255,255,255,.72)", stroke: "rgba(58,47,36,.14)" }));
    g.appendChild(svgText(12, 15, TXT.gauge || "CUT", { size: 10, anchor: "start", fill: "#8b7c68", weight: 600 }));
    g.appendChild(el("rect", { x: 12, y: 22, width: 100, height: 6, rx: 3, fill: "rgba(58,47,36,.12)" }));
    const bar = el("rect", { x: 12, y: 22, width: 0, height: 6, rx: 3, fill: "#b98a55" });
    g.appendChild(bar); view.meterBar = bar;
    svg.appendChild(g);

    host.appendChild(svg);

    fitScene();
  }

  /* ---------- scene fitting ----------
     The drawing is composed once at 900x500, but the stage box can be much
     wider (short windows) or narrower (phones). fitScene picks a viewBox that
     matches the stage ratio while keeping the machine band as large as
     possible: wide stages scale by height (machine fills ~58% of it), narrow
     stages scale by width so the whole belt stays visible. */
  function fitScene() {
    const host = $("scene");
    if (!host || !view.svg) return;
    const r = host.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const a = r.width / r.height;
    const bandH = BAND_BOT - BAND_TOP;
    const bandA = VW / bandH;
    let vbX, vbY, vbW, vbH;
    if (a >= bandA) {
      // stage is wide: lock the band height, widen the viewBox to match
      vbH = bandH;
      vbW = bandH * a;
      vbX = (VW - vbW) / 2;      // negative: empty margins left/right of the belt
      vbY = BAND_TOP;
    } else {
      // stage is narrow/tall: lock the full drawing width, center the band
      vbW = VW;
      vbH = VW / a;
      vbX = 0;
      vbY = (BAND_TOP + BAND_BOT) / 2 - vbH / 2;
    }
    view.svg.setAttribute("viewBox",
      vbX.toFixed(1) + " " + vbY.toFixed(1) + " " + vbW.toFixed(1) + " " + vbH.toFixed(1));
  }

  /* ============================================================
     LOG + PIECES
     ============================================================ */
  /* ---------- queued logs on the belt ---------- */
  function makeQueued(w) {
    const g = blockShape(w, LOG_LEN, LOG_H);
    g.classList.add("queued");
    g.style.opacity = "0.96";
    return g;
  }

  function maxQueued() {
    // The belt from BELT_QUEUE_TAIL up to the box mouth is packed with logs.
    const room = (BOX_L - LOG_LEN - QUEUE_GAP) - BELT_QUEUE_TAIL;
    return Math.max(3, Math.floor(room / QUEUE_PITCH) + 1);
  }

  // A queued log owns an explicit integer slot. Slots are laid out from a
  // single base offset, so the gap between neighbours is always exactly
  // QUEUE_PITCH: overlap is mathematically impossible.
  function slotX(slot) {
    // slot 0 is the head (at the box mouth); higher slots march left.
    return st.beltBase - slot * QUEUE_PITCH;
  }

  function refillQueue() {
    const w = WOODS.find((x) => x.id === cfg.wood) || WOODS[0];
    const want = maxQueued();
    while (st.queue.length < want) st.queue.push({ g: makeQueued(w) });
    while (st.queue.length > want) {
      const q = st.queue.pop();
      if (q && q.g && q.g.parentNode) q.g.parentNode.removeChild(q.g);
    }
    if (view.queueLayer) {
      view.queueLayer.innerHTML = '';
      st.queue.forEach((q) => view.queueLayer.appendChild(q.g));
    }
  }

  // The whole line glides right by exactly one pitch across a feed pass (toward
  // the box). The base offset never changes; when the pass ends we drop the head
  // and append a fresh log at the far tail, so the belt always looks loaded.
  function layoutQueue() {
    const y = BELT_TOP - LOG_H;
    const shift = st.phase === 'feed' ? QUEUE_PITCH * clamp(st.logT, 0, 1) : 0;
    st.queue.forEach((q, i) => {
      const x = slotX(i) + shift;
      // hide the log once it is fully inside the box mouth
      const visible = x > BELT_L - LOG_LEN - 2 && x < BOX_L - LOG_LEN + 4;
      q.g.setAttribute('transform', 'translate(' + x.toFixed(2) + ',' + y + ')');
      q.g.style.display = visible ? '' : 'none';
    });
  }

  // The head log leaves the queue and becomes the carried log (view.log).
  // shift has already moved it to the box mouth, so it carries on from there
  // and slides inside: no snap, no re-ordering.
  function takeHeadLog() {
    if (!st.queue.length) refillQueue();
    // the head has been shifted right, and now sits at the box mouth
    st.carryFrom = slotX(0) + QUEUE_PITCH;
    st.carryTo = (BOX_L + BOX_R) / 2 - LOG_LEN / 2;
    const w = WOODS.find((x) => x.id === cfg.wood) || WOODS[0];
    const g = blockShape(w, LOG_LEN, LOG_H);
    view.logLayer.appendChild(g);
    view.log = g;
    st.logT = 0;
    st.sawT = 0;
    st.ejectT = 0;
    st.pieces = 0;
    applyLogTransform();
  }

  // Called the instant a feed pass completes: drop the head slot and append a
  // fresh log at the tail. Because the shift is reset in the same frame, every
  // remaining log lands exactly where the shift had already pushed it.
  function advanceQueue() {
    const q = st.queue.shift();
    if (q && q.g && q.g.parentNode) q.g.parentNode.removeChild(q.g);
    refillQueue();
  }

  function applyLogTransform() {
    if (!view.log) return;
    if (st.phase === "burst" || st.phase === "eject" || st.phase === "settle" || st.phase === "clear") {
      view.log.style.opacity = "0";
      return;
    }
    // glides from the queue head to the box mouth over the feed duration
    const t = ease(clamp(st.logT, 0, 1));
    const x = lerp(st.carryFrom, st.carryTo, t);
    const y = BELT_TOP - LOG_H;
    view.log.setAttribute("transform", "translate(" + x.toFixed(2) + "," + y.toFixed(2) + ")");
    view.log.style.opacity = st.phase === "saw" ? String(clamp(1 - st.sawT * 2.4, 0.1, 1)) : "1";
  }

  function spawnPiece(wood, delay, i) {
    const g = blockShape(wood, LOG_LEN, LOG_H);
    g.setAttribute("transform", "translate(" + (BOX_R + 16) + "," + (BELT_TOP - LOG_H) + ")");
    view.logLayer.appendChild(g);
    const jitter = i - 1.5;
    // four blocks fan out and settle in a tidy 2-high stack, all inside the tray
    st.tween.push({
      g: g, t: -delay, dur: T.eject * (0.72 + 0.09 * (i % 3)),
      x0: BOX_R + 16, y0: BELT_TOP - LOG_H + jitter * 2.2,
      x1: CATCH_X - 33 + jitter * 26 + (i % 2 ? 5 : -5),
      y1: CATCH_Y - 4 - Math.abs(jitter) * 5 - (i > 1 ? LOG_H - 2 : 0),
      rot: jitter * 11 + (i % 2 ? 5 : -5)
    });
  }

  /* ============================================================
     EFFECTS
     ============================================================ */
  function spawnChip(x, y, n, wood, power) {
    if (!view.chips) return;
    const p = power == null ? 1 : power;
    for (let i = 0; i < n; i++) {
      const s = 1.4 + Math.random() * 2.6;
      const r = el("rect", {
        x: 0, y: 0, width: s, height: s * (0.5 + Math.random() * 0.6), rx: 0.6,
        fill: Math.random() < 0.5 ? wood.light : wood.dark, opacity: 0.95
      });
      r.setAttribute("transform", "translate(" + x + "," + y + ")");
      view.chips.appendChild(r);
      st.grit.push({
        n: r, x: x, y: y,
        vx: (Math.random() - 0.7) * 62 * p,
        vy: (-34 - Math.random() * 54) * p,
        rot: (Math.random() - 0.5) * 760,
        a: 0, life: 0.55 + Math.random() * 0.6
      });
    }
  }

  function spawnSpark(x, y, n) {
    if (!view.sparks) return;
    for (let i = 0; i < n; i++) {
      const line = el("line", {
        x1: x, y1: y, x2: x + (Math.random() - 0.5) * 24, y2: y + (Math.random() - 0.5) * 24,
        stroke: "#ffe9a8", "stroke-width": 1.4, opacity: 0.95, "stroke-linecap": "round"
      });
      view.sparks.appendChild(line);
      st.grit.push({ n: line, x: x, y: y, vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90, rot: 0, a: 0, life: 0.24 + Math.random() * 0.2, fade: true });
    }
  }

  /* ============================================================
     AUDIO  --  the "bzzz"
     ============================================================ */
  let AC = null;
  function actx() {
    if (!AC) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      try { AC = new Ctx(); } catch (e) { return null; }
    }
    if (AC.state === "suspended") { try { AC.resume(); } catch (e) {} }
    return AC;
  }

  function playBuzz(level) {
    if (!cfg.sound) return;
    const ac = actx();
    if (!ac) return;
    const now = ac.currentTime;
    const dur = 1.35;
    const lv = level == null ? 1 : level;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.24 * lv, now + 0.06);
    g.gain.setValueAtTime(0.24 * lv, now + dur * 0.62);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(420, now);
    bp.frequency.linearRampToValueAtTime(1150, now + dur * 0.5);
    bp.frequency.linearRampToValueAtTime(560, now + dur);
    bp.Q.value = 1.1;
    const o1 = ac.createOscillator();
    o1.type = "sawtooth";
    o1.frequency.setValueAtTime(96, now);
    o1.frequency.linearRampToValueAtTime(132, now + dur);
    const o2 = ac.createOscillator();
    o2.type = "square";
    o2.frequency.setValueAtTime(48, now);
    o2.frequency.linearRampToValueAtTime(66, now + dur);
    const lfo = ac.createOscillator();
    lfo.type = "sine";
    lfo.frequency.setValueAtTime(21, now);
    const lg = ac.createGain();
    lg.gain.value = 0.7;
    lfo.connect(lg).connect(g.gain);
    o1.connect(bp); o2.connect(bp); bp.connect(g).connect(ac.destination);
    [o1, o2, lfo].forEach((o) => { o.start(now); o.stop(now + dur + 0.02); });
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    const air = ac.createBufferSource();
    air.buffer = buf;
    const hp = ac.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 2600;
    const ag = ac.createGain();
    ag.gain.setValueAtTime(0.0001, now);
    ag.gain.exponentialRampToValueAtTime(0.045 * lv, now + 0.05);
    ag.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    air.connect(hp).connect(ag).connect(ac.destination);
    air.start(now); air.stop(now + dur);
  }

  function playPop() {
    if (!cfg.sound) return;
    const ac = actx();
    if (!ac) return;
    const now = ac.currentTime;
    const o = ac.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(320, now);
    o.frequency.exponentialRampToValueAtTime(90, now + 0.16);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.2, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    o.connect(g).connect(ac.destination);
    o.start(now); o.stop(now + 0.22);
  }

  function buzzHaptic() {
    if (cfg.haptics && navigator.vibrate) { try { navigator.vibrate([26, 34, 26]); } catch (e) {} }
  }

  /* ============================================================
     PHASE MACHINE
     ============================================================ */
  function setLamp(color) { if (view.lamp) view.lamp.setAttribute("fill", color); }

  function showTag(text) {
    const tag = $("tag");
    if (!tag) return;
    tag.textContent = text;
    tag.hidden = false;
    tag.classList.remove("show");
    void tag.offsetWidth;
    tag.classList.add("show");
  }

  function paintStats() {
    const bo = $("outOut");
    if (bo) bo.textContent = String(st.blocksOut);
    const lo = $("logOut");
    if (lo) lo.textContent = String(st.logsOut);
    const d = $("deep");
    if (d) d.textContent = (TXT.deepPrefix || "") + st.logsOut + (TXT.deepMid || "") + st.blocksOut + (TXT.deepSuffix || "");
    const f = $("feel");
    if (f) f.textContent = (TXT.feelPrefix || "") + st.blocksOut + (TXT.feelMid || "") + st.logsOut + (TXT.feelSuffix || "");
    const wt = $("woodTag");
    if (wt) {
      const w = WOODS.find((x) => x.id === cfg.wood) || WOODS[0];
      wt.textContent = w.tag || w.name;
    }
  }

  function enter(phase) {
    st.phase = phase;
    st.t = 0;
    if (phase === "feed") {
      // every feed pass begins by taking the current queue head as the log
      // that will be carried into the box
      takeHeadLog();
    } else if (phase === "hold") {
      setLamp("#ffd27a");
    } else if (phase === "saw") {
      setLamp("#ff6b52");
      playBuzz(0.85 + cfg.grip * 0.4);
      buzzHaptic();
      boxShake = 1;
    } else if (phase === "burst") {
      setLamp("#7fe0a0");
      playPop();
      const w = WOODS.find((x) => x.id === cfg.wood) || WOODS[0];
      for (let i = 0; i < 4; i++) spawnPiece(w, i * 0.05, i);
      st.pieces = 4;
      st.blocksOut += 4;
      st.logsOut += 1;
      showTag(TXT.burst || "4 BLOCKS OUT");
      paintStats();
      boxShake = 0.6;
    } else {
      setLamp("#7fe0a0");
    }
  }

  function update(dt) {
    const sdt = dt * cfg.speed;
    st.t += sdt;
    if (st.phase === "feed") {
      const d = T.feed / (0.78 + cfg.speed * 0.42);
      st.logT = clamp(st.t / d, 0, 1);
      if (st.t >= d) { advanceQueue(); enter("hold"); }
    } else if (st.phase === "hold") {
      if (st.t >= T.hold) enter("saw");
    } else if (st.phase === "saw") {
      const d = T.saw * (1.35 - cfg.grip * 0.7);
      st.sawT = clamp(st.t / d, 0, 1);
      const w = WOODS.find((x) => x.id === cfg.wood) || WOODS[0];
      const cx = (BOX_L + BOX_R) / 2 + (Math.random() - 0.5) * 30;
      const cy = BELT_TOP - LOG_H / 2 + (Math.random() - 0.5) * 16;
      spawnChip(cx, cy, Math.max(1, Math.round(cfg.dust * 1.4)), w, 0.7);
      if (Math.random() < 0.5) spawnSpark(BOX_L + 22 + Math.random() * 20, cy, 2);
      if (st.t >= d) enter("burst");
    } else if (st.phase === "burst") {
      if (st.t >= T.burst) enter("eject");
    } else if (st.phase === "eject") {
      st.ejectT = clamp(st.t / T.eject, 0, 1);
      if (st.t >= T.eject) enter("settle");
    } else if (st.phase === "settle") {
      if (st.t >= T.settle) enter("clear");
    } else if (st.phase === "clear") {
      if (st.t >= T.clear) {
        if (cfg.auto) { enter("feed"); }
        else { st.phase = "idle"; st.idle = 1; }
      }
    }
    applyLogTransform();
    // The queue line is positioned purely from st.beltBase + slot index, and
    // the only motion is the per-feed shift applied inside layoutQueue().
    // No accumulated offset exists any more, so the line cannot drift and the
    // logs can never pile up on top of each other.
    layoutQueue();
    stepTweens(sdt);
    stepGrit(dt);
    paintMeter();
  }

  function paintMeter() {
    if (!view.meterBar) return;
    const v = st.phase === "saw" ? st.sawT : (st.phase === "feed" || st.phase === "hold" ? 0 : 1);
    view.meterBar.setAttribute("width", (100 * clamp(v, 0, 1)).toFixed(1));
  }

  function stepTweens(dt) {
    for (let i = st.tween.length - 1; i >= 0; i--) {
      const p = st.tween[i];
      p.t += dt;
      if (p.t < 0) continue;
      const k = clamp(p.t / p.dur, 0, 1);
      const e = ease(k);
      const x = lerp(p.x0, p.x1, e);
      const y = lerp(p.y0, p.y1, e) + Math.sin(k * Math.PI) * -28 * (1 - cfg.grip * 0.3);
      const rot = p.rot * e + Math.sin(k * Math.PI * 2) * 9 * (1 - k);
      p.g.setAttribute("transform", "translate(" + x.toFixed(1) + "," + y.toFixed(1) + ") rotate(" + rot.toFixed(1) + ")");
      if (k >= 1) {
        p.g.setAttribute("transform", "translate(" + p.x1.toFixed(1) + "," + p.y1.toFixed(1) + ") rotate(" + p.rot.toFixed(1) + ")");
        if (view.trayG) view.trayG.appendChild(p.g);
        st.tray.push({ x: p.x1, y: p.y1, rot: p.rot });
        st.tween.splice(i, 1);
      }
    }
  }

  function stepGrit(dt) {
    for (let i = st.grit.length - 1; i >= 0; i--) {
      const p = st.grit[i];
      p.a += dt;
      if (p.a > p.life) { if (p.n.parentNode) p.n.parentNode.removeChild(p.n); st.grit.splice(i, 1); continue; }
      p.vy += 190 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const op = 1 - p.a / p.life;
      if (p.fade) {
        p.n.setAttribute("x2", (p.x + 6).toFixed(1));
        p.n.setAttribute("y2", (p.y + 6).toFixed(1));
        p.n.setAttribute("transform", "translate(0,0)");
      } else {
        p.n.setAttribute("transform", "translate(" + p.x.toFixed(1) + "," + p.y.toFixed(1) + ") rotate(" + (p.rot * p.a * 3).toFixed(0) + ")");
      }
      p.n.setAttribute("opacity", op.toFixed(2));
    }
  }

  /* ============================================================
     AMBIENT ANIMATION
     ============================================================ */
  function ambient(dt) {
    anim += dt;
    if (view.beltLines) {
      // treads only creep forward while logs are actually moving
      const spd = st.phase === "idle" ? 0 : 26;
      const shift = (anim * spd * cfg.speed) % 20;
      view.beltLines.setAttribute("transform", "translate(" + shift.toFixed(2) + ",0)");
    }
    if (boxShake > 0.001) {
      boxShake = Math.max(0, boxShake - dt * 4.2);
      const s = boxShake;
      const dx = (Math.random() - 0.5) * 3.4 * s;
      const dy = (Math.random() - 0.5) * 2.6 * s;
      if (view.box) view.box.setAttribute("transform", "translate(" + dx.toFixed(2) + "," + dy.toFixed(2) + ")");
    } else if (view.box) {
      view.box.setAttribute("transform", "translate(0,0)");
    }
    if (st.phase === "saw") {
      const on = 0.55 + Math.random() * 0.28;
      if (view.glow) view.glow.setAttribute("opacity", String(on));
      if (view.sawArc) {
        view.sawArc.setAttribute("opacity", String(on));
        view.sawArc.setAttribute("stroke-dashoffset", String((-anim * 260) % 12));
      }
      if (view.mouth) view.mouth.setAttribute("fill", Math.random() < 0.5 ? "#33261a" : "#161a20");
    } else {
      if (view.glow) view.glow.setAttribute("opacity", "0");
      if (view.sawArc) view.sawArc.setAttribute("opacity", "0");
      if (view.mouth) view.mouth.setAttribute("fill", "#161a20");
    }
    const wrap = $("wrap");
    if (wrap) {
      if (st.phase === "saw") wrap.classList.add("cutting"); else wrap.classList.remove("cutting");
      if (st.phase === "burst" || (st.phase === "eject" && st.ejectT < 0.4)) wrap.classList.add("popping");
      else wrap.classList.remove("popping");
    }
  }

  /* ============================================================
     RAF LOOP
     ============================================================ */
  function frame(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;
    if (!paused) { update(dt); ambient(dt); }
    requestAnimationFrame(frame);
  }

  /* ============================================================
     UI WIRING
     ============================================================ */
  function restart() {
    st.logsOut = 0;
    st.blocksOut = 0;
    st.tray = [];
    st.grit.forEach((p) => { if (p.n.parentNode) p.n.parentNode.removeChild(p.n); });
    st.grit = [];
    st.tween = [];
    st.idle = 0;
    st.beltBase = BOX_L - LOG_LEN - QUEUE_GAP;
    if (view.trayG) view.trayG.innerHTML = "";
    if (view.logLayer) view.logLayer.innerHTML = "";
    st.queue = [];
    refillQueue();
    enter("feed");
    paintStats();
  }

  function bindUI() {
    document.querySelectorAll("[data-wood]").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("[data-wood]").forEach((o) => o.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
        const w = woodByName(b.getAttribute("data-wood"));
        cfg.wood = w.id;
        const wg = b.getAttribute("data-grip");
        setGrip(wg ? parseFloat(wg) : 0.3);
        st.queue = [];
        st.beltBase = BOX_L - LOG_LEN - QUEUE_GAP;
        refillQueue();
        paintStats();
      });
    });

    const feed = $("feedOne");
    if (feed) feed.addEventListener("click", () => {
      actx();
      if (st.phase === "idle") { enter("feed"); }
      else if (st.phase === "clear") { st.t = T.clear + 1; }
    });

    const auto = $("autoToggle");
    if (auto) auto.addEventListener("click", () => {
      cfg.auto = !cfg.auto;
      auto.setAttribute("aria-pressed", cfg.auto ? "true" : "false");
      auto.textContent = cfg.auto ? (auto.getAttribute("data-on") || "Auto: on") : (auto.getAttribute("data-off") || "Auto: off");
      if (cfg.auto && st.phase === "idle") { enter("feed"); }
    });

    const grip = $("grip");
    if (grip) grip.addEventListener("input", () => setGrip(parseFloat(grip.value)));
    const dust = $("dust");
    if (dust) dust.addEventListener("input", () => {
      cfg.dust = parseFloat(dust.value);
      const dv = $("dustVal");
      if (dv) dv.textContent = cfg.dust.toFixed(1);
    });
    const speed = $("speed");
    if (speed) speed.addEventListener("input", () => {
      cfg.speed = parseFloat(speed.value);
      const sv = $("speedVal");
      if (sv) sv.textContent = cfg.speed.toFixed(2) + "x";
    });
    const sound = $("sound");
    if (sound) sound.addEventListener("change", () => { cfg.sound = sound.checked; });
    const hap = $("haptics");
    if (hap) hap.addEventListener("change", () => { cfg.haptics = hap.checked; });

    const reset = $("resetAll");
    if (reset) reset.addEventListener("click", () => { actx(); restart(); });

    const scene = $("scene");
    if (scene) scene.addEventListener("click", () => {
      actx();
      if (st.phase === "idle") { enter("feed"); }
    });

    document.addEventListener("keydown", (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        paused = !paused;
        const c = $("coach");
        if (c) {
          c.textContent = paused ? (TXT.paused || "Paused") : (TXT.resume || "Running");
          c.classList.remove("gone");
        }
      } else if (e.key === "r" || e.key === "R") {
        restart();
      }
    });

    const coach = $("coach");
    if (coach) setTimeout(() => coach.classList.add("gone"), 4600);
  }

  function setGrip(v) {
    cfg.grip = clamp(v, 0, 1);
    const g = $("grip");
    if (g) g.value = cfg.grip.toFixed(2);
    const gv = $("gripVal");
    if (gv) gv.textContent = Math.round(cfg.grip * 100) + "%";
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    mount();
    bindUI();
    // keep the scene fitted when the window or the stage box resizes
    if (typeof ResizeObserver === "function") {
      const host = $("scene");
      if (host) new ResizeObserver(fitScene).observe(host);
    } else {
      window.addEventListener("resize", fitScene);
    }
    refillQueue();
    paintStats();
    enter("feed");
    requestAnimationFrame(frame);
    window.__saw = {
      st: st, cfg: cfg, view: view, pausedGet: () => paused,
      enter: enter, takeHeadLog: takeHeadLog, paintStats: paintStats, restart: restart
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
