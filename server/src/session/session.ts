import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { scoreRun, type Engine, type Haunting, type PlayerAction, type VerifyResult } from '@witching-hour/engine';
import type { Narrator } from '../narrator/bedrock.js';
import { execute, type ExecDeps } from '../terminal/executor.js';
import { parseCommand } from '../terminal/parser.js';
import { buildPostmortem, type Postmortem, type TimelineEvent } from './postmortem.js';

export class SessionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SessionOptions {
  engine: Engine;
  narrator: Narrator;
  exec: ExecDeps;
  clock?: () => number;
  timers?: Timers;
  /** Speeds up escalation for demos and tests: 2 means twice as fast. */
  timeScale?: number;
  /** Sessions end (and revert) on their own after this long. */
  maxMinutes?: number;
}

interface Session {
  id: string;
  haunting: Haunting;
  drillId?: string;
  player?: string;
  startedAt: number;
  status: 'active' | 'ended';
  step: number;
  narration: { at: number; text: string }[];
  timeline: TimelineEvent[];
  actions: PlayerAction[];
  hintsUsed: number;
  detectedAt?: number;
  diagnosis?: { component: string; summary: string };
  fixVerified: boolean;
  lastVerify?: { at: number; pass: boolean; checks: { id: string; description: string; pass: boolean; observed: number | null }[] };
  timers: unknown[];
  postmortem?: Postmortem;
}

/** What the player may see. No target, fault or root cause until the postmortem. */
export interface SessionView {
  id: string;
  hauntingId: string;
  hauntingName: string;
  difficulty: Haunting['difficulty'];
  drillId?: string;
  player?: string;
  status: Session['status'];
  startedAt: number;
  elapsedSeconds: number;
  alert: string;
  narration: { at: number; text: string }[];
  escalationStep: number;
  hintsUsed: number;
  hintsLeft: number;
  diagnosis?: Session['diagnosis'];
  lastVerify?: Session['lastVerify'];
  hasPostmortem: boolean;
}

export type SessionEvent =
  | { type: 'narration'; sessionId: string; text: string }
  | { type: 'ended'; sessionId: string; postmortem: Postmortem };

export const MAX_HINTS = 3;

/**
 * Runs play sessions. There is one sandbox, so one session at a time. Ending a session,
 * timing out, or shutting down always reverts the haunting (sandbox-safety.md).
 */
export class SessionManager extends EventEmitter {
  private readonly sessions = new Map<string, Session>();
  private activeId: string | undefined;
  private readonly clock: () => number;
  private readonly timers: Timers;
  private readonly timeScale: number;
  private readonly maxMs: number;

