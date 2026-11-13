import { useEffect, useMemo, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import { ptBR } from "react-day-picker/locale";
import "react-day-picker/style.css";

type DatePickerFieldProps = {
  id: string;
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
};

export function DatePickerField({
  id,
  value,
  onChange,
  placeholder = "Selecionar data",
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selectedDate = useMemo(() => parseIsoDate(value), [value]);
  const [month, setMonth] = useState<Date>(() => selectedDate ?? new Date(1995, 0, 1));

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const formattedLabel = selectedDate
    ? selectedDate.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : placeholder;

  return (
    <div className="date-picker-field" ref={containerRef}>
      <div className="date-picker-control">
        <button
          id={id}
          type="button"
          className={`date-picker-trigger${selectedDate ? "" : " placeholder"}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => {
            setOpen((current) => {
              const next = !current;
              if (next && selectedDate) {
                setMonth(selectedDate);
              }
              return next;
            });
          }}
        >
          <CalendarIcon />
          <span>{formattedLabel}</span>
        </button>
        {selectedDate ? (
          <button
            type="button"
            className="date-picker-clear"
            aria-label="Limpar data"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="date-picker-popover" role="dialog" aria-label="Calendário">
          <DayPicker
            mode="single"
            locale={ptBR}
            captionLayout="dropdown"
            month={month}
            onMonthChange={setMonth}
            selected={selectedDate}
            startMonth={new Date(1900, 0)}
            endMonth={new Date()}
            onSelect={(day) => {
              if (day) {
                onChange(formatIsoDate(day));
                setOpen(false);
              }
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function parseIsoDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, month, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month ||
    parsed.getDate() !== day
  ) {
    return undefined;
  }
  return parsed;
}

function formatIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 2v4M16 2v4M3 10h18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
