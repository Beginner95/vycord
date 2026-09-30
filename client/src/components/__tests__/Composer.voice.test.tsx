// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Composer } from '@/components/Composer';

vi.mock('@/services/api', () => ({ apiService: {} }));
const recorder = vi.hoisted(() => ({
  handle: { level: () => 0.5, stop: async () => ({ blob: new Blob(['x']), mimeType: 'audio/webm', durationMs: 2000, waveform: [] }), discard: () => {} },
}));
vi.mock('@/voice/voiceRecorder', async (orig) => ({
  ...(await orig<typeof import('@/voice/voiceRecorder')>()),
  startVoiceRecorder: vi.fn(async () => recorder.handle),
}));

afterEach(cleanup);

const MIC = 'Записать голосовое сообщение';
const SEND = 'Отправить';
const channel = { id: 'c1', name: 'general', server_id: 's1' };
const mount = (over: Record<string, unknown> = {}) => {
  const utils = render(
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
      <Composer channel={channel} members={[]} canMentionEveryone={false} onSend={vi.fn()}
        serverStickers={[]} onSendSticker={vi.fn(async () => true)} onSendVoice={vi.fn()} {...over} />
    </MemoryRouter>,
  );
  return { ...utils, field: utils.container.querySelector('.composer-input') as HTMLTextAreaElement };
};
const mic = () => screen.queryByRole('button', { name: MIC });
const send = () => screen.queryByRole('button', { name: SEND });

describe('Composer voice button', () => {
  it('desktop: пустое поле — микрофон вместо «Отправить», текст возвращает «Отправить»', () => {
    const { field } = mount();
    expect(mic()).not.toBeNull();
    expect(send()).toBeNull();
    fireEvent.change(field, { target: { value: 'hi' } });
    expect(send()).not.toBeNull();
    expect(mic()).toBeNull();
  });

  it('textOnly — микрофона нет никогда', () => {
    const { field } = mount({ textOnly: true });
    expect(mic()).toBeNull();
    fireEvent.change(field, { target: { value: 'hi' } });
    expect(mic()).toBeNull();
  });

  it('без onSendVoice — микрофона нет', () => {
    mount({ onSendVoice: undefined });
    expect(mic()).toBeNull();
    expect(send()).not.toBeNull();
  });

  it('mobile, пустое поле — микрофон на месте «Отправить»', () => {
    const { container } = mount({ variant: 'mobile' });
    const row = [...container.querySelectorAll('.composer-field > *')];
    expect(send()).toBeNull();
    expect(row.indexOf(mic() as Element)).toBe(4); // поле, Aa, эмодзи, скрепка, микрофон
  });

  it('Enter на микрофоне — закреплённая запись: поле скрыто, фокус на «Удалить», «Удалить» возвращает поле', async () => {
    const { field } = mount();
    await act(async () => { fireEvent.keyDown(mic()!, { key: 'Enter' }); });
    expect(field.hidden).toBe(true);
    const del = screen.getByRole('button', { name: 'Удалить запись' });
    expect(document.activeElement).toBe(del);
    expect(mic()).toBeNull();
    fireEvent.click(del);
    expect(field.hidden).toBe(false);
    expect(mic()).not.toBeNull();
  });
});
