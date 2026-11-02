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
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table.tsx";

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
    /** What the search box matches in a row. */
    searchText: (row: Row) => string;
  },
) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const rows = matchingRows(options.rows, options.searchText, query);
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
 * The link to a row's record, in the column that names it: the whole row opens
 * it. It does not preload: moving the pointer down a list would read each record.
 */
export function RowLink(props: LinkProps & { children: ReactNode }) {
  return (
    <Link
      {...props}
      preload={false}
      className="font-medium underline-offset-4 after:absolute after:inset-0 hover:underline"
    />
  );
}

export function DataTable<Row extends RowData>(props: {
  table: TanStackTable<typeof features, Row>;
  search: Search;
  filters?: ComponentProps<typeof FilterBar>;
  pager?: Pager;
  /** What shows with no rows: `NoMatches`, or the list's own `EmptyState`. */
  empty: ReactNode;
}) {
  const { table } = props;
  return (
    <div className="flex flex-col gap-3">
      <Toolbar search={props.search} filters={props.filters} />
      {table.getRowModel().rows.length === 0 ? props.empty : <Rows table={table} />}
      <PageControls pager={props.pager} />
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
            <TableRow key={row.id} className="relative h-10">
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

function Toolbar(props: { search: Search; filters?: ComponentProps<typeof FilterBar> }) {
  const { search, filters } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="search"
        className="w-full sm:w-80"
        aria-label={search.label}
        placeholder={search.placeholder}
        value={search.value}
        onChange={(event) => search.onChange(event.target.value)}
      />
      {filters && <FilterBar {...filters} />}
    </div>
  );
}

function PageControls({ pager }: { pager?: Pager }) {
  if (!pager || pager.pageCount <= 1) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-muted-foreground text-sm">
        Página {pager.page} de {pager.pageCount} · {pager.total} en total
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
