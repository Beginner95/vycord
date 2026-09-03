// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CallEventRow } from '@/components/CallEventRow';
import type { ChatMessage } from '@/stores/messageStore';

function callMsg(over: Partial<ChatMessage>): ChatMessage {
  return {
    id: '1', channel_id: 'c', user_id: 'u', content: '', kind: 'call',
    call_started_at: '2026-08-25T12:00:00Z', call_ended_at: null,
    created_at: '2026-08-25T12:00:00Z', updated_at: '2026-08-25T12:00:00Z',
    ...over,
  };
}

describe('CallEventRow', () => {
  it('active call: "started" label, no duration', () => {
    render(<CallEventRow msg={callMsg({})} starterName="Вася" />);
    expect(screen.getByText('Вася начал звонок')).toBeTruthy();
  });

  it('ended call: "from X — duration" label', () => {
    const msg = callMsg({
      call_started_at: '2026-08-25T12:00:00Z',
      call_ended_at: '2026-08-25T12:12:00Z',
    });
    render(<CallEventRow msg={msg} starterName="Вася" />);
    expect(screen.getByText('Звонок от Вася — 12 мин')).toBeTruthy();
  });

  it('ended call with one other participant: "with X"', () => {
    const msg = callMsg({
      call_started_at: '2026-08-25T12:00:00Z',
      call_ended_at: '2026-08-25T12:12:00Z',
    });
    render(<CallEventRow msg={msg} starterName="Вася" participantNames={['Петя']} />);
    expect(screen.getByText('Звонок от Вася с участием Петя — 12 мин')).toBeTruthy();
  });

  it('ended call with two other participants: conjunction-joined', () => {
    const msg = callMsg({
      call_started_at: '2026-08-25T12:00:00Z',
      call_ended_at: '2026-08-25T12:12:00Z',
    });
    render(<CallEventRow msg={msg} starterName="Вася" participantNames={['Петя', 'Ира']} />);
    expect(screen.getByText('Звонок от Вася с участием Петя и Ира — 12 мин')).toBeTruthy();
  });

  it('renders no edit/delete/quote affordances', () => {
    render(<CallEventRow msg={callMsg({})} starterName="Вася" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
