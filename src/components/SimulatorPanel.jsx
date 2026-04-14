import React, { useState, useMemo } from 'react';
import './SimulatorPanel.css';

export default function SimulatorPanel({ activeRegex, onSimulate, simResult }) {
  const [input, setInput] = useState('');
  const [simStep, setSimStep] = useState(-1);

  function run() {
    setSimStep(-1);
    onSimulate(input);
  }

  function handleKey(e) {
    if (e.key === 'Enter') run();
  }

  const trace = simResult?.nfa_trace || [];
  const dfaTrace = simResult?.dfa_trace || [];
  const accepted = simResult?.accepted;

  const summaryText = useMemo(() => {
    if (!simResult || simResult.error) {
      return 'Run a string to inspect the execution trace.';
    }
    return accepted
      ? 'The input is accepted by the automaton.'
      : 'The input is rejected by the automaton.';
  }, [simResult, accepted]);

  return (
    <div className="sim-wrap">
      <div className="sim-head">
        <div className="sim-head-badge">Simulation</div>
        <div className="sim-head-title">Test input strings</div>
        <div className="sim-head-sub">
          Run a string on the generated automata and inspect both NFA and DFA traces.
        </div>
      </div>

      <div className="sim-active-regex">
        <span className="sim-active-label">Active regex</span>
        <span className="sim-active-value">
          {activeRegex ? `/${activeRegex}/` : 'Build a regex first'}
        </span>
      </div>

      <div className="sim-input-row">
        <input
          className="sim-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Enter string to simulate..."
          spellCheck={false}
        />

        <button
          className="sim-run-btn"
          onClick={run}
          disabled={!activeRegex}
          type="button"
        >
          Run
        </button>
      </div>

      <div className="sim-summary">{summaryText}</div>

      {simResult && !simResult.error && (
        <>
          <div className={`sim-verdict ${accepted ? 'sim-accept' : 'sim-reject'}`}>
            <span className="sim-verdict-icon">{accepted ? '✓' : '✕'}</span>

            <div className="sim-verdict-copy">
              <div className="sim-verdict-main">
                {accepted ? 'ACCEPTED' : 'REJECTED'}
              </div>

              <div className="sim-verdict-sub">
                "{simResult.input}" {accepted ? 'matches' : 'does not match'} /{activeRegex}/
              </div>
            </div>
          </div>

          {trace.length > 0 && (
            <div className="sim-trace-section">
              <div className="sim-trace-head">
                <div className="sim-trace-label">NFA Trace</div>
                <div className="sim-trace-meta">{trace.length} steps</div>
              </div>

              <div className="sim-trace-scroll">
                {trace.map((step, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`sim-trace-step ${i === simStep ? 'sim-trace-active' : ''}`}
                    onClick={() => setSimStep(i === simStep ? -1 : i)}
                  >
                    <div className="sim-trace-char">
                      {step.char === null ? 'START' : `'${step.char}'`}
                    </div>

                    <div className="sim-trace-arrow">→</div>

                    <div className="sim-trace-states">
                      {step.states.length === 0 ? (
                        <span className="sim-dead">∅ dead</span>
                      ) : (
                        step.states.map((s) => (
                          <span key={s} className="sim-state-chip">
                            q{s}
                          </span>
                        ))
                      )}
                    </div>

                    {i === trace.length - 1 && (
                      <div className={`sim-final-tag ${accepted ? 'sim-ftag-acc' : 'sim-ftag-rej'}`}>
                        {accepted ? 'ACC' : 'REJ'}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {dfaTrace.length > 0 && (
            <div className="sim-trace-section">
              <div className="sim-trace-head">
                <div className="sim-trace-label">DFA Trace</div>
                <div className="sim-trace-meta">{dfaTrace.length} steps</div>
              </div>

              <div className="sim-trace-scroll">
                {dfaTrace.map((step, i) => (
                  <div key={i} className="sim-trace-step sim-trace-step-static">
                    <div className="sim-trace-char">
                      {step.char === null ? 'START' : `'${step.char}'`}
                    </div>

                    <div className="sim-trace-arrow">→</div>

                    <div className="sim-trace-states">
                      {step.dead ? (
                        <span className="sim-dead">∅ dead</span>
                      ) : (
                        <span className="sim-state-chip sim-dfa-chip">D{step.state}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {simResult?.error && (
        <div className="sim-error">{simResult.error}</div>
      )}

      {!simResult && (
        <div className="sim-hint">
          Type a string and press <span className="sim-kbd">Enter</span> or{' '}
          <span className="sim-kbd">Run</span>
          <br />
          The NFA and DFA traces will appear here.
        </div>
      )}
    </div>
  );
}
