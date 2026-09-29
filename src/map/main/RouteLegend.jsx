import { useState } from 'react';
import { Box, Button, IconButton, Paper, Typography } from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import UndoIcon from '@mui/icons-material/Undo';
import { MANUAL_COLOR, ROUTE_COLORS, vanColor } from './plannedRoutes';

const COLLAPSED_KEY = 'routeLegendCollapsed';

const formatTime = new Intl.DateTimeFormat('nb-NO', {
  timeZone: 'Europe/Oslo',
  hour: '2-digit',
  minute: '2-digit',
});

const readCollapsed = () => {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
};

const RouteLegend = ({
  status,
  devices,
  closedRoutes,
  marking,
  canMark,
  pending,
  error,
  onMarkingChange,
  onToggleRoute,
}) => {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, String(!collapsed));
    } catch {
      // the state is only a convenience
    }
  };

  return (
    <Paper elevation={3} sx={{ p: 1, width: 240, maxWidth: 'calc(100vw - 32px)' }}>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          Ruter
        </Typography>
        {!collapsed && canMark && (
          <Button
            size="small"
            variant={marking ? 'contained' : 'text'}
            onClick={() => onMarkingChange(!marking)}
          >
            {marking ? 'Slutt å markere' : 'Marker'}
          </Button>
        )}
        <IconButton
          size="small"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Vis ruter' : 'Skjul ruter'}
        >
          {collapsed ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
        </IconButton>
      </Box>
      {!collapsed &&
        Object.keys(ROUTE_COLORS).map((route) => {
          const { progress = 0, shares = {}, manual = 0, eta = null } = status[route] || {};
          const done = progress >= 1;
          return (
            <Box key={route} sx={{ mt: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: '2px',
                    bgcolor: ROUTE_COLORS[route],
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                  {`Rute ${route}`}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {done ? 'Ferdig' : eta && `ferdig ca. ${formatTime.format(eta)}`}
                </Typography>
                {marking && (
                  <IconButton
                    size="small"
                    disabled={pending}
                    onClick={() => onToggleRoute(route)}
                    title={
                      closedRoutes[route] !== undefined
                        ? 'Åpne ruten igjen'
                        : 'Marker resten av ruten som ferdig'
                    }
                    sx={{ p: 0.25 }}
                  >
                    {closedRoutes[route] !== undefined ? (
                      <UndoIcon fontSize="small" />
                    ) : (
                      <DoneAllIcon fontSize="small" />
                    )}
                  </IconButton>
                )}
                <Typography variant="body2" sx={{ width: 36, textAlign: 'right' }}>
                  {`${Math.floor(progress * 100)}%`}
                </Typography>
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  height: 6,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  overflow: 'hidden',
                }}
              >
                {Object.entries(shares).map(([van, share]) => (
                  <Box
                    key={van}
                    sx={{ width: `${share * 100}%`, bgcolor: vanColor(devices[van]) }}
                  />
                ))}
                <Box sx={{ width: `${manual * 100}%`, bgcolor: MANUAL_COLOR }} />
              </Box>
            </Box>
          );
        })}
      {error && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}
      {marking && (
        <Typography variant="caption" color="text.secondary" component="div">
          <div>Trykk på en rute i kartet for å markere.</div>
          <div>
            <DoneAllIcon sx={{ fontSize: 'inherit', verticalAlign: 'middle' }} /> markerer resten av
            ruten som ferdig.
          </div>
        </Typography>
      )}
    </Paper>
  );
};

export default RouteLegend;
