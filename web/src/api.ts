// Types mirror server/src/session (SessionView, Postmortem). Kept local so the UI
// bundle does not pull in server code.

export interface HauntingSummary {
  id: string;
  name: string;
  difficulty: 'easy' | 'medium' | 'hard';
  escalationSteps: number;
  parSeconds: number;
}

export interface VerifySummary {
  at: number;
  pass: boolean;
  checks: { id: string; description: string; pass: boolean; observed: number | null }[];
}

export interface SessionView {
  id: string;
  hauntingId: string;
  hauntingName: string;
  difficulty: HauntingSummary['difficulty'];
  parSeconds: number;
  player?: string;
  status: 'active' | 'ended';
  startedAt: number;
  elapsedSeconds: number;
  alert: string;
  narration: { at: number; text: string }[];
  escalationStep: number;
  hintsUsed: number;
  hintsLeft: number;
  diagnosis?: { component: string; summary: string };
  lastVerify?: VerifySummary;
  hasPostmortem: boolean;
}

export interface Postmortem {
  sessionId: string;
  hauntingName: string;
  player?: string;
  startedAt: number;
  endedAt: number;
  endedBecause: 'player' | 'timeout' | 'shutdown';
  score: {
    total: number;
    max: number;
    detection: { points: number; max: number; seconds: number | null; parSeconds: number };
    rootCause: { points: number; max: number; componentCorrect: boolean; keywordGroupsMatched: number; keywordGroupsRequired: number };
    fix: { points: number; max: number; verified: boolean };
    penalties: { points: number; items: { command: string; penalty: number; reason: string }[] };
  };
  whatHappened: string;
  theFix: string;
  yourDiagnosis?: { component: string; summary: string };
  signals: { id: string; kind: 'symptom' | 'cause' | 'red-herring'; description: string; checked: boolean }[];
  hintsUsed: number;
  timeline: { at: number; type: string; text: string }[];
  closing: string;
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

export const api = {
  config: () => call<{ grafanaUrl: string }>('GET', '/api/config'),
  hauntings: () => call<HauntingSummary[]>('GET', '/api/hauntings'),
  active: () => call<SessionView | null>('GET', '/api/sessions/active'),
  start: (hauntingId: string, player?: string) => call<SessionView>('POST', '/api/sessions', { hauntingId, player }),
  session: (id: string) => call<SessionView>('GET', `/api/sessions/${id}`),
  hint: (id: string) => call<{ hint: string }>('POST', `/api/sessions/${id}/hint`),
  diagnose: (id: string, component: string, summary: string) => call<SessionView>('POST', `/api/sessions/${id}/diagnose`, { component, summary }),
  verify: (id: string) => call<VerifySummary>('POST', `/api/sessions/${id}/verify`),
  end: (id: string) => call<Postmortem>('POST', `/api/sessions/${id}/end`),
  postmortem: (id: string) => call<Postmortem>('GET', `/api/sessions/${id}/postmortem`),
};

/** Observed metric values, readable: 2.7528680157817065 -> 2.75, 190038016 -> 190M. */
export function formatObserved(v: number | null): string {
  if (v === null || Number.isNaN(v)) return 'no data';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${+(v / 1e9).toPrecision(3)}G`;
  if (abs >= 1e6) return `${+(v / 1e6).toPrecision(3)}M`;
  if (abs >= 1e4) return `${+(v / 1e3).toPrecision(3)}k`;
  return String(+v.toPrecision(3));
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
