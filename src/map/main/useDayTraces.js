import { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { FAR_FUTURE, isVan, mergeTrace, trackingWindow } from './plannedRoutes';
import { SPARSE_WINDOW_S } from '../../driver/driverLink';

const RETRY_MS = 15000;
const GAP_RELOAD_MS = 60000;

const toPoint = (p) => ({
  id: p.id,
  lon: p.longitude,
  lat: p.latitude,
  speed: p.speed,
  time: Date.parse(p.fixTime),
});

// The current tracking window, rechecked every minute.
export const useTrackingWindow = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const { from, to } = trackingWindow(new Date(now));
  const [fromTime, toTime] = [from?.getTime() ?? null, to?.getTime() ?? null];
  return useMemo(() => ({ from: fromTime, to: toTime, now }), [fromTime, toTime, now]);
};

// The day's positions per van: history of the window, then websocket positions. Also the
// fix times of the last minutes, before thinning: a parked van's trace is two points.
export default (trackWindow) => {
  const devices = useSelector((state) => state.devices.items);
  const positions = useSelector((state) => state.session.positions);
  const socket = useSelector((state) => state.session.socket);

  const { from, to } = trackWindow;
  const storeRef = useRef({});
  const [version, setVersion] = useState(0);

  const vanIds = Object.values(devices)
    .filter(isVan)
    .map((device) => device.id)
    .join(',');

  const inWindow = (time) => from !== null && time >= from && (to === null || time <= to);

  // One load per van at a time. A failed load retries, so a van is never left without
  // its history for the evening.
  const load = async (deviceId, since) => {
    const store = storeRef.current;
    const entry = store[deviceId];
    if (entry.loading) return;
    entry.loading = true;
    const query = new URLSearchParams({
      deviceId,
      from: new Date(since).toISOString(),
      to: to ? new Date(to).toISOString() : FAR_FUTURE,
    });
    try {
      const response = await fetch(`/api/positions?${query}`);
      if (response.status === 401 || response.status === 403) return;
      if (!response.ok) throw new Error(response.statusText);
      const loaded = (await response.json()).map(toPoint).filter((p) => inWindow(p.time));
      if (storeRef.current === store) {
        entry.trace = mergeTrace(entry.trace, loaded);
        loaded.forEach((p) => entry.times.add(p.time));
        entry.syncedTo = Math.max(entry.syncedTo ?? since, loaded.at(-1)?.time ?? since);
        setVersion((v) => v + 1);
      }
    } catch {
      setTimeout(() => storeRef.current === store && load(deviceId, since), RETRY_MS);
    } finally {
      entry.loading = false;
    }
  };

  // A new window starts an empty store.
  useEffect(() => {
    storeRef.current = {};
    setVersion((v) => v + 1);
  }, [from, to]);

  useEffect(() => {
    if (from === null) return;
    vanIds
      .split(',')
      .filter(Boolean)
      .map(Number)
      .filter((deviceId) => !storeRef.current[deviceId])
      .forEach((deviceId) => {
        storeRef.current[deviceId] = { trace: [], loading: false, times: new Set() };
        load(deviceId, from);
      });
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [from, to, vanIds]);

  useEffect(() => {
    let changed = false;
    Object.values(positions).forEach((position) => {
      const entry = storeRef.current[position.deviceId];
      const point = toPoint(position);
      // The store holds every device's latest position, so most of these are not new.
      if (entry && inWindow(point.time) && entry.trace.at(-1)?.id !== point.id) {
        const previous = entry.trace.at(-1)?.time;
        entry.trace = mergeTrace(entry.trace, [point]);
        entry.times.add(point.time);
        // Only a live socket keeps the history complete; the catch-up positions fetched
        // after a disconnect leave a gap that the reconnect reload has to fill.
        // A jump of more than GAP_RELOAD_MS means the phone was offline and the server
        // pushed only its latest point, so fetch what came in between.
        if (socket && entry.syncedTo !== undefined) {
          if (previous !== undefined && point.time - previous > GAP_RELOAD_MS) {
            load(position.deviceId, entry.syncedTo);
          } else {
            entry.syncedTo = point.time;
          }
        }
        changed = true;
      }
    });
    if (changed) setVersion((v) => v + 1);
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [positions]);

  // The socket only refetches the latest positions on reconnect, so fill the gap here.
  useEffect(() => {
    const reload = () => {
      Object.entries(storeRef.current).forEach(([deviceId, entry]) => {
        if (from !== null) load(deviceId, entry.syncedTo ?? from);
      });
    };
    if (socket) reload();
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [socket, from, to]);

  return useMemo(
    () => {
      const entries = Object.entries(storeRef.current).filter(([deviceId]) => devices[deviceId]);
      const cutoff = Date.now() - SPARSE_WINDOW_S * 1000;
      entries.forEach(([, { times }]) => times.forEach((t) => t < cutoff && times.delete(t)));
      return {
        traces: Object.fromEntries(entries.map(([deviceId, entry]) => [deviceId, entry.trace])),
        fixTimes: Object.fromEntries(
          entries.map(([deviceId, entry]) => [deviceId, [...entry.times]]),
        ),
      };
    },
    // eslint-disable-next-line @eslint-react/exhaustive-deps
    [version, devices],
  );
};
