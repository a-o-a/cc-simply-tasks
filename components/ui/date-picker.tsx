"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────── 공통 유틸 ───────────────────────────────

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function parseYmd(v: string): { y: number; m: number; d: number } | null {
  const match = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function isValidYmd(v: string): boolean {
  const parsed = parseYmd(v);
  if (!parsed) return false;
  const dt = new Date(parsed.y, parsed.m - 1, parsed.d);
  return (
    dt.getFullYear() === parsed.y &&
    dt.getMonth() === parsed.m - 1 &&
    dt.getDate() === parsed.d
  );
}

function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function todayYmd() {
  const t = new Date();
  return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

function buildGrid(year: number, month: number): (number | null)[][] {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

// ─────────────────────────── 공통 달력 그리드 ───────────────────────────

function CalendarGrid({
  viewYear,
  viewMonth,
  selectedYmd,
  onPrev,
  onNext,
  onSelect,
}: {
  viewYear: number;
  viewMonth: number;
  selectedYmd: string;
  onPrev: () => void;
  onNext: () => void;
  onSelect: (day: number) => void;
}) {
  const grid = buildGrid(viewYear, viewMonth);
  const today = todayYmd();

  return (
    <>
      {/* 헤더 */}
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={onPrev} className="rounded p-1 hover:bg-accent">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium">
          {viewYear}년 {String(viewMonth).padStart(2, "0")}월
        </span>
        <button type="button" onClick={onNext} className="rounded p-1 hover:bg-accent">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* 요일 */}
      <div className="mb-1 grid grid-cols-7 text-center">
        {WEEKDAYS.map((w, i) => (
          <span
            key={w}
            className={cn(
              "text-[11px] font-medium text-muted-foreground",
              i === 0 && "text-red-500 dark:text-red-400",
              i === 6 && "text-blue-500 dark:text-blue-400",
            )}
          >
            {w}
          </span>
        ))}
      </div>

      {/* 날짜 */}
      <div className="space-y-0.5">
        {grid.map((row, ri) => (
          <div key={ri} className="grid grid-cols-7 text-center">
            {row.map((day, ci) => {
              if (!day) return <span key={ci} />;
              const cellYmd = ymd(viewYear, viewMonth, day);
              const isSelected = cellYmd === selectedYmd;
              const isToday = cellYmd === today;
              return (
                <button
                  key={ci}
                  type="button"
                  onClick={() => onSelect(day)}
                  className={cn(
                    "rounded py-1 text-xs transition-colors hover:bg-accent",
                    isSelected && "bg-primary text-primary-foreground hover:bg-primary/90",
                    isToday && !isSelected && "font-bold underline underline-offset-2",
                    !isSelected && ci === 0 && "text-red-500 dark:text-red-400",
                    !isSelected && ci === 6 && "text-blue-500 dark:text-blue-400",
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

// ─────────────────────── 공통 트리거 래퍼 스타일 ───────────────────────

const popoverContentClass = cn(
  "z-50 w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md",
  "data-[state=open]:animate-in data-[state=closed]:animate-out",
  "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
  "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
);

// ════════════════════════════ DatePicker ════════════════════════════

/**
 * 날짜 선택기. value: "yyyy-MM-dd" 또는 ""
 */
export interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  id?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "날짜 선택",
  disabled = false,
  clearable = true,
  className,
  id,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const today = new Date();
  const parsed = parseYmd(value);
  const [draftInput, setDraftInput] = React.useState(value.slice(0, 10));
  const [inputError, setInputError] = React.useState<string | null>(null);

  const [viewYear, setViewYear] = React.useState(parsed?.y ?? today.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(parsed?.m ?? today.getMonth() + 1);

  React.useEffect(() => {
    if (!open) return;
    const p = parseYmd(value);
    setViewYear(p?.y ?? today.getFullYear());
    setViewMonth(p?.m ?? today.getMonth() + 1);
    setDraftInput(value.slice(0, 10));
    setInputError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      setDraftInput(value.slice(0, 10));
      setInputError(null);
    }
  }, [open, value]);

  function prevMonth() {
    if (viewMonth === 1) { setViewYear((y) => y - 1); setViewMonth(12); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 12) { setViewYear((y) => y + 1); setViewMonth(1); }
    else setViewMonth((m) => m + 1);
  }

  const displayLabel = parsed
    ? `${parsed.y}년 ${String(parsed.m).padStart(2, "0")}월 ${String(parsed.d).padStart(2, "0")}일`
    : "";

  const previewYmd = open && isValidYmd(draftInput.trim())
    ? draftInput.trim().slice(0, 10)
    : value.slice(0, 10);

  function applyDraftInput() {
    const trimmed = draftInput.trim();
    if (!trimmed) {
      onChange("");
      setInputError(null);
      setOpen(false);
      return;
    }
    if (!isValidYmd(trimmed)) {
      setInputError("yyyy-mm-dd 형식으로 올바른 날짜를 입력하세요");
      return;
    }
    const next = trimmed.slice(0, 10);
    const nextParsed = parseYmd(next);
    if (nextParsed) {
      setViewYear(nextParsed.y);
      setViewMonth(nextParsed.m);
    }
    onChange(next);
    setInputError(null);
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={disabled ? undefined : setOpen}>
      <Popover.Trigger asChild>
        <div
          id={id}
          role="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
          className={cn(
            "flex h-9 w-full cursor-pointer items-center rounded-md border border-input bg-background px-3 text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            disabled && "cursor-not-allowed opacity-50",
            className,
          )}
        >
          <span className={cn("flex-1 truncate", !value && "text-muted-foreground")}>
            {displayLabel || placeholder}
          </span>
          {clearable && value && !disabled && (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
              className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <CalendarDays className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className={popoverContentClass}>
          <CalendarGrid
            viewYear={viewYear}
            viewMonth={viewMonth}
            selectedYmd={previewYmd}
            onPrev={prevMonth}
            onNext={nextMonth}
            onSelect={(day) => {
              onChange(ymd(viewYear, viewMonth, day));
              setOpen(false);
            }}
          />
          <div className="mt-3 border-t pt-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                placeholder="yyyy-mm-dd"
                value={draftInput}
                onChange={(e) => {
                  const next = e.target.value;
                  setDraftInput(next);
                  const trimmed = next.trim();
                  if (isValidYmd(trimmed)) {
                    const parsedDraft = parseYmd(trimmed);
                    if (parsedDraft) {
                      setViewYear(parsedDraft.y);
                      setViewMonth(parsedDraft.m);
                    }
                  }
                  if (inputError) setInputError(null);
                }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyDraftInput();
                  }
                }}
                className={cn(
                  "flex-1 rounded border border-input bg-background px-2 py-1 text-sm",
                  "focus:outline-none focus:ring-1 focus:ring-ring",
                  inputError && "border-destructive focus:ring-destructive",
                )}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  applyDraftInput();
                }}
                className="rounded border border-input px-2 py-1 text-xs font-medium hover:bg-accent"
              >
                적용
              </button>
            </div>
            <p className={cn("mt-1.5 text-[11px]", inputError ? "text-destructive" : "text-muted-foreground")}>
              {inputError ?? "달력에서 고르거나 날짜를 직접 입력할 수 있습니다"}
            </p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ════════════════════════════ DateTimePicker ════════════════════════════

/**
 * 날짜+시간 선택기. value: "yyyy-MM-ddTHH:mm" 또는 ""
 * 팝업 안에 달력 그리드 + 시간 입력이 함께 표시됨.
 */
export interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  id?: string;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = "날짜/시간 선택",
  disabled = false,
  clearable = true,
  className,
  id,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const today = new Date();

  // value 파싱: "yyyy-MM-ddTHH:mm"
  const datePart = value.slice(0, 10);   // "yyyy-MM-dd" or ""
  const timePart = value.slice(11, 16);  // "HH:mm" or ""
  const parsed = parseYmd(datePart);

  const [viewYear, setViewYear] = React.useState(parsed?.y ?? today.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(parsed?.m ?? today.getMonth() + 1);
  const [draftDate, setDraftDate] = React.useState(datePart);
  const [draftTime, setDraftTime] = React.useState(timePart || "09:00");
  const [dateError, setDateError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const p = parseYmd(datePart);
    setViewYear(p?.y ?? today.getFullYear());
    setViewMonth(p?.m ?? today.getMonth() + 1);
    setDraftDate(datePart);
    setDraftTime(timePart || "09:00");
    setDateError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      setDraftDate(datePart);
      setDraftTime(timePart || "09:00");
      setDateError(null);
    }
  }, [open, datePart, timePart]);

  function prevMonth() {
    if (viewMonth === 1) { setViewYear((y) => y - 1); setViewMonth(12); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 12) { setViewYear((y) => y + 1); setViewMonth(1); }
    else setViewMonth((m) => m + 1);
  }

  function handleSelectDay(day: number) {
    const d = ymd(viewYear, viewMonth, day);
    setDraftDate(d);
    onChange(`${d}T${draftTime}`);
    setOpen(false);
  }

  function handleTimeChange(t: string) {
    setDraftTime(t);
    const nextDate = isValidYmd(draftDate.trim()) ? draftDate.trim().slice(0, 10) : datePart;
    if (nextDate) onChange(`${nextDate}T${t}`);
  }

  function applyDraftDate() {
    const trimmed = draftDate.trim();
    if (!trimmed) {
      setDateError("yyyy-mm-dd 형식으로 올바른 날짜를 입력하세요");
      return;
    }
    if (!isValidYmd(trimmed)) {
      setDateError("yyyy-mm-dd 형식으로 올바른 날짜를 입력하세요");
      return;
    }
    const next = trimmed.slice(0, 10);
    const nextParsed = parseYmd(next);
    if (nextParsed) {
      setViewYear(nextParsed.y);
      setViewMonth(nextParsed.m);
    }
    onChange(`${next}T${draftTime}`);
    setDateError(null);
  }

  const displayLabel = parsed && timePart
    ? `${parsed.y}년 ${String(parsed.m).padStart(2, "0")}월 ${String(parsed.d).padStart(2, "0")}일 ${timePart}`
    : parsed
      ? `${parsed.y}년 ${String(parsed.m).padStart(2, "0")}월 ${String(parsed.d).padStart(2, "0")}일`
      : "";

  const previewDatePart = open && isValidYmd(draftDate.trim())
    ? draftDate.trim().slice(0, 10)
    : datePart;

  return (
    <Popover.Root open={open} onOpenChange={disabled ? undefined : setOpen}>
      <Popover.Trigger asChild>
        <div
          id={id}
          role="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
          className={cn(
            "flex h-9 w-full cursor-pointer items-center rounded-md border border-input bg-background px-3 text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            disabled && "cursor-not-allowed opacity-50",
            className,
          )}
        >
          <span className={cn("flex-1 truncate", !value && "text-muted-foreground")}>
            {displayLabel || placeholder}
          </span>
          {clearable && value && !disabled && (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
              className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <CalendarDays className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className={popoverContentClass}>
          <CalendarGrid
            viewYear={viewYear}
            viewMonth={viewMonth}
            selectedYmd={previewDatePart}
            onPrev={prevMonth}
            onNext={nextMonth}
            onSelect={handleSelectDay}
          />

          {/* 시간 입력 */}
          <div className="mt-2 border-t pt-2">
            <div className="mb-2 flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                placeholder="yyyy-mm-dd"
                value={draftDate}
                onChange={(e) => {
                  const next = e.target.value;
                  setDraftDate(next);
                  const trimmed = next.trim();
                  if (isValidYmd(trimmed)) {
                    const parsedDraft = parseYmd(trimmed);
                    if (parsedDraft) {
                      setViewYear(parsedDraft.y);
                      setViewMonth(parsedDraft.m);
                    }
                  }
                  if (dateError) setDateError(null);
                }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyDraftDate();
                  }
                }}
                className={cn(
                  "flex-1 rounded border border-input bg-background px-2 py-1 text-sm",
                  "focus:outline-none focus:ring-1 focus:ring-ring",
                  dateError && "border-destructive focus:ring-destructive",
                )}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  applyDraftDate();
                }}
                className="rounded border border-input px-2 py-1 text-xs font-medium hover:bg-accent"
              >
                적용
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                type="time"
                value={draftTime}
                onChange={(e) => handleTimeChange(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "flex-1 rounded border border-input bg-background px-2 py-1 text-sm",
                  "focus:outline-none focus:ring-1 focus:ring-ring",
                )}
              />
            </div>
            <p className={cn("mt-1.5 text-[11px]", dateError ? "text-destructive" : "text-muted-foreground")}>
              {dateError ?? "달력에서 고르거나 날짜를 직접 입력한 뒤 시간을 선택할 수 있습니다"}
            </p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
