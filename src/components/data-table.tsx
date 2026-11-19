import { Button as ButtonPrimitive } from "@base-ui/react/button";
import {
  FlexRender,
  createPaginatedRowModel,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { ColumnDef, RowData, Table as TanStackTable } from "@tanstack/react-table";
import { Link } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { matchingRows } from "#/components/data-table-rows.ts";
import { EmptyState } from "#/components/empty-state.tsx";
import { FilterBar } from "#/components/filter-bar.tsx";
import { RecordName } from "#/components/record-transition.tsx";
import { SearchInput } from "#/components/search-input.tsx";
import { Avatar, AvatarFallback } from "#/components/ui/avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table.tsx";
import { initialsOf } from "#/lib/initials.ts";

// Every list: a toolbar, 40 px rows and a pager. A row has no actions column:
// its `RowLink` opens the record. `useClientDataTable` is for a list the loader
// sends whole; `useServerDataTable` for one the server searches and pages.
// Columns are a module constant: a cell is mounted as a component, so a new
// array each render would remount every cell.

const features = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

const clientPageSize = 25;

export interface DataTableColumn<Row> {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
}

interface DataTableOptions<Row> {
  rows: Row[];
  columns: DataTableColumn<Row>[];
  getRowId: (row: Row) => string;
}

interface Pager {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}

interface Search {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  loading?: boolean;
}

function useColumnDefs<Row extends RowData>(columns: DataTableColumn<Row>[]) {
  return useMemo(
    () =>
      columns.map((column): ColumnDef<typeof features, Row> => ({
        id: column.id,
        header: column.header,
        cell: ({ row }) => column.cell(row.original),
      })),
    [columns],
  );
}

/** A list the loader sends whole: searched and paged in the browser. */
export function useClientDataTable<Row extends RowData>(
  options: DataTableOptions<Row> & {
    /** What the search box matches in a row; none for a list with no search. */
    searchText?: (row: Row) => string;
  },
) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const rows = matchingRows(options.rows, options.searchText ?? (() => ""), query);
  const pageCount = Math.max(1, Math.ceil(rows.length / clientPageSize));
  const shownPage = Math.min(page, pageCount);
  const table = useTable({
    features,
    columns: useColumnDefs(options.columns),
    data: rows,
    getRowId: options.getRowId,
    state: { pagination: { pageIndex: shownPage - 1, pageSize: clientPageSize } },
  });
  return {
    table,
    pager: { page: shownPage, pageCount, total: rows.length, onPageChange: setPage },
    query,
    setQuery: (value: string) => {
      setQuery(value);
      setPage(1);
    },
  };
}

/** A list the server has already searched and paged: `rows` is the page to draw. */
export function useServerDataTable<Row extends RowData>(options: DataTableOptions<Row>) {
  return useTable({
    features,
    columns: useColumnDefs(options.columns),
    data: options.rows,
    getRowId: options.getRowId,
    manualPagination: true,
  });
}

/**
 * The link to a row's record, in the cell that names it, with the look of a link
 * `Button`: a real link, which a screen reader names as one and a reader can
 * select. It does not preload: pointing down a list would read each record.
 */
function RowLink(props: LinkProps & { children: ReactNode }) {
  return (
    <Link
      {...props}
      preload={false}
      className="text-primary font-medium underline-offset-4 hover:underline"
    />
  );
}

/**
 * A row's name that opens its dialog: a button that looks like `RowLink`, so
 * Base UI's unstyled one, not the ui `Button`, whose look is a button's.
 */
function RowButton(props: { onClick: () => void; children: ReactNode }) {
  return (
    <ButtonPrimitive
      onClick={props.onClick}
      className="text-primary cursor-pointer text-left font-medium underline-offset-4 hover:underline"
    >
      {props.children}
    </ButtonPrimitive>
  );
}

