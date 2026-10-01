import type { ChatMessage } from '@/stores/messageStore';
import type { Attachment, Message } from '@/types';
import { waveformToBase64 } from './waveform';
import { voiceFileName, type VoiceRecording } from './voiceRecorder';

export interface VoiceStore {
  add(m: ChatMessage): void;
  update(id: string, patch: Partial<ChatMessage>): void;
  replace(id: string, m: ChatMessage): void;
  has(id: string): boolean;
}

export interface SendVoiceDeps {
  upload(channelId: string, file: File, voice: { durationMs: number; waveform: number[] }): Promise<Attachment>;
  createMessage(channelId: string, attachmentId: string): Promise<Message>;
  deleteAttachment(id: string): Promise<unknown>;
  store: VoiceStore;
  createObjectURL(b: Blob): string;
  revokeObjectURL(url: string): void;
  onOrphanFailure(err: unknown): void;
  /** Серверный код ошибки (ApiError.code) — инъекция, чтобы модуль не тянул сервис API. */
  errorCode?(err: unknown): string | undefined;
  /** Показан ли сейчас канал получателя: иначе оптимистичная строка попала бы в чужую ленту. */
  isCurrentChannel?(channelId: string): boolean;
}

/** Синтетическое вложение: пузырь играет из локального blob, пока файл грузится. */
export function buildPendingVoiceMessage(a: { tempId: string; channelId: string; userId: string; now: string; recording: VoiceRecording; objectUrl: string }): ChatMessage {
  const { recording: r } = a;
  const att: Attachment = {
    id: `${a.tempId}-voice`, channel_id: a.channelId, user_id: a.userId, kind: 'audio',
    file_name: voiceFileName(r.mimeType), content_type: r.mimeType, size_bytes: r.blob.size,
    url: a.objectUrl, created_at: a.now,
    is_voice: true, duration_ms: r.durationMs, waveform: waveformToBase64(r.waveform), listened: false,
  };
  return {
    id: a.tempId, channel_id: a.channelId, user_id: a.userId, kind: 'user', content: '',
    created_at: a.now, updated_at: a.now, deliveryState: 'sending', attachments: [att],
    pendingVoice: { blob: r.blob, objectUrl: a.objectUrl, mimeType: r.mimeType, durationMs: r.durationMs, waveform: r.waveform },
  };
}

// Строки, по которым прямо сейчас идёт отправка: защита от двойного retry.
const inFlight = new Set<string>();

async function deliver(deps: SendVoiceDeps, msg: ChatMessage): Promise<void> {
  const pv = msg.pendingVoice!;
  const channelId = msg.channel_id;
  if (inFlight.has(msg.id)) return;
  inFlight.add(msg.id);
  let attachment = pv.attachment;
  try {
    if (!attachment) {
      const file = new File([pv.blob], voiceFileName(pv.mimeType), { type: pv.mimeType });
      attachment = await deps.upload(channelId, file, { durationMs: pv.durationMs, waveform: pv.waveform });
      deps.store.update(msg.id, { pendingVoice: { ...pv, attachment } });
    }
    const saved = await deps.createMessage(channelId, attachment.id);
    deps.store.replace(msg.id, saved);
    deps.revokeObjectURL(pv.objectUrl);
  } catch (err) {
    if (deps.store.has(msg.id)) deps.store.update(msg.id, { deliveryState: 'failed', deliveryErrorCode: deps.errorCode?.(err) });
    else {
      // Строки нет — discard уже некому сделать: освобождаем URL и убираем сироту сами.
      deps.revokeObjectURL(pv.objectUrl);
      if (attachment) void deps.deleteAttachment(attachment.id).catch(() => {});
      deps.onOrphanFailure(err);
    }
  } finally {
    inFlight.delete(msg.id);
  }
}

export async function sendVoice(deps: SendVoiceDeps, a: { tempId: string; channelId: string; userId: string; now: string; recording: VoiceRecording }): Promise<void> {
  const objectUrl = deps.createObjectURL(a.recording.blob);
  const msg = buildPendingVoiceMessage({ ...a, objectUrl });
  // Канал могли сменить между решением «отправить» и onstop: тогда строки нет,
  // а доставка идёт в исходный канал (успех/сирота обрабатывает deliver).
  if (deps.isCurrentChannel?.(a.channelId) !== false) deps.store.add(msg);
  await deliver(deps, msg);
}

export async function retryVoice(deps: SendVoiceDeps, msg: ChatMessage): Promise<void> {
  if (!msg.pendingVoice || inFlight.has(msg.id)) return;
  deps.store.update(msg.id, { deliveryState: 'sending', deliveryErrorCode: undefined });
  // attachment мог записаться в store после того, как msg был прочитан вызывающим.
  await deliver(deps, msg);
}

export function discardVoice(deps: Pick<SendVoiceDeps, 'deleteAttachment' | 'revokeObjectURL'>, msg: ChatMessage): void {
  const pv = msg.pendingVoice;
  if (!pv) return;
  deps.revokeObjectURL(pv.objectUrl);
  // Уборщик подберёт сироту и сам; удаляем сразу, чтобы не ждать его прохода.
  if (pv.attachment) void deps.deleteAttachment(pv.attachment.id).catch(() => {});
}
