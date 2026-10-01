import { describe, it, expect } from 'vitest';
import { applyVoiceListened, isVoiceMessage } from '@/voice/listened';
import type { Message } from '@/types';

const msg = (attUser: string, listened = false) => ({
  id: 'm', attachments: [{ id: 'v', user_id: attUser, is_voice: true, listened }],
}) as unknown as Message;

describe('applyVoiceListened', () => {
  it('я слушал (другое устройство) → listened', () => {
    expect(applyVoiceListened([msg('author')], { attachment_id: 'v', user_id: 'me' }, 'me')[0].attachments![0].listened).toBe(true);
  });
  it('я автор, слушал другой → listened', () => {
    expect(applyVoiceListened([msg('me')], { attachment_id: 'v', user_id: 'bob' }, 'me')[0].attachments![0].listened).toBe(true);
  });
  it('слушал третий, я не автор → без изменений, та же ссылка', () => {
    const list = [msg('author')];
    expect(applyVoiceListened(list, { attachment_id: 'v', user_id: 'bob' }, 'me')).toBe(list);
  });
  it('неизвестное вложение → та же ссылка', () => {
    const list = [msg('me')];
    expect(applyVoiceListened(list, { attachment_id: 'zzz', user_id: 'bob' }, 'me')).toBe(list);
  });
  it('isVoiceMessage', () => {
    expect(isVoiceMessage(msg('a'))).toBe(true);
    expect(isVoiceMessage({ attachments: [] })).toBe(false);
    expect(isVoiceMessage({})).toBe(false);
  });
});
