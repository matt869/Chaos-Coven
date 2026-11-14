import { formatDuration, type Postmortem as PM } from './api';

const KIND_LABEL = { symptom: 'Symptom', cause: 'Cause', 'red-herring': 'Red herring' } as const;

export function Postmortem({ pm, onAgain }: { pm: PM; onAgain: () => void }) {
  const s = pm.score;
  const duration = Math.round((pm.endedAt - pm.startedAt) / 1000);
  return (
    <article className="postmortem" aria-labelledby="pm-title">
      <header>
        <h2 id="pm-title">Postmortem: {pm.hauntingName}</h2>
        <p className="score" aria-label={`Score ${s.total} out of ${s.max}`}>
          <span className="score-value">{s.total}</span>
          <span className="score-max">/ {s.max}</span>
        </p>
        <p className="narration-line">{pm.closing}</p>
        <p className="muted">
          {pm.endedBecause === 'timeout' ? 'Time ran out' : 'Session ended'} after {formatDuration(duration)}.
          {pm.hintsUsed > 0 && ` You used ${pm.hintsUsed} hint${pm.hintsUsed === 1 ? '' : 's'}.`}
        </p>
      </header>

      <section aria-labelledby="pm-score">
        <h3 id="pm-score">How the score adds up</h3>
        <table className="breakdown">
          <tbody>
            <tr>
              <th scope="row">Detection</th>
              <td>
                {s.detection.points} / {s.detection.max}
              </td>
              <td className="muted">
                {s.detection.seconds === null
                  ? 'You never named the failing component.'
                  : `Named the right component after ${formatDuration(s.detection.seconds)} (par ${formatDuration(s.detection.parSeconds)}).`}
              </td>
            </tr>
            <tr>
              <th scope="row">Root cause</th>
              <td>
                {s.rootCause.points} / {s.rootCause.max}
              </td>
              <td className="muted">
                {s.rootCause.componentCorrect
                  ? `Right component; your explanation covered ${s.rootCause.keywordGroupsMatched} of ${s.rootCause.keywordGroupsRequired} key points.`
                  : 'Wrong or missing component.'}
              </td>
            </tr>
            <tr>
              <th scope="row">Fix</th>
              <td>
                {s.fix.points} / {s.fix.max}
              </td>
              <td className="muted">{s.fix.verified ? 'Verified by live health checks.' : 'Never verified. Run Verify fix after you change something.'}</td>
            </tr>
            <tr>
              <th scope="row">Penalties</th>
              <td>−{s.penalties.points}</td>
              <td className="muted">{s.penalties.items.length === 0 ? 'No harmful actions.' : `${s.penalties.items.length} harmful action(s), listed below.`}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="pm-what">
        <h3 id="pm-what">What happened</h3>
        <p>{pm.whatHappened}</p>
        <h4>The fix</h4>
        <p>{pm.theFix}</p>
        {pm.yourDiagnosis && (
          <>
            <h4>Your diagnosis</h4>
            <p>
              <strong>{pm.yourDiagnosis.component}</strong>: {pm.yourDiagnosis.summary}
            </p>
          </>
        )}
      </section>

      {s.penalties.items.length > 0 && (
        <section aria-labelledby="pm-harm">
          <h3 id="pm-harm">Harmful actions</h3>
          <ul>
            {s.penalties.items.map((p, i) => (
              <li key={i}>
                <code>{p.command}</code> (−{p.penalty}): {p.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="pm-signals">
        <h3 id="pm-signals">The evidence</h3>
        <ul className="signals">
          {pm.signals.map((sig) => (
            <li key={sig.id}>
              <span className={`tag tag-${sig.kind}`}>{KIND_LABEL[sig.kind]}</span> {sig.description}{' '}
              <span className={sig.checked ? 'ok' : 'missed'}>{sig.checked ? '(you checked this)' : '(missed)'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="pm-timeline">
        <h3 id="pm-timeline">Timeline</h3>
        <ol className="timeline">
          {pm.timeline.map((e, i) => (
            <li key={i}>
              <time>{formatDuration(Math.max(0, (e.at - pm.startedAt) / 1000))}</time> <span className="tag">{e.type}</span> {e.text}
            </li>
          ))}
        </ol>
      </section>

      <button type="button" className="primary" onClick={onAgain}>
        Face another haunting
      </button>
    </article>
  );
}
