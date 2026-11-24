import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CalendarDaySummary } from '../shared/types';

interface ClinicCalendarProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  daySummaries: CalendarDaySummary[];
  compact?: boolean;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toDateKey(year: number, monthZeroBased: number, day: number): string {
  return `${year}-${String(monthZeroBased + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function ClinicCalendar({
  selectedDate,
  onSelectDate,
  daySummaries,
  compact = false,
}: ClinicCalendarProps) {
  const initialDate = useMemo(() => {
    const [y, m] = selectedDate.split('-').map(Number);
    return y && m ? { year: y, month: m - 1 } : { year: new Date().getFullYear(), month: new Date().getMonth() };
  }, [selectedDate]);

  const [viewYear, setViewYear] = useState(initialDate.year);
  const [viewMonth, setViewMonth] = useState(initialDate.month);

  const summaryMap = useMemo(() => {
    const map = new Map<string, CalendarDaySummary>();
    for (const item of daySummaries) {
      map.set(item.date, item);
    }
    return map;
  }, [daySummaries]);

  const todayKey = useMemo(() => {
    const d = new Date();
    return toDateKey(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const cells: Array<{ day: number | null; dateKey?: string }> = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    cells.push({ day: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateKey: toDateKey(viewYear, viewMonth, d) });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-[#16211C]">{monthLabel}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setViewYear(now.getFullYear());
              setViewMonth(now.getMonth());
              onSelectDate(todayKey);
            }}
            className="btn-press px-2.5 py-1 text-xs font-medium text-[#047857] hover:bg-[#EDF4F0] rounded-md transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            onClick={handlePrevMonth}
            className="btn-press p-1.5 text-[#526058] hover:text-[#16211C] hover:bg-[#F7F8F6] rounded-md transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleNextMonth}
            className="btn-press p-1.5 text-[#526058] hover:text-[#16211C] hover:bg-[#F7F8F6] rounded-md transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        key={`${viewYear}-${viewMonth}`}
        className="grid grid-cols-7 gap-1 text-center animate-view-enter"
      >
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="py-1 text-[11px] font-medium text-[#526058]">
            {wd}
          </div>
        ))}

        {cells.map((cell, idx) => {
          if (!cell.day || !cell.dateKey) {
            return <div key={`empty-${idx}`} className={compact ? 'h-9' : 'h-16'} />;
          }

          const summary = summaryMap.get(cell.dateKey);
          const isSelected = cell.dateKey === selectedDate;
          const isToday = cell.dateKey === todayKey;

          return (
            <button
              key={cell.dateKey}
              type="button"
              onClick={() => onSelectDate(cell.dateKey!)}
              aria-label={`${cell.dateKey}${summary ? `, ${summary.total} appointments` : ', no appointments'}`}
              aria-pressed={isSelected}
              className={`btn-press ${
                compact ? 'h-10 p-1 items-center justify-center' : 'h-16 p-1.5 items-start justify-between'
              } flex flex-col rounded-lg border text-left transition-colors ${
                isSelected
                  ? 'bg-[#0C291E] text-white border-[#0C291E]'
                  : isToday
                    ? 'bg-[#EDF4F0] text-[#0C291E] border-[#A7D3BE] hover:bg-[#DCECE3]'
                    : 'bg-white text-[#16211C] border-[#E4E7E2] hover:bg-[#F7F8F6]'
              }`}
            >
              <div className="w-full flex items-center justify-between">
                <span className="text-xs font-mono tabular-nums font-medium">{cell.day}</span>
                {!compact && summary && (
                  <span
                    className={`text-[10px] font-mono tabular-nums ${
                      isSelected ? 'text-emerald-200' : 'text-[#526058]'
                    }`}
                  >
                    {summary.total}
                  </span>
                )}
              </div>

              {summary && (
                <div className="flex items-center gap-1 mt-auto" aria-hidden="true">
                  {(summary.confirmed > 0 || summary.completed > 0) && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isSelected ? 'bg-emerald-300' : 'bg-[#059669]'
                      }`}
                    />
                  )}
                  {summary.scheduled > 0 && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isSelected ? 'bg-amber-300' : 'bg-amber-500'
                      }`}
                    />
                  )}
                  {summary.missed > 0 && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isSelected ? 'bg-red-300' : 'bg-red-600'
                      }`}
                    />
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-1 text-[11px] text-[#526058]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#059669]" aria-hidden="true" />
          Confirmed / Completed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" />
          Unconfirmed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-600" aria-hidden="true" />
          Missed
        </span>
      </div>
    </div>
  );
}
