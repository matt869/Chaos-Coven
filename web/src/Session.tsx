import { useEffect, useState, type FormEvent } from 'react';
import { api, formatDuration, type Postmortem, type SessionView } from './api';
import { Terminal } from './Terminal';

const COMPONENTS = ['storefront', 'cart', 'payments', 'worker', 'postgres', 'queue'];

export function Session({ initial, grafanaUrl, onEnded }: { initial: SessionView; grafanaUrl: string; onEnded: (pm: Postmortem) => void }) {
  const [view, setView] = useState(initial);
  const [now, setNow] = useState(Date.now());
  const [hints, setHints] = useState<string[]>([]);
  const [component, setComponent] = useState(initial.diagnosis?.component ?? '');
  const [summary, setSummary] = useState(initial.diagnosis?.summary ?? '');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

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

  const finish = () =>
    run('Ending the haunting and reverting the sandbox', async () => {
      onEnded(await api.end(view.id));
    });

  const submitDiagnosis = (e: FormEvent) => {
    e.preventDefault();
    void run('Recording your diagnosis', async () => {
      setView(await api.diagnose(view.id, component, summary));
      setStatus('Diagnosis recorded. You can change it until you end the session.');
    });
  };

  const elapsed = Math.max(0, Math.round((now - view.startedAt) / 1000));
  const dashboard = `${grafanaUrl}/d/witching-overview?orgId=1&kiosk&refresh=5s`;

  return (
    <div className="session">
      <section className="page" role="alert" aria-labelledby="alert-title">
        <h2 id="alert-title">
          <span className="pager" aria-hidden="true">
            ●
          </span>{' '}
          {view.hauntingName}
        </h2>
        <p className="alert-text">{view.alert}</p>
        <p className="muted">
          On call for <time aria-label={`${elapsed} seconds`}>{formatDuration(elapsed)}</time> · difficulty {view.difficulty}
          {view.escalationStep > 0 && ` · escalated ${view.escalationStep}×`}
        </p>
      </section>

      <section className="narration" aria-labelledby="narration-title">
        <h3 id="narration-title">The narrator</h3>
        <ol aria-live="polite">
          {view.narration.map((n, i) => (
            <li key={i} className="narration-line">
              {n.text}
            </li>
          ))}
          {hints.map((h, i) => (
            <li key={`h${i}`} className="narration-line hint">
              <span className="tag">hint</span> {h}
            </li>
          ))}
        </ol>
      </section>

      <section className="dashboard" aria-labelledby="dash-title">
        <h3 id="dash-title">
          Dashboards{' '}
          <a href={dashboard} target="_blank" rel="noreferrer">
            open in Grafana ↗
          </a>
        </h3>
        <iframe title="Grafana sandbox overview dashboard" src={dashboard} loading="lazy" />
      </section>

      <section className="console" aria-labelledby="term-title">
        <h3 id="term-title">Terminal</h3>
        <Terminal
          sessionId={view.id}
          onNarration={(text) => setView((v) => ({ ...v, narration: [...v.narration, { at: Date.now(), text }] }))}
          onEnded={() => void api.postmortem(view.id).then(onEnded).catch(() => undefined)}
        />
      </section>

      <section className="actions" aria-labelledby="act-title">
        <h3 id="act-title">Your call</h3>
        <form onSubmit={submitDiagnosis}>
          <label htmlFor="component">Failing component</label>
          <select id="component" value={component} onChange={(e) => setComponent(e.target.value)} required>
            <option value="" disabled>
              Choose…
            </option>
            {COMPONENTS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label htmlFor="summary">Root cause, in your words</label>
          <textarea id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} maxLength={1000} required />
          <button type="submit" disabled={busy}>
            Record diagnosis
          </button>
        </form>

        <div className="buttons">
          <button type="button" disabled={busy} onClick={() => void run('Checking live health', async () => {
            const r = await api.verify(view.id);
            setView((v) => ({ ...v, lastVerify: r }));
            setStatus(r.pass ? 'Fix verified: every health check passes.' : 'Not fixed yet. See the checks below.');
          })}>
            Verify fix
          </button>
          <button type="button" disabled={busy || view.hintsLeft <= 0} onClick={() => void run('Asking the narrator', async () => {
            const { hint } = await api.hint(view.id);
            setHints((h) => [...h, hint]);
            setView((v) => ({ ...v, hintsUsed: v.hintsUsed + 1, hintsLeft: v.hintsLeft - 1 }));
            setStatus('');
          })}>
            Hint ({view.hintsLeft} left)
          </button>
          <button type="button" className="danger" disabled={busy} onClick={() => void finish()}>
            End and see postmortem
          </button>
        </div>

        <p className="status" role="status">
          {status}
        </p>

        {view.lastVerify && (
          <ul className="checks" aria-label="Health checks from the last verify">
            {view.lastVerify.checks.map((c) => (
              <li key={c.id} className={c.pass ? 'ok' : 'missed'}>
                <span aria-hidden="true">{c.pass ? '✓' : '✗'}</span> {c.description}
                <span className="muted"> (observed {c.observed ?? 'no data'})</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
