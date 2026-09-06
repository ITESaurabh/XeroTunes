import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { alpha, Box, Theme, Typography, useMediaQuery, type SxProps } from '@mui/material';
import {
  DataGrid,
  useGridApiRef,
  type GridColDef,
  type GridRowSelectionModel,
  type GridSortModel,
} from '@mui/x-data-grid';
import { createPortal } from 'react-dom';
import LibraryToolbar from './LibraryToolbar';
import { TABLE_ACTIONS_SLOT_ID } from './PageToolbar';
import {
  matchesFilter,
  matchesSearch,
  nextSort,
  opNeedsValue,
  sortRows,
  type SortState,
  type TableFilter,
} from '../utils/tableSort';

export type { SortState, TableFilter } from '../utils/tableSort';

export interface TableColumn<T> {
  label: string;
  /** Row property this column reads, and the sort identity. */
  key: string;
  align: 'left' | 'center' | 'right';
  flex?: number;
  /** Off for columns whose order means nothing (an action button, say). */
  sortable?: boolean;
  /** Sort on something other than the raw property: a parsed date, a rank. */
  sortValue?: (_row: T) => unknown;
  format?: (_val: unknown, _row: T) => string;
  getNavPath?: (_row: T) => string | null;
  /** Full control of the cell body; skips format and getNavPath. */
  render?: (_row: T, _index: number) => React.ReactNode;
  /** DataGrid lays out in pixels, so flex columns need a starting width. */
  gridWidth?: number;
  /**
   * Explicit narrow-viewport visibility. Set it on any column and it governs
   * the whole table, overriding the width budget, for tables whose droppable
   * column isn't the last one.
   */
  hideOnPhone?: boolean;
}

const cellText = <T,>(col: TableColumn<T>, row: T): string => {
  const value = (row as Record<string, unknown>)[col.key];
  if (col.format) return col.format(value, row);
  return value == null ? '' : String(value);
};

const sortValueOf = <T,>(col: TableColumn<T>, row: T): unknown =>
  col.sortValue ? col.sortValue(row) : (row as Record<string, unknown>)[col.key];

export interface TableView {
  sort: SortState;
  toggleSort: (_key: string) => void;
  filter: TableFilter | null;
  setFilter: (_next: TableFilter | null) => void;
  search: string;
  setSearch: (_next: string) => void;
  /** Row count before filter and search, for the "n of m" readout. */
  total: number;
}

/**
 * Sort, filter and search over a row list. Views own this rather than the
 * table, because what comes out is also the play-queue order and contents.
 */
export function useLibraryTable<T>(rows: T[], columns: TableColumn<T>[], initial?: SortState) {
  const [sort, setSort] = useState<SortState>(initial ?? { key: null, dir: 'asc' });
  const [filter, setFilter] = useState<TableFilter | null>(null);
  const [search, setSearch] = useState('');

  const toggleSort = useCallback((key: string) => setSort(prev => nextSort(prev, key)), []);

  const matched = useMemo(() => {
    let out = rows;
    if (filter) {
      const col = columns.find(c => c.key === filter.key);
      // A value operator with an empty box is someone mid-edit, not a filter.
      if (col && (!opNeedsValue(filter.op) || filter.value.trim() !== '')) {
        out = out.filter(row => matchesFilter(cellText(col, row), filter.op, filter.value));
      }
    }
    if (search.trim()) {
      // ponytail: rebuilds every cell's text per keystroke; memoise a per-row
      // search index if a very large library starts to feel laggy.
      out = out.filter(row =>
        matchesSearch(
          columns.map(col => cellText(col, row)),
          search
        )
      );
    }
    return out;
  }, [rows, columns, filter, search]);

  const sorted = useMemo(() => {
    const col = sort.key != null ? columns.find(c => c.key === sort.key) : undefined;
    if (!col) return matched;
    return sortRows(matched, row => sortValueOf(col, row), sort.dir);
  }, [matched, columns, sort]);

  const view: TableView = {
    sort,
    toggleSort,
    filter,
    setFilter,
    search,
    setSearch,
    total: rows.length,
  };
  return { rows: sorted, view };
}

/**
 * How many columns a viewport can carry. The last column (a duration or a
 * count) survives every tier, being narrow and the thing people scan for, so
 * the budget is spent on the leading columns instead.
 */
