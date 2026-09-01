import { useRef, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react';
import './OtpCodeInput.css';

const CODE_LENGTH = 4;

interface OtpCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * Ввод 4-значного кода отдельными ячейками.
 *
 * inputMode="numeric" поднимает цифровую клавиатуру на мобильных, а
 * autoComplete="one-time-code" даёт автоподстановку кода из почты в Safari
 * и на iOS. Ради этого атрибута ячейки остаются настоящими input, а не
 * одним скрытым полем с нарисованными квадратами.
 */
export function OtpCodeInput({ value, onChange, onComplete, disabled, autoFocus }: OtpCodeInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const emit = (next: string) => {
    onChange(next);
    if (next.length === CODE_LENGTH) onComplete?.(next);
  };

  const focusCell = (index: number) => {
    refs.current[Math.min(Math.max(index, 0), CODE_LENGTH - 1)]?.focus();
  };

  const handleChange = (index: number) => (e: ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '');
    if (!digits) return;

    const chars = value.split('');
    while (chars.length < index) chars.push('');
    chars[index] = digits[digits.length - 1];
    const next = chars.join('').slice(0, CODE_LENGTH);

    emit(next);
    focusCell(index + 1);
  };

  const handleKeyDown = (index: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Backspace') return;
    e.preventDefault();

    // Backspace в пустой ячейке стирает предыдущую и уводит туда фокус —
    // иначе исправить опечатку можно только мышью.
    const target = value[index] ? index : index - 1;
    if (target < 0) return;

    emit(value.slice(0, target));
    focusCell(target);
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!digits) return;

    emit(digits);
    focusCell(digits.length);
  };

  return (
    <div className="otp-code-input">
      {Array.from({ length: CODE_LENGTH }, (_, index) => (
        <input
          key={index}
          ref={(el) => { refs.current[index] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={value[index] ?? ''}
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          onChange={handleChange(index)}
          onKeyDown={handleKeyDown(index)}
          onPaste={handlePaste}
          className="otp-code-input-cell"
        />
      ))}
    </div>
  );
}
