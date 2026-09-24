import type { ReactNode } from 'react';
import { ScreenHeader } from './ScreenHeader';
import './FormScreen.css';

/** Каркас полноэкранной формы (спека §5.9): шапка с «назад», прокручиваемое
 *  тело, основная кнопка липнет к низу над safe-area. Кнопка живёт внутри
 *  формы (класс .form-screen-actions), а не в отдельном слоте: иначе
 *  type="submit" пришлось бы связывать с формой атрибутом form=. */
export function FormScreen({ title, onBack, actions, children }: {
  title: string;
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="form-screen">
      <ScreenHeader title={title} onBack={onBack} actions={actions} />
      <div className="form-screen-body">{children}</div>
    </div>
  );
}
