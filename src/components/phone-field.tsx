import { useRef } from "react";
import type { RefObject } from "react";

import { FieldHint, joinIds, useFieldContext } from "#/components/form-fields.tsx";
import { placeAttributes } from "#/components/field-size.ts";
import type { FieldPlace } from "#/components/field-size.ts";
import { FieldProblemText, useFieldProblem } from "#/components/field-problem.tsx";
import { Button } from "#/components/ui/button.tsx";
import { ButtonGroup } from "#/components/ui/button-group.tsx";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "#/components/ui/combobox.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";
import { countryMatches, phoneCountries } from "#/lib/phone-countries.ts";
import type { PhoneCountry } from "#/lib/phone-countries.ts";
import type { PhoneEntry, PhoneEntryRefusal } from "#/lib/phones.ts";

// A person's phone: the country picked from a searchable list, Argentina
// first, and the national number beside it, digits only. The form holds a
// `PhoneEntry`; `phoneSchema` reads it into E.164 (`src/lib/phones.ts`).

/** What each refusal of a phone field's entry tells the user to type. */
export const phoneMessages: Record<PhoneEntryRefusal, string> = {
  missingPhone: "Ingresá el teléfono.",
  notDigits: "Escribí solo los números, sin espacios, guiones ni el código del país.",
  wrongArgentineNumber:
    "Ingresá 10 números: el código de área sin 0 y el número sin 15, por ejemplo 3515551234.",
  invalidPhone: "El teléfono no es válido para el país elegido. Revisá el número.",
};

const argentina = "AR";

export function PhoneField(
  props: FieldPlace & { label: string; required?: boolean; hint?: string },
) {
  const field = useFieldContext<PhoneEntry>();
  const numberInput = useRef<HTMLInputElement>(null);
  const entry = field.state.value;
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const hintId = `${field.name}-hint`;
  const argentine = entry.country === argentina;
  return (
    <Field {...placeAttributes(props, "quarter")} data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{props.label}</FieldLabel>
      <ButtonGroup className="w-full">
        <CountryPicker
          code={entry.country}
          onChange={(country) => field.handleChange({ ...entry, country })}
          numberInput={numberInput}
        />
        <Input
          ref={numberInput}
          id={field.name}
          name={field.name}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          required={props.required}
          placeholder={argentine ? "3515551234" : undefined}
          value={entry.number}
          onChange={(event) => field.handleChange({ ...entry, number: event.target.value })}
          onBlur={field.handleBlur}
          aria-invalid={invalid}
          aria-describedby={joinIds(hintId, errorId)}
        />
      </ButtonGroup>
      <FieldHint id={hintId}>
        {[
          props.hint,
          argentine
            ? "Código de área sin 0 y número sin 15."
            : "Solo números, sin el código del país.",
        ]
          .filter(Boolean)
          .join(" ")}
      </FieldHint>
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
    </Field>
  );
}

/**
 * The country, shown as its flag and dial code, picked by typing its name or
 * code. Picking one moves on to the number; closing without a pick does not.
 */
function CountryPicker(props: {
  code: string;
  onChange: (code: string) => void;
  numberInput: RefObject<HTMLInputElement | null>;
}) {
  const picked = phoneCountries.find((country) => country.code === props.code) ?? null;
  const justPicked = useRef(false);
  return (
    <Combobox
      items={phoneCountries}
      value={picked}
      onValueChange={(country: PhoneCountry | null) => {
        if (country) {
          justPicked.current = true;
          props.onChange(country.code);
        }
      }}
      itemToStringLabel={(country: PhoneCountry) => `${country.name} ${country.dialCode}`}
      isItemEqualToValue={(country, other) => country.code === other.code}
      filter={countryMatches}
      autoHighlight
      onOpenChange={(open) => {
        if (open) {
          justPicked.current = false;
        }
      }}
      onOpenChangeComplete={(open) => {
        if (!open && justPicked.current) {
          justPicked.current = false;
          props.numberInput.current?.focus();
        }
      }}
    >
      <ComboboxTrigger
        render={<Button variant="outline" />}
        aria-label={picked ? `País: ${picked.name} ${picked.dialCode}` : "País"}
      >
        <ComboboxValue>
          {(country: PhoneCountry | null) => country && `${country.flag} ${country.dialCode}`}
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxContent align="start" className="w-72">
        <ComboboxInput showTrigger={false} placeholder="Buscar país o código" />
        <ComboboxEmpty>Ningún país coincide.</ComboboxEmpty>
        <ComboboxList>
          {(country: PhoneCountry) => (
            <ComboboxItem key={country.code} value={country}>
              <span aria-hidden="true">{country.flag}</span>
              {country.name}
              <span className="text-muted-foreground ml-auto">{country.dialCode}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
