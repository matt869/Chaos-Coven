import type { Haunting, ScoreBreakdown, SignalDefinition } from '@witching-hour/engine';

export interface TimelineEvent {
  at: number;
  type: 'page' | 'escalation' | 'command' | 'hint' | 'diagnosis' | 'verify' | 'end';
  text: string;
}

export interface Postmortem {
  sessionId: string;
  hauntingId: string;
  hauntingName: string;
  player?: string;
  startedAt: number;
  endedAt: number;
  endedBecause: 'player' | 'timeout' | 'shutdown' | 'idle';
  score: ScoreBreakdown;
  whatHappened: string;
  theFix: string;
  yourDiagnosis?: { component: string; summary: string };
  signals: { id: string; kind: SignalDefinition['kind']; description: string; checked: boolean }[];
  hintsUsed: number;
  timeline: TimelineEvent[];
  closing: string;
}

/** Metric names (identifiers followed by { or [) and service/job label values in a query. */
export function signalTargets(query: string): { metrics: string[]; services: string[] } {
  const metrics = [...query.matchAll(/([a-zA-Z_:][a-zA-Z0-9_:]*)\s*[{[]/g)].map((m) => m[1]!).filter((m) => !['by', 'without', 'sum', 'rate'].includes(m));
  const services = [...query.matchAll(/(?:service|job)="([a-z]+)"/g)].map((m) => m[1]!);
  return { metrics: [...new Set(metrics)], services: [...new Set(services)] };
}

/**
 * A signal counts as checked when the player queried one of its metrics, or read the
 * logs of the service a log signal is about.
 */
export function signalChecked(signal: SignalDefinition, commands: string[]): boolean {
  const { metrics, services } = signalTargets(signal.query);
  const lower = commands.map((c) => c.toLowerCase());
  if (signal.source === 'prometheus') {
    return lower.some((c) => c.startsWith('haunt promql') && metrics.some((m) => c.includes(m.toLowerCase())));
  }
  return lower.some((c) => (c.startsWith('haunt logs ') || c.startsWith('haunt grep ')) && services.some((s) => c.split(' ')[2] === s));
}

export function closingLine(score: ScoreBreakdown): string {
  if (score.total >= 85) return 'The house is quiet again. You found the ghost and sent it home.';
  if (score.total >= 50) return 'The haunting is over, but the ghost left marks. Read the timeline before the next one.';
  return 'The night got the better of you this time. Every on-call engineer has one of these; the postmortem is where it pays off.';
}

export function buildPostmortem(input: {
  sessionId: string;
  haunting: Haunting;
  player?: string;
  startedAt: number;
  endedAt: number;
  endedBecause: Postmortem['endedBecause'];
  score: ScoreBreakdown;
  diagnosis?: { component: string; summary: string };
  commands: string[];
  hintsUsed: number;
  timeline: TimelineEvent[];
}): Postmortem {
  const h = input.haunting;
  return {
    sessionId: input.sessionId,
    hauntingId: h.id,
    hauntingName: h.name,
    player: input.player,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    endedBecause: input.endedBecause,
    score: input.score,
    whatHappened: h.rootCause.summary,
    theFix: h.fix.summary,
    yourDiagnosis: input.diagnosis,
    signals: h.signals.map((s) => ({ id: s.id, kind: s.kind, description: s.description, checked: signalChecked(s, input.commands) })),
    hintsUsed: input.hintsUsed,
    timeline: input.timeline,
    closing: closingLine(input.score),
  };
}
