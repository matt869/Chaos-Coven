import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrillCard, Daemonwatch } from '../src/shared/Daemonwatch';
import { parsePlayers, teamAverage } from '../src/shared/helpers';
import { htmlKit } from '../src/shared/kit';
import { drillsClient, type Drill } from '../src/shared/types';

// The Crew SDK is provided by the Crew host at runtime; tests stand in for it.
const api = { get: vi.fn(), post: vi.fn(), del: vi.fn() };
vi.mock('@kirocrew/app-sdk', () => ({ useAppApi: () => api, useNotify: () => () => undefined }));
vi.mock('@kirocrew/app-sdk/ui', () => {
  const pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Card: pass,
    CardTitle: ({ children, id }: { children?: ReactNode; id?: string }) => <h2 id={id}>{children}</h2>,
    PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
    EmptyState: ({ title }: { title: string }) => <p>{title}</p>,
    Btn: ({ children, onClick, ...rest }: { children?: ReactNode; onClick?: () => void; 'aria-label'?: string }) => (
      <button onClick={onClick} aria-label={rest['aria-label']}>
        {children}
      </button>
    ),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const drill: Drill = {
  id: '00000000-0000-4000-8000-000000000001',
  hauntingId: 'the-vanishing',
  team: 'Payments squad',
  players: ['sam', 'ana'],
  scheduledFor: '2026-12-01T10:00:00Z',
  status: 'scheduled',
  results: [{ player: 'sam', sessionId: 's1', score: 90, maxScore: 100, detectionSeconds: 95, rootCauseCorrect: true, fixVerified: true, harmfulActions: 0, endedAt: '' }],
};

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

describe('drillsClient', () => {
  it('maps calls onto the API prefix', async () => {
    const request = vi.fn().mockResolvedValue([]);
    const c = drillsClient(request, '/apps/daemonwatch/api');
    await c.list();
    await c.start('d1', 'sam');
    expect(request.mock.calls).toEqual([
      ['GET', '/apps/daemonwatch/api/drills'],
      ['POST', '/apps/daemonwatch/api/drills/d1/start', { player: 'sam' }],
    ]);
  });
});

describe('DrillCard', () => {
  it('shows results and starts a player', () => {
    const onStart = vi.fn();
    render(<DrillCard kit={htmlKit} drill={drill} hauntingName="The Vanishing" onStart={onStart} onCancel={() => undefined} />);
    expect(screen.getByText('90/100')).toBeTruthy();
    expect(screen.getByText(/team average 90\/100/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start drill for ana' }));
    expect(onStart).toHaveBeenCalledWith('ana');
  });

  it('hides actions on cancelled drills', () => {
    render(<DrillCard kit={htmlKit} drill={{ ...drill, status: 'cancelled' }} hauntingName="The Vanishing" onStart={() => undefined} onCancel={() => undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Daemonwatch page', () => {
  it('loads drills and starts a player through the client', async () => {
    const client = {
      hauntings: vi.fn().mockResolvedValue([{ id: 'the-vanishing', name: 'The Vanishing', difficulty: 'easy' }]),
      list: vi.fn().mockResolvedValue([drill]),
      create: vi.fn(),
      cancel: vi.fn(),
      start: vi.fn().mockResolvedValue({}),
    };
    const onStarted = vi.fn();
    render(<Daemonwatch kit={htmlKit} client={client} notify={() => undefined} onStarted={onStarted} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start drill for ana' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('ana'));
    expect(client.start).toHaveBeenCalledWith(drill.id, 'ana');
  });
});

describe('Crew page', () => {
  it('uses the Crew app API through the backend prefix', async () => {
    api.get.mockImplementation(async (path: string) => (path.endsWith('/hauntings') ? [] : [drill]));
    const { default: DaemonwatchPage, CREW_API_BASE } = await import('../src/crew/index');
    render(<DaemonwatchPage />);
    expect(await screen.findByRole('heading', { name: /Payments squad/ })).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith(`${CREW_API_BASE}/drills`);
    expect(CREW_API_BASE).toBe('/apps/daemonwatch/api');
  });
});
