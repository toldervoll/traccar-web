import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import useMapLayer from '../core/useMapLayer';
import { useAttributePreference } from '../../common/util/preferences';
import { MAX_GAP_M, vanColor } from './plannedRoutes';
import { buildRouteIndex, detectStops } from './routeCoverage';

const noRoutes = buildRouteIndex({ features: [] });

const meters = (a, b) =>
  Math.hypot((a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180), a.lat - b.lat) * 111320;

// A trace split where the phone jumped more than MAX_GAP_M, so gaps show as gaps.
const traceParts = (trace) => {
  const parts = [[]];
  trace.forEach((p, i) => {
    if (i > 0 && meters(trace[i - 1], p) > MAX_GAP_M) parts.push([]);
    parts[parts.length - 1].push([p.lon, p.lat]);
  });
  return parts.filter((part) => part.length > 1);
};

// The day's van traces and pickup stops, from the day-trace store.
// All vans with a trace show, also when their latest position is missing or filtered out.
const MapRouteTraces = ({ traces, routeIndex }) => {
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
        geometry: { type: 'MultiLineString', coordinates: traceParts(trace) },
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
  }, [traces, type, selectedDeviceId, devices, mapLineWidth, mapLineOpacity, routeIndex]);

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
