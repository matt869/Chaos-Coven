import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { fmtSeconds, fmtTime, parsePlayers, teamAverage } from './helpers';
import type { UiKit } from './kit';
import type { Drill, DrillsClient, Haunting, NewDrill } from './types';

export function ScheduleForm({ kit, hauntings, onCreate }: { kit: UiKit; hauntings: Haunting[]; onCreate: (d: NewDrill) => Promise<void> }) {
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
    <kit.Card title="Schedule a drill" titleId="schedule-title">
      <form className="dw-form" onSubmit={(e) => void submit(e)}>
        <label htmlFor="dw-haunting">Haunting</label>
        <select id="dw-haunting" value={hauntingId} onChange={(e) => setHauntingId(e.target.value)} required>
          <option value="" disabled>
            Choose…
          </option>
          {hauntings.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name} ({h.difficulty})
            </option>
          ))}
        </select>
        <label htmlFor="dw-team">Team</label>
        <input id="dw-team" value={team} onChange={(e) => setTeam(e.target.value)} maxLength={40} required />
        <label htmlFor="dw-players">Players</label>
        <textarea id="dw-players" value={players} onChange={(e) => setPlayers(e.target.value)} rows={3} placeholder="One per line, or comma separated" required />
        <label htmlFor="dw-when">When</label>
        <input id="dw-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
        <kit.Button type="submit" variant="primary">
          Schedule drill
        </kit.Button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </kit.Card>
  );
}

export function DrillCard({ kit, drill, hauntingName, onStart, onCancel }: { kit: UiKit; drill: Drill; hauntingName: string; onStart: (player: string) => void; onCancel: () => void }) {
  const avg = teamAverage(drill.results);
  const done = new Set(drill.results.map((r) => r.player));
  const titleId = `drill-${drill.id}`;
  return (
    <kit.Card title={`${drill.team}: ${hauntingName}`} titleId={titleId}>
      <p className="muted">
        {fmtTime(drill.scheduledFor)} · {drill.status === 'cancelled' ? 'cancelled' : `${drill.results.length}/${drill.players.length} done`}
        {avg !== null && ` · team average ${avg}/100`}
      </p>
      <table className="dw-table">
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
                    <kit.Button onClick={() => onStart(p)} ariaLabel={`${done.has(p) ? 'Rerun' : 'Start'} drill for ${p}`}>
                      {done.has(p) ? 'Rerun' : 'Start'}
                    </kit.Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {drill.status === 'scheduled' && (
        <kit.Button variant="danger" onClick={onCancel}>
          Cancel drill
        </kit.Button>
      )}
    </kit.Card>
  );
}

/** The whole Daemonwatch page. Shared by the standalone page and the Crew page. */
export function Daemonwatch({ kit, client, notify, onStarted }: { kit: UiKit; client: DrillsClient; notify: (text: string) => void; onStarted: (player: string) => void }) {
  const [hauntings, setHauntings] = useState<Haunting[]>([]);
  const [drills, setDrills] = useState<Drill[]>([]);

  const refresh = useCallback(() => client.list().then(setDrills).catch((e: Error) => notify(e.message)), [client, notify]);

  useEffect(() => {
    void client.hauntings().then(setHauntings).catch((e: Error) => notify(e.message));
    void refresh();
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, [client, notify, refresh]);

  const name = (id: string) => hauntings.find((h) => h.id === id)?.name ?? id;

  return (
    <div className="dw">
      <kit.Header title="Daemonwatch" subtitle="team drills for Witching Hour" />
      <ScheduleForm
        kit={kit}
        hauntings={hauntings}
        onCreate={async (d) => {
          await client.create(d);
          notify('Drill scheduled.');
          await refresh();
        }}
      />
      <section aria-labelledby="drills-title">
        <h2 id="drills-title">Drills</h2>
        {drills.length === 0 && <kit.Empty text="No drills yet. Schedule one above." />}
        {drills.map((d) => (
          <DrillCard
            key={d.id}
            kit={kit}
            drill={d}
            hauntingName={name(d.hauntingId)}
            onStart={(player) =>
              void client
                .start(d.id, player)
                .then(() => {
                  notify(`Started for ${player}. Opening the player view…`);
                  onStarted(player);
                })
                .catch((e: Error) => notify(e.message))
            }
            onCancel={() => void client.cancel(d.id).then(refresh).catch((e: Error) => notify(e.message))}
          />
        ))}
      </section>
    </div>
  );
}
