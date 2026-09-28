import { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { isVan, mergeTrace, trackingWindow } from './plannedRoutes';

const FAR_FUTURE = '2100-01-01T00:00:00Z';

export const toPoint = (p) => ({
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

// The day's positions per van: history of the window, then websocket positions.
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

  const load = async (deviceId, since) => {
    const store = storeRef.current;
    const query = new URLSearchParams({
      deviceId,
      from: new Date(since).toISOString(),
      to: to ? new Date(to).toISOString() : FAR_FUTURE,
    });
    try {
      const response = await fetch(`/api/positions?${query}`);
      if (response.ok && storeRef.current === store) {
        const loaded = (await response.json()).map(toPoint).filter((p) => inWindow(p.time));
        store[deviceId] = { trace: mergeTrace(store[deviceId]?.trace || [], loaded), loaded: true };
        setVersion((v) => v + 1);
      }
    } catch {
      // ignore fetch errors, the next reload fills the gap
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
        storeRef.current[deviceId] = { trace: [], loaded: false };
        load(deviceId, from);
      });
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [from, to, vanIds]);

  useEffect(() => {
    let changed = false;
    Object.values(positions).forEach((position) => {
      const entry = storeRef.current[position.deviceId];
      const point = toPoint(position);
      if (entry?.loaded && inWindow(point.time)) {
        entry.trace = mergeTrace(entry.trace, [point]);
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
        if (from !== null) load(deviceId, entry.trace.at(-1)?.time ?? from);
      });
    };
    if (socket) reload();
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [socket, from, to]);

  return useMemo(
    () =>
      Object.fromEntries(
        Object.entries(storeRef.current)
          .filter(([deviceId]) => devices[deviceId])
          .map(([deviceId, entry]) => [deviceId, entry.trace]),
      ),
    // eslint-disable-next-line @eslint-react/exhaustive-deps
    [version, devices],
  );
};
