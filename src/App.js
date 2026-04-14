import React, { useState, useCallback, useMemo } from 'react';
import './App.css';
import RegexBuilder from './components/RegexBuilder';
import GraphPanel from './components/GraphPanel';
import StepPlayer from './components/StepPlayer';
import SimulatorPanel from './components/SimulatorPanel';
import { convertRegex, simulateInput } from './api/client';

const TABS = [
  'ε-NFA Build Steps',
  'Full ε-NFA',
  'ε-NFA→NFA Table',
  'Reduced NFA',
  'NFA→DFA Steps',
  'Full DFA',
  'Minimized DFA',
  'Simulate'
];

export default function App() {
  const [regex, setRegex] = useState('');
  const [activeRe, setActiveRe] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState(0);

  const [enfaStep, setEnfaStep] = useState(0);
  const [nfaStep, setNfaStep] = useState(0);
  const [dfaStep, setDfaStep] = useState(0);

  const [simResult, setSimResult] = useState(null);

  const handleConvert = useCallback(async () => {
    const re = regex.trim();

    if (!re) {
      setError('Enter a regular expression');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);
    setSimResult(null);
    setEnfaStep(0);
    setNfaStep(0);
    setDfaStep(0);

    try {
      const data = await convertRegex(re);
      setResult(data);
      setActiveRe(re);
      setTab(0);
    } catch (e) {
      setError(
        e.response?.data?.error ||
          'Cannot reach Flask backend — is it running on port 5000?'
      );
    } finally {
      setLoading(false);
    }
  }, [regex]);

  const handleSimulate = useCallback(
    async (input) => {
      if (!activeRe) return;

      try {
        const data = await simulateInput(activeRe, input);
        setSimResult(data);
      } catch (e) {
        setSimResult({ error: e.response?.data?.error || 'Simulation failed' });
      }
    },
    [activeRe]
  );

  const enfaStepData = result?.enfa_steps?.[enfaStep] || null;
  const dfaStepData = result?.dfa_steps?.[dfaStep]?.snapshot || null;

  const simHighlightENFA = simResult?.enfa_trace
    ? new Set(simResult.enfa_trace[simResult.enfa_trace.length - 1]?.states || [])
    : simResult?.nfa_trace
      ? new Set(simResult.nfa_trace[simResult.nfa_trace.length - 1]?.states || [])
      : new Set();

  const enfaStepHighlights = new Set(enfaStepData?.new_states || []);
  const dfaStepHighlights = new Set(dfaStepData?.new_states || []);

  const getTransitionData = () => {
    if (!result) return null;

    if (tab === 0) return enfaStepData;
    if (tab === 1) return result.enfa;
    if (tab === 3) return result.nfa;
    if (tab === 4) return dfaStepData;
    if (tab === 5) return result.dfa;
    if (tab === 6) return result.min_dfa;

    return null;
  };

  const getTransitionMode = () => {
    if (tab === 4 || tab === 5 || tab === 6) return 'dfa';
    return 'nfa';
  };

  const getTableTitle = () => {
    if (tab === 0) return 'ε-NFA Step Table';
    if (tab === 1) return 'ε-NFA Transition Table';
    if (tab === 2) return 'ε-Closure Transition Table';
    if (tab === 3) return 'Reduced NFA Table';
    if (tab === 4) return 'NFA→DFA Step Table';
    if (tab === 5) return 'DFA Transition Table';
    if (tab === 6) return 'Minimized DFA Table';
    return 'Transition Table';
  };

  const symbols = useMemo(() => {
    const s = new Set();
    (result?.nfa_steps || []).forEach((step) => {
      Object.keys(step.moves || {}).forEach((sym) => s.add(sym));
    });
    return [...s].sort();
  }, [result]);

  const getSidebarStepPanel = () => {
    if (!result) return null;

    if (tab === 0 && result?.enfa_steps?.length > 0) {
      return (
        <div className="sidebar-section">
          <StepPlayer
            steps={result.enfa_steps}
            currentStep={enfaStep}
            onStep={setEnfaStep}
            label="ε-NFA Build Progress"
            variant="enfa-build"
          />
        </div>
      );
    }

    if (tab === 2 && result?.nfa_steps?.length > 0) {
      return (
        <div className="sidebar-section">
          <StepPlayer
            steps={result.nfa_steps}
            currentStep={nfaStep}
            onStep={setNfaStep}
            label="ε-NFA → NFA Conversion"
            variant="enfa-to-nfa"
          />
        </div>
      );
    }

    if (tab === 4 && result?.dfa_steps?.length > 0) {
      return (
        <div className="sidebar-section">
          <StepPlayer
            steps={result.dfa_steps}
            currentStep={dfaStep}
            onStep={setDfaStep}
            label="NFA → DFA Conversion"
            variant="nfa-to-dfa"
          />
        </div>
      );
    }

    return null;
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-main">
            regex<span>→</span><em>ε-NFA</em><span>→</span><em>NFA</em><span>→</span><em>DFA</em>
          </div>
          <div className="logo-sub">Thompson&apos;s Construction Visualizer</div>
        </div>

        {getSidebarStepPanel()}

        <div className="sidebar-section">
          <RegexBuilder
            value={regex}
            onChange={setRegex}
            onConvert={handleConvert}
            loading={loading}
            error={error}
          />
        </div>

        {result && tab !== 7 && (
          <div className="sidebar-section sidebar-table">
            <div className="section-label">{getTableTitle()}</div>

            {tab === 2 ? (
              <EpsilonClosureTable
                steps={result.nfa_steps}
                symbols={symbols}
                activeIndex={nfaStep}
                compact
              />
            ) : (
              <TransitionTable
                data={getTransitionData()}
                mode={getTransitionMode()}
              />
            )}
          </div>
        )}
      </aside>

      <main className="main">
        <div className="tabbar">
          {TABS.map((t, i) => (
            <button
              key={i}
              className={`tab-btn ${tab === i ? 'tab-active' : ''} ${!result && i !== 0 ? 'tab-disabled' : ''}`}
              onClick={() => result && setTab(i)}
              disabled={!result && i !== 0}
            >
              {t}
            </button>
          ))}

          {activeRe && (
            <div className="tabbar-regex" title={activeRe}>
              <span className="tabbar-regex-slash">/</span>
              <span className="tabbar-regex-val">{activeRe}</span>
              <span className="tabbar-regex-slash">/</span>
            </div>
          )}
        </div>

        <div className="content">
          {!result && (
            <div className="empty-state">
              <div className="empty-orbit">
                <div className="empty-ring r1" />
                <div className="empty-ring r2" />
                <div className="empty-ring r3" />
                <div className="empty-center">⊛</div>
              </div>

              <div className="empty-title">Regex Automaton Visualizer</div>

              <div className="empty-sub">
                Use the operator buttons on the left to build a regex,
                <br />
                then press <strong>BUILD</strong> or <kbd>Enter</kbd>
              </div>

              <div className="empty-flow">
                <span className="ef-node">Regex</span>
                <span className="ef-arr">→</span>
                <span className="ef-node">AST</span>
                <span className="ef-arr">→</span>
                <span className="ef-node">ε-NFA</span>
                <span className="ef-arr">→</span>
                <span className="ef-node">Reduced NFA</span>
                <span className="ef-arr">→</span>
                <span className="ef-node">DFA</span>
                <span className="ef-arr">→</span>
                <span className="ef-node ef-hi">Min DFA</span>
              </div>
            </div>
          )}

          {result && tab === 0 && enfaStepData && (
            <GraphPanel
              data={enfaStepData}
              mode="nfa"
              label={result.enfa_steps?.[enfaStep]?.label || 'ε-NFA Construction'}
              subtitle={result.enfa_steps?.[enfaStep]?.description}
              highlightStates={enfaStepHighlights}
              persistKey={`enfa-build-layout-${activeRe}`}
            />
          )}

          {result && tab === 1 && (
            <GraphPanel
              data={result.enfa}
              mode="nfa"
              label="Complete ε-NFA"
              persistKey={`full-enfa-layout-${activeRe}`}
            />
          )}

          {result && tab === 2 && (
            <EpsilonClosurePanel
              steps={result.nfa_steps}
              symbols={symbols}
              activeIndex={nfaStep}
            />
          )}

          {result && tab === 3 && (
            <GraphPanel
              data={result.nfa}
              mode="nfa"
              label="Reduced NFA"
              persistKey={`reduced-nfa-layout-${activeRe}`}
            />
          )}

          {result && tab === 4 && dfaStepData && (
            <GraphPanel
              data={dfaStepData}
              mode="dfa"
              label={result.dfa_steps?.[dfaStep]?.label || 'NFA → DFA'}
              subtitle={result.dfa_steps?.[dfaStep]?.description}
              highlightStates={dfaStepHighlights}
              persistKey={`dfa-steps-layout-${activeRe}`}
            />
          )}

          {result && tab === 5 && (
            <GraphPanel
              data={result.dfa}
              mode="dfa"
              label="Complete DFA"
              persistKey={`full-dfa-layout-${activeRe}`}
            />
          )}

          {result && tab === 6 && (
            <GraphPanel
              data={result.min_dfa}
              mode="dfa"
              label="Minimized DFA"
              persistKey={`min-dfa-layout-${activeRe}`}
            />
          )}

          {result && tab === 7 && (
            <div className="sim-layout">
              <div className="sim-graph-col">
                <GraphPanel
                  data={result.enfa}
                  mode="nfa"
                  label="ε-NFA (active states highlighted)"
                  highlightStates={simHighlightENFA}
                  persistKey={`sim-enfa-layout-${activeRe}`}
                />
              </div>

              <div className="sim-ctrl-col">
                <SimulatorPanel
                  activeRegex={activeRe}
                  onSimulate={handleSimulate}
                  simResult={simResult}
                />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function EpsilonClosurePanel({ steps, symbols, activeIndex }) {
  if (!steps?.length) return null;

  const current = steps[activeIndex] || steps[0];

  return (
    <div className="ec-panel">
      <div className="ec-card">
        <div className="ec-title">{current.label}</div>
        <div className="ec-desc">{current.description}</div>

        <div className="ec-meta-row">
          <span className="ec-meta-pill">
            Source: <strong>q{current.source_state}</strong>
          </span>
          <span className="ec-meta-pill">
            ε-closure: <strong>{formatStates(current.eclosure)}</strong>
          </span>
        </div>
      </div>

      <div className="ec-card">
        <div className="ec-table-title">ε-closure transition table</div>
        <EpsilonClosureTable steps={steps} symbols={symbols} activeIndex={activeIndex} />
      </div>
    </div>
  );
}

function EpsilonClosureTable({ steps, symbols, activeIndex, compact = false }) {
  if (!steps?.length) return null;

  return (
    <div className={`tt-scroll ${compact ? 'tt-scroll-compact' : ''}`}>
      <table className="tt">
        <thead>
          <tr>
            <th>State</th>
            <th>ε-Closure</th>
            {symbols.map((sym) => (
              <th key={sym}>{sym}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {steps.map((step, i) => (
            <tr key={step.source_state} className={i === activeIndex ? 'tt-row-active' : ''}>
              <td>
                q{step.source_state}
                {i === activeIndex && <span className="tt-badge tt-c">Now</span>}
              </td>

              <td>{formatStates(step.eclosure)}</td>

              {symbols.map((sym) => (
                <td key={sym} className={sym === 'ε' ? 'tt-eps' : 'tt-sym'}>
                  {formatStates(step.moves?.[sym] || [])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransitionTable({ data, mode }) {
  if (!data) return null;

  const accepts = new Set(
    mode === 'dfa'
      ? (data.accept_states || [])
      : (data.accept_states || (data.accept !== undefined && data.accept !== null ? [data.accept] : []))
  );

  const label = (id) => (mode === 'dfa' ? `D${id}` : `q${id}`);

  return (
    <div className="tt-scroll">
      <table className="tt">
        <thead>
          <tr>
            <th>From</th>
            <th>Sym</th>
            <th>To</th>
          </tr>
        </thead>
        <tbody>
          {(data.transitions || []).map((t, i) => (
            <tr key={i}>
              <td>
                {label(t.from)}
                {t.from === data.start && <span className="tt-badge tt-s">S</span>}
                {accepts.has(t.from) && <span className="tt-badge tt-a">A</span>}
              </td>

              <td className={t.sym === 'ε' ? 'tt-eps' : 'tt-sym'}>
                {t.sym}
              </td>

              <td>
                {label(t.to)}
                {t.to === data.start && <span className="tt-badge tt-s">S</span>}
                {accepts.has(t.to) && <span className="tt-badge tt-a">A</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatStates(states) {
  if (!states || states.length === 0) return '∅';
  return `{${states.map((s) => `q${s}`).join(', ')}}`;
}





