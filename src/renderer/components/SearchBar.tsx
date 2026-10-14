import { useContext } from 'react';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import InputBase from '@mui/material/InputBase';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import { store } from '../utils/store';

interface SearchBarProps {
  open: boolean;
  tempDrawer?: boolean;
  toggleDrawer: () => void;
}

export default function SearchBar({ open, tempDrawer, toggleDrawer }: SearchBarProps) {
  const { state, dispatch } = useContext(store);
  // A scan rewrites the library underneath the results as they render.
  const libraryBusy = state.isScanningLibrary || state.isSyncing;

  return (
    <Box
      component={open ? Paper : 'div'}
      sx={{
        borderRadius: 100,
        display: 'flex',
        alignItems: 'center',
        px: 1,
        mt: 1,
        mb: 2,
        ...(open && {
          bgcolor: 'surfaces.elevated',
          boxShadow: 'none',
          border: theme => `1px solid ${theme.palette.surfaces.glassBorder}`,
        }),
      }}
    >
      {!tempDrawer && (
        <IconButton sx={{ pl: '10px' }} aria-label="menu" onClick={toggleDrawer}>
          <MenuIcon />
        </IconButton>
      )}
      <InputBase
        sx={{ ml: 1, flex: 1 }}
        disabled={libraryBusy}
        onClick={() => dispatch({ type: 'SET_SEARCH_ENABLED', payload: true })}
        placeholder={libraryBusy ? 'Library is busy…' : 'Search'}
        inputProps={{ 'aria-label': 'search', readOnly: true }}
      />
      <IconButton
        type="button"
        sx={{ p: '10px' }}
        aria-label="search"
        disabled={libraryBusy}
        onClick={() => dispatch({ type: 'SET_SEARCH_ENABLED', payload: true })}
      >
        <SearchIcon />
      </IconButton>
    </Box>
  );
}