  constructor(private readonly opts: SessionOptions) {
    super();
    this.clock = opts.clock ?? Date.now;
    this.timers = opts.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as never) };
    this.timeScale = opts.timeScale ?? 1;
    this.maxMs = (opts.maxMinutes ?? 45) * 60_000;
  }

  onEvent(fn: (e: SessionEvent) => void): () => void {
    this.on('event', fn);
    return () => this.off('event', fn);
  }

  private publish(e: SessionEvent): void {
    this.emit('event', e);
  }

  hauntings(): { id: string; name: string; difficulty: Haunting['difficulty']; escalationSteps: number }[] {
    return this.opts.engine.list().map((h) => ({ id: h.id, name: h.name, difficulty: h.difficulty, escalationSteps: h.escalationSteps }));
  }

  active(): SessionView | undefined {
    return this.activeId === undefined ? undefined : this.view(this.activeId);
  }

  async start(hauntingId: string, meta: { player?: string; drillId?: string } = {}): Promise<SessionView> {
    if (this.activeId !== undefined) throw new SessionError(409, 'a haunting is already running in the sandbox. End it first.');
    let haunting: Haunting;
    try {
      haunting = this.opts.engine.get(hauntingId);
    } catch {
      throw new SessionError(404, `unknown haunting "${hauntingId}"`);
    }
    const id = randomUUID();
    this.activeId = id; // claim the sandbox before awaiting
    try {
      const applied = await this.opts.engine.apply(hauntingId);
      const startedAt = this.clock();
      const session: Session = {
        id,
        haunting,
        drillId: meta.drillId,
        player: meta.player,
        startedAt,
        status: 'active',
        step: 0,
        narration: [],
        timeline: [{ at: startedAt, type: 'page', text: applied.page.alert }],
        actions: [],
        hintsUsed: 0,
        fixVerified: false,
        timers: [],
      };
      this.sessions.set(id, session);
      await this.narrate(session, 'page', applied.page.narration, [applied.page.alert]);

      for (const step of haunting.escalation) {
        const ms = (step.afterSeconds * 1000) / this.timeScale;
        session.timers.push(this.timers.setTimeout(() => void this.escalate(session, step.step), ms));
      }
      session.timers.push(this.timers.setTimeout(() => void this.end(id, 'timeout').catch(() => undefined), this.maxMs));
      return this.view(id);
    } catch (err) {
      this.activeId = undefined;
      // The engine already rolled the fault back. Tell the player why it didn't start.
      throw new SessionError(503, `could not start the haunting: ${(err as Error).message.split('\n')[0]}. Is the sandbox running? (npm run sandbox:up)`);
    }
  }

  get(id: string): Session {
    const s = this.sessions.get(id);
    if (s === undefined) throw new SessionError(404, 'unknown session');
    return s;
  }

  view(id: string): SessionView {
    const s = this.get(id);
    const now = s.status === 'ended' && s.postmortem ? s.postmortem.endedAt : this.clock();
    return {
      id: s.id,
      hauntingId: s.haunting.id,
      hauntingName: s.haunting.name,
      difficulty: s.haunting.difficulty,
      drillId: s.drillId,
      player: s.player,
      status: s.status,
      startedAt: s.startedAt,
      elapsedSeconds: Math.round((now - s.startedAt) / 1000),
      alert: s.haunting.page.alert,
      narration: s.narration,
      escalationStep: s.step,
      hintsUsed: s.hintsUsed,
      hintsLeft: MAX_HINTS - s.hintsUsed,
      diagnosis: s.diagnosis,
      lastVerify: s.lastVerify,
      hasPostmortem: s.postmortem !== undefined,
    };
  }

  /** Parses and runs one terminal line. Every accepted command is recorded for scoring. */
  async command(id: string, line: string): Promise<{ ok: boolean; output: string }> {
    const s = this.activeSession(id);
    const parsed = parseCommand(line);
    if (!parsed.ok) return { ok: false, output: parsed.error };
    const at = this.clock();
    s.actions.push({ at, command: parsed.canonical });
    s.timeline.push({ at, type: 'command', text: parsed.canonical });
    try {
      return { ok: true, output: await execute(parsed.command, this.opts.exec) };
    } catch (err) {
      return { ok: false, output: `error: ${(err as Error).message}` };
    }
  }

  async hint(id: string): Promise<string> {
    const s = this.activeSession(id);
    if (s.hintsUsed >= MAX_HINTS) throw new SessionError(409, 'no hints left');
    const h = s.haunting;
    const symptom = h.signals.find((x) => x.kind === 'symptom');
    const cause = h.signals.find((x) => x.kind === 'cause');
    const lines = [
      symptom ? `Start with what customers feel: ${symptom.description}` : `Start with the alert: ${h.page.alert}`,
      cause ? `Then follow it inward: ${cause.description}` : `Look closely at ${h.rootCause.component}.`,
      `The trouble lives in ${h.rootCause.component}.`,
    ];
    const line = lines[s.hintsUsed]!;
    s.hintsUsed++;
    s.timeline.push({ at: this.clock(), type: 'hint', text: line });
    return this.opts.narrator.narrate({ kind: 'hint', fallback: line, facts: [line] });
  }

  diagnose(id: string, diagnosis: { component: string; summary: string }): SessionView {
    const s = this.activeSession(id);
    const component = String(diagnosis.component ?? '').trim().toLowerCase().slice(0, 40);
    const summary = String(diagnosis.summary ?? '').trim().slice(0, 1000);
    if (component === '' || summary === '') throw new SessionError(400, 'name a component and describe the root cause');
    const at = this.clock();
    s.diagnosis = { component, summary };
    // Detection time is the first time the player names the right component.
    if (s.detectedAt === undefined && component === s.haunting.rootCause.component) s.detectedAt = at;
    s.timeline.push({ at, type: 'diagnosis', text: `${component}: ${summary}` });
    return this.view(id);
  }

  async verify(id: string): Promise<NonNullable<Session['lastVerify']>> {
    const s = this.activeSession(id);
    const r: VerifyResult = await this.opts.engine.verify(s.haunting.id);
    const at = this.clock();
    s.lastVerify = { at, pass: r.pass, checks: r.checks.map((c) => ({ id: c.id, description: c.description, pass: c.pass, observed: c.observed })) };
    if (r.pass) s.fixVerified = true;
    s.timeline.push({ at, type: 'verify', text: r.pass ? 'fix verified: every health check passed' : `fix not verified: ${r.checks.filter((c) => !c.pass).length} check(s) failing` });
    return s.lastVerify;
  }

  async end(id: string, because: Postmortem['endedBecause'] = 'player'): Promise<Postmortem> {
    const s = this.get(id);
    if (s.status === 'ended' && s.postmortem) return s.postmortem;
    s.status = 'ended';
    for (const t of s.timers) this.timers.clearTimeout(t);
    if (this.activeId === id) this.activeId = undefined;
    try {
      await this.opts.engine.revert(s.haunting.id);
    } finally {
      const endedAt = this.clock();
      s.timeline.push({ at: endedAt, type: 'end', text: because === 'player' ? 'session ended by the player' : `session ended (${because})` });
      const score = scoreRun(s.haunting, {
        hauntingId: s.haunting.id,
        startedAt: s.startedAt,
        detectedAt: s.detectedAt,
        diagnosis: s.diagnosis,
        fixVerified: s.fixVerified,
        actions: s.actions,
      });
      s.postmortem = buildPostmortem({
        sessionId: s.id,
        haunting: s.haunting,
        player: s.player,
        startedAt: s.startedAt,
        endedAt,
        endedBecause: because,
        score,
        diagnosis: s.diagnosis,
        commands: s.actions.map((a) => a.command),
        hintsUsed: s.hintsUsed,
        timeline: s.timeline,
      });
      this.publish({ type: 'ended', sessionId: s.id, postmortem: s.postmortem });
    }
    return s.postmortem;
  }

  postmortem(id: string): Postmortem {
    const s = this.get(id);
    if (s.postmortem === undefined) throw new SessionError(409, 'the session is still running');
    return s.postmortem;
  }

  /** Ends the running session, if any. Use on shutdown. */
  async shutdown(): Promise<void> {
    if (this.activeId !== undefined) await this.end(this.activeId, 'shutdown');
  }

  private activeSession(id: string): Session {
    const s = this.get(id);
    if (s.status !== 'active') throw new SessionError(409, 'the session has ended');
    return s;
  }

  private async escalate(s: Session, step: number): Promise<void> {
    if (s.status !== 'active') return;
    try {
      const r = await this.opts.engine.escalate(s.haunting.id, step);
      s.step = r.step;
      for (const a of r.applied) {
        s.timeline.push({ at: this.clock(), type: 'escalation', text: `escalation step ${a.step}` });
        await this.narrate(s, 'escalation', a.narration, [s.haunting.page.alert]);
      }
    } catch {
      // The session may have ended between the timer firing and now.
    }
  }

  private async narrate(s: Session, kind: 'page' | 'escalation', fallback: string, facts: string[]): Promise<void> {
    const text = await this.opts.narrator.narrate({ kind, fallback, facts });
    s.narration.push({ at: this.clock(), text });
    this.publish({ type: 'narration', sessionId: s.id, text });
  }
}
