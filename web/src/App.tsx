import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { api, type HauntingSummary, type Postmortem as PM, type SessionView } from './api';
// Loaded on demand: the session screen pulls in xterm.js, the postmortem is only needed at the end.
const Session = lazy(() => import('./Session').then((m) => ({ default: m.Session })));
const Postmortem = lazy(() => import('./Postmortem').then((m) => ({ default: m.Postmortem })));

type Screen = { kind: 'pick' } | { kind: 'play'; session: SessionView } | { kind: 'postmortem'; pm: PM };

export function Picker({ hauntings, onStart, error }: { hauntings: HauntingSummary[]; onStart: (id: string, player: string) => void; error?: string }) {
  const [choice, setChoice] = useState('');
  const [player, setPlayer] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (choice) onStart(choice, player.trim());
  };
  return (
    <form className="picker" onSubmit={submit} aria-labelledby="pick-title">
      <h2 id="pick-title">Choose a haunting</h2>
      <p className="muted">A ghost will break something real in the sandbox. You get paged, you investigate, you fix it.</p>
      <fieldset>
        <legend>Haunting</legend>
        {hauntings.length === 0 && <p>No hauntings loaded. Is the server running?</p>}
        {hauntings.map((h) => (
          <label key={h.id} className="choice">
            <input type="radio" name="haunting" value={h.id} checked={choice === h.id} onChange={() => setChoice(h.id)} />
            <span className="choice-name">{h.name}</span>
            <span className={`tag tag-${h.difficulty}`}>{h.difficulty}</span>
          </label>
        ))}
      </fieldset>
      <label htmlFor="player">Your name (optional)</label>
      <input id="player" value={player} onChange={(e) => setPlayer(e.target.value)} maxLength={40} autoComplete="nickname" />
      <button type="submit" className="primary" disabled={!choice}>
        Start the night shift
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'pick' });
  const [hauntings, setHauntings] = useState<HauntingSummary[]>([]);
  const [grafanaUrl, setGrafanaUrl] = useState('/grafana');
  const [error, setError] = useState<string>();

  useEffect(() => {
    void api.hauntings().then(setHauntings).catch((e: Error) => setError(e.message));
    void api.config().then((c) => setGrafanaUrl(c.grafanaUrl)).catch(() => undefined);
    // Pick up a session that is already running, for example after a page reload.
    void api.active().then((s) => s && setScreen({ kind: 'play', session: s })).catch(() => undefined);
  }, []);

  useEffect(() => {
    // Move focus to the new screen's heading for keyboard and screen-reader users.
    document.querySelector<HTMLElement>('main h2')?.focus();
  }, [screen.kind]);

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <h1>
          Witching Hour <span className="muted">on-call training</span>
        </h1>
      </header>
      <main id="main">
        {screen.kind === 'pick' && (
          <Picker
            hauntings={hauntings}
            error={error}
            onStart={(id, player) => {
              setError(undefined);
              api
                .start(id, player || undefined)
                .then((session) => setScreen({ kind: 'play', session }))
                .catch((e: Error) => setError(e.message));
            }}
          />
        )}
        <Suspense fallback={<p className="muted" role="status">Loading…</p>}>
          {screen.kind === 'play' && <Session initial={screen.session} grafanaUrl={grafanaUrl} onEnded={(pm) => setScreen({ kind: 'postmortem', pm })} />}
          {screen.kind === 'postmortem' && <Postmortem pm={screen.pm} onAgain={() => setScreen({ kind: 'pick' })} />}
        </Suspense>
      </main>
    </>
  );
}
