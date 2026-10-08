import { useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Alert, Box, Paper, Typography } from '@mui/material';
import { LngLatBounds } from 'maplibre-gl';
import MapView, { map } from '../map/core/MapView';
import MapPlannedRoutes, { useRouteIndex } from '../map/main/MapPlannedRoutes';
import useDayTraces, { useTrackingWindow } from '../map/main/useDayTraces';
import MapPositionMarkers from '../map/MapPositionMarkers';
import MapScale from '../map/MapScale';
import { isVan, mainRouteOf } from '../map/main/plannedRoutes';
import DriverSetup, { TrackingStatus, useTrackingStatus } from './DriverSetup';
import { sparseVanIds } from './driverLink';
import useMessages from './useMessages';
import MessagePanel from './MessagePanel';
import MessagePins from './MessagePins';

// Fits the map to the van's main route once, or to all routes for a van with none.
const useFitRoute = (routes, route) => {
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!routes || fittedRef.current) return;
    const bounds = new LngLatBounds();
    routes.geojson.features
      .filter((f) => f.geometry.type === 'LineString')
      .filter((f) => route === null || f.properties.route === route)
      .forEach((f) => f.geometry.coordinates.forEach((c) => bounds.extend(c)));
    if (bounds.isEmpty()) return;
    map.fitBounds(bounds, { padding: 40, duration: 0 });
    fittedRef.current = true;
  }, [routes, route]);
};

const SjaforPage = () => {
  const deviceId = Number(useParams().deviceId);
  const loaded = useSelector((state) => state.devices.loaded);
  const devices = useSelector((state) => state.devices.items);
  const positions = useSelector((state) => state.session.positions);
  const device = devices[deviceId];
  const known = device && isVan(device);
  const status = useTrackingStatus(deviceId);
  const messages = useMessages(known ? String(deviceId) : null);

  const trackWindow = useTrackingWindow();
  const { traces, fixTimes } = useDayTraces(trackWindow);
  const sparse = sparseVanIds(traces, fixTimes, trackWindow).includes(deviceId);
  const routes = useRouteIndex();
  useFitRoute(known ? routes : null, mainRouteOf(device));

  const vanPositions = useMemo(
    () => Object.values(positions).filter((p) => devices[p.deviceId] && isVan(devices[p.deviceId])),
    [positions, devices],
  );

  if (!loaded) return null;
  if (!known) {
    return (
      <Typography variant="h6" sx={{ p: 2 }}>
        Ukjent bil
      </Typography>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Paper square elevation={2} sx={{ px: 2, py: 1, zIndex: 3 }}>
        <Typography variant="h6">{device.name}</Typography>
        <TrackingStatus status={status} />
        {sparse && (
          <Alert severity="warning" sx={{ mt: 0.5, py: 0 }}>
            Telefonen sender få posisjoner. Sjekk oppsettet nederst på siden, særlig steg 2 og 3.
          </Alert>
        )}
      </Paper>
      <Box sx={{ flexGrow: 1, position: 'relative' }}>
        <MapView hideSettings>
          <MapPlannedRoutes
            routes={routes}
            traces={traces}
            trackWindow={trackWindow}
            markable={false}
            highlightRoute={mainRouteOf(device)}
          />
          {messages.enabled && (
            <MessagePins
              pins={messages.pins}
              onRemove={messages.removePin}
              draft={messages.draftPin}
            />
          )}
          <MapPositionMarkers positions={vanPositions} ownDeviceId={deviceId} />
        </MapView>
        <MapScale />
        {messages.enabled && (
          <MessagePanel
            viewer={String(deviceId)}
            data={messages}
            buttonSx={{ right: 16, bottom: 40 }}
            bannerSx={{ top: 8 }}
          />
        )}
      </Box>
      <DriverSetup device={device} status={status} />
    </Box>
  );
};

export default SjaforPage;
