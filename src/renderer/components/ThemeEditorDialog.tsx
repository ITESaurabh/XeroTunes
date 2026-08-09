import React from 'react';
import { Box, Button, Slider, Stack, TextField, Typography, Alert } from '@mui/material';
import { Icon } from '@iconify/react';
import wandIcon from '@iconify/icons-fluent/wand-24-regular';
import AppDialog from './AppDialog';
import {
  AppTheme,
  DEFAULT_RADIUS,
  DEFAULT_SEED,
  MAX_RADIUS,
  MIN_RADIUS,
  THEME_FIELDS,
  ThemeColors,
  isHexColor,
  parseTheme,
  themeFromSeed,
} from '../../config/theme';

interface ColorFieldProps {
  label: string;
  ariaLabel: string;
  value: string;
  onCommit: (_value: string) => void;
}

const ColorField = React.memo<ColorFieldProps>(({ label, ariaLabel, value, onCommit }) => {
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const commit = () => onCommit(el.value);
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, [onCommit]);

  // Autofill and reopen change the value from outside the picker.
  React.useEffect(() => {
    const el = ref.current;
    if (el && isHexColor(value) && el.value !== value) el.value = value;
  }, [value]);

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Box
        component="input"
        type="color"
        ref={ref}
        aria-label={ariaLabel}
        defaultValue={isHexColor(value) ? value : '#000000'}
        sx={{
          width: 36,
          height: 32,
          p: 0,
          flexShrink: 0,
          border: 'none',
          bgcolor: 'transparent',
          cursor: 'pointer',
        }}
      />
      <Typography variant="body2" sx={{ flex: 1 }}>
        {label}
      </Typography>
      <TextField
        size="small"
        value={value}
        error={!isHexColor(value)}
        onChange={e => onCommit(e.target.value)}
        sx={{ width: 110 }}
        inputProps={{ spellCheck: false }}
      />
    </Stack>
  );
});
ColorField.displayName = 'ColorField';

interface ThemeEditorDialogProps {
  open: boolean;
  theme: AppTheme;
  /** Names already taken by other themes, so a rename can't collide. */
  takenNames: string[];
  onClose: () => void;
  onSave: (_theme: AppTheme) => void;
}

const ThemeEditorDialog: React.FC<ThemeEditorDialogProps> = ({
  open,
  theme,
  takenNames,
  onClose,
  onSave,
}) => {
  const [draft, setDraft] = React.useState<AppTheme>(theme);
  // Read on click only; holding the seed in state re-rendered the dialog on every drag frame.
  const seedRef = React.useRef<HTMLInputElement>(null);

  // Reopening on a different theme must not keep the previous draft.
  React.useEffect(() => {
    if (open) setDraft(theme);
  }, [open, theme]);

  // Stable per-field setters, so React.memo actually skips the rows that didn't change.
  const setters = React.useMemo(() => {
    const make = (mode: 'light' | 'dark', key: keyof ThemeColors) => (value: string) =>
      setDraft(d => ({ ...d, [mode]: { ...d[mode], [key]: value } }));
    return {
      light: Object.fromEntries(THEME_FIELDS.map(f => [f.key, make('light', f.key)])),
      dark: Object.fromEntries(THEME_FIELDS.map(f => [f.key, make('dark', f.key)])),
    } as Record<'light' | 'dark', Record<keyof ThemeColors, (_value: string) => void>>;
  }, []);

  const name = draft.name.trim();
  const nameError = !name
    ? 'Name is required'
    : takenNames.includes(name)
      ? 'Another theme already uses this name'
      : '';

  // A bad hex would make createTheme throw, so saving stays blocked until every field parses.
  const parsed = parseTheme({ ...draft, name: name || 'unnamed' });
  const colorError = 'error' in parsed ? parsed.error : '';

  return (
    <AppDialog open={open} onClose={onClose} title="Customise Theme" maxWidth="md">
      <Stack spacing={2}>
        <TextField
          size="small"
          label="Theme name"
          value={draft.name}
          error={!!nameError}
          helperText={nameError}
          onChange={e => setDraft(d => ({ ...d, name: e.target.value.slice(0, 60) }))}
        />

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Box
            component="input"
            type="color"
            aria-label="Seed colour"
            ref={seedRef}
            defaultValue={DEFAULT_SEED}
            sx={{ width: 40, height: 36, p: 0, border: 'none', bgcolor: 'transparent' }}
          />
          <Button
            size="small"
            startIcon={<Icon icon={wandIcon} width="1.1rem" />}
            onClick={() =>
              setDraft(d => themeFromSeed(d.name, seedRef.current?.value ?? DEFAULT_SEED))
            }
          >
            Autofill from colour
          </Button>
          <Typography variant="caption" color="text.secondary">
            Fills every field as a starting point — edit freely afterwards.
          </Typography>
        </Stack>

        <Alert severity={colorError ? 'error' : 'info'} sx={{ py: 0 }}>
          {colorError || 'Everything else (hover, disabled, contrast text) is derived from these.'}
        </Alert>

        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="body2" sx={{ flexShrink: 0 }}>
            Roundness
          </Typography>
          <Slider
            size="small"
            value={draft.radius ?? DEFAULT_RADIUS}
            min={MIN_RADIUS}
            max={MAX_RADIUS}
            valueLabelDisplay="auto"
            onChange={(_e, value) => setDraft(d => ({ ...d, radius: value as number }))}
          />
          <Typography variant="body2" color="text.secondary" sx={{ width: 24, flexShrink: 0 }}>
            {draft.radius ?? DEFAULT_RADIUS}
          </Typography>
          <Button size="small" onClick={() => setDraft(d => ({ ...d, radius: undefined }))}>
            Reset
          </Button>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: 3,
          }}
        >
          {(['light', 'dark'] as const).map(mode => (
            <Stack key={mode} spacing={1.5}>
              <Typography variant="subtitle2" sx={{ textTransform: 'capitalize' }}>
                {mode}
              </Typography>
              {THEME_FIELDS.map(({ key, label }) => (
                <ColorField
                  key={key}
                  label={label}
                  ariaLabel={`${mode} ${label}`}
                  value={draft[mode][key]}
                  onCommit={setters[mode][key]}
                />
              ))}
            </Stack>
          ))}
        </Box>

        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!!nameError || !!colorError}
            onClick={() => onSave({ ...draft, name })}
          >
            Save
          </Button>
        </Stack>
      </Stack>
    </AppDialog>
  );
};

export default ThemeEditorDialog;
