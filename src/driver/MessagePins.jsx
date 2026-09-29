import { useCallback, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Box, Button, Dialog, DialogContent, Typography } from '@mui/material';
import { map } from '../map/core/MapView';
import { toMapCoordinates } from '../map/core/mapUtil';
import MapMarkers from '../map/MapMarkers';
import { directionsLink } from './driverLink';
import { ALL, MANAGER, pinLabel } from './messages';

export const showOnMap = ({ lat, lon }) =>
  map.easeTo({ center: toMapCoordinates(lon, lat), zoom: Math.max(map.getZoom(), 16) });

export const useNameOf = () => {
  const devices = useSelector((state) => state.devices.items);
  return useCallback(
    (id) => {
      if (id === MANAGER) return 'Leder';
      if (id === ALL) return 'Alle biler';
      return devices[id]?.name ?? `Bil ${id}`;
    },
    [devices],
  );
};

// The pins of the viewer's messages (plan U9). Labels on the main map only (R34).
const MessagePins = ({ pins, onRemove, labels, draft }) => {
  const nameOf = useNameOf();
  const [selectedId, setSelectedId] = useState(null);
  const selected = pins.find((pin) => pin.id === selectedId);

  const markers = useMemo(
    () =>
      pins.map((pin) => ({
        id: pin.id,
        latitude: pin.lat,
        longitude: pin.lon,
        image: 'default-info',
        title: labels ? pinLabel(pin.van === ALL ? 'Alle' : nameOf(pin.van), pin.address) : '',
      })),
    [pins, labels, nameOf],
  );

  const onClick = useCallback((properties) => setSelectedId(properties.id), []);

  const draftMarkers = useMemo(
    () =>
      draft
        ? [
            {
              id: 0,
              latitude: draft.lat,
              longitude: draft.lon,
              image: 'default-error',
              title: 'Ny adresse',
            },
          ]
        : [],
    [draft],
  );

  return (
    <>
      <MapMarkers markers={markers} showTitles={labels} onClick={onClick} />
      <MapMarkers markers={draftMarkers} showTitles />
      <Dialog open={Boolean(selected)} onClose={() => setSelectedId(null)} maxWidth="xs" fullWidth>
        {selected && (
          <DialogContent>
            <Typography variant="subtitle1" sx={{ overflowWrap: 'anywhere' }}>
              {selected.address}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {`${nameOf(selected.message.from)} → ${nameOf(selected.message.to)}`}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {selected.message.text}
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
              <Button
                variant="contained"
                href={directionsLink(selected.lat, selected.lon)}
                target="_blank"
                rel="noopener"
                sx={{ minHeight: 44 }}
              >
                Kjør dit
              </Button>
              <Button
                color="error"
                sx={{ minHeight: 44 }}
                onClick={() => {
                  onRemove(selected.id);
                  setSelectedId(null);
                }}
              >
                Fjern
              </Button>
            </Box>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
};

export default MessagePins;
