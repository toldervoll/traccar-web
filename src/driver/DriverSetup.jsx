import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogTitle,
  IconButton,
  Link,
  Paper,
  Typography,
} from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { BASE, INTAKE_URL } from '../map/main/plannedRoutes';
import {
  START_LINK,
  STOP_LINK,
  configLink,
  directionsLink,
  formatAge,
  platformOf,
  trackingStatus,
} from './driverLink';

const APP_STORE = 'https://apps.apple.com/app/id843156974';
const GOOGLE_PLAY = 'https://play.google.com/store/apps/details?id=org.traccar.client';

const trackedKey = (deviceId) => `driverTracked:${deviceId}`;

const readTracked = (deviceId) => {
  try {
    return window.localStorage.getItem(trackedKey(deviceId)) === 'true';
  } catch {
    return false;
  }
};

export const useNow = (ms = 1000) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
};

// The van's status, updated every second, and whether it was tracked once on this phone.
export const useTrackingStatus = (deviceId) => {
  const position = useSelector((state) => state.session.positions[deviceId]);
  const socket = useSelector((state) => state.session.socket);
  const status = trackingStatus(position, socket, useNow());
  const [trackedOnce, setTrackedOnce] = useState(() => readTracked(deviceId));
  const tracked = status.state === 'tracked';
  useEffect(() => {
    if (!tracked || trackedOnce) return;
    setTrackedOnce(true);
    try {
      window.localStorage.setItem(trackedKey(deviceId), 'true');
    } catch {
      // the flag only decides what opens first
    }
  }, [tracked, trackedOnce, deviceId]);
  return { ...status, trackedOnce };
};

const STATUS_TEXT = {
  offline: 'Ingen kontakt med serveren',
  tracked: 'Bilen spores',
  untracked: 'Bilen spores ikke',
};

const STATUS_COLOR = {
  offline: 'text.secondary',
  tracked: 'success.main',
  untracked: 'error.main',
};

export const TrackingStatus = ({ status }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <Typography variant="body2" sx={{ color: STATUS_COLOR[status.state], fontWeight: 500 }}>
      {status.state === 'tracked' ? '● ' : '○ '}
      {STATUS_TEXT[status.state]}
      {status.state !== 'offline' && status.age !== null && ` (${formatAge(status.age)})`}
    </Typography>
    {status.state === 'untracked' && status.trackedOnce && (
      <Button size="small" variant="contained" href={START_LINK}>
        Start sporing
      </Button>
    )}
  </Box>
);

const CopyText = ({ label, value }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
    <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
      {`${label}: ${value}`}
    </Typography>
    <IconButton
      size="small"
      aria-label={`Kopier ${label.toLowerCase()}`}
      onClick={() => navigator.clipboard?.writeText(value).catch(() => {})}
    >
      <ContentCopyIcon fontSize="small" />
    </IconButton>
  </Box>
);

const Step = ({ number, title, children }) => (
  <Box sx={{ mt: 1.5 }}>
    <Typography variant="subtitle2">{`${number}. ${title}`}</Typography>
    {children}
  </Box>
);

const DriverSetup = ({ device, status }) => {
  const [open, setOpen] = useState(!status.trackedOnce);
  const [confirmStop, setConfirmStop] = useState(false);
  // Only the phone's own platform is shown. An unknown platform shows both.
  const platform = platformOf(navigator.userAgent, navigator.maxTouchPoints);
  const ios = platform !== 'android';
  const android = platform !== 'ios';

  const links = (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
      <Button
        size="small"
        variant="outlined"
        href={directionsLink(BASE[1], BASE[0])}
        target="_blank"
        rel="noopener"
      >
        Kjør til basen
      </Button>
      <Button size="small" variant="outlined" color="error" onClick={() => setConfirmStop(true)}>
        Stopp sporing
      </Button>
    </Box>
  );

  return (
    <Paper
      square
      elevation={4}
      sx={{ px: 2, py: 1, maxHeight: open ? '45vh' : 'none', overflowY: 'auto', zIndex: 3 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
          Oppsett av sporing
        </Typography>
        <IconButton
          size="small"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Skjul oppsett' : 'Vis oppsett'}
        >
          {open ? <ExpandMoreIcon /> : <ExpandLessIcon />}
        </IconButton>
      </Box>
      {open && (
        <>
          {status.state === 'tracked' && (
            <Typography variant="body2" color="success.main">
              Bilen spores allerede. Bruk bare én telefon per bil.
            </Typography>
          )}
          <Step number={1} title="Installer Traccar Client">
            <Typography variant="body2">
              {ios && (
                <Link href={APP_STORE} target="_blank" rel="noopener">
                  {platform ? 'App Store' : 'App Store (iPhone)'}
                </Link>
              )}
              {!platform && ' · '}
              {android && (
                <Link href={GOOGLE_PLAY} target="_blank" rel="noopener">
                  {platform ? 'Google Play' : 'Google Play (Android)'}
                </Link>
              )}
            </Typography>
          </Step>
          <Step number={2} title="Sett opp appen">
            <Button size="small" variant="contained" href={configLink(device.uniqueId)}>
              Sett opp Traccar Client
            </Button>
            <Typography variant="body2">
              Appen spør på engelsk «Apply new configuration?». Svar «OK».
            </Typography>
          </Step>
          <Step number={3} title="Gi appen tillatelser">
            {ios && (
              <Typography variant="body2">
                {!platform && 'iPhone: '}
                Stedstjenester «Alltid» og «Nøyaktig posisjon» på.
              </Typography>
            )}
            {android && (
              <Typography variant="body2">
                {!platform && 'Android: '}
                Posisjon «Tillat hele tiden», og slå av batterioptimalisering for appen.
              </Typography>
            )}
          </Step>
          <Step number={4} title="Start sporing">
            <Button size="small" variant="contained" href={START_LINK}>
              Start sporing
            </Button>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              Setter du opp før arrangementsdagen: trykk «Stopp sporing» når bilen spores. Start
              sporingen igjen på basen på arrangementsdagen.
            </Typography>
          </Step>
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              For oppsett for hånd:
            </Typography>
            <CopyText label="Server" value={INTAKE_URL} />
            <CopyText label="Identifikator" value={device.uniqueId} />
          </Box>
        </>
      )}
      {links}
      <Dialog open={confirmStop} onClose={() => setConfirmStop(false)}>
        <DialogTitle>Stoppe sporingen av bilen?</DialogTitle>
        <DialogActions>
          <Button onClick={() => setConfirmStop(false)}>Avbryt</Button>
          <Button color="error" href={STOP_LINK} onClick={() => setConfirmStop(false)}>
            Stopp sporing
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default DriverSetup;
