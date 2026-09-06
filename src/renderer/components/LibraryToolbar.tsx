import React, { useMemo, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Popover,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import columnsIcon from '@iconify/icons-fluent/column-triple-24-regular';
import filterIcon from '@iconify/icons-fluent/filter-24-filled';
import searchIcon from '@iconify/icons-fluent/search-24-regular';
import dismissIcon from '@iconify/icons-fluent/dismiss-24-regular';
import arrowUpIcon from '@iconify/icons-fluent/arrow-up-16-regular';
import arrowDownIcon from '@iconify/icons-fluent/arrow-down-16-regular';
import {
  FILTER_OPS,
  opNeedsValue,
  type FilterOp,
  type SortState,
  type TableFilter,
} from '../utils/tableSort';

/** The slice of a column this toolbar needs; keeps it free of the row generic. */
export interface ToolbarColumn {
  key: string;
  label: string;
  sortable?: boolean;
}

export interface LibraryToolbarProps {
  columns: ToolbarColumn[];
  visibility: Record<string, boolean>;
  onVisibilityChange: (_next: Record<string, boolean>) => void;
  /** The responsive default, so RESET has something to go back to. */
  defaultVisibility: Record<string, boolean>;
  sort: SortState;
  onToggleSort: (_key: string) => void;
  filter: TableFilter | null;
  onFilterChange: (_next: TableFilter | null) => void;
  search: string;
  onSearchChange: (_next: string) => void;
  /** Rows surviving filter and search, against the unfiltered total. */
  shown: number;
  total: number;
}

const PANEL_WIDTH = 300;

function ColumnsPanel({
  columns,
  visibility,
  onVisibilityChange,
  defaultVisibility,
}: Pick<
  LibraryToolbarProps,
  'columns' | 'visibility' | 'onVisibilityChange' | 'defaultVisibility'
>) {
  const [query, setQuery] = useState('');
  const matches = useMemo(
    () => columns.filter(c => c.label.toLowerCase().includes(query.trim().toLowerCase())),
    [columns, query]
  );
  const allShown = columns.every(c => visibility[c.key] !== false);

  return (
    <Box sx={{ width: PANEL_WIDTH, p: 1.5 }}>
      <TextField
        autoFocus
        fullWidth
        size="small"
        placeholder="Search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Icon icon={searchIcon} width={18} />
            </InputAdornment>
          ),
        }}
      />
      <Box sx={{ maxHeight: 280, overflowY: 'auto', mt: 1 }}>
        {matches.map(col => (
          <FormControlLabel
            key={col.key}
            sx={{ display: 'flex', ml: 0 }}
            control={
              <Checkbox
                size="small"
                checked={visibility[col.key] !== false}
                onChange={e => onVisibilityChange({ ...visibility, [col.key]: e.target.checked })}
              />
            }
            label={<Typography variant="body2">{col.label}</Typography>}
          />
        ))}
        {!matches.length && (
          <Typography variant="body2" sx={{ color: 'text.secondary', p: 1 }}>
            No columns match.
          </Typography>
        )}
      </Box>
      <Divider sx={{ my: 1 }} />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <FormControlLabel
          sx={{ ml: 0 }}
          control={
            <Checkbox
              size="small"
              checked={allShown}
              indeterminate={!allShown && columns.some(c => visibility[c.key] !== false)}
              onChange={e =>
                onVisibilityChange(Object.fromEntries(columns.map(c => [c.key, e.target.checked])))
              }
            />
          }
          label={<Typography variant="body2">Show/Hide All</Typography>}
        />
        <Button size="small" onClick={() => onVisibilityChange({ ...defaultVisibility })}>
          Reset
        </Button>
      </Box>
    </Box>
  );
}

