import { useState } from 'react';
import { useSelector } from 'react-redux';
import { Box, IconButton, TextField, Typography, useTheme } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { QRCode } from 'react-qr-code';
import { useAdministrator } from '../common/util/permissions';
import { isVan } from '../map/main/plannedRoutes';
import { driverLink, setupQrAddress } from './driverLink';

const Code = ({ value, caption }) => {
  const theme = useTheme();
  return (
    <Box sx={{ textAlign: 'center', width: theme.dimensions.qrCodeSize }}>
      <QRCode value={value} size={theme.dimensions.qrCodeSize} />
      <Typography variant="body2" sx={{ mt: 1 }}>
        {caption}
      </Typography>
    </Box>
  );
};

// One printable block per van: the driver link and the tracker setup (plan U7).
const DriverLinksPage = () => {
  const administrator = useAdministrator();
  const devices = useSelector((state) => state.devices.items);
  // The token stays in this state only: never stored, never in the repo.
  const [token, setToken] = useState('');

  if (!administrator) return null;

  const vans = Object.values(devices)
    .filter(isVan)
    .sort((a, b) => a.name.localeCompare(b.name, 'nb', { numeric: true }));

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ '@media print': { display: 'none' }, mb: 2 }}>
        <Typography variant="h6">Sjåførlenker</Typography>
        <TextField
          label="Token for sjåførkontoen"
          value={token}
          onChange={(e) => setToken(e.target.value.trim())}
          autoComplete="off"
          fullWidth
          margin="dense"
        />
        <Typography variant="caption" color="text.secondary">
          Test lenkene i et privat vindu. En lenke i dette vinduet erstatter innloggingen din.
        </Typography>
      </Box>
      {vans.map((van) => {
        const link = token && driverLink(window.location.origin, van.name, token);
        return (
          <Box
            key={van.id}
            sx={{
              py: 3,
              borderTop: 1,
              borderColor: 'divider',
              breakInside: 'avoid',
              '@media print': { breakAfter: 'page', borderTop: 0 },
            }}
          >
            <Typography variant="h3" sx={{ mb: 2 }}>
              {van.name}
            </Typography>
            {link && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}>
                <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                  {link}
                </Typography>
                <IconButton
                  size="small"
                  aria-label="Kopier lenken"
                  sx={{ '@media print': { display: 'none' } }}
                  onClick={() => navigator.clipboard?.writeText(link).catch(() => {})}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Box>
            )}
            <Box sx={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {link && <Code value={link} caption="Skann med kamera: åpner sjåførsiden" />}
              <Code
                value={setupQrAddress(van.uniqueId)}
                caption="Skann i Traccar Client: setter opp sporing"
              />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

export default DriverLinksPage;
