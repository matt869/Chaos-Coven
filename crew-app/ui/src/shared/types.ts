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

export interface NewDrill {
  hauntingId: string;
  team: string;
  players: string[];
  scheduledFor: string;
}

/** The drills API, reached through fetch (standalone) or the Crew app API (Crew page). */
export interface DrillsClient {
  hauntings(): Promise<Haunting[]>;
  list(): Promise<Drill[]>;
  create(d: NewDrill): Promise<Drill>;
  cancel(id: string): Promise<Drill>;
  start(id: string, player: string): Promise<unknown>;
}

export type Request = (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) => Promise<unknown>;

/** Builds a DrillsClient on top of any request function. `base` is the API prefix. */
export function drillsClient(request: Request, base: string): DrillsClient {
  return {
    hauntings: () => request('GET', `${base}/hauntings`) as Promise<Haunting[]>,
    list: () => request('GET', `${base}/drills`) as Promise<Drill[]>,
    create: (d) => request('POST', `${base}/drills`, d) as Promise<Drill>,
    cancel: (id) => request('DELETE', `${base}/drills/${encodeURIComponent(id)}`) as Promise<Drill>,
    start: (id, player) => request('POST', `${base}/drills/${encodeURIComponent(id)}/start`, { player }),
  };
}