function useColumnBudget(): number | null {
  // Explicit widths rather than theme breakpoints: the sidebar eats a fixed
  // ~330px, so the table's usable width doesn't track the breakpoint scale.
  const under580 = useMediaQuery('(max-width:579.98px)');
  const under1080 = useMediaQuery('(max-width:1079.98px)');
  const under1280 = useMediaQuery('(max-width:1279.98px)');
  const under1480 = useMediaQuery('(max-width:1479.98px)');
  if (under580) return 2;
  if (under1080) return 3;
  if (under1280) return 4;
  if (under1480) return 5;
  return null;
}

function budgetColumns<T>(columns: TableColumn<T>[], budget: number | null): TableColumn<T>[] {
  if (budget == null || budget >= columns.length) return columns;
  return [...columns.slice(0, budget - 1), columns[columns.length - 1]];
}

export interface TableSelection {
  selectedIds: Set<string | number>;
  /** DataGrid hands back a whole model rather than one row at a time. */
  onReplace: (_ids: Set<string | number>) => void;
}

export interface LibraryTableHandle {
  scrollToItem: (_index: number) => void;
}

export interface LibraryTableProps<T> {
  rows: T[];
  columns: TableColumn<T>[];
  getRowId: (_row: T) => string | number;
  view: TableView;
  rowHeight?: number;
  isRowActive?: (_row: T) => boolean;
  onRowClick?: (_row: T, _index: number) => void;
  /** Hover, so a row can warm its query before the click lands. */
  onRowHover?: (_row: T, _index: number) => void;
  onRowContextMenu?: (_row: T, _event: React.MouseEvent) => void;
  /** Pinned trailing cell, e.g. the Favourites remove button. */
  renderRowAction?: (_row: T) => React.ReactNode;
  actionWidth?: number;
  selection?: TableSelection;
  listRef?: React.MutableRefObject<LibraryTableHandle | null>;
  initialScrollOffset?: number;
  onScroll?: (_args: { scrollOffset: number }) => void;
  onNavigate?: (_path: string) => void;
}

/** Hoisted: a fresh sx object per render is pure churn for the grid. */
const GRID_SX: SxProps<Theme> = {
  border: 0,
  fontSize: '0.875rem',
  // The grid draws its own 1px row rules; the library lists band with
  // colour instead, so the rules go and the stripes come back.
  '--DataGrid-rowBorderColor': 'transparent',
  // The header band is painted by two separate grid rules: the header cells,
  // and a filler cell capping the scrollbar column. Restyling only the cells
  // leaves the filler in MUI's own header colour, which reads as the band's
  // rounded right edge being cut square where the scrollbar sits.
  [`& .MuiDataGrid-columnHeader,
    & .MuiDataGrid-columnHeaders .MuiDataGrid-scrollbarFiller,
    & .MuiDataGrid-scrollbarFiller`]: {
    bgcolor: theme => theme.palette.surfaces.listHeader,
  },
  '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 500 },
  '& .MuiDataGrid-columnSeparator': {
    color: theme => alpha(theme.palette.text.primary, 0.12),
  },
  '& .MuiDataGrid-cell': {
    borderBottom: 0,
    // Custom renderCell content (ArtistCell, the nav links) sits on its
    // own line box and rides high without this.
    display: 'flex',
    alignItems: 'center',
  },
  '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
  '& .MuiDataGrid-columnHeader:focus, & .MuiDataGrid-columnHeader:focus-within': {
    outline: 'none',
  },
  '& .MuiDataGrid-row': { cursor: 'pointer' },
  '& .xt-row--striped': { bgcolor: theme => alpha(theme.palette.text.primary, 0.03) },
  '& .MuiDataGrid-row:hover, & .xt-row--striped:hover': {
    bgcolor: theme => alpha(theme.palette.text.primary, 0.08),
  },
  '& .xt-row--active, & .xt-row--active:hover': {
    bgcolor: theme => theme.palette.surfaces.selection,
  },
  '& .MuiDataGrid-row.Mui-selected, & .MuiDataGrid-row.Mui-selected:hover': {
    bgcolor: theme => theme.palette.surfaces.selection,
  },
  '& .MuiDataGrid-toolbar, & .MuiDataGrid-footerContainer': {
    border: 0,
    bgcolor: 'transparent',
  },
};

const ACTION_FIELD = '__action';

