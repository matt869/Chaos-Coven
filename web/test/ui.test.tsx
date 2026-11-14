import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Picker } from '../src/App';
import { formatDuration, type Postmortem as PM } from '../src/api';
import { Postmortem } from '../src/Postmortem';

afterEach(cleanup);

describe('Picker', () => {
  it('starts the chosen haunting with the player name', () => {
    const onStart = vi.fn();
    render(<Picker hauntings={[{ id: 'the-vanishing', name: 'The Vanishing', difficulty: 'easy', escalationSteps: 2 }]} onStart={onStart} />);
    const start = screen.getByRole('button', { name: /start the night shift/i });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/the vanishing/i));
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: ' sam ' } });
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledWith('the-vanishing', 'sam');
  });
});

const pm: PM = {
  sessionId: 's1',
  hauntingName: 'The Vanishing',
  startedAt: 0,
  endedAt: 300_000,
  endedBecause: 'player',
  score: {
    total: 60,
    max: 100,
    detection: { points: 30, max: 30, seconds: 120, parSeconds: 300 },
    rootCause: { points: 30, max: 30, componentCorrect: true, keywordGroupsMatched: 2, keywordGroupsRequired: 2 },
    fix: { points: 0, max: 40, verified: false },
    penalties: { points: 0, items: [] },
  },
  whatHappened: 'The worker was stopped.',
  theFix: 'Start the worker.',
  signals: [{ id: 'a', kind: 'cause', description: 'Worker down', checked: false }],
  hintsUsed: 1,
  timeline: [{ at: 0, type: 'page', text: 'paged' }],
  closing: 'The haunting is over.',
};

describe('Postmortem', () => {
  it('shows the score, missed evidence and an accessible label', () => {
    render(<Postmortem pm={pm} onAgain={() => undefined} />);
    expect(screen.getByLabelText('Score 60 out of 100')).toBeTruthy();
    expect(screen.getByText(/never verified/i)).toBeTruthy();
    expect(screen.getByText('(missed)')).toBeTruthy();
  });
});

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(125)).toBe('2:05');
  });
});
