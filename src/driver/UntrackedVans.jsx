import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Button, Link, Paper, Typography } from '@mui/material';
import WarningIcon from '@mui/icons-material/Warning';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import { map } from '../map/core/MapView';
import { devicesActions } from '../store';
import { eventDayWindow, formatAge, untrackedVans } from './driverLink';
import { useNow } from './DriverSetup';

const DONE_KEY = 'untrackedVansDone';

const readDone = () => {
  try {
    const value = JSON.parse(window.localStorage.getItem(DONE_KEY));
    return Array.isArray(value) ? value.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
};

const writeDone = (done) => {
  try {
    window.localStorage.setItem(DONE_KEY, JSON.stringify(done));
  } catch {
    // the marks then last for this page only
  }
};

// A map control under the route legend: the vans that are not tracked (plan U10).
const UntrackedVans = () => {
  const dispatch = useDispatch();
  const devices = useSelector((state) => state.devices.items);
  const positions = useSelector((state) => state.session.positions);
  const socket = useSelector((state) => state.session.socket);
  const now = useNow();
  const [done, setDone] = useState(readDone);
  const [open, setOpen] = useState(false);

  const result = untrackedVans(devices, positions, now, eventDayWindow(now), done);
  const keepKey = result.done.join(',');
  useEffect(() => {
    if (keepKey !== done.join(',')) {
      setDone(result.done);
      writeDone(result.done);
    }
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [keepKey]);

  const updateDone = (next) => {
    setDone(next);
    writeDone(next);
  };

  const [container, setContainer] = useState(null);
  useEffect(() => {
    const element = document.createElement('div');
    element.className = 'maplibregl-ctrl';
    const control = { onAdd: () => element, onRemove: () => element.remove() };
    map.addControl(control, 'top-left');
    setContainer(element);
    return () => map.removeControl(control);
  }, []);

  const doneVans = useMemo(() => done.map((id) => devices[id]).filter(Boolean), [done, devices]);

  if (!container) return null;
  if (socket === false) {
    return createPortal(
      <Paper elevation={3} sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <CloudOffIcon fontSize="small" color="disabled" />
        <Typography variant="body2">Ingen kontakt med serveren</Typography>
      </Paper>,
      container,
    );
  }
  if (!result.vans.length && !doneVans.length) return null;

  return createPortal(
    <Paper elevation={3} sx={{ p: 1, width: 240, maxWidth: 'calc(100vw - 32px)' }}>
      {result.vans.length > 0 ? (
        <Button
          size="small"
          color="error"
          startIcon={<WarningIcon />}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {`${result.vans.length} ${result.vans.length === 1 ? 'bil spores' : 'biler spores'} ikke`}
        </Button>
      ) : (
        <Button size="small" onClick={() => setOpen(!open)} aria-expanded={open}>
          Alle biler spores
        </Button>
      )}
      {open && (
        <>
          {result.vans.map(({ device, age }) => (
            <Box key={device.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Link
                component="button"
                variant="body2"
                sx={{ flexGrow: 1, textAlign: 'left' }}
                onClick={() => dispatch(devicesActions.selectId(device.id))}
              >
                {device.name}
              </Link>
              <Typography variant="caption" color="text.secondary">
                {age === null ? 'ingen posisjon' : formatAge(age)}
              </Typography>
              <Button size="small" onClick={() => updateDone([...done, device.id])}>
                Ferdig
              </Button>
            </Box>
          ))}
          {doneVans.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Ferdig:
              </Typography>
              {doneVans.map((device) => (
                <Button
                  key={device.id}
                  size="small"
                  title="Ta bort ferdig-merket"
                  onClick={() => updateDone(done.filter((id) => id !== device.id))}
                >
                  {`${device.name} ✕`}
                </Button>
              ))}
            </Box>
          )}
        </>
      )}
    </Paper>,
    container,
  );
};

export default UntrackedVans;
