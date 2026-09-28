import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';
import { Menu, MenuItem } from '@mui/material';
import { map } from '../core/MapView';
import useMapLayer from '../core/useMapLayer';
import fetchOrThrow from '../../common/util/fetchOrThrow';
import { INTAKE_URL, MARK_TARGET, ROUTE_COLORS, isVan, vanColor } from './plannedRoutes';
import { buildRouteIndex, computeCoverage, routeStatus, servicedFeatures } from './routeCoverage';
import { buildMarkReport, marksFromPositions } from './manualMarks';
import RouteLegend from './RouteLegend';

const THROTTLE_MS = 3000;
const TAP_PADDING = 12;
const noMarks = { stretches: {}, routes: {} };

export const useRouteIndex = () => {
  const [routes, setRoutes] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/routes.geojson', { signal: controller.signal })
      .then((response) => response.json())
      .then((geojson) => setRoutes({ geojson, index: buildRouteIndex(geojson) }))
      .catch(() => setRoutes(null));
    return () => controller.abort();
  }, []);
  return routes;
};

const send = async (body) => {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (MARK_TARGET === 'origin' && window.location.protocol === 'https:') {
    await fetchOrThrow(window.location.origin, { method: 'POST', headers, body });
  } else {
    // ponytail: no-cors gives no status; the websocket echo shows whether it arrived
    await fetch(INTAKE_URL, { method: 'POST', mode: 'no-cors', headers, body });
  }
};

// Marks from the virtual device's reports in the window, reloaded when it reports.
const useManualMarks = ({ from, to, now }, routes) => {
  const devices = useSelector((state) => state.devices.items);
  const markDevice = Object.values(devices).find((device) => !isVan(device));
  const latest = useSelector((state) => markDevice && state.session.positions[markDevice.id]);
  const [positions, setPositions] = useState([]);

  const load = async () => {
    if (!markDevice || from === null) {
      setPositions([]);
      return;
    }
    const query = new URLSearchParams({
      deviceId: markDevice.id,
      from: new Date(from).toISOString(),
      to: new Date(to ?? Date.parse('2100-01-01')).toISOString(),
    });
    const response = await fetch(`/api/positions?${query}`);
    if (response.ok) setPositions(await response.json());
  };

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [markDevice?.id, from, to, latest?.id]);

  const marks = useMemo(
    () =>
      routes
        ? marksFromPositions(positions, new Set(routes.index.stretches.map((s) => s.id)))
        : noMarks,
    [positions, routes],
  );

  const report = async (mark) => {
    await send(buildMarkReport({ uniqueId: markDevice.uniqueId, ...mark }));
    await load();
  };

  return {
    marks,
    report,
    enabled: Boolean(markDevice) && from !== null && (to === null || to > now),
  };
};

