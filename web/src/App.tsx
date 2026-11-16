import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { api, formatDuration, type HauntingSummary, type Postmortem as PM, type SessionView } from './api';
import { Ghost, NightSky, Pumpkin } from './art';

// Loaded on demand: the session screen pulls in xterm.js, the postmortem is only needed at the end.
const Session = lazy(() => import('./Session').then((m) => ({ default: m.Session })));
const Postmortem = lazy(() => import('./Postmortem').then((m) => ({ default: m.Postmortem })));

type Screen = { kind: 'pick' } | { kind: 'play'; session: SessionView } | { kind: 'postmortem'; pm: PM };

const SHOP = ['storefront', 'cart', 'payments', 'worker', 'postgres', 'queue'];
const THREAT = { easy: 1, medium: 2, hard: 3 } as const;

/** A real sequence, so numbering it is honest. */
const SHIFT = [
  { step: 'Paged', text: 'An alert lands. The clock starts; par is your target.' },
  { step: 'Investigate', text: 'Dashboards, logs and haunt commands. One clue is a red herring.' },
  { step: 'Call it', text: 'Name the failing component and why, then apply a fix.' },
  { step: 'Debrief', text: 'Live checks verify the fix, and the postmortem scores the shift.' },
];

export function Picker({ hauntings, onStart, error }: { hauntings: HauntingSummary[]; onStart: (id: string, player: string) => void; error?: string }) {
  const [choice, setChoice] = useState('');
  const [player, setPlayer] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (choice) onStart(choice, player.trim());
  };
  return (
    <section className="picker" aria-labelledby="pick-title">
      <div className="picker-intro">
        <p className="kicker">Witching Hour · on-call training</p>
        <div className="hero">
          <h1 id="pick-title" tabIndex={-1}>
            It&rsquo;s <span className="candlelit">3&nbsp;a.m.</span> and the pager just went off.
          </h1>
          <Ghost className="mascot" />
        </div>
        <p className="lede">
          A ghost has broken <strong>one thing</strong> in a six-service shop. You get the same tools as a real shift: live Grafana dashboards, the logs, and a terminal
          that only takes <code>haunt</code> commands. Name the root cause, fix it, and read your postmortem.
        </p>
        <ul className="shop-map" aria-label="Services in the haunted shop">
          {SHOP.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <ol className="shift-steps" aria-label="How a shift works">
          {SHIFT.map((x, i) => (
            <li key={x.step}>
              <span className="n data">{String(i + 1).padStart(2, '0')}</span>
              <span className="step">{x.step}</span>
              <span className="muted">{x.text}</span>
            </li>
          ))}
        </ol>
      </div>

      <form className="rota" onSubmit={submit}>
        <fieldset>
          <legend>Tonight&rsquo;s rota</legend>
          {hauntings.length === 0 && <p className="muted">No hauntings loaded. Is the game server running?</p>}
          {hauntings.map((h) => (
            <label key={h.id} className="rota-row">
              <input type="radio" name="haunting" value={h.id} checked={choice === h.id} onChange={() => setChoice(h.id)} />
              <span className="rota-name">{h.name}</span>
              <span className={`threat threat-${h.difficulty}`}>
                <span className="pumpkins" aria-hidden="true">
                  {[1, 2, 3].map((n) => (
                    <Pumpkin key={n} lit={n <= THREAT[h.difficulty]} size={20} />
                  ))}
                </span>
                {h.difficulty}
              </span>
              <span className="rota-meta">
                <span>par {formatDuration(h.parSeconds)}</span>
                <span>
                  escalates {h.escalationSteps}×
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="player">
          <label htmlFor="player">Your name, for the postmortem (optional)</label>
          <input id="player" value={player} onChange={(e) => setPlayer(e.target.value)} maxLength={40} autoComplete="nickname" />
        </div>
        <button type="submit" className="primary start" disabled={!choice}>
          {choice ? 'Take the pager' : 'Pick a haunting to take the pager'}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
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
    document.querySelector<HTMLElement>('main h1, main h2')?.focus();
  }, [screen.kind]);

  return (
    <>
      <NightSky />
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <span className="wordmark">
          <Ghost className="wordmark-ghost" />
          <span>
            Witching Hour<span className="moon">.</span>
          </span>
        </span>
        <nav aria-label="Other pages">
          <a href="/daemonwatch/">
            <span className="wide-only">Daemonwatch: </span>team drills
          </a>
        </nav>
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
        <Suspense
          fallback={
            <p className="muted" role="status">
              Summoning your shift…
            </p>
          }
        >
          {screen.kind === 'play' && <Session initial={screen.session} grafanaUrl={grafanaUrl} onEnded={(pm) => setScreen({ kind: 'postmortem', pm })} />}
          {screen.kind === 'postmortem' && <Postmortem pm={screen.pm} onAgain={() => setScreen({ kind: 'pick' })} />}
        </Suspense>
      </main>
    </>
  );
}
