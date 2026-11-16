import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, formatDuration, formatObserved, type Postmortem, type SessionView } from './api';
import { Cobweb, Ghost, type Mood } from './art';
import { Terminal, type RunCommand } from './Terminal';

const COMPONENTS = ['storefront', 'cart', 'payments', 'worker', 'postgres', 'queue'];
const QUICK = ['haunt status', 'haunt queue', 'haunt logs storefront', 'haunt help'];
const MAX_ESCALATION_PIPS = 2;

/** The signature element: the pager. It buzzes when you're paged and on every escalation. */
function Pager({ view, elapsed }: { view: SessionView; elapsed: number }) {
  const [buzz, setBuzz] = useState(true);
  const lastStep = useRef(view.escalationStep);
  useEffect(() => {
    if (view.escalationStep !== lastStep.current) {
      lastStep.current = view.escalationStep;
      setBuzz(true);
    }
  }, [view.escalationStep]);
  const resolved = view.lastVerify?.pass === true;
  const pips = Math.max(MAX_ESCALATION_PIPS, view.escalationStep);
  const overPar = elapsed > view.parSeconds;
  // The pager buddy: happy once the fix verifies, scared when things get worse, worried otherwise.
  const mood: Mood = resolved ? 'happy' : overPar || view.escalationStep > 0 ? 'scared' : 'worried';

  return (
    <section className={`pager${buzz ? ' buzz' : ''}`} onAnimationEnd={() => setBuzz(false)} aria-labelledby="pager-title">
      <Cobweb className="web web-left" />
      <Cobweb className="web web-right" />
      <Ghost className={`buddy buddy-${mood}`} mood={mood} />
      <span className={`pager-led${resolved ? ' resolved' : ''}`} aria-hidden="true" />
      <div className="pager-screen" role="alert">
        <div className="line1">{resolved ? 'resolved · fix verified' : `page · ${view.difficulty}`}</div>
        <p className="alert">{view.alert}</p>
      </div>
      <div className="pager-side">
        <div className="pager-clock" aria-label={`On call for ${formatDuration(elapsed)}`}>
          {formatDuration(elapsed)}
        </div>
        <div className="pager-sub">
          <span className="pips-label">escalation {view.escalationStep}/{pips}</span>
          <span className="pips" aria-hidden="true">
            {Array.from({ length: pips }, (_, i) => (
              <span key={i} className={`pip${i < view.escalationStep ? ' on' : ''}`} />
            ))}
          </span>
        </div>
      </div>
      <div className="par" aria-label={overPar ? `Over par by ${formatDuration(elapsed - view.parSeconds)}` : `${formatDuration(view.parSeconds - elapsed)} left to beat par`}>
        <div className={`par-track${overPar ? ' over' : ''}`} aria-hidden="true">
          <div className="par-fill" style={{ width: `${Math.min(100, (elapsed / view.parSeconds) * 100)}%` }} />
        </div>
        <span className="par-text">
          {resolved
            ? 'fix verified'
            : overPar
              ? `over par by ${formatDuration(elapsed - view.parSeconds)}`
              : `par ${formatDuration(view.parSeconds)} · ${formatDuration(view.parSeconds - elapsed)} to name the cause for full detection points`}
        </span>
      </div>
      <div className="pager-title">
        <h2 id="pager-title" tabIndex={-1}>
          {view.hauntingName}
        </h2>
        {view.player && <span className="muted">{view.player} is on call</span>}
      </div>
    </section>
  );
}