const MapPlannedRoutes = ({ routes, traces, trackWindow }) => {
  const devices = useSelector((state) => state.devices.items);
  const { marks, report, enabled } = useManualMarks(trackWindow, routes);

  const [result, setResult] = useState(null);
  const lastRunRef = useRef(0);
  useEffect(() => {
    if (!routes) return undefined;
    const timer = setTimeout(
      () => {
        lastRunRef.current = Date.now();
        const coverage = computeCoverage(routes.index, traces, marks);
        const stripes = servicedFeatures(routes.index, coverage, (van) => vanColor(devices[van]));
        setResult({ coverage, stripes });
      },
      Math.max(0, lastRunRef.current + THROTTLE_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [routes, traces, marks, devices]);

  const status = useMemo(
    () =>
      routes && result
        ? routeStatus(routes.index, result.coverage, trackWindow.to ?? trackWindow.now)
        : null,
    [routes, result, trackWindow],
  );

  const bandId = useMapLayer({
    layers: [
      {
        key: 'band',
        type: 'line',
        filter: ['==', '$type', 'LineString'],
        metadata: { 'traccar:title': 'Planlagte ruter' },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'route'],
            ...Object.entries(ROUTE_COLORS).flatMap(([route, color]) => [Number(route), color]),
            '#000000',
          ],
          'line-width': 12,
          'line-opacity': 0.3,
        },
      },
    ],
    layersDeps: [],
    data: routes?.geojson ?? null,
    dataDeps: [routes],
  });

  useMapLayer({
    layers: [
      {
        type: 'line',
        metadata: { 'traccar:title': 'Planlagte ruter' },
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'width'],
          'line-offset': ['get', 'offset'],
        },
      },
    ],
    layersDeps: [],
    data: { type: 'FeatureCollection', features: result?.stripes ?? [] },
    dataDeps: [result],
  });

  // Marking mode: a tap on a band opens a menu for that stretch or street.
  const [marking, setMarking] = useState(false);
  const [menu, setMenu] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!marking || !enabled) return undefined;
    const onClick = (event) => {
      const { x, y } = event.point;
      const hits = map.queryRenderedFeatures(
        [
          [x - TAP_PADDING, y - TAP_PADDING],
          [x + TAP_PADDING, y + TAP_PADDING],
        ],
        { layers: [`${bandId}-band`] },
      );
      const unique = [
        ...new Map(
          hits.map((f) => [`${f.properties.route}:${f.properties.id}`, f.properties]),
        ).values(),
      ];
      if (unique.length) {
        setMenu({
          left: event.originalEvent.clientX,
          top: event.originalEvent.clientY,
          lngLat: event.lngLat,
          hits: unique,
        });
      }
    };
    map.on('click', onClick);
    return () => map.off('click', onClick);
  }, [marking, enabled, bandId]);

  const run = async (mark) => {
    setPending(true);
    setError(null);
    try {
      await report(mark);
      setMenu(null);
    } catch (e) {
      setError(e.message || 'Markering feilet');
    } finally {
      setPending(false);
    }
  };

  const streetIds = (route, name) =>
    routes.index.stretches
      .filter((s) => s.route === route && s.name === name && name)
      .map((s) => s.id);

  const menuItems = (menu?.hits || []).flatMap(({ route, id, name }) => {
    const at = { lon: menu.lngLat.lng, lat: menu.lngLat.lat };
    const street = streetIds(route, name);
    const stretchOn = marks.stretches[id] !== undefined;
    const streetOn = street.length > 0 && street.every((s) => marks.stretches[s] !== undefined);
    return [
      <MenuItem
        key={`${route}-${id}`}
        disabled={pending}
        onClick={() => run({ ...at, stretches: [id], on: !stretchOn })}
      >
        {`Rute ${route}: ${stretchOn ? 'angre strekning' : 'marker strekning'}`}
      </MenuItem>,
      street.length > 1 && (
        <MenuItem
          key={`${route}-${id}-street`}
          disabled={pending}
          onClick={() => run({ ...at, stretches: street, on: !streetOn })}
        >
          {`Rute ${route}: ${streetOn ? 'angre' : 'marker'} hele ${name}`}
        </MenuItem>
      ),
    ].filter(Boolean);
  });

  const toggleRoute = (route) => {
    const sample = routes.index.samples[routes.index.routes[route]?.samples[0]];
    if (!sample) return undefined;
    return run({
      lon: sample.lon,
      lat: sample.lat,
      route: Number(route),
      on: marks.routes[route] === undefined,
    });
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

  return (
    <>
      {container &&
        status &&
        createPortal(
          <RouteLegend
            status={status}
            devices={devices}
            closedRoutes={marks.routes}
            marking={marking && enabled}
            canMark={enabled}
            pending={pending}
            error={error}
            onMarkingChange={setMarking}
            onToggleRoute={toggleRoute}
          />,
          container,
        )}
      <Menu
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { left: menu.left, top: menu.top } : undefined}
      >
        {menuItems}
      </Menu>
    </>
  );
};

export default MapPlannedRoutes;
