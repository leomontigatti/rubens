import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { es } from "react-day-picker/locale";

import {
  dateText,
  isLocalDate,
  shownText,
  timeText,
  typedValue,
} from "#/components/date-time-text.ts";
import type { TypedText } from "#/components/date-time-text.ts";
import { Calendar } from "#/components/ui/calendar.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#/components/ui/input-group.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";

// A date typed as `dd/mm/aaaa`, or picked on a calendar, and a time typed as
// `HH:mm`: plain text boxes, so every browser shows them alike whatever its
// language, which `type="date"` and `type="time"` do not. Each holds the
// value as `date-time-text.ts` reads it.

export interface TypedInputProps {
  id: string;
  /** `YYYY-MM-DD` or `HH:MM`, "" for nothing, or text that names neither. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

/** The box's text: what is being typed, until the box loses focus or the value moves. */
function useTypedText(kind: TypedText, props: TypedInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    text: shownText(kind, draft, props.value),
    change: (typed: string) => {
      const masked = kind.mask(typed);
      setDraft(masked);
      props.onChange(typedValue(kind, masked));
    },
    leave: () => {
      setDraft(null);
      props.onBlur?.();
    },
  };
}

function boxProps(props: TypedInputProps, typed: ReturnType<typeof useTypedText>) {
  return {
    id: props.id,
    required: props.required,
    disabled: props.disabled,
    "aria-label": props["aria-label"],
    "aria-invalid": props["aria-invalid"],
    "aria-describedby": props["aria-describedby"],
    type: "text",
    inputMode: "numeric" as const,
    autoComplete: "off",
    value: typed.text,
    onChange: (event: { target: { value: string } }) => typed.change(event.target.value),
    onBlur: typed.leave,
  };
}

/** The value under `name`, for a form read from its `FormData`. */
function Submitted(props: { name?: string; value: string }) {
  return props.name ? <input type="hidden" name={props.name} value={props.value} /> : null;
}

/** A local date `YYYY-MM-DD` as the calendar's day, at its local midnight. */
function calendarDay(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

function localDateOf(day: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

// The year list reaches back far enough for any birth date, and forward far
// enough for any appointment, schedule or time off.
const thisYear = new Date().getFullYear();
const firstMonth = new Date(thisYear - 120, 0);
const lastMonth = new Date(thisYear + 5, 11);

export function DateInput(
  props: TypedInputProps & {
    /** Submits the value under this name, for a form read from its `FormData`. */
    name?: string;
  },
) {
  const typed = useTypedText(dateText, props);
  const [open, setOpen] = useState(false);
  const picked = isLocalDate(props.value) ? calendarDay(props.value) : undefined;
  return (
    <InputGroup>
      <InputGroupInput {...boxProps(props, typed)} placeholder="dd/mm/aaaa" />
      <InputGroupAddon align="inline-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <InputGroupButton
                size="icon-xs"
                aria-label="Elegir en el calendario"
                disabled={props.disabled}
              />
            }
          >
            <CalendarIcon />
          </PopoverTrigger>
          <PopoverContent className="w-auto" align="end">
            <Calendar
              mode="single"
              captionLayout="dropdown"
              locale={es}
              weekStartsOn={1}
              startMonth={firstMonth}
              endMonth={lastMonth}
              selected={picked}
              defaultMonth={picked}
              onSelect={(day) => {
                if (day) {
                  props.onChange(localDateOf(day));
                }
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
      <Submitted name={props.name} value={props.value} />
    </InputGroup>
  );
}

export function TimeInput(props: TypedInputProps) {
  const typed = useTypedText(timeText, props);
  return <Input {...boxProps(props, typed)} placeholder="hh:mm" />;
}
