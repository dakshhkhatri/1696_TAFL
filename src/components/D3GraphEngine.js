import * as d3 from 'd3';

const C = {
  normal: { bg: '#0f172a', stroke: '#64748b', text: '#e5eefc' },
  start:  { bg: '#052e2b', stroke: '#10b981', text: '#6ee7b7' },
  accept: { bg: '#3a0f18', stroke: '#f43f5e', text: '#fda4af' },
  both:   { bg: '#3b2a0a', stroke: '#f59e0b', text: '#fcd34d' },
  active: { bg: '#0b2447', stroke: '#38bdf8', text: '#7dd3fc' },
  edgeNormal:   '#93c5fd',
  edgeEps:      '#38bdf8',
  labelText:    '#e2e8f0',
  labelTextEps: '#7dd3fc',
  labelBg:      'rgba(15, 23, 42, 0.85)',
  labelStroke:  'rgba(148, 163, 184, 0.22)',
  newNodeStroke: '#f8fafc',
  newEdge:       '#f8fafc',
  oldFade:    0.52,
  canvasGlow: 'rgba(56, 189, 248, 0.03)'
};

const NODE_R        = 24;
const ACCEPT_R      = 30;
const START_ARROW_X = -42;

const graphPositionStore = new Map();

// ─── Utilities ────────────────────────────────────────────────────────────────

