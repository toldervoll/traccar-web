import { useId, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { map } from '../core/MapView';
import { useAttributePreference } from '../../common/util/preferences';
import { useEffectAsync } from '../../reactHelper';

const routeColors = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#bfef45',
  '#fabed4',
  '#469990',
  '#dcbeff',
  '#9A6324',
  '#800000',
  '#aaffc3',
  '#808000',
  '#000075',
  '#a9a9a9',
  '#e6beff',
  '#ffe119',
  '#ff6961',
];

const STOP_SPEED_THRESHOLD = 1;

const findStops = (route) => {
  const stops = [];
  for (let i = 0; i < route.length; i += 1) {
    if (route[i].speed <= STOP_SPEED_THRESHOLD) {
      const prev = stops[stops.length - 1];
      if (!prev || prev[0] !== route[i].lon || prev[1] !== route[i].lat) {
        stops.push([route[i].lon, route[i].lat]);
      }
    }
  }
  return stops;
};

const MapRouteTraces = ({ deviceIds }) => {
  const id = useId();
  const stopsId = `${id}-stops`;

  const type = useAttributePreference('mapRouteTraces', 'all');

  const devices = useSelector((state) => state.devices.items);
  const selectedDeviceId = useSelector((state) => state.devices.selectedId);

  const mapLineWidth = useAttributePreference('mapLineWidth', 2);
  const mapLineOpacity = useAttributePreference('mapLineOpacity', 1);

  const routesRef = useRef({});

  useEffect(() => {
    if (type !== 'none') {
      map.addSource(id, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
      map.addLayer({
        source: id,
        id,
        type: 'line',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'width'],
          'line-opacity': ['get', 'opacity'],
        },
      });
      map.addSource(stopsId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
      map.addLayer({
        source: stopsId,
        id: stopsId,
        type: 'circle',
        paint: {
          'circle-radius': 5,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-opacity': ['get', 'opacity'],
        },
      });

      return () => {
        if (map.getLayer(stopsId)) {
          map.removeLayer(stopsId);
        }
        if (map.getSource(stopsId)) {
          map.removeSource(stopsId);
        }
        if (map.getLayer(id)) {
          map.removeLayer(id);
        }
        if (map.getSource(id)) {
          map.removeSource(id);
        }
        routesRef.current = {};
      };
    }
    return () => {};
  }, [type]);

  useEffectAsync(async () => {
    if (type === 'none') return;

    const visibleIds = deviceIds
      .filter((deviceId) => (type === 'selected' ? deviceId === selectedDeviceId : true))
      .filter((deviceId) => devices[deviceId]);

    // Start at 17:00 Europe/Oslo today, regardless of the user's local timezone.
    const now = new Date();
    const osloDateParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Oslo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const year = osloDateParts.find((p) => p.type === 'year').value;
    const month = osloDateParts.find((p) => p.type === 'month').value;
    const day = osloDateParts.find((p) => p.type === 'day').value;
    let fromDate = new Date(`${year}-${month}-${day}T17:00:00Z`);
    const osloHour = parseInt(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Oslo',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(fromDate).find((p) => p.type === 'hour').value, 10);
    fromDate = new Date(fromDate.getTime() - (osloHour - 17) * 3600000);
    const from = fromDate.toISOString();
    // No end time — use a far-future date so the API returns everything from `from` onward.
    const to = new Date('2100-01-01T00:00:00Z').toISOString();

    const newIds = visibleIds.filter((deviceId) => !routesRef.current[deviceId]);
    const results = await Promise.all(
      newIds.map(async (deviceId) => {
        try {
          const query = new URLSearchParams({ deviceId, from, to });
          const response = await fetch(`/api/positions?${query.toString()}`);
          if (response.ok) {
            const positions = await response.json();
            return [deviceId, positions.map((p) => ({ lon: p.longitude, lat: p.latitude, speed: p.speed }))];
          }
        } catch {
          // ignore fetch errors
        }
        return [deviceId, []];
      }),
    );

    results.forEach(([deviceId, coordinates]) => {
      routesRef.current[deviceId] = coordinates;
    });

    // Remove devices that are no longer visible
    Object.keys(routesRef.current).forEach((deviceId) => {
      if (!visibleIds.includes(Number(deviceId))) {
        delete routesRef.current[deviceId];
      }
    });

    updateMap();
  }, [type, deviceIds, selectedDeviceId]);

  // Update map with new positions from WebSocket
  const positions = useSelector((state) => state.session.positions);

  useEffect(() => {
    if (type === 'none') return;

    Object.values(positions).forEach((position) => {
      const route = routesRef.current[position.deviceId];
      if (route) {
        const last = route[route.length - 1];
        if (!last || last.lon !== position.longitude || last.lat !== position.latitude) {
          route.push({ lon: position.longitude, lat: position.latitude, speed: position.speed });
        }
      }
    });

    updateMap();
  }, [positions, type]);

  const updateMap = () => {
    const allDeviceIds = Object.keys(routesRef.current).map(Number);
    const lineFeatures = [];
    const stopFeatures = [];
    allDeviceIds
      .filter((deviceId) => routesRef.current[deviceId]?.length > 1)
      .forEach((deviceId) => {
        const route = routesRef.current[deviceId];
        const colorIndex = allDeviceIds.indexOf(deviceId) % routeColors.length;
        const color = devices[deviceId]?.attributes?.['web.reportColor'] || routeColors[colorIndex];
        lineFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: route.map((p) => [p.lon, p.lat]),
          },
          properties: {
            color,
            width: mapLineWidth,
            opacity: mapLineOpacity,
          },
        });
        findStops(route).forEach((coord) => {
          stopFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: coord,
            },
            properties: {
              color,
              opacity: mapLineOpacity,
            },
          });
        });
      });

    map.getSource(id)?.setData({
      type: 'FeatureCollection',
      features: lineFeatures,
    });
    map.getSource(stopsId)?.setData({
      type: 'FeatureCollection',
      features: stopFeatures,
    });
  };

  return null;
};

export default MapRouteTraces;
