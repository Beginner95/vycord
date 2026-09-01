// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { OtpCodeInput } from '@/components/OtpCodeInput';

// Без явного cleanup DOM-узлы от предыдущих it() остаются в document (globals
// не включены в vite.config.ts, поэтому автоматический cleanup из
// @testing-library/react не срабатывает) — getAllByRole тогда возвращает
// ячейки сразу нескольких рендеров, и fireEvent попадает не в тот компонент.
// Тот же приём уже используется в MediaLightbox.test.tsx.
afterEach(cleanup);

function renderInput(value = '', onChange = vi.fn(), onComplete = vi.fn()) {
  render(<OtpCodeInput value={value} onChange={onChange} onComplete={onComplete} />);
  return { onChange, onComplete, cells: screen.getAllByRole('textbox') as HTMLInputElement[] };
}

describe('OtpCodeInput', () => {
  it('рисует ровно четыре ячейки', () => {
    const { cells } = renderInput();
    expect(cells).toHaveLength(4);
  });

  it('пропускает только цифры', () => {
    const { cells, onChange } = renderInput();

    fireEvent.change(cells[0], { target: { value: 'a' } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(cells[0], { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith('7');
  });

  it('вставка четырёх цифр из буфера заполняет код целиком', () => {
    const { cells, onChange, onComplete } = renderInput();

    fireEvent.paste(cells[0], { clipboardData: { getData: () => '0429' } });

    expect(onChange).toHaveBeenCalledWith('0429');
    expect(onComplete).toHaveBeenCalledWith('0429');
  });

  // Из письма код часто копируют вместе с текстом вокруг.
  it('вытаскивает цифры из вставленного текста', () => {
    const { cells, onChange } = renderInput();

    fireEvent.paste(cells[0], { clipboardData: { getData: () => 'ваш код: 0429' } });

    expect(onChange).toHaveBeenCalledWith('0429');
  });

  it('backspace в пустой ячейке стирает предыдущую', () => {
    const { cells, onChange } = renderInput('12');

    fireEvent.keyDown(cells[2], { key: 'Backspace' });

    expect(onChange).toHaveBeenCalledWith('1');
  });

  it('onComplete не зовётся на неполном коде', () => {
    const { cells, onComplete } = renderInput('1');

    fireEvent.change(cells[1], { target: { value: '2' } });

    expect(onComplete).not.toHaveBeenCalled();
  });
});
