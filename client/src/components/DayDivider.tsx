import './DayDivider.css';

interface DayDividerProps {
  label: string;
}

export function DayDivider({ label }: DayDividerProps) {
  return (
    <div className="date-divider" role="separator" aria-label={label}>
      <span className="date-divider-line" />
      <span className="date-divider-label">{label}</span>
      <span className="date-divider-line" />
    </div>
  );
}
