import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import useMapLayer from '../core/useMapLayer';
import { useAttributePreference } from '../../common/util/preferences';
import { vanColor } from './plannedRoutes';
import { buildRouteIndex, detectStops } from './routeCoverage';

const noRoutes = buildRouteIndex({ features: [] });

// The day's van traces and pickup stops, from the day-trace store.
const MapRouteTraces = ({ deviceIds, traces, routeIndex }) => {
  const type = useAttributePreference('mapRouteTraces', 'all');
  const devices = useSelector((state) => state.devices.items);
  const selectedDeviceId = useSelector((state) => state.devices.selectedId);
  const mapLineWidth = useAttributePreference('mapLineWidth', 2);
  const mapLineOpacity = useAttributePreference('mapLineOpacity', 1);

  const [lines, stops] = useMemo(() => {
    const visible = Object.entries(traces).filter(
      ([deviceId, trace]) =>
        type !== 'none' &&
        trace.length > 1 &&
        deviceIds.includes(Number(deviceId)) &&
        (type !== 'selected' || Number(deviceId) === selectedDeviceId),
    );
    const properties = (deviceId) => ({
      color: vanColor(devices[deviceId]),
      width: mapLineWidth,
      opacity: mapLineOpacity,
    });
    return [
      visible.map(([deviceId, trace]) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: trace.map((p) => [p.lon, p.lat]) },
        properties: properties(deviceId),
      })),
      visible.flatMap(([deviceId, trace]) =>
        detectStops(trace, routeIndex || noRoutes).map((stop) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
          properties: properties(deviceId),
        })),
      ),
    ];
  }, [
    traces,
    deviceIds,
    type,
    selectedDeviceId,
    devices,
    mapLineWidth,
    mapLineOpacity,
    routeIndex,
  ]);

  useMapLayer({
    layers: [
      {
        type: 'line',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'width'],
          'line-opacity': ['get', 'opacity'],
        },
      },
    ],
    layersDeps: [],
    data: { type: 'FeatureCollection', features: lines },
    dataDeps: [lines],
  });

  useMapLayer({
    layers: [
      {
        type: 'circle',
        paint: {
          'circle-radius': 5,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-opacity': ['get', 'opacity'],
        },
      },
    ],
    layersDeps: [],
    data: { type: 'FeatureCollection', features: stops },
    dataDeps: [stops],
  });

  return null;
};

export default MapRouteTraces;
