import { useEffect, useState, type FormEvent } from 'react';

export interface Haunting {
  id: string;
  name: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface DrillResult {
  player: string;
  sessionId: string;
  score: number;
  maxScore: number;
  detectionSeconds: number | null;
  rootCauseCorrect: boolean;
  fixVerified: boolean;
  harmfulActions: number;
  endedAt: string;
}

export interface Drill {
  id: string;
  hauntingId: string;
  team: string;
  players: string[];
  scheduledFor: string;
  status: 'scheduled' | 'cancelled';
  results: DrillResult[];
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
  return data as T;
}

const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const fmtSeconds = (s: number | null) => (s === null ? 'not detected' : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);

/** Splits a comma or newline separated list of names. */
export function parsePlayers(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((p) => p.trim()).filter(Boolean))];
}

export function teamAverage(results: DrillResult[]): number | null {
  if (results.length === 0) return null;
  return Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
}

export function ScheduleForm({ hauntings, onCreate }: { hauntings: Haunting[]; onCreate: (d: { hauntingId: string; team: string; players: string[]; scheduledFor: string }) => Promise<void> }) {
  const [hauntingId, setHauntingId] = useState('');
  const [team, setTeam] = useState('');
  const [players, setPlayers] = useState('');
  const [when, setWhen] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await onCreate({ hauntingId, team: team.trim(), players: parsePlayers(players), scheduledFor: new Date(when).toISOString() });
      setTeam('');
      setPlayers('');
      setWhen('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form className="card" onSubmit={(e) => void submit(e)} aria-labelledby="schedule-title">
      <h2 id="schedule-title">Schedule a drill</h2>
      <label htmlFor="haunting">Haunting</label>
      <select id="haunting" value={hauntingId} onChange={(e) => setHauntingId(e.target.value)} required>
        <option value="" disabled>
          Choose…
        </option>
        {hauntings.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name} ({h.difficulty})
          </option>
        ))}
      </select>
      <label htmlFor="team">Team</label>
      <input id="team" value={team} onChange={(e) => setTeam(e.target.value)} maxLength={40} required />
      <label htmlFor="players">Players</label>
      <textarea id="players" value={players} onChange={(e) => setPlayers(e.target.value)} rows={3} placeholder="One per line, or comma separated" required />
      <label htmlFor="when">When</label>
      <input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
      <button type="submit" className="primary">
        Schedule drill
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function DrillCard({ drill, hauntingName, onStart, onCancel }: { drill: Drill; hauntingName: string; onStart: (player: string) => void; onCancel: () => void }) {
  const avg = teamAverage(drill.results);
  const done = new Set(drill.results.map((r) => r.player));
  return (
    <article className="card" aria-labelledby={`drill-${drill.id}`}>
      <h3 id={`drill-${drill.id}`}>
        {drill.team}: {hauntingName}
      </h3>
      <p className="muted">
        {fmtTime(drill.scheduledFor)} · {drill.status === 'cancelled' ? 'cancelled' : `${drill.results.length}/${drill.players.length} done`}
        {avg !== null && ` · team average ${avg}/100`}
      </p>
      <table>
        <caption className="sr-only">Results for {drill.team}</caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Score</th>
            <th scope="col">Detected</th>
            <th scope="col">Root cause</th>
            <th scope="col">Fix verified</th>
            <th scope="col">Harmful actions</th>
            <th scope="col">
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {drill.players.map((p) => {
            const r = drill.results.find((x) => x.player === p);
            return (
              <tr key={p}>
                <th scope="row">{p}</th>
                <td>{r ? `${r.score}/${r.maxScore}` : '—'}</td>
                <td>{r ? fmtSeconds(r.detectionSeconds) : '—'}</td>
                <td>{r ? (r.rootCauseCorrect ? 'right' : 'wrong') : '—'}</td>
                <td>{r ? (r.fixVerified ? 'yes' : 'no') : '—'}</td>
                <td>{r ? r.harmfulActions : '—'}</td>
                <td>
                  {drill.status === 'scheduled' && (
                    <button type="button" onClick={() => onStart(p)} aria-label={`${done.has(p) ? 'Rerun' : 'Start'} drill for ${p}`}>
                      {done.has(p) ? 'Rerun' : 'Start'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {drill.status === 'scheduled' && (
        <button type="button" className="danger" onClick={onCancel}>
          Cancel drill
        </button>
      )}
    </article>
  );
}

export function App() {
  const [hauntings, setHauntings] = useState<Haunting[]>([]);
  const [drills, setDrills] = useState<Drill[]>([]);
  const [status, setStatus] = useState('');

  const refresh = () => call<Drill[]>('GET', '/api/drills').then(setDrills).catch((e: Error) => setStatus(e.message));

  useEffect(() => {
    void call<Haunting[]>('GET', '/api/hauntings').then(setHauntings).catch((e: Error) => setStatus(e.message));
    void refresh();
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, []);

  const name = (id: string) => hauntings.find((h) => h.id === id)?.name ?? id;

  return (
    <>
      <header className="top">
        <h1>
          Daemonwatch <span className="muted">team drills for Witching Hour</span>
        </h1>
      </header>
      <main>
        <ScheduleForm
          hauntings={hauntings}
          onCreate={async (d) => {
            await call('POST', '/api/drills', d);
            setStatus('Drill scheduled.');
            await refresh();
          }}
        />
        <section aria-labelledby="drills-title">
          <h2 id="drills-title">Drills</h2>
          {drills.length === 0 && <p className="muted">No drills yet.</p>}
          {drills.map((d) => (
            <DrillCard
              key={d.id}
              drill={d}
              hauntingName={name(d.hauntingId)}
              onStart={(player) =>
                void call('POST', `/api/drills/${d.id}/start`, { player })
                  .then(() => {
                    setStatus(`Started for ${player}. Opening the player view…`);
                    window.open('/', '_blank', 'noopener');
                  })
                  .catch((e: Error) => setStatus(e.message))
              }
              onCancel={() => void call('DELETE', `/api/drills/${d.id}`).then(refresh).catch((e: Error) => setStatus(e.message))}
            />
          ))}
        </section>
        <p role="status" className="muted">
          {status}
        </p>
      </main>
    </>
  );
}