/** A row's avatar: its name's initials. */
function RowAvatar({ name }: { name: string }) {
  return (
    <Avatar size="sm">
      <AvatarFallback>{initialsOf(name)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Every list's first cell, and the only way a list links a row: its name (the
 * link to its page when `link` is given), its states as badges beside the
 * name, and, each a deliberate choice, an `avatar` with its initials and a
 * `detail` line under it.
 */
export function RowName(props: {
  name: string;
  link?: LinkProps;
  status?: ReactNode;
  detail?: ReactNode;
  /** Opens the row's dialog (`FormDialog`), for a row with no page of its own. */
  onOpen?: () => void;
  /** The row's id, when its page's title takes the name over (`RecordName`). */
  transitionId?: string;
  avatar?: boolean;
}) {
  const { name, link, onOpen, status, detail, transitionId, avatar = false } = props;
  const label = transitionId ? <RecordName id={transitionId}>{name}</RecordName> : name;
  return (
    <span className="flex items-center gap-2">
      {avatar && <RowAvatar name={name} />}
      <span className="flex flex-col">
        <span className="flex flex-wrap items-center gap-2">
          <RowLabel link={link} onOpen={onOpen}>
            {label}
          </RowLabel>
          {status}
        </span>
        {detail && <span className="text-muted-foreground text-sm">{detail}</span>}
      </span>
    </span>
  );
}

/** The row's name: the link to its page, the button that opens its dialog, or plain text. */
function RowLabel(props: { link?: LinkProps; onOpen?: () => void; children: ReactNode }) {
  if (props.link) {
    return <RowLink {...props.link}>{props.children}</RowLink>;
  }
  if (props.onOpen) {
    return <RowButton onClick={props.onOpen}>{props.children}</RowButton>;
  }
  return props.children;
}

export function DataTable<Row extends RowData>(props: {
  table: TanStackTable<typeof features, Row>;
  /** None for a short fixed list, which has nothing to narrow. */
  search?: Search;
  filters?: ComponentProps<typeof FilterBar>;
  pager?: Pager;
  /** What shows with no rows: `NoMatches`, or the list's own `EmptyState`. */
  empty: ReactNode;
  /**
   * The list has no records at all, or only the inactive ones it hides: with
   * nothing to search, the search and filters give way to `empty`, whose
   * buttons say what to do.
   */
  noRecords?: boolean;
}) {
  const { table } = props;
  if (props.noRecords) {
    return props.empty;
  }
  return (
    <div className="flex flex-col gap-3 has-data-[slot=empty]:flex-1">
      <Toolbar search={props.search} filters={props.filters} />
      {table.getRowModel().rows.length === 0 ? props.empty : <Rows table={table} />}
      <Footer shown={table.getRowModel().rows.length} pager={props.pager} />
    </div>
  );
}

/** A search that found nothing, with the icon of the list's concept. */
export function NoMatches(props: { icon: LucideIcon }) {
  return (
    <EmptyState
      icon={props.icon}
      title="Ningún resultado coincide con la búsqueda"
      description="Probá con otra búsqueda."
    />
  );
}

function Rows<Row extends RowData>(props: { table: TanStackTable<typeof features, Row> }) {
  const { table } = props;
  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  <FlexRender header={header} />
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} className="h-10">
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id}>
                  <FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Toolbar(props: { search?: Search; filters?: ComponentProps<typeof FilterBar> }) {
  const { search, filters } = props;
  if (!search && !filters) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {search && <SearchInput className="w-full sm:w-96" {...search} />}
      {filters && <FilterBar {...filters} />}
    </div>
  );
}

function Footer({ shown, pager }: { shown: number; pager?: Pager }) {
  if (!pager || shown === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-muted-foreground text-sm">
        {shown} de {pager.total} {pager.total === 1 ? "registro" : "registros"}
      </span>
      <PageControls pager={pager} />
    </div>
  );
}

function PageControls({ pager }: { pager: Pager }) {
  if (pager.pageCount <= 1) {
    return null;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-sm">
        Página {pager.page} de {pager.pageCount}
      </span>
      <Button
        variant="outline"
        disabled={pager.page === 1}
        onClick={() => pager.onPageChange(pager.page - 1)}
      >
        Anterior
      </Button>
      <Button
        variant="outline"
        disabled={pager.page === pager.pageCount}
        onClick={() => pager.onPageChange(pager.page + 1)}
      >
        Siguiente
      </Button>
    </div>
  );
}
