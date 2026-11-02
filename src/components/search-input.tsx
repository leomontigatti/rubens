import { SearchIcon, XIcon } from "lucide-react";
import { useRef } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#/components/ui/input-group.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";

/**
 * A search box: the magnifier, the input and a clear button once there is text.
 * While the search runs a spinner takes the magnifier's place, so the box keeps
 * its size and the signal sits where the reader just acted.
 */
export function SearchInput(props: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  loading?: boolean;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  // The clear button leaves with the text, so focus returns to the box.
  const clear = () => {
    props.onChange("");
    input.current?.focus();
  };
  return (
    <InputGroup className={props.className}>
      <InputGroupAddon>
        {props.loading ? <Spinner aria-label="Buscando" /> : <SearchIcon aria-hidden="true" />}
      </InputGroupAddon>
      <InputGroupInput
        ref={input}
        aria-label={props.label}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.value && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="Borrar búsqueda" onClick={clear}>
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
