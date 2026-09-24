// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { RemoteParticipantTile } from '@/components/call/RemoteParticipantTile';
import { stubBrowser, participant } from '@/components/__tests__/callHarness';

// Уровень микрофона здесь не проверяется — реальный хук поднимает AudioContext.
vi.mock('@/hooks/useMicLevel', () => ({ useMicLevel: () => 0 }));

beforeAll(stubBrowser);
afterEach(cleanup);

const liveStream = {} as MediaStream;

function renderTile(over: Partial<React.ComponentProps<typeof RemoteParticipantTile>> = {}) {
  return render(
    <RemoteParticipantTile
      participant={participant('u2', { stream: liveStream })}
      displayName="Boris"
      muted={false}
      isSharing={false}
      layout="grid"
      onFocus={vi.fn()}
      videoRefSetter={vi.fn()}
      volume={100}
      isVolumePopoverOpen={false}
      onToggleVolumePopover={vi.fn()}
      onCloseVolumePopover={vi.fn()}
      onVolumeChange={vi.fn()}
      {...over}
    />,
  );
}

describe('RemoteParticipantTile — camera_off (VYC-96)', () => {
  it('по умолчанию DOM прежний: у плитки с потоком нет аватара и is-camera-off', () => {
    const withDefault = renderTile().container.innerHTML;
    cleanup();
    const withFalse = renderTile({ cameraOff: false }).container.innerHTML;
    expect(withFalse).toBe(withDefault);
    expect(document.querySelector('.stage-tile-avatar')).toBeNull();
    expect(document.querySelector('.stage-tile.is-camera-off')).toBeNull();
    expect(document.querySelector('.stage-state-chip')).toBeNull();
  });

  it('grid: cameraOff показывает аватар и чип вместо видео, <video> остаётся (звук)', () => {
    renderTile({ cameraOff: true });
    expect(document.querySelector('.stage-tile.is-camera-off')).toBeTruthy();
    expect(document.querySelector('.stage-tile-avatar')).toBeTruthy();
    expect(document.querySelector('.stage-state-chip')).toBeTruthy();
    expect(document.querySelector('video')).toBeTruthy();
  });

  it('thumbnail: cameraOff показывает аватар и помечает миниатюру', () => {
    renderTile({ cameraOff: true, layout: 'thumbnail' });
    expect(document.querySelector('.stage-thumb.is-camera-off')).toBeTruthy();
    expect(document.querySelector('.stage-thumb-avatar')).toBeTruthy();
  });

  it('thumbnail по умолчанию — без аватара и без is-camera-off', () => {
    renderTile({ layout: 'thumbnail' });
    expect(document.querySelector('.stage-thumb.is-camera-off')).toBeNull();
    expect(document.querySelector('.stage-thumb-avatar')).toBeNull();
  });

  it('демонстрация экрана имеет приоритет: плитка ведёт себя как без cameraOff', () => {
    const sharing = renderTile({ isSharing: true }).container.innerHTML;
    cleanup();
    expect(renderTile({ isSharing: true, cameraOff: true }).container.innerHTML).toBe(sharing);
    cleanup();
    const focusedThumb = renderTile({ isSharing: true, isFocused: true, layout: 'thumbnail' }).container.innerHTML;
    cleanup();
    expect(
      renderTile({ isSharing: true, isFocused: true, layout: 'thumbnail', cameraOff: true }).container.innerHTML,
    ).toBe(focusedThumb);
  });
});