function SortFilterPanel({
  columns,
  sort,
  onToggleSort,
  filter,
  onFilterChange,
}: Pick<LibraryToolbarProps, 'columns' | 'sort' | 'onToggleSort' | 'filter' | 'onFilterChange'>) {
  const sortable = columns.filter(c => c.sortable !== false);
  // Every column is listed, hidden ones included: on a narrow window that is
  // the only way to reach the sort and filter for a column that will not fit.
  const active = filter ?? { key: columns[0]?.key ?? '', op: 'contains' as FilterOp, value: '' };

  return (
    <Box sx={{ width: PANEL_WIDTH, p: 1.5 }}>
      <Typography variant="overline" sx={{ color: 'text.secondary' }}>
        Sort by
      </Typography>
      <Box sx={{ maxHeight: 220, overflowY: 'auto', mb: 1 }}>
        {sortable.map(col => {
          const isActive = sort.key === col.key;
          return (
            <MenuItem
              key={col.key}
              selected={isActive}
              onClick={() => onToggleSort(col.key)}
              sx={{ borderRadius: 1 }}
            >
              <Typography variant="body2" sx={{ flex: 1 }}>
                {col.label}
              </Typography>
              {isActive && (
                <Icon icon={sort.dir === 'asc' ? arrowUpIcon : arrowDownIcon} width={16} />
              )}
            </MenuItem>
          );
        })}
      </Box>

      <Divider sx={{ my: 1 }} />
      <Typography variant="overline" sx={{ color: 'text.secondary' }}>
        Filter
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
        <Select
          size="small"
          value={active.key}
          onChange={e => onFilterChange({ ...active, key: e.target.value })}
          sx={{ flex: 1, minWidth: 0 }}
        >
          {columns.map(col => (
            <MenuItem key={col.key} value={col.key}>
              {col.label}
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          value={active.op}
          onChange={e => onFilterChange({ ...active, op: e.target.value as FilterOp })}
          sx={{ flex: 1, minWidth: 0 }}
        >
          {FILTER_OPS.map(op => (
            <MenuItem key={op.value} value={op.value}>
              {op.label}
            </MenuItem>
          ))}
        </Select>
      </Box>
      {opNeedsValue(active.op) && (
        <TextField
          fullWidth
          size="small"
          placeholder="Value"
          sx={{ mt: 1 }}
          value={active.value}
          onChange={e => onFilterChange({ ...active, value: e.target.value })}
        />
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
        <Button size="small" disabled={!filter} onClick={() => onFilterChange(null)}>
          Clear filter
        </Button>
      </Box>
    </Box>
  );
}

export default function LibraryToolbar(props: LibraryToolbarProps) {
  const { sort, filter, search, onSearchChange, shown, total } = props;
  const [panel, setPanel] = useState<{ el: HTMLElement; kind: 'columns' | 'sort' } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const hiddenCount = props.columns.filter(c => props.visibility[c.key] === false).length;
  const filtered = shown !== total;
  const showField = searchOpen || !!search;

  const inputRef = useRef<HTMLInputElement>(null);
  // The field is always mounted, so autoFocus never fires again; focus it once
  // the expansion has actually started.
  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  // Collapsing always clears: a stale query behind a hidden field would filter
  // the list with nothing on screen to explain why.
  const closeSearch = () => {
    onSearchChange('');
    setSearchOpen(false);
  };

  // Sits in the page title row, so it stays intrinsically sized; no spacers.
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {filtered && (
        <Typography variant="caption" sx={{ color: 'text.secondary', mr: 1 }}>
          {shown} of {total}
        </Typography>
      )}

      {!showField && (
        <Tooltip title={showField ? 'Close search' : 'Search'}>
          <IconButton
            aria-label={showField ? 'Close search' : 'Search'}
            onClick={showField ? closeSearch : openSearch}
          >
            <Icon icon={searchIcon} width={24} />
          </IconButton>
        </Tooltip>
      )}
      <TextField
        inputRef={inputRef}
        size="small"
        placeholder="Search"
        value={search}
        onChange={e => onSearchChange(e.target.value)}
        onBlur={() => !search && setSearchOpen(false)}
        inputProps={{ tabIndex: showField ? 0 : -1 }}
        sx={{
          width: showField ? { xs: 150, sm: 240 } : 0,
          opacity: showField ? 1 : 0,
          overflow: 'hidden',
          transition: theme =>
            theme.transitions.create(['width', 'opacity'], {
              duration: theme.transitions.duration.shorter,
            }),
        }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Icon icon={searchIcon} width={24} />
            </InputAdornment>
          ),
          endAdornment: search ? (
            <InputAdornment position="end">
              <IconButton size="small" aria-label="Clear search" onClick={closeSearch}>
                <Icon icon={dismissIcon} width={16} />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        }}
      />

      <Tooltip title="Columns">
        <IconButton
          aria-label="Columns"
          onClick={e => setPanel({ el: e.currentTarget, kind: 'columns' })}
        >
          <Badge badgeContent={hiddenCount} color="primary" variant="dot" invisible={!hiddenCount}>
            <Icon icon={columnsIcon} width={24} />
          </Badge>
        </IconButton>
      </Tooltip>

      <Tooltip title="Sort and filter">
        <IconButton
          aria-label="Sort and filter"
          color={filter || sort.key ? 'primary' : 'default'}
          onClick={e => setPanel({ el: e.currentTarget, kind: 'sort' })}
        >
          <Icon icon={filterIcon} width={24} />
        </IconButton>
      </Tooltip>

      <Popover
        open={!!panel}
        anchorEl={panel?.el}
        onClose={() => setPanel(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {panel?.kind === 'columns' ? <ColumnsPanel {...props} /> : <SortFilterPanel {...props} />}
      </Popover>
    </Box>
  );
}
