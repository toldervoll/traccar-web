import { useCallback, useMemo, useState } from 'react';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useDispatch, useSelector } from 'react-redux';
import MapView from '../map/core/MapView';
import MapSelectedDevice from '../map/main/MapSelectedDevice';
import MapAccuracy from '../map/main/MapAccuracy';
import MapGeofence from '../map/MapGeofence';
import MapCurrentLocation from '../map/MapCurrentLocation';
import PoiMap from '../map/main/PoiMap';
import MapPadding from '../map/MapPadding';
import { devicesActions } from '../store';
import MapDefaultCamera from '../map/main/MapDefaultCamera';
import MapLiveRoutes from '../map/main/MapLiveRoutes';
import MapRouteTraces from '../map/main/MapRouteTraces';
import MapPlannedRoutes, { useRouteIndex } from '../map/main/MapPlannedRoutes';
import useDayTraces, { useTrackingWindow } from '../map/main/useDayTraces';
import MapPositionMarkers from '../map/MapPositionMarkers';
import MapOverlay from '../map/overlay/MapOverlay';
import MapGeocoder from '../map/control/MapGeocoder';
import MapScale from '../map/MapScale';
import MapRuler from '../map/control/MapRuler';
import MapNotification from '../map/control/MapNotification';
import useFeatures from '../common/util/useFeatures';
import UntrackedVans from '../driver/UntrackedVans';
import { sparseVanIds } from '../driver/driverLink';
import MessagePins from '../driver/MessagePins';

const MainMap = ({ filteredPositions, selectedPosition, onEventsClick, messages }) => {
  const theme = useTheme();
  const dispatch = useDispatch();

  const desktop = useMediaQuery(theme.breakpoints.up('md'));

  const eventsAvailable = useSelector((state) => !!state.events.items.length);

  const features = useFeatures();

  const [rulerActive, setRulerActive] = useState(false);

  const trackWindow = useTrackingWindow();
  const { traces, fixTimes } = useDayTraces(trackWindow);
  const sparseDeviceIds = useMemo(
    () => sparseVanIds(traces, fixTimes, trackWindow),
    [traces, fixTimes, trackWindow],
  );
  const routes = useRouteIndex();

  const onMarkerClick = useCallback(
    (_, deviceId) => {
      dispatch(devicesActions.selectId(deviceId));
    },
    [dispatch],
  );

  return (
    <>
      <MapView>
        <MapOverlay />
        <MapGeofence />
        <MapAccuracy positions={filteredPositions} />
        <MapPlannedRoutes routes={routes} traces={traces} trackWindow={trackWindow} />
        <UntrackedVans />
        <MapLiveRoutes deviceIds={filteredPositions.map((p) => p.deviceId)} />
        <MapRouteTraces traces={traces} routeIndex={routes?.index} />
        <PoiMap />
        {messages && (
          <MessagePins
            pins={messages.pins}
            onRemove={messages.removePin}
            draft={messages.draftPin}
            labels
          />
        )}
        <MapPositionMarkers
          positions={filteredPositions}
          onMarkerClick={onMarkerClick}
          selectedPosition={selectedPosition}
          showStatus
          sparseDeviceIds={sparseDeviceIds}
          disabled={rulerActive}
        />
        <MapDefaultCamera filteredPositions={filteredPositions} />
        <MapSelectedDevice />
        <MapRuler positions={filteredPositions} onActiveChange={setRulerActive} />
        {!features.disableEvents && (
          <MapNotification enabled={eventsAvailable} onClick={onEventsClick} />
        )}
      </MapView>
      <MapScale />
      <MapCurrentLocation />
      <MapGeocoder />
      {desktop && (
        <MapPadding
          start={
            parseInt(theme.dimensions.drawerWidthDesktop, 10) + parseInt(theme.spacing(1.5), 10)
          }
        />
      )}
    </>
  );
};

export default MainMap;