function safeBBox(node) {
  try { return node.getBBox(); }
  catch { return { x: 0, y: 0, width: 1, height: 1 }; }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function edgeKey(t) { return `${t.from}|${t.sym}|${t.to}`; }

function buildSignature(data, mode, persistKey = '') {
  const isStepLayout = !!data.layout_hint;
  if (persistKey && !isStepLayout) return persistKey;
  const accepts = data.accept_states?.length
    ? [...data.accept_states]
    : (data.accept !== undefined && data.accept !== null ? [data.accept] : []);
  return JSON.stringify({
    mode, start: data.start, accepts,
    states: [...(data.states || [])].sort(),
    transitions: [...(data.transitions || [])].map((t) => `${t.from}|${t.sym}|${t.to}`).sort(),
    layout_hint: data.layout_hint || ''
  });
}

function formatDfaSubLabel(raw) {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return '';
  if (raw.length === 1 && raw[0] === 'Dead') return '{Dead}';
  const mapped = raw.map((x) => {
    if (typeof x === 'number') return `q${x}`;
    if (typeof x === 'string' && /^\d+$/.test(x)) return `q${x}`;
    return String(x);
  });
  return `{${mapped.join(',')}}`;
}

function buildAdj(transitions) {
  const out = new Map();
  const incoming = new Map();
  transitions.forEach((t) => {
    if (!out.has(t.from)) out.set(t.from, []);
    if (!incoming.has(t.to)) incoming.set(t.to, []);
    out.get(t.from).push(t);
    incoming.get(t.to).push(t);
  });
  return { out, incoming };
}

function setNodePos(nodeMap, id, x, y) {
  if (nodeMap[id]) { nodeMap[id].x = x; nodeMap[id].y = y; }
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function detectUnionLayout(data) {
  const start = data.start;
  const accepts = data.accept_states?.length
    ? data.accept_states
    : (data.accept !== undefined && data.accept !== null ? [data.accept] : []);
  if (start == null || accepts.length !== 1) return null;
  const accept = accepts[0];
  const { out, incoming } = buildAdj(data.transitions || []);
  const startOut = (out.get(start) || []).filter((t) => t.sym === 'ε');
  const acceptIn = (incoming.get(accept) || []).filter((t) => t.sym === 'ε');
  if (startOut.length !== 2 || acceptIn.length !== 2) return null;
  return { start, accept, branchStarts: startOut.map((t) => t.to), branchEnds: acceptIn.map((t) => t.from) };
}

function shortestLevelsFromStart(states, start, transitions) {
  const out = new Map();
  states.forEach((s) => out.set(s, []));
  transitions.forEach((t) => {
    if (!out.has(t.from)) out.set(t.from, []);
    out.get(t.from).push(t.to);
  });
  const level = {};
  if (start == null) return level;
  const q = [start];
  level[start] = 0;
  while (q.length) {
    const u = q.shift();
    const base = level[u];
    (out.get(u) || []).forEach((v) => {
      if (level[v] === undefined) { level[v] = base + 1; q.push(v); }
    });
  }
  return level;
}

function reverseDistanceToAccept(states, accepts, transitions) {
  const incoming = new Map();
  states.forEach((s) => incoming.set(s, []));
  transitions.forEach((t) => {
    if (!incoming.has(t.to)) incoming.set(t.to, []);
    incoming.get(t.to).push(t.from);
  });
  const dist = {};
  const q = [];
  accepts.forEach((a) => { dist[a] = 0; q.push(a); });
  while (q.length) {
    const u = q.shift();
    const base = dist[u];
    (incoming.get(u) || []).forEach((v) => {
      if (dist[v] === undefined) { dist[v] = base + 1; q.push(v); }
    });
  }
  return dist;
}

function assignGenericStepLayout(nodes, data, W, H) {
  const safeNodes = nodes.filter(Boolean);
  const nodeMap = {};
  safeNodes.forEach((n) => { nodeMap[n.id] = n; });
  const states = safeNodes.map((n) => n.id);
  const transitions = data.transitions || [];
  const start = data.start;
  const accepts = data.accept_states?.length
    ? data.accept_states
    : (data.accept !== undefined && data.accept !== null ? [data.accept] : []);

  const levels = shortestLevelsFromStart(states, start, transitions);
  const revDist = reverseDistanceToAccept(states, accepts, transitions);
  const { out } = buildAdj(transitions);

  const firstHop = {};
  if (start != null) {
    firstHop[start] = String(start);
    const q = [start];
    while (q.length) {
      const u = q.shift();
      const outs = [...(out.get(u) || [])].sort((a, b) => {
        const ra = revDist[a.to] ?? 999;
        const rb = revDist[b.to] ?? 999;
        return ra - rb || String(a.to).localeCompare(String(b.to));
      });
      outs.forEach((t, idx) => {
        const v = t.to;
        if (firstHop[v] === undefined) {
          firstHop[v] = u === start ? `${idx}` : firstHop[u];
          q.push(v);
        }
      });
    }
  }

  safeNodes.forEach((n) => { if (levels[n.id] === undefined) levels[n.id] = 1; });

  const grouped = {};
  safeNodes.forEach((n) => {
    const lv = levels[n.id];
    if (!grouped[lv]) grouped[lv] = [];
    grouped[lv].push(n);
  });

  const levelNums = Object.keys(grouped).map(Number).sort((a, b) => a - b);
  const leftPad  = 120;
  const rightPad = 100;
  const usableW  = Math.max(300, W - leftPad - rightPad);
  const maxLevel = Math.max(...levelNums, 1);
  const xGap     = Math.max(160, usableW / Math.max(maxLevel, 1));

  levelNums.forEach((lv) => {
    const arr = grouped[lv];
    arr.sort((a, b) => {
      const fa = firstHop[a.id] ?? '999';
      const fb = firstHop[b.id] ?? '999';
      const ra = revDist[a.id] ?? 999;
      const rb = revDist[b.id] ?? 999;
      return fa.localeCompare(fb) || ra - rb || String(a.id).localeCompare(String(b.id));
    });

    const groupBuckets = {};
    arr.forEach((n) => {
      const key = firstHop[n.id] ?? '999';
      if (!groupBuckets[key]) groupBuckets[key] = [];
      groupBuckets[key].push(n);
    });

    const bucketKeys  = Object.keys(groupBuckets).sort();
    const bucketCount = bucketKeys.length;
    const bucketGap   = Math.max(110, H * 0.20);
    const baseCenter  = H / 2;

    bucketKeys.forEach((key, bi) => {
      const bucket = groupBuckets[key];
      const bucketCenter = baseCenter + (bi - (bucketCount - 1) / 2) * bucketGap;
      const nodeGap = Math.max(95, H * 0.17);
      bucket.forEach((n, i) => {
        n.x = leftPad + lv * xGap;
        n.y = bucketCenter + (i - (bucket.length - 1) / 2) * nodeGap;
      });
    });
  });

  return true;
}

function assignSpecialLayout(nodes, data, W, H, mode) {
  const nodeMap = {};
  nodes.forEach((n) => { nodeMap[n.id] = n; });
  const hint    = data.layout_hint || '';
  const start   = data.start;
  const accept  = data.accept_states?.length
    ? data.accept_states[0]
    : (data.accept ?? data.accept_state ?? null);

  const centerY   = H / 2 + 6;
  const topY      = centerY - Math.min(110, H * 0.22);
  const botY      = centerY + Math.min(110, H * 0.22);
  const leftX     = Math.max(120, W * 0.12);
  const midLeftX  = Math.max(260, W * 0.38);
  const midRightX = Math.max(midLeftX + 160, W * 0.68);
  const rightX    = Math.min(W - 120, W * 0.88);

  if (mode === 'nfa' && hint === 'union') {
    const shape = detectUnionLayout(data);
    if (shape) {
      setNodePos(nodeMap, shape.start,  leftX,  centerY);
      setNodePos(nodeMap, shape.accept, rightX, centerY);
      const [bs1, bs2] = shape.branchStarts;
      const [be1, be2] = shape.branchEnds;
      const e1 = (data.transitions || []).find((t) => t.from === bs1 && t.sym !== 'ε');
      const e2 = (data.transitions || []).find((t) => t.from === bs2 && t.sym !== 'ε');
      let upperStart = bs1, lowerStart = bs2, upperEnd = be1, lowerEnd = be2;
      if (e1 && e2 && String(e1.sym) > String(e2.sym)) {
        upperStart = bs2; lowerStart = bs1; upperEnd = be2; lowerEnd = be1;
      }
      setNodePos(nodeMap, upperStart, midLeftX,  topY);
      setNodePos(nodeMap, upperEnd,   midRightX, topY);
      setNodePos(nodeMap, lowerStart, midLeftX,  botY);
      setNodePos(nodeMap, lowerEnd,   midRightX, botY);
      return true;
    }
  }

  if (mode === 'nfa' && hint === 'star') {
    return assignGenericStepLayout(nodes, data, W, H);
  }

  if (mode === 'nfa' && (hint === 'symbol' || hint === 'epsilon')) {
    if ((data.states || []).length === 2) {
      setNodePos(nodeMap, start,  Math.max(180, W * 0.30), centerY);
      setNodePos(nodeMap, accept, Math.min(W - 180, W * 0.70), centerY);
      return true;
    }
  }

  return false;
}

// ─── Edge path computation ────────────────────────────────────────────────────

function computeEdgePath(d, nodeMap) {
  const s = nodeMap[d.from];
  const t = nodeMap[d.to];
  if (!s || !t) return '';
  const sx = s.x, sy = s.y, tx = t.x, ty = t.y;

  if (d.isSelf) {
    const loopR = 36;
    return `M ${sx} ${sy - NODE_R} C ${sx + loopR} ${sy - 85}, ${sx - loopR} ${sy - 85}, ${sx} ${sy - NODE_R}`;
  }

  const dx = tx - sx, dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / dist, uy = dy / dist;
  const x1 = sx + ux * (NODE_R + 4);
  const y1 = sy + uy * (NODE_R + 4);
  const x2 = tx - ux * (NODE_R + 14);
  const y2 = ty - uy * (NODE_R + 14);

  let bend = 0;
  if (d.hasReverse) {
    bend = String(d.from) < String(d.to) ? -55 : 55;
  } else if (d.isEps) {
    bend = 12;
  } else {
    bend = 8;
  }

  if (Math.abs(bend) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const mx = (x1 + x2) / 2 - uy * bend;
  const my = (y1 + y2) / 2 + ux * bend;
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

// ─── Label layout with collision repulsion ────────────────────────────────────

function applyEdgeLabelLayout(edgeLabelGroup, edge) {
  const positions = [];

  edgeLabelGroup.each(function(d, i) {
    const group    = d3.select(this);
    const pathNode = edge.nodes()[i];
    if (!pathNode) { positions.push(null); return; }
    const totalLen = pathNode.getTotalLength();
    if (totalLen < 1) { positions.push(null); return; }

    const pos   = d.isSelf ? 0.20 : 0.50;
    const p     = pathNode.getPointAtLength(totalLen * pos);
    const pPrev = pathNode.getPointAtLength(Math.max(0, totalLen * (pos - 0.06)));
    const pNext = pathNode.getPointAtLength(Math.min(totalLen, totalLen * (pos + 0.06)));

    const tvx = pNext.x - pPrev.x, tvy = pNext.y - pPrev.y;
    const tlen = Math.sqrt(tvx * tvx + tvy * tvy) || 1;
    const nx = -tvy / tlen, ny = tvx / tlen;

    let offset = d.isSelf ? 24 : d.isEps ? 14 : 11;
    if (d.hasReverse) offset = String(d.from) < String(d.to) ? -28 : 28;

    const textNode = group.select('text').node();
    const tb = safeBBox(textNode);
    const w  = Math.max(tb.width + 14, 20);
    const h  = Math.max(tb.height + 8, 18);
    positions.push({ lx: p.x + nx * offset, ly: p.y + ny * offset, w, h });
  });

  // 5-iteration repulsion
  const THRESH = 42;
  for (let iter = 0; iter < 5; iter++) {
    for (let a = 0; a < positions.length; a++) {
      if (!positions[a]) continue;
      for (let b = a + 1; b < positions.length; b++) {
        if (!positions[b]) continue;
        const ddx = positions[b].lx - positions[a].lx;
        const ddy = positions[b].ly - positions[a].ly;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dist < THRESH && dist > 0.01) {
          const push = (THRESH - dist) / 2 + 1;
          const ux2 = ddx / dist, uy2 = ddy / dist;
          positions[a].lx -= ux2 * push; positions[a].ly -= uy2 * push;
          positions[b].lx += ux2 * push; positions[b].ly += uy2 * push;
        }
      }
    }
  }

  edgeLabelGroup.each(function(_, i) {
    const p = positions[i];
    if (!p) return;
    const group = d3.select(this);
    group.attr('transform', `translate(${p.lx},${p.ly})`);
    group.select('rect').attr('x', -p.w / 2).attr('y', -p.h / 2).attr('width', p.w).attr('height', p.h);
  });
}

// ─── Fit view ─────────────────────────────────────────────────────────────────

function fitGraphView(svg, graphLayer, gEdges, gEdgeLabels, gNodes, zoom, W, H, animated) {
  const eb = safeBBox(gEdges.node());
  const lb = safeBBox(gEdgeLabels.node());
  const nb = safeBBox(gNodes.node());
  const pad = 50;
  const minX = Math.min(eb.x, lb.x, nb.x) - pad;
  const minY = Math.min(eb.y, lb.y, nb.y) - pad;
  const maxX = Math.max(eb.x + eb.width,  lb.x + lb.width,  nb.x + nb.width)  + pad;
  const maxY = Math.max(eb.y + eb.height, lb.y + lb.height, nb.y + nb.height) + pad;
  const cw = maxX - minX, ch = maxY - minY;
  if (cw < 1 || ch < 1) return;
  const scale  = Math.min(0.95, Math.min(W / cw, H / ch));
  const tx     = (W - cw * scale) / 2 - minX * scale;
  const ty     = (H - ch * scale) / 2 - minY * scale;
  const target = d3.zoomIdentity.translate(tx, ty).scale(scale);
  if (animated) {
    svg.transition().duration(520).ease(d3.easeCubicInOut).call(zoom.transform, target);
  } else {
    svg.call(zoom.transform, target);
  }
}

// ─── SVG scaffold ─────────────────────────────────────────────────────────────

function createSvgScaffold(container, W, H) {
  const svg = d3.select(container)
    .append('svg')
    .attr('width', W).attr('height', H)
    .style('display', 'block').style('background', 'transparent')
    .style('border-radius', '18px').style('overflow', 'hidden');

  const defs = svg.append('defs');

  const shadow = defs.append('filter').attr('id', 'soft-shadow')
    .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
  shadow.append('feDropShadow').attr('dx', 0).attr('dy', 4).attr('stdDeviation', 6)
    .attr('flood-color', '#020617').attr('flood-opacity', 0.32);

  const glow = defs.append('filter').attr('id', 'new-node-glow')
    .attr('x', '-100%').attr('y', '-100%').attr('width', '300%').attr('height', '300%');
  glow.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 4).attr('result', 'blur');
  const merge = glow.append('feMerge');
  merge.append('feMergeNode').attr('in', 'blur');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');

  const grad = defs.append('linearGradient').attr('id', 'canvas-grad')
    .attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '100%');
  grad.append('stop').attr('offset', '0%').attr('stop-color', '#0f172a');
  grad.append('stop').attr('offset', '100%').attr('stop-color', '#020617');

  defs.append('marker').attr('id', 'arrow-default')
    .attr('viewBox', '0 -2.5 5 5').attr('refX', 5).attr('refY', 0)
    .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-2.5L5,0L0,2.5Z').attr('fill', C.edgeNormal);

  defs.append('marker').attr('id', 'arrow-eps')
    .attr('viewBox', '0 -2.5 5 5').attr('refX', 5).attr('refY', 0)
    .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-2.5L5,0L0,2.5Z').attr('fill', C.edgeEps);

  defs.append('marker').attr('id', 'arrow-new')
    .attr('viewBox', '0 -2.5 5 5').attr('refX', 5).attr('refY', 0)
    .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-2.5L5,0L0,2.5Z').attr('fill', C.newEdge);

  const root = svg.append('g');
  root.append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', H)
    .attr('rx', 18).attr('fill', 'url(#canvas-grad)');
  root.append('circle').attr('cx', W * 0.12).attr('cy', H * 0.18)
    .attr('r', Math.max(70, Math.min(W, H) * 0.06)).attr('fill', C.canvasGlow);

  const graphLayer  = root.append('g');
  const gEdges      = graphLayer.append('g');
  const gEdgeLabels = graphLayer.append('g');
  const gNodes      = graphLayer.append('g');

  const zoom = d3.zoom().scaleExtent([0.45, 2.2])
    .on('zoom', (event) => { graphLayer.attr('transform', event.transform); });
  svg.call(zoom);

  return { svg, graphLayer, gEdges, gEdgeLabels, gNodes, zoom };
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function renderElements(gEdges, gEdgeLabels, gNodes, nodes, mergedTransitions,
                        newStatesSet, newTransitionsSet, highlightStates, mode) {
  const edge = gEdges.selectAll('.edge-path')
    .data(mergedTransitions, (d) => d.key)
    .enter().append('path')
    .attr('class', 'edge-path')
    .attr('fill', 'none')
    .attr('stroke-width', (d) => (d.isNew ? 3.4 : 2.8))
    .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
    .attr('vector-effect', 'non-scaling-stroke')
    .attr('filter', 'url(#soft-shadow)')
    .attr('opacity', (d) => (d.isNew ? 1 : newTransitionsSet.size || newStatesSet.size ? C.oldFade : 0.96));

  const edgeLabelGroup = gEdgeLabels.selectAll('.edge-label-group')
    .data(mergedTransitions, (d) => d.key)
    .enter().append('g').attr('class', 'edge-label-group')
    .attr('opacity', (d) => (d.isNew ? 0 : newTransitionsSet.size || newStatesSet.size ? C.oldFade : 1));

  edgeLabelGroup.append('rect').attr('rx', 8).attr('ry', 8)
    .attr('fill', C.labelBg).attr('stroke', C.labelStroke).attr('stroke-width', 1);

  edgeLabelGroup.append('text').attr('class', 'edge-label-text')
    .attr('font-size', (d) => (d.isNew ? 13 : 12))
    .attr('font-weight', (d) => (d.isNew ? 700 : 600))
    .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
    .attr('fill', (d) => (d.isEps ? C.labelTextEps : C.labelText))
    .attr('paint-order', 'stroke').attr('stroke', 'rgba(2, 6, 23, 0.78)')
    .attr('stroke-width', 2).attr('stroke-linejoin', 'round')
    .text((d) => d.label);

  const node = gNodes.selectAll('.node')
    .data(nodes, (d) => d.id)
    .enter().append('g').attr('class', 'node')
    .style('cursor', 'grab')
    .attr('opacity', (d) => (d.isNew ? 0 : 1));

  const mainCircle = node.append('circle')
    .attr('r', (d) => (d.isNew ? 0 : NODE_R))
    .attr('fill', (d) => (highlightStates.has(d.id) ? C.active.bg : C[d.type].bg))
    .attr('stroke', (d) => {
      if (highlightStates.has(d.id)) return C.active.stroke;
      if (d.isNew) return C.newNodeStroke;
      return C[d.type].stroke;
    })
    .attr('stroke-width', (d) => (d.isNew ? 3 : 2.2))
    .attr('filter', (d) => (d.isNew ? 'url(#new-node-glow)' : 'url(#soft-shadow)'))
    .attr('opacity', (d) => (d.isNew ? 1 : newStatesSet.size ? C.oldFade : 1));

  const acceptRing = node.filter((d) => d.type === 'accept' || d.type === 'both')
    .append('circle')
    .attr('r', (d) => (d.isNew ? 0 : ACCEPT_R))
    .attr('fill', 'none')
    .attr('stroke', (d) => {
      if (highlightStates.has(d.id)) return C.active.stroke;
      if (d.isNew) return C.newNodeStroke;
      return C[d.type].stroke;
    })
    .attr('stroke-width', 1.8)
    .attr('opacity', (d) => (d.isNew ? 1 : newStatesSet.size ? C.oldFade : 1));

  node.filter((d) => d.type === 'start' || d.type === 'both')
    .append('text').attr('class', 'start-arrow')
    .attr('x', START_ARROW_X).attr('y', 5)
    .attr('fill', (d) => (d.isNew ? C.newNodeStroke : C.start.stroke))
    .attr('font-size', 18).attr('font-weight', 700)
    .attr('opacity', (d) => (d.isNew ? 1 : newStatesSet.size ? C.oldFade : 1))
    .text('▶');

  const label = node.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', mode === 'dfa' && nodes.some((n) => n.sublabel) ? -2 : 5)
    .attr('fill', (d) => (highlightStates.has(d.id) ? C.active.text : C[d.type].text))
    .attr('font-size', 13).attr('font-weight', 700).attr('letter-spacing', '0.2px')
    .attr('opacity', (d) => (d.isNew ? 0 : newStatesSet.size ? C.oldFade : 1))
    .text((d) => d.label);

  const sublabel = node.append('text')
    .attr('text-anchor', 'middle').attr('dy', 15)
    .attr('fill', '#bfd2ef').attr('font-size', 9.5).attr('font-weight', 600)
    .attr('letter-spacing', '0.1px')
    .attr('opacity', (d) => (d.sublabel ? (d.isNew ? 0 : newStatesSet.size ? C.oldFade : 0.92) : 0))
    .text((d) => d.sublabel);

  return { edge, edgeLabelGroup, node, mainCircle, acceptRing, label, sublabel };
}

function animateNewElements(node, mainCircle, acceptRing, label, sublabel,
                            edge, edgeLabelGroup, getMarker) {
  const STEP_NODE_DELAY = 220, STEP_EDGE_DELAY = 300;
  const NODE_GROW_MS = 320, EDGE_DRAW_MS = 460;

  const newNodeSel   = node.filter((d) => d.isNew);
  const newNodes     = newNodeSel.data();
  const nodeDelayMap = new Map();
  newNodes.forEach((d, i) => { nodeDelayMap.set(d.id, i * STEP_NODE_DELAY); });
  const totalNodePhaseTime = newNodes.length * STEP_NODE_DELAY + NODE_GROW_MS;

  newNodeSel.transition().delay((d) => nodeDelayMap.get(d.id) || 0).duration(100).attr('opacity', 1);

  mainCircle.filter((d) => d.isNew)
    .transition().delay((d) => nodeDelayMap.get(d.id) || 0)
    .duration(NODE_GROW_MS).ease(d3.easeBackOut.overshoot(1.15)).attr('r', NODE_R);

  acceptRing.filter((d) => d.isNew)
    .transition().delay((d) => nodeDelayMap.get(d.id) || 0)
    .duration(NODE_GROW_MS).ease(d3.easeBackOut.overshoot(1.1)).attr('r', ACCEPT_R);

  label.filter((d) => d.isNew)
    .transition().delay((d) => (nodeDelayMap.get(d.id) || 0) + 140).duration(160).attr('opacity', 1);

  sublabel.filter((d) => d.isNew)
    .transition().delay((d) => (nodeDelayMap.get(d.id) || 0) + 180).duration(160)
    .attr('opacity', (d) => (d.sublabel ? 0.92 : 0));

  requestAnimationFrame(() => {
    edge.filter((d) => d.isNew).each(function(d, i) {
      const path  = d3.select(this);
      const total = this.getTotalLength();
      if (total === 0) return;
      const delay = totalNodePhaseTime + i * STEP_EDGE_DELAY;
      path.attr('stroke-dasharray', `${total} ${total}`).attr('stroke-dashoffset', total)
        .attr('marker-end', getMarker(d))
        .transition().delay(delay).duration(EDGE_DRAW_MS).ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', 0)
        .on('end', function(_, datum) {
          d3.select(this)
            .attr('stroke-dasharray', datum.isNew ? '8,5' : (datum.isEps ? '7,5' : null))
            .attr('marker-end', getMarker(datum));
        });
    });

    edgeLabelGroup.filter((d) => d.isNew)
      .transition().delay((d, i) => totalNodePhaseTime + i * STEP_EDGE_DELAY + 220).duration(160)
      .attr('opacity', 1);
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function drawGraph(container, data, mode, highlightStates = new Set(), persistKey = '') {
  if (!container || !data) return () => {};

  const W = container.clientWidth  || container.getBoundingClientRect().width  || 1000;
  const H = (container.clientHeight > 40 ? container.clientHeight : null)
          || container.getBoundingClientRect().height
          || 600;

  const isStepLayout   = !!data.layout_hint;
  const graphSignature = buildSignature(data, mode, persistKey);

  // ── Incremental mode: reuse existing SVG, only add new elements ────────────
  const canIncremental = (
    persistKey &&
    !isStepLayout &&
    container._gpKey === persistKey &&
    container._d3svg &&
    container._d3nodeMap
  );

  if (canIncremental) {
    const svg        = container._d3svg;
    const nodeMap    = container._d3nodeMap;
    const zoom       = container._d3zoom;
    const graphLayer = container._d3graphLayer;
    const gEdges      = container._d3gEdges;
    const gEdgeLabels = container._d3gEdgeLabels;
    const gNodes      = container._d3gNodes;

    const accepts = mode === 'dfa'
      ? new Set(data.accept_states || [])
      : new Set((data.accept_states && data.accept_states.length)
          ? data.accept_states
          : (data.accept !== undefined && data.accept !== null ? [data.accept] : []));

    const startId           = data.start;
    const newStatesSet      = new Set(data.new_states || []);
    const newTransitionsSet = new Set((data.new_transitions || []).map(edgeKey));
    const stateLabels       = data.state_labels || {};

    function getType(id) {
      const isStart = id === startId, isAccept = accepts.has(id);
      if (isStart && isAccept) return 'both';
      if (isStart) return 'start';
      if (isAccept) return 'accept';
      return 'normal';
    }

    // Add brand-new state objects to nodeMap
    const brandNewIds = (data.new_states || []).filter((id) => !nodeMap[id]);
    brandNewIds.forEach((id) => {
      nodeMap[id] = {
        id,
        label:    mode === 'dfa' ? `D${id}` : `q${id}`,
        sublabel: mode === 'dfa' ? formatDfaSubLabel(stateLabels[String(id)]) : '',
        type:     getType(id),
        isNew:    true,
        x: 0, y: 0
      };
    });

    // Re-layout all nodes so new ones get positions; preserve existing positions
    const allNodes = (data.states || []).filter((id) => id !== undefined && id !== null && nodeMap[id]).map((id) => nodeMap[id]);

    const prevPositions = {};
    allNodes.forEach((n) => { if (n) prevPositions[n.id] = { x: n.x, y: n.y }; });

    const specialPlaced = assignSpecialLayout(allNodes, data, W, H, mode);
    if (!specialPlaced) assignGenericStepLayout(allNodes, data, W, H);

    // Restore positions for existing nodes
    allNodes.forEach((n) => {
      if (!brandNewIds.includes(n.id)) {
        n.x = prevPositions[n.id].x;
        n.y = prevPositions[n.id].y;
      }
    });

    // Build full merged transitions
    const rawTransitions = (data.transitions || []).filter(
      (t) => t && nodeMap[t.from] && nodeMap[t.to] && t.sym !== undefined && t.sym !== null
    );
    const mergedMap = new Map();
    rawTransitions.forEach((t) => {
      const key = `${t.from}|${t.to}`;
      if (!mergedMap.has(key)) mergedMap.set(key, { from: t.from, to: t.to, syms: [], hasEps: false, isNew: false });
      const item = mergedMap.get(key);
      if (!item.syms.includes(String(t.sym))) item.syms.push(String(t.sym));
      if (String(t.sym) === 'ε') item.hasEps = true;
      if (newTransitionsSet.has(edgeKey(t))) item.isNew = true;
    });
    const mergedTransitions = [...mergedMap.values()].map((t, idx) => ({
      from: t.from, to: t.to,
      label: t.syms.sort().join(', '),
      isSelf: t.from === t.to,
      isEps: t.hasEps && t.syms.length === 1,
      isMixed: t.hasEps && t.syms.length > 1,
      isNew: t.isNew,
      hasReverse: !!mergedMap.get(`${t.to}|${t.from}`),
      key: `${t.from}|${t.to}|${idx}`
    }));

    function getMarker(d) {
      if (d.isNew) return 'url(#arrow-new)';
      return d.isEps ? 'url(#arrow-eps)' : 'url(#arrow-default)';
    }
    function getEdgeColor(d) {
      if (d.isNew) return C.newEdge;
      return d.isEps ? C.edgeEps : C.edgeNormal;
    }
    function edgePath(d) { return computeEdgePath(d, nodeMap); }

    // Add new node elements
    const newNodeData = brandNewIds.map((id) => nodeMap[id]).filter(Boolean);
    const newNodeSel = gNodes.selectAll('.node').data(newNodeData, (d) => d.id)
      .enter().append('g').attr('class', 'node').style('cursor', 'grab')
      .attr('opacity', 0).attr('transform', (d) => `translate(${d.x},${d.y})`);

    const newMainCircle = newNodeSel.append('circle').attr('r', 0)
      .attr('fill', (d) => C[d.type].bg).attr('stroke', C.newNodeStroke)
      .attr('stroke-width', 3).attr('filter', 'url(#new-node-glow)');

    newNodeSel.filter((d) => d.type === 'accept' || d.type === 'both')
      .append('circle').attr('r', 0).attr('fill', 'none')
      .attr('stroke', C.newNodeStroke).attr('stroke-width', 1.8);

    newNodeSel.filter((d) => d.type === 'start' || d.type === 'both')
      .append('text').attr('class', 'start-arrow')
      .attr('x', START_ARROW_X).attr('y', 5).attr('fill', C.newNodeStroke)
      .attr('font-size', 18).attr('font-weight', 700).text('▶');

    newNodeSel.append('text').attr('text-anchor', 'middle')
      .attr('dy', mode === 'dfa' && allNodes.some((n) => n.sublabel) ? -2 : 5)
      .attr('fill', (d) => C[d.type].text).attr('font-size', 13).attr('font-weight', 700)
      .attr('letter-spacing', '0.2px').attr('opacity', 0).text((d) => d.label);

    newNodeSel.append('text').attr('text-anchor', 'middle').attr('dy', 15)
      .attr('fill', '#bfd2ef').attr('font-size', 9.5).attr('font-weight', 600)
      .attr('letter-spacing', '0.1px').attr('opacity', 0).text((d) => d.sublabel);

    // Add new edge elements
    const existingEdgeKeys = new Set(gEdges.selectAll('.edge-path').data().map((d) => d.key));
    const newEdgeData = mergedTransitions.filter((t) => t.isNew && !existingEdgeKeys.has(t.key));

    const newEdgeSel = gEdges.selectAll('.edge-path-new')
      .data(newEdgeData, (d) => d.key).enter()
      .append('path').attr('class', 'edge-path edge-path-new')
      .attr('fill', 'none').attr('stroke-width', 3.4)
      .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
      .attr('vector-effect', 'non-scaling-stroke').attr('filter', 'url(#soft-shadow)')
      .attr('opacity', 1).attr('d', edgePath).attr('stroke', getEdgeColor)
      .attr('stroke-dasharray', '8,5').attr('marker-end', getMarker);

    const existingLabelKeys = new Set(gEdgeLabels.selectAll('.edge-label-group').data().map((d) => d.key));
    const newLabelData = mergedTransitions.filter((t) => t.isNew && !existingLabelKeys.has(t.key));

    const newLabelSel = gEdgeLabels.selectAll('.edge-label-group-new')
      .data(newLabelData, (d) => d.key).enter()
      .append('g').attr('class', 'edge-label-group edge-label-group-new').attr('opacity', 0);

    newLabelSel.append('rect').attr('rx', 8).attr('ry', 8)
      .attr('fill', C.labelBg).attr('stroke', C.labelStroke).attr('stroke-width', 1);
    newLabelSel.append('text').attr('class', 'edge-label-text')
      .attr('font-size', 13).attr('font-weight', 700)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('fill', (d) => (d.isEps ? C.labelTextEps : C.labelText))
      .attr('paint-order', 'stroke').attr('stroke', 'rgba(2, 6, 23, 0.78)')
      .attr('stroke-width', 2).attr('stroke-linejoin', 'round').text((d) => d.label);

    // Update all existing paths and node positions
    gEdges.selectAll('.edge-path').attr('d', edgePath);
    gNodes.selectAll('.node').attr('transform', (d) => `translate(${d.x},${d.y})`);
    applyEdgeLabelLayout(gEdgeLabels.selectAll('.edge-label-group'), gEdges.selectAll('.edge-path'));
    gEdges.lower(); gEdgeLabels.raise(); gNodes.raise();

    // Animate new nodes
    const STEP_NODE_DELAY = 220, STEP_EDGE_DELAY = 300;
    const NODE_GROW_MS = 320, EDGE_DRAW_MS = 460;
    const nodeDelayMap = new Map();
    newNodeData.forEach((d, i) => { nodeDelayMap.set(d.id, i * STEP_NODE_DELAY); });
    const totalNodePhaseTime = newNodeData.length * STEP_NODE_DELAY + NODE_GROW_MS;

    newNodeSel.transition().delay((d) => nodeDelayMap.get(d.id) || 0).duration(100).attr('opacity', 1);
    newMainCircle.transition().delay((d) => nodeDelayMap.get(d.id) || 0)
      .duration(NODE_GROW_MS).ease(d3.easeBackOut.overshoot(1.15)).attr('r', NODE_R);
    newNodeSel.filter((d) => d.type === 'accept' || d.type === 'both').select('circle:nth-child(2)')
      .transition().delay((d) => nodeDelayMap.get(d.id) || 0)
      .duration(NODE_GROW_MS).ease(d3.easeBackOut.overshoot(1.1)).attr('r', ACCEPT_R);
    newNodeSel.selectAll('text:not(.start-arrow)')
      .transition().delay((d) => (nodeDelayMap.get(d.id) || 0) + 140).duration(160).attr('opacity', 1);

    requestAnimationFrame(() => {
      newEdgeSel.each(function(d, i) {
        const path = d3.select(this);
        const total = this.getTotalLength();
        if (total === 0) return;
        const delay = totalNodePhaseTime + i * STEP_EDGE_DELAY;
        path.attr('stroke-dasharray', `${total} ${total}`).attr('stroke-dashoffset', total)
          .attr('marker-end', getMarker(d))
          .transition().delay(delay).duration(EDGE_DRAW_MS).ease(d3.easeCubicOut)
          .attr('stroke-dashoffset', 0)
          .on('end', function(_, datum) {
            d3.select(this).attr('stroke-dasharray', '8,5').attr('marker-end', getMarker(datum));
          });
      });
      newLabelSel.transition()
        .delay((d, i) => totalNodePhaseTime + i * STEP_EDGE_DELAY + 220).duration(160).attr('opacity', 1);

      requestAnimationFrame(() => {
        fitGraphView(svg, graphLayer, gEdges, gEdgeLabels, gNodes, zoom, W, H, true);
      });
    });

    // Drag on new nodes
    newNodeSel.call(d3.drag()
      .on('start', function(event) { event.sourceEvent?.stopPropagation?.(); d3.select(this).style('cursor', 'grabbing').raise(); })
      .on('drag', function(event, d) {
        d.x = clamp(event.x, 70, W - 70); d.y = clamp(event.y, 70, H - 70);
        gEdges.selectAll('.edge-path').attr('d', edgePath);
        gNodes.selectAll('.node').attr('transform', (nd) => `translate(${nd.x},${nd.y})`);
        applyEdgeLabelLayout(gEdgeLabels.selectAll('.edge-label-group'), gEdges.selectAll('.edge-path'));
      })
      .on('end', function() { d3.select(this).style('cursor', 'grab'); }));

    return () => {};
  }

  // ── Full redraw ────────────────────────────────────────────────────────────
  d3.select(container).selectAll('*').remove();
  container._gpKey = null; container._d3svg = null; container._d3nodeMap = null;
  container._d3zoom = null; container._d3graphLayer = null;
  container._d3gEdges = null; container._d3gEdgeLabels = null; container._d3gNodes = null;

  const { svg, graphLayer, gEdges, gEdgeLabels, gNodes, zoom } = createSvgScaffold(container, W, H);

  container._gpKey        = persistKey || null;
  container._d3svg        = svg;
  container._d3graphLayer = graphLayer;
  container._d3zoom       = zoom;
  container._d3gEdges     = gEdges;
  container._d3gEdgeLabels = gEdgeLabels;
  container._d3gNodes     = gNodes;

  const accepts = mode === 'dfa'
    ? new Set(data.accept_states || [])
    : new Set((data.accept_states && data.accept_states.length)
        ? data.accept_states
        : (data.accept !== undefined && data.accept !== null ? [data.accept] : []));

  const startId           = data.start;
  const newStatesSet      = new Set(data.new_states || []);
  const newTransitionsSet = new Set((data.new_transitions || []).map(edgeKey));
  const stateLabels       = data.state_labels || {};

  function getType(id) {
    const isStart = id === startId, isAccept = accepts.has(id);
    if (isStart && isAccept) return 'both';
    if (isStart) return 'start';
    if (isAccept) return 'accept';
    return 'normal';
  }

  const nodes = (data.states || []).filter((id) => id !== undefined && id !== null).map((id) => ({
    id,
    label:    mode === 'dfa' ? `D${id}` : `q${id}`,
    sublabel: mode === 'dfa' ? formatDfaSubLabel(stateLabels[String(id)]) : '',
    type:     getType(id),
    isNew:    newStatesSet.has(id),
    x: 0, y: 0
  }));

  const nodeMap = {};
  nodes.forEach((n) => { nodeMap[n.id] = n; });
  container._d3nodeMap = nodeMap;

  const rawTransitions = (data.transitions || []).filter(
    (t) => t && nodeMap[t.from] && nodeMap[t.to] && t.sym !== undefined && t.sym !== null
  );
  const mergedMap = new Map();
  rawTransitions.forEach((t) => {
    const key = `${t.from}|${t.to}`;
    if (!mergedMap.has(key)) mergedMap.set(key, { from: t.from, to: t.to, syms: [], hasEps: false, isNew: false });
    const item = mergedMap.get(key);
    if (!item.syms.includes(String(t.sym))) item.syms.push(String(t.sym));
    if (String(t.sym) === 'ε') item.hasEps = true;
    if (newTransitionsSet.has(edgeKey(t))) item.isNew = true;
  });
  const mergedTransitions = [...mergedMap.values()].map((t, idx) => ({
    from: t.from, to: t.to,
    label: t.syms.sort().join(', '),
    isSelf: t.from === t.to,
    isEps: t.hasEps && t.syms.length === 1,
    isMixed: t.hasEps && t.syms.length > 1,
    isNew: t.isNew,
    hasReverse: !!mergedMap.get(`${t.to}|${t.from}`),
    key: `${t.from}|${t.to}|${idx}`
  }));

  const specialPlaced = assignSpecialLayout(nodes, data, W, H, mode);
  if (!specialPlaced) assignGenericStepLayout(nodes, data, W, H);

  const allowSavedPositions = !data.layout_hint;
  const savedPositions = allowSavedPositions ? graphPositionStore.get(graphSignature) : null;
  if (savedPositions) {
    nodes.forEach((n) => {
      if (savedPositions[n.id]) { n.x = savedPositions[n.id].x; n.y = savedPositions[n.id].y; }
    });
  }

  function getMarker(d) {
    if (d.isNew) return 'url(#arrow-new)';
    return d.isEps ? 'url(#arrow-eps)' : 'url(#arrow-default)';
  }
  function getEdgeColor(d) {
    if (d.isNew) return C.newEdge;
    return d.isEps ? C.edgeEps : C.edgeNormal;
  }
  function edgePath(d) { return computeEdgePath(d, nodeMap); }

  const { edge, edgeLabelGroup, node, mainCircle, acceptRing, label, sublabel } =
    renderElements(gEdges, gEdgeLabels, gNodes, nodes, mergedTransitions,
                   newStatesSet, newTransitionsSet, highlightStates, mode);

  function savePositions() {
    if (data.layout_hint) return;
    const pos = {};
    nodes.forEach((n) => { pos[n.id] = { x: n.x, y: n.y }; });
    graphPositionStore.set(graphSignature, pos);
  }

  function updateScene() {
    edge.attr('d', edgePath).attr('stroke', getEdgeColor)
      .attr('stroke-dasharray', (d) => { if (d.isNew) return '8,5'; return d.isEps ? '7,5' : null; })
      .attr('marker-end', getMarker);
    node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    applyEdgeLabelLayout(edgeLabelGroup, edge);
    gEdges.lower(); gEdgeLabels.raise(); gNodes.raise();
  }

  updateScene();
  node.filter((d) => highlightStates.has(d.id)).raise();

  if (highlightStates.size) {
    mainCircle.attr('opacity', (d) => (highlightStates.has(d.id) ? 1 : 0.22));
    acceptRing.attr('opacity', (d) => (highlightStates.has(d.id) ? 1 : 0.22));
    label.attr('opacity', (d) => (highlightStates.has(d.id) ? 1 : 0.32));
    sublabel.attr('opacity', (d) => (highlightStates.has(d.id) && d.sublabel ? 0.95 : 0.18));
    edge.attr('opacity', 0.24);
    edgeLabelGroup.attr('opacity', 0.24);
  }

  node.call(d3.drag()
    .on('start', function(event) { event.sourceEvent?.stopPropagation?.(); d3.select(this).style('cursor', 'grabbing').raise(); })
    .on('drag', function(event, d) {
      d.x = clamp(event.x, 70, W - 70); d.y = clamp(event.y, 70, H - 70);
      updateScene();
    })
    .on('end', function() { d3.select(this).style('cursor', 'grab'); savePositions(); }));

  animateNewElements(node, mainCircle, acceptRing, label, sublabel, edge, edgeLabelGroup, getMarker);

  requestAnimationFrame(() => {
    fitGraphView(svg, graphLayer, gEdges, gEdgeLabels, gNodes, zoom, W, H, !savedPositions);
  });

  return () => {};
}
