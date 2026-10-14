import React, { useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import reiSick from '../../assets/mascot/rei-sick.png';

function CrashScreen({ details, onRetry }: { details: string; onRetry: () => void }) {
  const [copied, setCopied] = useState(false);

  return (
    <Stack
      alignItems="center"
      // "safe" keeps a tall trace scrollable to the top; centered flex content overflows past it.
      justifyContent="safe center"
      spacing={2}
      // #app has no height of its own, so an app-level crash needs minHeight to center.
      sx={{ flex: 1, height: '100%', minHeight: 420, p: 4, overflow: 'auto', textAlign: 'center' }}
    >
      <Box
        component="img"
        src={reiSick}
        alt=""
        sx={{
          height: 'min(260px, 26vh)',
          maxWidth: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />
      <Typography variant="h3">Something went wrong 🤒</Typography>
      <Button size="medium" variant="contained" onClick={onRetry}>
        Try again
      </Button>
      <Accordion variant="outlined" sx={{ width: '100%', maxWidth: 920, mt: 2, textAlign: 'left' }}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          sx={{ '& .MuiAccordionSummary-content': { alignItems: 'center', gap: 1, mr: 1 } }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            Crash Details
          </Typography>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            component="div"
            onClick={e => {
              e.stopPropagation();
              navigator.clipboard.writeText(details).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </AccordionSummary>
        <AccordionDetails>
          <Box
            component="pre"
            sx={{
              width: '100%',
              m: 0,
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'background.default',
              fontSize: 12,
              lineHeight: 1.5,
              maxHeight: '30vh',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              userSelect: 'text',
            }}
          >
            {details}
          </Box>
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
}

interface ErrorBoundaryProps {
  /** Which boundary caught it; shown in the copied report and the console log. */
  scope: 'app' | 'page';
  /** Lets the app boundary tell the titlebar its nav controls lead nowhere. */
  onErrorChange?: (_crashed: boolean) => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string;
  /** Bumped by Try again so the children remount instead of re-rendering stale ones. */
  attempt: number;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: '', attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? '' });
    this.props.onErrorChange?.(true);
    console.error(`[${this.props.scope} boundary]`, error, info.componentStack);
  }

  retry = () => {
    this.setState(({ attempt }) => ({ error: null, componentStack: '', attempt: attempt + 1 }));
    this.props.onErrorChange?.(false);
  };

  render() {
    const { error, componentStack, attempt } = this.state;
    if (!error) return <React.Fragment key={attempt}>{this.props.children}</React.Fragment>;

    const details = [
      `${this.props.scope} boundary`,
      error.stack || `${error.name}: ${error.message}`,
      componentStack && `Component stack:${componentStack}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    return <CrashScreen details={details} onRetry={this.retry} />;
  }
}

export default ErrorBoundary;
