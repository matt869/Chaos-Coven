import { formatDuration, type Postmortem as PM } from './api';
import { CandyCorn, Ghost, type Mood } from './art';

function moodFor(total: number, verified: boolean): Mood {
  if (total >= 85) return 'happy';
  if (verified || total >= 60) return 'calm';
  if (total >= 30) return 'worried';
  return 'sad';
}

/** A one-time shower of candy corn for a Ghostbuster shift. Purely decorative. */
function CandyShower() {
  return (
    <div className="candy-shower" aria-hidden="true">
      {Array.from({ length: 14 }, (_, i) => (
        <CandyCorn key={i} className={`candy candy-${i % 7}`} />
      ))}
    </div>
  );
}

/** A rank for the shift, from the fixed score. */
export function rankFor(total: number): string {
  if (total >= 85) return 'Ghostbuster';
  if (total >= 60) return 'Night-shift survivor';
  if (total >= 30) return 'Spooked';
  return 'Possessed';
}

const KIND_LABEL = { symptom: 'symptom', cause: 'cause', 'red-herring': 'red herring' } as const;

/** The shift report: the score on the left, the ledger and evidence on the right. */
export function Postmortem({ pm, onAgain }: { pm: PM; onAgain: () => void }) {
  const s = pm.score;
  const duration = Math.round((pm.endedAt - pm.startedAt) / 1000);
  const at = (t: number) => formatDuration(Math.max(0, (t - pm.startedAt) / 1000));
  const causes = pm.signals.filter((x) => x.kind === 'cause');
  const missed = causes.filter((x) => !x.checked);
  const missedCauses = missed.length;

  return (
    <article className="report" aria-labelledby="pm-title">
      <header className="report-score">
        <p className="kicker">Shift report{pm.player ? ` · ${pm.player}` : ''}</p>
        <h2 id="pm-title" tabIndex={-1}>
          {pm.hauntingName}
        </h2>
        <div className="score-row">
          <p className="score" aria-label={`Score ${s.total} out of ${s.max}`}>
            <span className="score-value">{s.total}</span>
            <span className="score-max">/ {s.max}</span>
          </p>
          <p className={`stamp ${s.fix.verified ? 'stamp-ok' : 'stamp-bad'}`}>{s.fix.verified ? 'Exorcised' : 'Still haunted'}</p>
        </div>
        <p className="rank">
          <Ghost className="rank-ghost" mood={moodFor(s.total, s.fix.verified)} />
          {rankFor(s.total)}
        </p>
        {s.total >= 85 && <CandyShower />}
        <p className="closing">{pm.closing}</p>
        <p className="muted data">
          {pm.endedBecause === 'timeout' ? 'time ran out' : 'shift ended'} after {formatDuration(duration)}
          {pm.hintsUsed > 0 && ` · ${pm.hintsUsed} hint${pm.hintsUsed === 1 ? '' : 's'}`}
          {causes.length > 0 && ` · ${causes.length - missedCauses}/${causes.length} cause signals checked`}
        </p>
        <aside className="next-shift" aria-labelledby="pm-next">
          <h3 id="pm-next">Next shift, check first</h3>
          {missed.length === 0 ? (
            <p>You checked every cause signal. Next time, try to name the component sooner.</p>
          ) : (
            <ul>
              {missed.slice(0, 3).map((m) => (
                <li key={m.id}>{m.description}</li>
              ))}
            </ul>
          )}
        </aside>
        <button type="button" className="primary" onClick={onAgain}>
          Take the pager again
        </button>
      </header>

      <div className="report-body">
        <section aria-labelledby="pm-score">
          <h3 id="pm-score">How the score adds up</h3>
          <table className="ledger">
            <tbody>
              <tr>
                <th scope="row">Detection</th>
                <td className="pts">
                  {s.detection.points} / {s.detection.max}
                </td>
                <td className="why">
                  {s.detection.seconds === null
                    ? 'You never named the failing component.'
                    : `Right component named at ${formatDuration(s.detection.seconds)}, par ${formatDuration(s.detection.parSeconds)}.`}
                </td>
              </tr>
              <tr>
                <th scope="row">Root cause</th>
                <td className="pts">
                  {s.rootCause.points} / {s.rootCause.max}
                </td>
                <td className="why">
                  {s.rootCause.componentCorrect
                    ? `Right component; your explanation covered ${s.rootCause.keywordGroupsMatched} of ${s.rootCause.keywordGroupsRequired} key points.`
                    : 'Wrong or missing component.'}
                </td>
              </tr>
              <tr>
                <th scope="row">Fix</th>
                <td className="pts">
                  {s.fix.points} / {s.fix.max}
                </td>
                <td className="why">{s.fix.verified ? 'Verified by live health checks.' : 'Never verified. Press Verify fix after you change something.'}</td>
              </tr>
              <tr>
                <th scope="row">Penalties</th>
                <td className="pts">−{s.penalties.points}</td>
                <td className="why">{s.penalties.items.length === 0 ? 'No harmful actions.' : `${s.penalties.items.length} harmful action(s), listed below.`}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section aria-labelledby="pm-what">
          <h3 id="pm-what">What happened</h3>
          <dl className="facts">
            <dt>Root cause</dt>
            <dd>{pm.whatHappened}</dd>
            <dt>The fix</dt>
            <dd>{pm.theFix}</dd>
            {pm.yourDiagnosis && (
              <>
                <dt>You said</dt>
                <dd>
                  <code>{pm.yourDiagnosis.component}</code> {pm.yourDiagnosis.summary}
                </dd>
              </>
            )}
          </dl>
        </section>

        {s.penalties.items.length > 0 && (
          <section aria-labelledby="pm-harm">
            <h3 id="pm-harm">Harmful actions</h3>
            <ul className="harm">
              {s.penalties.items.map((p, i) => (
                <li key={i}>
                  <span className="data">−{p.penalty}</span>
                  <span>
                    <code>{p.command}</code> {p.reason}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="pm-signals">
          <h3 id="pm-signals">The evidence</h3>
          <ul className="evidence">
            {pm.signals.map((sig) => (
              <li key={sig.id}>
                <span className={`seen ${sig.checked ? 'ok' : 'missed'}`}>
                  {sig.checked ? '✓ checked' : '✗ missed'}
                  <span className="tag evidence-kind">
                    {KIND_LABEL[sig.kind]}
                  </span>
                </span>
                <span>{sig.description}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="pm-timeline">
          <h3 id="pm-timeline">Timeline</h3>
          <ol className="timeline">
            {pm.timeline.map((e, i) => (
              <li key={i} className={`ev-${e.type}`}>
                <time>{at(e.at)}</time>
                <span className="kind">{e.type}</span>
                <span className="text">{e.text}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </article>
  );
}
