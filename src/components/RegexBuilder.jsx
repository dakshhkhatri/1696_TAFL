import React, { useRef, useState, useEffect } from 'react';
import './RegexBuilder.css';

const OPS = [
  { label: '( )', ins: '()', tip: 'Grouping', move: -1, tone: 'violet' },
  { label: '*', ins: '*', tip: 'Kleene star', tone: 'pink' },
  { label: '+', ins: '+', tip: 'OR / Union', tone: 'cyan' },
  { label: 'ε', ins: 'ε', tip: 'Epsilon', tone: 'amber' },
];

const EXAMPLES = [
  { label: '(a+b)*', desc: 'any a/b string' },
  { label: '(a+b)*abb', desc: 'ends in abb' },
  { label: 'a*b*', desc: 'a-run then b-run' },
  { label: '(ab)*', desc: 'repeated ab' },
  { label: '(0+1)*0', desc: 'binary, ends in 0' },
  { label: '(a+b)*a(a+b)', desc: 'a before last' },
  { label: 'a(b+c)*d', desc: 'a, b/c mix, d' },
];

function renderPrettyRegex(regex) {
  if (!regex) return null;

  const out = [];

  for (let i = 0; i < regex.length; i++) {
    const ch = regex[i];

    if (ch === '*') {
      out.push(
        <sup key={i} className="rb-sup">
          *
        </sup>
      );
    } else {
      out.push(
        <span key={i} className="rb-pretty-ch">
          {ch}
        </span>
      );
    }
  }

  return out;
}

export default function RegexBuilder({ value, onChange, onConvert, loading, error }) {
  const inputRef = useRef(null);
  const [cursor, setCursor] = useState(null);

  useEffect(() => {
    if (cursor !== null && inputRef.current) {
      inputRef.current.setSelectionRange(cursor, cursor);
      setCursor(null);
    }
  }, [value, cursor]);

  function insertAt(ins, move = 0) {
    const el = inputRef.current;
    if (!el) return;

    const s = el.selectionStart;
    const e = el.selectionEnd;
    const before = value.slice(0, s);
    const after = value.slice(e);
    const next = before + ins + after;

    onChange(next);

    const pos = s + ins.length + move;
    setCursor(pos);

    setTimeout(() => el.focus(), 0);
  }

  function handleKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onConvert();
    }

    if (e.key === 'Backspace' && !value) {
      e.preventDefault();
    }
  }

  function handleExampleClick(example) {
    onChange(example);
    setTimeout(() => {
      onConvert();
    }, 50);
  }

  const hasValue = value.trim().length > 0;

  return (
    <div className="rb-wrap">
      <div className="rb-head">
        <div className="rb-head-badge">Regex Input</div>
        <div className="rb-head-title">Build automata from a regular expression</div>
        <div className="rb-head-sub">
          Compose a regex and generate its ε-NFA, reduced NFA, DFA, and minimized DFA.
        </div>
      </div>

      <div className="rb-input-row">
        <div className={`rb-input-box ${error ? 'rb-error' : ''}`}>
          <span className="rb-prefix">/</span>

          <input
            ref={inputRef}
            className="rb-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder="click operators or type…"
            autoComplete="off"
            spellCheck={false}
          />

          <span className="rb-suffix">/</span>

          {value && (
            <button
              className="rb-clear"
              onClick={() => onChange('')}
              title="Clear"
              type="button"
            >
              ✕
            </button>
          )}
        </div>

        <button
          className={`rb-convert-btn ${loading ? 'rb-loading' : ''}`}
          onClick={onConvert}
          disabled={loading}
          type="button"
        >
          {loading ? <span className="rb-spinner" /> : <span className="rb-build-icon">⚡</span>}
          <span>{loading ? 'BUILDING…' : 'BUILD'}</span>
        </button>
      </div>

      <div className={`rb-error-msg ${error ? 'rb-error-visible' : ''}`}>
        {error || '\u00a0'}
      </div>

      <div className="rb-status-row">
        <div className="rb-status-chip">
          <span className={`rb-status-dot ${hasValue ? 'rb-status-live' : ''}`} />
          {hasValue ? `${value.length} chars` : 'Empty regex'}
        </div>

        <div className="rb-status-chip">
          <span className="rb-status-key">Enter</span>
          quick build
        </div>
      </div>

      <div className="rb-block">
        <div className="rb-block-head">
          <div className="rb-ops-label">Operators</div>
          <div className="rb-block-hint">Click to insert</div>
        </div>

        <div className="rb-ops">
          {OPS.map((op) => (
            <button
              key={op.label}
              className={`rb-op-btn rb-op-${op.tone}`}
              onClick={() => insertAt(op.ins, op.move || 0)}
              title={op.tip}
              type="button"
            >
              <span className="rb-op-top">
                <span className="rb-op-sym">{op.label}</span>
                <span className="rb-op-insert">{op.ins}</span>
              </span>
              <span className="rb-op-tip">{op.tip}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rb-block">
        <div className="rb-block-head">
          <div className="rb-ops-label">Quick Examples</div>
          <div className="rb-block-hint">Load + build instantly</div>
        </div>

        <div className="rb-examples">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              className="rb-ex-btn"
              onClick={() => handleExampleClick(ex.label)}
              title={ex.desc}
              type="button"
            >
              <span className="rb-ex-top">
                <span className="rb-ex-regex">{renderPrettyRegex(ex.label)}</span>
                <span className="rb-ex-run">Run</span>
              </span>
              <span className="rb-ex-desc">{ex.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

