import { describe, expect, it } from 'vitest';
import { SessionError } from '../src/session/session.js';
import { signalChecked, signalTargets } from '../src/session/postmortem.js';
import { setup } from './support.js';

const worker = (s: Awaited<ReturnType<typeof setup>>['sandbox']) =>
  [...s.containers.values()].filter((c) => c.service === 'worker').map((c) => c.state);

describe('SessionManager with the-vanishing', () => {
  it('runs a full haunting: page, investigate, diagnose, fix, verify, postmortem', async () => {
    const { sessions, sandbox, now, timers } = await setup();
    const baseline = sandbox.snapshot();

    const view = await sessions.start('the-vanishing', { player: 'sam' });
    expect(view.alert).toMatch(/orders never get confirmed/);
    expect(view.narration).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain('"target"');
    expect(worker(sandbox)).toEqual(['stopped', 'stopped']);

    now.t += 60_000;
    expect((await sessions.command(view.id, 'haunt promql sum(up{job="worker"})')).ok).toBe(true);
    expect((await sessions.command(view.id, 'haunt logs worker')).output).toMatch(/no worker log lines/);

    now.t += 60_000;
    sessions.diagnose(view.id, { component: 'worker', summary: 'The worker is stopped so nothing consumes the orders queue.' });

    now.t += 30_000;
    expect((await sessions.command(view.id, 'haunt restart worker')).output).toBe('restarted 2 worker container(s).');
    sandbox.settle();
    sandbox.setQuery('prometheus', 'sum(up{job="worker"})', 2);
    sandbox.setQuery('prometheus', 'sum(rate(witching_worker_jobs_processed_total[1m]))', 5);
    sandbox.setQuery('prometheus', 'sum(deriv(witching_queue_depth{queue="orders"}[2m]))', -3);
    expect((await sessions.verify(view.id)).pass).toBe(true);

    const pm = await sessions.end(view.id);
    expect(pm.score.total).toBe(100);
    expect(pm.score.detection.seconds).toBe(120);
    expect(pm.signals.find((s) => s.id === 'worker-target-down')?.checked).toBe(true);
    expect(pm.signals.find((s) => s.id === 'queue-depth-rising')?.checked).toBe(false);
    expect(pm.timeline.map((e) => e.type)).toEqual(['page', 'command', 'command', 'diagnosis', 'command', 'verify', 'end']);

    // Ending reverted the haunting and cleared the timers.
    sandbox.settle();
    expect(sandbox.snapshot()).toBe(baseline);
    expect(timers.pending.size).toBe(0);
    expect(sessions.active()).toBeUndefined();
  });

  it('escalates on schedule and narrates each step', async () => {
    const { sessions, sandbox, timers } = await setup();
    const view = await sessions.start('the-vanishing');
    timers.fireUpTo(600_000);
    await new Promise((r) => setTimeout(r, 0));
    const after = sessions.view(view.id);
    expect(after.escalationStep).toBe(2);
    expect(after.narration).toHaveLength(3);
    expect([...sandbox.toxics.get('storefront_queue')!.values()]).toHaveLength(1);
    await sessions.end(view.id);
  });

  it('times out, reverts and scores the run', async () => {
    const { sessions, sandbox, timers } = await setup();
    const baseline = sandbox.snapshot();
    const view = await sessions.start('the-vanishing');
    timers.fireUpTo(45 * 60_000);
    await new Promise((r) => setTimeout(r, 0));
    const pm = sessions.postmortem(view.id);
    expect(pm.endedBecause).toBe('timeout');
    sandbox.settle();
    expect(sandbox.snapshot()).toBe(baseline);
  });

  it('penalizes harmful commands', async () => {
    const { sessions, control } = await setup();
    const view = await sessions.start('the-vanishing');
    await sessions.command(view.id, 'haunt purge-queue orders');
    expect(control.purged).toBe(1);
    const pm = await sessions.end(view.id);
    expect(pm.score.penalties.items.map((i) => i.command)).toEqual(['haunt purge-queue orders']);
  });

  it('allows one session at a time and rejects unknown hauntings', async () => {
    const { sessions } = await setup();
    await expect(sessions.start('nope')).rejects.toThrow(SessionError);
    const view = await sessions.start('the-vanishing');
    await expect(sessions.start('slow-whisper')).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already on call.*ends on its own by \d\d:\d\d UTC/) });
    await sessions.end(view.id);
    const next = await sessions.start('slow-whisper');
    await sessions.end(next.id);
  });

  it('explains a sandbox failure at start and leaves no session running', async () => {
    const { sessions, sandbox } = await setup();
    const baseline = sandbox.snapshot();
    sandbox.failNext('docker.setState');
    await expect(sessions.start('the-vanishing')).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/sandbox running/) });
    expect(sessions.active()).toBeUndefined();
    sandbox.settle();
    expect(sandbox.snapshot()).toBe(baseline);
  });

  it('gives three hints, from symptom to component', async () => {
    const { sessions } = await setup();
    const view = await sessions.start('possessed-config');
    const hints = [await sessions.hint(view.id), await sessions.hint(view.id), await sessions.hint(view.id)];
    expect(hints[2]).toMatch(/payments/);
    await expect(sessions.hint(view.id)).rejects.toMatchObject({ status: 409 });
    await sessions.end(view.id);
  });

  it('applies the player fix for possessed-config through the config admin', async () => {
    const { sessions, sandbox } = await setup();
    const view = await sessions.start('possessed-config');
    expect(sandbox.config.get('payments')!.get('db.pool_max')).toBe(1);
    await sessions.command(view.id, 'haunt config set payments db.pool_max 10');
    expect(sandbox.config.get('payments')!.get('db.pool_max')).toBe(10);
    await sessions.end(view.id);
    expect(sandbox.config.get('payments')!.get('db.pool_max')).toBe(10);
  });

  it('rejects bad terminal input without recording it', async () => {
    const { sessions } = await setup();
    const view = await sessions.start('the-vanishing');
    expect(await sessions.command(view.id, 'rm -rf /')).toMatchObject({ ok: false });
    const pm = await sessions.end(view.id);
    expect(pm.timeline.filter((e) => e.type === 'command')).toEqual([]);
  });
});

describe('postmortem signal tracking', () => {
  it('extracts metric names and service labels', () => {
    expect(signalTargets('sum(rate(witching_worker_jobs_processed_total[2m]))')).toEqual({ metrics: ['witching_worker_jobs_processed_total'], services: [] });
    expect(signalTargets('sum(count_over_time({service="worker"}[2m]))').services).toEqual(['worker']);
  });

  it('counts a log signal as checked when the player read that service', () => {
    const sig = { id: 'x', kind: 'cause' as const, description: '', source: 'loki' as const, query: 'sum(count_over_time({service="worker"}[2m]))', expect: { op: '==' as const, value: 0 } };
    expect(signalChecked(sig, ['haunt logs worker 5'])).toBe(true);
    expect(signalChecked(sig, ['haunt logs cart 5'])).toBe(false);
  });
});
