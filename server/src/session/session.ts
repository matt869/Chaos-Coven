import { randomUUID, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { scoreRun, type Engine, type Haunting, type PlayerAction, type VerifyResult } from '@witching-hour/engine';
import type { Narrator } from '../narrator/bedrock.js';
import { execute, type ExecDeps } from '../terminal/executor.js';
import { parseCommand } from '../terminal/parser.js';
import { publicError } from '../http/security.js';
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
  /**
   * Sessions end (and revert) when nobody has checked in for this long. The player page
   * checks in every few seconds, so this frees the sandbox when a tab is closed.
   * Unset or 0: off.
   */
  idleMinutes?: number;
  /** Where operational problems are reported, such as an escalation step failing. */
  log?: (message: string) => void;
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
  idleTimer?: unknown;
  /** A secret held by the browser that started the session. See ownedBy(). */
  owner?: string;
  postmortem?: Postmortem;
}

/** What the player may see. No target, fault or root cause until the postmortem. */
export interface SessionView {
  id: string;
  hauntingId: string;
  hauntingName: string;
  difficulty: Haunting['difficulty'];
  /** Detection target: naming the right component within this time earns full points. */
  parSeconds: number;
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
  private readonly idleMs: number;

  constructor(private readonly opts: SessionOptions) {
    super();
    this.clock = opts.clock ?? Date.now;
    this.timers = opts.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as never) };
    this.timeScale = opts.timeScale ?? 1;
    this.maxMs = (opts.maxMinutes ?? 45) * 60_000;
    this.idleMs = Math.max(0, opts.idleMinutes ?? 0) * 60_000;
  }

  onEvent(fn: (e: SessionEvent) => void): () => void {
    this.on('event', fn);
    return () => this.off('event', fn);
  }

  private publish(e: SessionEvent): void {
    this.emit('event', e);
  }

  /** What the picker may show. Par time is a target, not a spoiler. */
  hauntings(): { id: string; name: string; difficulty: Haunting['difficulty']; escalationSteps: number; parSeconds: number }[] {
    return this.opts.engine.list().map((h) => ({
      id: h.id,
      name: h.name,
      difficulty: h.difficulty,
      escalationSteps: h.escalationSteps,
      parSeconds: this.opts.engine.get(h.id).scoring.detectParSeconds,
    }));
  }

  active(): SessionView | undefined {
    return this.activeId === undefined ? undefined : this.view(this.activeId);
  }

  /**
   * Starts a session. `owner` is a secret only the starting browser gets back (as a
   * cookie); the HTTP layer uses ownedBy() so other visitors can't see or drive it.
   */
  async start(hauntingId: string, meta: { player?: string; drillId?: string; owner?: string } = {}): Promise<SessionView> {
    if (this.activeId !== undefined) {
      const current = this.sessions.get(this.activeId);
      const startedAt = current?.startedAt ?? this.clock();
      const minutes = Math.max(0, Math.round((this.clock() - startedAt) / 60_000));
      const endsBy = new Date(startedAt + this.maxMs).toISOString().slice(11, 16);
      throw new SessionError(
        409,
        `Someone else is on call right now (their shift started ${minutes} min ago). There is one sandbox, so one player at a time: it frees up when they finish, or by ${endsBy} UTC at the latest.`,
      );
    }
    let haunting: Haunting;
    try {
      haunting = this.opts.engine.get(hauntingId);
    } catch {
      throw new SessionError(404, `unknown haunting "${hauntingId}"`);
    }
    const busy = this.opts.engine.list().find((h) => h.active);
    if (busy !== undefined) throw new SessionError(409, 'a haunting started by an agent is running in the sandbox. Wait for it to be reverted.');
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
        owner: meta.owner,
      };
      this.sessions.set(id, session);
      this.armIdle(session);
      await this.narrate(session, 'page', applied.page.narration, [applied.page.alert]);

      for (const step of haunting.escalation) {
        const ms = (step.afterSeconds * 1000) / this.timeScale;
        session.timers.push(this.timers.setTimeout(() => void this.escalate(session, step.step), ms));
      }
      session.timers.push(this.timers.setTimeout(() => void this.end(id, 'timeout').catch(() => undefined), this.maxMs));
      return this.view(id);
    } catch (err) {
      this.activeId = undefined;
      // The engine already rolled the fault back. The details stay in the server log.
      this.opts.log?.(`could not start ${hauntingId}: ${(err as Error).message}`);
      throw new SessionError(503, 'The sandbox is not ready right now, so the haunting did not start. Try again in a minute.');
    }
  }

  get(id: string): Session {
    const s = this.sessions.get(id);
    if (s === undefined) throw new SessionError(404, 'unknown session');
    return s;
  }

  /** True when `token` is the secret the session was started with. Sessions started without one have no owner. */
  ownedBy(id: string, token: string | undefined): boolean {
    const owner = this.sessions.get(id)?.owner;
    if (owner === undefined || token === undefined) return false;
    const a = Buffer.from(owner);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** The player is still there: push back the idle end. */
  touch(id: string): void {
    const s = this.sessions.get(id);
    if (s?.status === 'active') this.armIdle(s);
  }

  private armIdle(s: Session): void {
    if (this.idleMs === 0) return;
    if (s.idleTimer !== undefined) this.timers.clearTimeout(s.idleTimer);
    s.idleTimer = this.timers.setTimeout(() => void this.end(s.id, 'idle').catch(() => undefined), this.idleMs);
  }

  view(id: string): SessionView {
    const s = this.get(id);
    const now = s.status === 'ended' && s.postmortem ? s.postmortem.endedAt : this.clock();
    return {
      id: s.id,
      hauntingId: s.haunting.id,
      hauntingName: s.haunting.name,
      difficulty: s.haunting.difficulty,
      parSeconds: s.haunting.scoring.detectParSeconds,
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
      this.opts.log?.(`command "${parsed.canonical}" failed: ${(err as Error).message}`);
      return { ok: false, output: `error: ${publicError((err as Error).message)}` };
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
    if (s.idleTimer !== undefined) this.timers.clearTimeout(s.idleTimer);
    if (this.activeId === id) this.activeId = undefined;
    try {
      await this.opts.engine.revert(s.haunting.id);
    } finally {
      const endedAt = this.clock();
      const endText = { player: 'session ended by the player', timeout: 'session ended (time limit)', shutdown: 'session ended (server shutdown)', idle: 'session ended (the player left)' }[because];
      s.timeline.push({ at: endedAt, type: 'end', text: endText });
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
    } catch (err) {
      // The session may have ended between the timer firing and now; anything else is a real problem.
      if (s.status === 'active') this.opts.log?.(`escalation step ${step} of ${s.haunting.id} failed: ${(err as Error).message}`);
    }
  }

  private async narrate(s: Session, kind: 'page' | 'escalation', fallback: string, facts: string[]): Promise<void> {
    const text = await this.opts.narrator.narrate({ kind, fallback, facts });
    s.narration.push({ at: this.clock(), text });
    this.publish({ type: 'narration', sessionId: s.id, text });
  }
}
