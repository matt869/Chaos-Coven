import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrillCard, parsePlayers, teamAverage, type Drill } from '../src/App';

afterEach(cleanup);

describe('helpers', () => {
  it('parses player lists', () => {
    expect(parsePlayers('sam, ana\nsam\n  lee ')).toEqual(['sam', 'ana', 'lee']);
  });
  it('averages scores', () => {
    expect(teamAverage([])).toBeNull();
    const r = { sessionId: 's', maxScore: 100, detectionSeconds: 1, rootCauseCorrect: true, fixVerified: true, harmfulActions: 0, endedAt: '' };
    expect(teamAverage([{ ...r, player: 'a', score: 80 }, { ...r, player: 'b', score: 61 }])).toBe(71);
  });
});

describe('DrillCard', () => {
  const drill: Drill = {
    id: 'd1',
    hauntingId: 'the-vanishing',
    team: 'Payments squad',
    players: ['sam', 'ana'],
    scheduledFor: '2026-12-01T10:00:00Z',
    status: 'scheduled',
    results: [{ player: 'sam', sessionId: 's1', score: 90, maxScore: 100, detectionSeconds: 95, rootCauseCorrect: true, fixVerified: true, harmfulActions: 0, endedAt: '' }],
  };

  it('shows results and starts a player', () => {
    const onStart = vi.fn();
    render(<DrillCard drill={drill} hauntingName="The Vanishing" onStart={onStart} onCancel={() => undefined} />);
    expect(screen.getByText('90/100')).toBeTruthy();
    expect(screen.getByText(/team average 90\/100/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start drill for ana' }));
    expect(onStart).toHaveBeenCalledWith('ana');
  });

  it('hides actions on cancelled drills', () => {
    render(<DrillCard drill={{ ...drill, status: 'cancelled' }} hauntingName="The Vanishing" onStart={() => undefined} onCancel={() => undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
