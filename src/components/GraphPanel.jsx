import React, { useRef, useEffect, useMemo } from 'react';
import { drawGraph } from './D3GraphEngine';
import './GraphPanel.css';

function normalizeId(v) {
  if (v === null || v === undefined) return null;
  return String(v);
}

function normalizeTransition(t) {
  if (!t) return null;

  const from = normalizeId(t.from ?? t.source);
  const to = normalizeId(t.to ?? t.target);
  const sym = t.sym ?? t.symbol ?? t.label ?? 'ε';

  if (from === null || to === null) return null;

  return {
    from,
    to,
    sym: String(sym)
  };
}

function normalizeStateLabels(stateLabels) {
  if (!stateLabels || typeof stateLabels !== 'object') return {};

  const out = {};
  Object.entries(stateLabels).forEach(([key, value]) => {
    const id = normalizeId(key);
    if (id === null) return;

    if (Array.isArray(value)) {
      out[id] = value
        .map((v) => {
          if (v === null || v === undefined) return '';
          return typeof v === 'number' ? String(v) : String(v);
        })
        .filter(Boolean);
    } else if (value !== null && value !== undefined) {
      out[id] = [String(value)];
    }
  });

  return out;
}

export default function GraphPanel({
  data,
  mode = 'nfa',
  label = 'Automaton',
  highlightStates = new Set(),
  subtitle = '',
  persistKey = ''
}) {
  const containerRef = useRef(null);
  const cleanupRef = useRef(null);
  const resizeObserverRef = useRef(null);

  const normalizedData = useMemo(() => {
    if (!data) return null;

    const start = normalizeId(data.start ?? data.start_state ?? data.startState ?? null);
    const accept = normalizeId(data.accept ?? data.accept_state ?? data.acceptState ?? null);

    const states = Array.isArray(data.states)
      ? [...new Set(data.states.map(normalizeId).filter(Boolean))]
      : [];

    const transitions = Array.isArray(data.transitions)
      ? data.transitions.map(normalizeTransition).filter(Boolean)
      : [];

    const acceptStates = Array.isArray(data.accept_states)
      ? [...new Set(data.accept_states.map(normalizeId).filter(Boolean))]
      : [];

    const newStates = Array.isArray(data.new_states)
      ? [...new Set(data.new_states.map(normalizeId).filter(Boolean))]
      : [];

    const newTransitions = Array.isArray(data.new_transitions)
      ? data.new_transitions.map(normalizeTransition).filter(Boolean)
      : [];

    const stateLabels = normalizeStateLabels(data.state_labels);

    return {
      ...data,
      start,
      accept,
      states,
      transitions,
      accept_states: acceptStates,
      new_states: newStates,
      new_transitions: newTransitions,
      state_labels: stateLabels
    };
  }, [data]);

  const safeHighlightStates = useMemo(() => {
    const set = new Set();
    if (!highlightStates) return set;

    for (const s of highlightStates) {
      const id = normalizeId(s);
      if (id !== null) set.add(id);
    }
    return set;
  }, [highlightStates]);

  const accepts = useMemo(() => {
    if (!normalizedData) return [];

    if (Array.isArray(normalizedData.accept_states) && normalizedData.accept_states.length > 0) {
      return normalizedData.accept_states;
    }

    return normalizedData.accept !== null && normalizedData.accept !== undefined
      ? [normalizedData.accept]
      : [];
  }, [normalizedData]);

  const newStatesCount = normalizedData?.new_states?.length || 0;
  const newTransitionsCount = normalizedData?.new_transitions?.length || 0;
  const hasHighlights = !!safeHighlightStates?.size;

  useEffect(() => {
    if (!containerRef.current || !normalizedData) return;

    cleanupRef.current = drawGraph(
      containerRef.current,
      normalizedData,
      mode,
      safeHighlightStates,
      persistKey
    );

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [normalizedData, mode, safeHighlightStates, persistKey]);

  useEffect(() => {
    if (!containerRef.current || !normalizedData) return;

    const handleResize = () => {
      if (!containerRef.current) return;

      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      cleanupRef.current = drawGraph(
        containerRef.current,
        normalizedData,
        mode,
        safeHighlightStates,
        persistKey
      );
    };

    resizeObserverRef.current = new ResizeObserver(() => {
      handleResize();
    });

    resizeObserverRef.current.observe(containerRef.current);

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [normalizedData, mode, safeHighlightStates, persistKey]);

  if (!normalizedData) return null;

  return (
    <div className="gp-wrap">
      <div className="gp-topbar">
        <div className="gp-title-row">
          <span className={`gp-badge gp-badge-${mode}`}>
            {mode.toUpperCase()}
          </span>
          <span className="gp-label">{label}</span>
        </div>

        <div className="gp-meta">
          {normalizedData.start !== null && normalizedData.start !== undefined && (
            <span className="gp-meta-item">
              <span className="gp-dot gp-dot-green" />
              {mode === 'dfa' ? `D${normalizedData.start}` : `q${normalizedData.start}`} start
            </span>
          )}

          {accepts.length > 0 && (
            <span className="gp-meta-item">
              <span className="gp-dot gp-dot-pink" />
              {accepts.map((a) => (mode === 'dfa' ? `D${a}` : `q${a}`)).join(', ')} accept
            </span>
          )}

          <span className="gp-meta-item">
            <span className="gp-dot gp-dot-violet" />
            {normalizedData.states.length} states
          </span>

          <span className="gp-meta-item">
            <span className="gp-dot gp-dot-amber" />
            {normalizedData.transitions.length} transitions
          </span>

          {newStatesCount > 0 && (
            <span className="gp-meta-item">
              <span className="gp-dot" style={{ background: '#2563eb' }} />
              {newStatesCount} new states
            </span>
          )}

          {newTransitionsCount > 0 && (
            <span className="gp-meta-item">
              <span className="gp-dot" style={{ background: '#38bdf8' }} />
              {newTransitionsCount} new transitions
            </span>
          )}

          {hasHighlights && (
            <span className="gp-meta-item">
              <span className="gp-dot" style={{ background: 'var(--cyan)' }} />
              {safeHighlightStates.size} active
            </span>
          )}
        </div>
      </div>

      {subtitle && <div className="gp-subtitle">{subtitle}</div>}

      <div className="gp-canvas" ref={containerRef} />

      <div className="gp-legend">
        <div className="gp-leg">
          <span className="gp-leg-dot" style={{ background: 'var(--green)' }} />
          Start
        </div>

        <div className="gp-leg">
          <span className="gp-leg-dot" style={{ background: 'var(--violet)' }} />
          Normal
        </div>

        <div className="gp-leg">
          <span className="gp-leg-dot" style={{ background: 'var(--pink)' }} />
          Accept
        </div>

        <div className="gp-leg">
          <span className="gp-leg-dot" style={{ background: 'var(--amber)' }} />
          Start + Accept
        </div>

        {mode === 'nfa' && (
          <div className="gp-leg">
            <span style={{ color: 'var(--text3)', fontSize: 11 }}>- -</span>
            ε-transition (when present)
          </div>
        )}

        <div className="gp-leg">
          <span className="gp-leg-dot" style={{ background: '#2563eb' }} />
          New in this step
        </div>

        {hasHighlights && (
          <div className="gp-leg">
            <span className="gp-leg-dot" style={{ background: 'var(--cyan)' }} />
            Active
          </div>
        )}

        <div className="gp-leg-hint">Drag nodes · Zoom · Pan</div>
      </div>
    </div>
  );
}
