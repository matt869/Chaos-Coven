import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** A drill Daemonwatch scheduled for a team: one haunting, several players, one at a time. */
export interface Drill {
  id: string;
  hauntingId: string;
  team: string;
  players: string[];
  scheduledFor: string;
  createdAt: string;
  status: 'scheduled' | 'cancelled';
  results: DrillResult[];
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

export interface NewDrill {
  hauntingId: string;
  team: string;
  players: string[];
  scheduledFor: string;
}

const NAME = /^[\p{L}\p{N} ._'-]{1,40}$/u;

export function validateDrill(input: unknown, knownHauntings: string[]): NewDrill {
  const d = input as Partial<NewDrill> | undefined;
  if (typeof d?.hauntingId !== 'string' || !knownHauntings.includes(d.hauntingId)) throw new Error('choose a known haunting');
  if (typeof d.team !== 'string' || !NAME.test(d.team.trim())) throw new Error('team name: 1-40 letters, digits, spaces, . _ \' -');
  if (!Array.isArray(d.players) || d.players.length === 0 || d.players.length > 20) throw new Error('add 1-20 players');
  const players = d.players.map((p) => String(p).trim());
  if (players.some((p) => !NAME.test(p))) throw new Error('player names: 1-40 letters, digits, spaces, . _ \' -');
  if (new Set(players).size !== players.length) throw new Error('player names must be unique');
  const when = new Date(String(d.scheduledFor));
  if (Number.isNaN(when.getTime())) throw new Error('scheduledFor must be a date and time');
  return { hauntingId: d.hauntingId, team: d.team.trim(), players, scheduledFor: when.toISOString() };
}

/** Drills saved as one JSON file. Plenty for a team tool; swap for a database later. */
export class DrillStore {
  private drills: Drill[] | undefined;

  constructor(
    private readonly path: string | undefined,
    private readonly clock: () => number = Date.now,
  ) {}

  async list(): Promise<Drill[]> {
    return [...(await this.load())].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  }

  async get(id: string): Promise<Drill | undefined> {
    return (await this.load()).find((d) => d.id === id);
  }

  async create(input: NewDrill): Promise<Drill> {
    const drill: Drill = { id: randomUUID(), ...input, createdAt: new Date(this.clock()).toISOString(), status: 'scheduled', results: [] };
    (await this.load()).push(drill);
    await this.save();
    return drill;
  }

  async cancel(id: string): Promise<Drill | undefined> {
    const d = await this.get(id);
    if (d === undefined) return undefined;
    d.status = 'cancelled';
    await this.save();
    return d;
  }

  async addResult(id: string, result: DrillResult): Promise<void> {
    const d = await this.get(id);
    if (d === undefined) return;
    d.results = [...d.results.filter((r) => r.player !== result.player), result];
    await this.save();
  }

  private async load(): Promise<Drill[]> {
    if (this.drills !== undefined) return this.drills;
    if (this.path === undefined) return (this.drills = []);
    try {
      this.drills = JSON.parse(await readFile(this.path, 'utf8')) as Drill[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.drills = [];
    }
    return this.drills;
  }

  private async save(): Promise<void> {
    if (this.path === undefined) return;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(`${this.path}.tmp`, JSON.stringify(this.drills, null, 2));
    await rename(`${this.path}.tmp`, this.path);
  }
}