export function Session({ initial, grafanaUrl, onEnded }: { initial: SessionView; grafanaUrl: string; onEnded: (pm: Postmortem) => void }) {
  const [view, setView] = useState(initial);
  const [now, setNow] = useState(Date.now());
  const [hints, setHints] = useState<{ at: number; text: string }[]>([]);
  const [component, setComponent] = useState(initial.diagnosis?.component ?? '');
  const [summary, setSummary] = useState(initial.diagnosis?.summary ?? '');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const runCommand = useRef<RunCommand | undefined>(undefined);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    // Polling backs up the WebSocket, for narration and escalation.
    const poll = setInterval(() => void api.session(view.id).then(setView).catch(() => undefined), 5000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [view.id]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      await fn();
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitDiagnosis = (e: FormEvent) => {
    e.preventDefault();
    void run('Recording your diagnosis', async () => {
      setView(await api.diagnose(view.id, component, summary));
      setStatus('Diagnosis recorded. You can change it until you end the shift.');
    });
  };

  const elapsed = Math.max(0, Math.round((now - view.startedAt) / 1000));
  const dashboard = `${grafanaUrl}/d/witching-overview?orgId=1&kiosk&refresh=5s&theme=dark`;
  const since = (at: number) => formatDuration(Math.max(0, (at - view.startedAt) / 1000));
  const log = [...view.narration.map((n) => ({ ...n, hint: false })), ...hints.map((h) => ({ ...h, hint: true }))].sort((a, b) => a.at - b.at);

  return (
    <>
      <Pager view={view} elapsed={elapsed} />
      <div className="session">
        <div className="workbench">
          <section className="panel console order-2" aria-labelledby="term-title">
            <div className="panel-head">
              <h3 id="term-title">Terminal</h3>
              <div className="quick" aria-label="Run a starter command">
                {QUICK.map((q) => (
                  <button key={q} type="button" onClick={() => runCommand.current?.(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
            <Terminal
              sessionId={view.id}
              onReady={(r) => (runCommand.current = r)}
              onNarration={(text) => setView((v) => ({ ...v, narration: [...v.narration, { at: Date.now(), text }] }))}
              onEnded={() => void api.postmortem(view.id).then(onEnded).catch(() => undefined)}
            />
          </section>

          <section className="panel dashboard order-4" aria-labelledby="dash-title">
            <div className="panel-head">
              <h3 id="dash-title">Sandbox dashboards</h3>
              <a href={dashboard} target="_blank" rel="noreferrer">
                Open in Grafana <span aria-hidden="true">↗</span>
              </a>
            </div>
            <iframe title="Grafana sandbox overview dashboard" src={dashboard} loading="lazy" />
          </section>
        </div>

        <aside className="sidebar">
          <section className="panel narration order-1" aria-labelledby="narration-title">
            <div className="panel-head">
              <h3 id="narration-title">The narrator</h3>
              <button
                type="button"
                className="quiet"
                disabled={busy || view.hintsLeft <= 0}
                onClick={() =>
                  void run('Asking the narrator', async () => {
                    const { hint } = await api.hint(view.id);
                    setHints((h) => [...h, { at: Date.now(), text: hint }]);
                    setView((v) => ({ ...v, hintsUsed: v.hintsUsed + 1, hintsLeft: v.hintsLeft - 1 }));
                    setStatus('');
                  })
                }
              >
                Ask for a hint ({view.hintsLeft} left)
              </button>
            </div>
            <ol aria-live="polite">
              {log.map((n, i) => (
                <li key={i} className={n.hint ? 'hint' : undefined}>
                  <time>
                    {since(n.at)}
                    {n.hint ? ' · hint' : ''}
                  </time>
                  {n.text}
                </li>
              ))}
            </ol>
          </section>

          <section className="panel call order-3" aria-labelledby="call-title">
            <div className="panel-head">
              <h3 id="call-title">Your call</h3>
            </div>
            <form onSubmit={submitDiagnosis}>
              <fieldset>
                <legend>Which component failed?</legend>
                <div className="components">
                  {COMPONENTS.map((c) => (
                    <label key={c} className="component">
                      <input type="radio" name="component" value={c} checked={component === c} onChange={() => setComponent(c)} required />
                      <span>{c}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label htmlFor="summary">What happened, in your words</label>
              <textarea
                id="summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                maxLength={1000}
                required
                placeholder="e.g. the worker stopped, so nothing drains the orders queue"
              />
              <div className="row">
                <button type="submit" disabled={busy}>
                  Record diagnosis
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run('Checking live health', async () => {
                      const r = await api.verify(view.id);
                      setView((v) => ({ ...v, lastVerify: r }));
                      setStatus(r.pass ? 'Fix verified: every health check passes.' : 'Not fixed yet. The failing checks are listed below.');
                    })
                  }
                >
                  Verify fix
                </button>
              </div>
            </form>

            <p className="status" role="status">
              {status}
            </p>

            {view.lastVerify && (
              <ul className="checks" aria-label="Health checks from the last verify">
                {view.lastVerify.checks.map((c) => (
                  <li key={c.id}>
                    <span className={c.pass ? 'mark-ok' : 'mark-bad'} aria-hidden="true">
                      {c.pass ? '✓' : '✗'}
                    </span>
                    <span>
                      <span className="sr-only">{c.pass ? 'Passing: ' : 'Failing: '}</span>
                      {c.description}
                    </span>
                    <span className="observed">observed {formatObserved(c.observed)}</span>
                  </li>
                ))}
              </ul>
            )}

            {confirmEnd ? (
              <div className="end-confirm" role="group" aria-label="Confirm ending the shift">
                <span>End the shift? The haunting is reverted and scored as it stands.</span>
                <div className="row">
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      void run('Ending the shift and reverting the sandbox', async () => {
                        onEnded(await api.end(view.id));
                      })
                    }
                  >
                    Yes, write my postmortem
                  </button>
                  <button type="button" className="quiet" onClick={() => setConfirmEnd(false)}>
                    Keep investigating
                  </button>
                </div>
              </div>
            ) : (
              <div className="row">
                <button type="button" className="danger" disabled={busy} onClick={() => setConfirmEnd(true)}>
                  End shift
                </button>
              </div>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
