import './DayDivider.css';

interface DayDividerProps {
  label: string;
}

export function DayDivider({ label }: DayDividerProps) {
  return (
    <div className="date-divider" role="separator" aria-label={label}>
      <span className="date-divider__line" />
      <span className="date-divider__label">{label}</span>
      <span className="date-divider__line" />
    </div>
  );
}