/**
 * The library list. Rows arrive already sorted, filtered and searched by
 * `useLibraryTable`, so the grid stays in `sortingMode="server"` and one order
 * drives both the table and the queue.
 */
export default function LibraryTable<T>({
  rows,
  columns,
  getRowId,
  view,
  rowHeight = 43,
  isRowActive,
  onRowClick,
  onRowHover,
  onRowContextMenu,
  renderRowAction,
  actionWidth = 48,
  selection,
  listRef,
  initialScrollOffset,
  onScroll,
  onNavigate,
}: LibraryTableProps<T>) {
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const budget = useColumnBudget();
  const apiRef = useGridApiRef();

  const defaultVisibility = useMemo(() => {
    const kept = columns.some(c => c.hideOnPhone !== undefined)
      ? isPhone
        ? columns.filter(c => !c.hideOnPhone)
        : columns
      : budgetColumns(columns, budget);
    return Object.fromEntries(columns.map(col => [col.key, kept.includes(col)]));
  }, [columns, isPhone, budget]);

  // Seeded from the width budget, then owned by the user: the columns panel
  // writes here, and only a breakpoint change reseeds it.
  const [visibility, setVisibility] = useState(defaultVisibility);
  useEffect(() => setVisibility(defaultVisibility), [defaultVisibility]);

  // PageToolbar's DOM is committed before any effect runs, so one lookup on
  // mount is enough; a remount re-queries.
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setActionsSlot(document.getElementById(TABLE_ACTIONS_SLOT_ID)), []);

  // The grid has no onScroll prop; its scrolling lives on an internal virtual
  // scroller and is only reachable through the event bus. Held in a ref so the
  // subscription survives a new handler identity instead of resubscribing.
  const onScrollRef = React.useRef(onScroll);
  onScrollRef.current = onScroll;
  useEffect(
    () =>
      apiRef.current?.subscribeEvent('scrollPositionChange', ({ top }) =>
        onScrollRef.current?.({ scrollOffset: top })
      ),
    [apiRef]
  );

  useEffect(() => {
    if (!listRef) return;
    listRef.current = {
      scrollToItem: index => apiRef.current?.scrollToIndexes({ rowIndex: index }),
    };
    return () => {
      listRef.current = null;
    };
  }, [apiRef, listRef]);

  // Restoring has to wait for rows: scrolling an empty viewport goes nowhere.
  const restored = React.useRef(false);
  useEffect(() => {
    if (restored.current || !initialScrollOffset || !rows.length) return;
    restored.current = true;
    apiRef.current?.scroll({ top: initialScrollOffset });
  }, [apiRef, initialScrollOffset, rows.length]);

  const gridColumns = useMemo<GridColDef[]>(() => {
    const cols: GridColDef[] = columns.map(col => ({
      field: col.key,
      headerName: col.label,
      flex: col.flex ?? 1,
      minWidth: col.gridWidth ?? 90,
      sortable: col.sortable !== false,
      align: col.align,
      headerAlign: col.align,
      // The grid filters, searches and exports off this, so it has to be the
      // text the cell shows, not the raw property.
      valueGetter: (_value: unknown, row: T) => cellText(col, row),
      renderCell: col.render
        ? params =>
            col.render?.(params.row as T, params.api.getRowIndexRelativeToVisibleRows(params.id))
        : col.getNavPath
          ? params => {
              const path = col.getNavPath?.(params.row as T) ?? null;
              if (!path) return cellText(col, params.row as T);
              return (
                <Typography
                  variant="body2"
                  noWrap
                  onClick={e => {
                    e.stopPropagation();
                    onNavigate?.(path);
                  }}
                  sx={{ '&:hover': { textDecoration: 'underline', color: 'primary.main' } }}
                >
                  {cellText(col, params.row as T)}
                </Typography>
              );
            }
          : undefined,
    }));
    if (renderRowAction) {
      cols.push({
        field: ACTION_FIELD,
        headerName: '',
        width: actionWidth,
        sortable: false,
        filterable: false,
        hideable: false,
        disableColumnMenu: true,
        align: 'center',
        renderCell: params => renderRowAction(params.row as T),
      });
    }
    return cols;
  }, [columns, onNavigate, renderRowAction, actionWidth]);

  // Every controlled model below is compared by reference inside the grid
  // (`setSortModel` does `currentModel !== model`), and a sortModelChange is
  // wired to its scroll-to-top. A fresh literal per render would send the list
  // back to row 0 every time the playing track changed.
  const sortModel = useMemo<GridSortModel>(
    () => (view.sort.key ? [{ field: view.sort.key, sort: view.sort.dir }] : []),
    [view.sort.key, view.sort.dir]
  );

  const rowSelectionModel = useMemo<GridRowSelectionModel>(
    () => ({ type: 'include', ids: new Set(selection?.selectedIds ?? []) }),
    [selection?.selectedIds]
  );

  // One page holding every row; `pagination` is forced on, but the patched
  // page-size cap lets that page be the whole library.
  const paginationModel = useMemo(
    () => ({ page: 0, pageSize: Math.max(rows.length, 1) }),
    [rows.length]
  );

  // slotProps handlers get the DOM event and nothing else, so the row comes
  // back off the element's data-id.
  const rowAt = useCallback(
    (e: React.MouseEvent) => {
      const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
      const index = rows.findIndex(row => String(getRowId(row)) === id);
      return index < 0 ? null : ([rows[index], index] as const);
    },
    [rows, getRowId]
  );

  const rowSlotProps = useMemo(() => {
    if (!onRowHover && !onRowContextMenu) return undefined;
    return {
      row: {
        onMouseEnter: onRowHover
          ? (e: React.MouseEvent) => {
              const hit = rowAt(e);
              if (hit) onRowHover(hit[0], hit[1]);
            }
          : undefined,
        onContextMenu: onRowContextMenu
          ? (e: React.MouseEvent) => {
              const hit = rowAt(e);
              if (!hit) return;
              e.preventDefault();
              onRowContextMenu(hit[0], e);
            }
          : undefined,
      },
    };
  }, [onRowHover, onRowContextMenu, rowAt]);

  const toolbar = (
    <LibraryToolbar
      columns={columns}
      visibility={visibility}
      onVisibilityChange={setVisibility}
      defaultVisibility={defaultVisibility}
      sort={view.sort}
      onToggleSort={view.toggleSort}
      filter={view.filter}
      onFilterChange={view.setFilter}
      search={view.search}
      onSearchChange={view.setSearch}
      shown={rows.length}
      total={view.total}
    />
  );

  return (
    <>
      {actionsSlot ? createPortal(toolbar, actionsSlot) : null}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          apiRef={apiRef}
          rows={rows as readonly Record<string, unknown>[]}
          columns={gridColumns}
          getRowId={row => getRowId(row as T)}
          rowHeight={rowHeight}
          columnHeaderHeight={40}
          columnVisibilityModel={visibility}
          onColumnVisibilityModelChange={model => setVisibility(model as Record<string, boolean>)}
          sortingMode="server"
          sortModel={sortModel}
          onSortModelChange={model => {
            const field = model[0]?.field;
            // The grid reports the target state; our cycle derives it from the
            // current one, so an unchanged field means "advance the cycle".
            if (field) view.toggleSort(field);
            else if (view.sort.key) view.toggleSort(view.sort.key);
          }}
          checkboxSelection={!!selection}
          disableRowSelectionOnClick
          rowSelectionModel={rowSelectionModel}
          onRowSelectionModelChange={model => {
            if (!selection) return;
            const ids = model.ids as Set<string | number>;
            // Select-all arrives as { type: 'exclude', ids: ∅ }, "everything
            // except nothing". Reading `ids` alone would clear the selection
            // instead of filling it, so the exclude form gets expanded here.
            selection.onReplace(
              model.type === 'exclude'
                ? new Set(rows.map(getRowId).filter(id => !ids.has(id)))
                : new Set(ids)
            );
          }}
          onRowClick={params =>
            onRowClick?.(
              params.row as T,
              rows.findIndex(r => getRowId(r) === params.id)
            )
          }
          getRowClassName={params =>
            [
              params.indexRelativeToCurrentPage % 2 !== 0 ? 'xt-row--striped' : '',
              isRowActive?.(params.row as T) ? 'xt-row--active' : '',
            ]
              .filter(Boolean)
              .join(' ')
          }
          slotProps={rowSlotProps}
          paginationModel={paginationModel}
          hideFooter
          sx={GRID_SX}
        />
      </Box>
    </>
  );
}
