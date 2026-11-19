import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";

// A choice from a list of options, shadcn's `Select` as forms use it: options
// as data, and `""` for no choice, which an option may name (`Sin documento`)
// or the box shows as `placeholder` (`Elegí una`).

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

// Base UI's Select says "no choice" with `null`; forms and the address say it with `""`.
const toSelect = (value: string) => (value === "" ? null : value);
const fromSelect = (value: string | null) => value ?? "";

export function OptionSelect(props: {
  id: string;
  options: SelectOption[];
  /** Controlled, with `onValueChange`; or `defaultValue` in a form the browser sends. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** The form field it sends as, for a form the browser submits. */
  name?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  onBlur?: () => void;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}) {
  const items = props.options.map((option) => ({
    value: toSelect(option.value),
    label: option.label,
  }));
  return (
    <Select
      items={items}
      name={props.name}
      required={props.required}
      disabled={props.disabled}
      value={props.value === undefined ? undefined : toSelect(props.value)}
      defaultValue={props.defaultValue === undefined ? undefined : toSelect(props.defaultValue)}
      onValueChange={(value) => props.onValueChange?.(fromSelect(value))}
    >
      <SelectTrigger
        id={props.id}
        className="w-full"
        onBlur={props.onBlur}
        aria-invalid={props["aria-invalid"]}
        aria-describedby={props["aria-describedby"]}
      >
        <SelectValue placeholder={props.placeholder} />
      </SelectTrigger>
      {/* Below the box, never over it with the picked option aligned on the box. */}
      <SelectContent alignItemWithTrigger={false}>
        {props.options.map((option) => (
          <SelectItem key={option.value} value={toSelect(option.value)} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
