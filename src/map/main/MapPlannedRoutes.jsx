import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';
import { Menu, MenuItem } from '@mui/material';
import { map } from '../core/MapView';
import useMapLayer from '../core/useMapLayer';
import { FAR_FUTURE, MANUAL_COLOR, isVan, routeColorExpression, vanColor } from './plannedRoutes';
import { buildRouteIndex, computeCoverage, routeStatus, servicedFeatures } from './routeCoverage';
import { buildMarkReport, marksFromPositions } from './manualMarks';
import RouteLegend from './RouteLegend';
import sendReport from './sendReport';

const THROTTLE_MS = 3000;
const REQUEST_TIMEOUT_MS = 10000;
const TAP_PADDING = 12;
const noMarks = { stretches: {}, routes: {} };
const PENDING_TIMEOUT_MS = 20000;

const segmentDistance = (p, a, b) => {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = dx || dy ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy) : 0;
  const k = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + k * dx), p.y - (a.y + k * dy));
};

// Screen distance from a tap to a rendered line feature.
const tapDistance = (point, feature) => {
  const { type, coordinates } = feature.geometry;
  const lines = type === 'MultiLineString' ? coordinates : [coordinates];
  return Math.min(
    ...lines.flatMap((line) =>
      line.slice(1).map((c, i) => segmentDistance(point, map.project(line[i]), map.project(c))),
    ),
  );
};

// Whether the marks show a change that was sent.
const reflected = (marks, { stretches, route, on }) =>
  stretches
    ? stretches.every((id) => (marks.stretches[id] !== undefined) === on)
    : (marks.routes[route] !== undefined) === on;

export const useRouteIndex = () => {
  const [routes, setRoutes] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    const load = async (attempt) => {
      try {
        const response = await fetch('/routes.geojson', { signal: controller.signal });
        if (!response.ok) throw new Error(response.statusText);
        const geojson = await response.json();
        setRoutes({ geojson, index: buildRouteIndex(geojson) });
      } catch {
        // A flaky mobile network must not leave the routes blank for the evening.
        if (!controller.signal.aborted)
          timer = setTimeout(() => load(attempt + 1), Math.min(30, 2 ** attempt) * 1000);
      }
    };
    load(1);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return routes;
};

// Marks from the virtual device's reports in the window, reloaded when it reports.
const useManualMarks = ({ from, to, now }, routes) => {
  const devices = useSelector((state) => state.devices.items);
  const markDevice = Object.values(devices).find((device) => !isVan(device));
  const latest = useSelector((state) => markDevice && state.session.positions[markDevice.id]);
  const [positions, setPositions] = useState([]);
  const loadRef = useRef(0);

  // Reloads can overlap (after a report and on its websocket echo); only the last one counts.
  const load = async () => {
    loadRef.current += 1;
    const current = loadRef.current;
    if (!markDevice || from === null) {
      setPositions([]);
      return;
    }
    const query = new URLSearchParams({
      deviceId: markDevice.id,
      from: new Date(from).toISOString(),
      to: to ? new Date(to).toISOString() : FAR_FUTURE,
    });
    const response = await fetch(`/api/positions?${query}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const loaded = response.ok ? await response.json() : null;
    if (loaded && current === loadRef.current) setPositions(loaded);
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
    await sendReport(buildMarkReport({ uniqueId: markDevice.uniqueId, ...mark }));
    // The mark is sent; a failed reload is caught up by the websocket echo.
    await load().catch(() => {});
  };

  return {
    marks,
    report,
    enabled: Boolean(markDevice) && from !== null && (to === null || to > now),
  };
};

const MapPlannedRoutes = ({
  routes,
  traces,
  trackWindow,
  markable = true,
  highlightRoute = null,
}) => {
  const devices = useSelector((state) => state.devices.items);
  const { marks, report, enabled: marksEnabled } = useManualMarks(trackWindow, routes);
  const enabled = marksEnabled && markable;

  const [result, setResult] = useState(null);
  const lastRunRef = useRef(0);
  useEffect(() => {
    if (!routes) return undefined;
    const timer = setTimeout(
      () => {
        lastRunRef.current = Date.now();
        const coverage = computeCoverage(routes.index, traces, marks);
        const stripes = servicedFeatures(routes.index, coverage, (van) => vanColor(devices[van]));
        setResult({ coverage, stripes, marks });
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
        type: 'line',
        filter: ['==', '$type', 'LineString'],
        metadata: { 'traccar:title': 'Planlagte ruter' },
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': routeColorExpression('#000000'),
          'line-width': 12,
          'line-opacity': 0.3,
        },
      },
    ],
    layersDeps: [],
    data: routes?.geojson ?? null,
    dataDeps: [routes],
  });

  // The highlight changes paint only, so the band keeps its place below the stripes.
  useEffect(() => {
    if (highlightRoute === null) return;
    map.setPaintProperty(bandId, 'line-opacity', [
      'case',
      ['==', ['get', 'route'], highlightRoute],
      0.6,
      0.15,
    ]);
  }, [bandId, highlightRoute]);

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
  // The change in flight: from the tap until the stripes show it.
  const [pendingMark, setPendingMark] = useState(null);
  const pending = Boolean(pendingMark);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (pendingMark && result?.marks === marks && reflected(marks, pendingMark)) {
      setPendingMark(null);
    }
  }, [pendingMark, result, marks]);

  useEffect(() => {
    if (!pendingMark) return undefined;
    const timer = setTimeout(() => {
      setPendingMark(null);
      setError('Markeringen vises ikke ennå. Sjekk kartet før du prøver igjen.');
    }, PENDING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingMark]);

  useMapLayer({
    layers: [
      {
        type: 'line',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': MANUAL_COLOR, 'line-width': 6, 'line-dasharray': [1, 1] },
      },
    ],
    layersDeps: [],
    data: {
      type: 'FeatureCollection',
      features:
        pendingMark && routes
          ? routes.geojson.features.filter(
              (f) =>
                f.geometry.type === 'LineString' &&
                (pendingMark.stretches
                  ? pendingMark.stretches.includes(f.properties.id)
                  : f.properties.route === pendingMark.route),
            )
          : [],
    },
    dataDeps: [pendingMark, routes],
  });

  useEffect(() => {
    if (!marking || !enabled) return undefined;
    const onClick = (event) => {
      const { x, y } = event.point;
      const hits = map.queryRenderedFeatures(
        [
          [x - TAP_PADDING, y - TAP_PADDING],
          [x + TAP_PADDING, y + TAP_PADDING],
        ],
        { layers: [bandId] },
      );
      // Per route, only the stretch nearest the tap: two stretches of one street
      // would give two menu entries with the same label.
      const nearest = new Map();
      hits.forEach((f) => {
        const distance = tapDistance(event.point, f);
        const best = nearest.get(f.properties.route);
        if (!best || distance < best.distance) nearest.set(f.properties.route, { distance, f });
      });
      const unique = [...nearest.values()].map(({ f }) => f.properties);
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
    setMenu(null);
    setPendingMark({ stretches: mark.stretches, route: mark.route, on: mark.on });
    setError(null);
    try {
      await report(mark);
    } catch (e) {
      setPendingMark(null);
      setError(`Markering feilet (${e.message || 'ukjent feil'}). Prøv igjen.`);
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
            defaultCollapsed={!markable}
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
