import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { isVan } from '../map/main/plannedRoutes';
import sendReport from '../map/main/sendReport';
import {
  buildMessageReport,
  messageWindow,
  messagesFromPositions,
  pinsFor,
  retryDelay,
  unreadCount,
  visibleTo,
} from './messages';

const REQUEST_TIMEOUT_MS = 10000;
const RELOAD_AFTER_SEND_MS = 4000;

const lastReadKey = (viewer) => `messagesLastRead:${viewer}`;

const removedKey = (viewer) => `messagePinsRemoved:${viewer}`;

const readRemoved = (viewer) => {
  try {
    const value = JSON.parse(window.localStorage.getItem(removedKey(viewer)));
    return Array.isArray(value) ? value.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
};

const readLastRead = (viewer) => {
  try {
    const value = Number(window.localStorage.getItem(lastReadKey(viewer)));
    return value > 0 ? value : null;
  } catch {
    return null;
  }
};

// The messages of `viewer` (a van's device id as a string, or MANAGER), from the
// virtual device's reports in the event day (plan U6). `viewer` null turns it off.
const useMessages = (viewer) => {
  const devices = useSelector((state) => state.devices.items);
  const markDevice = viewer ? Object.values(devices).find((device) => !isVan(device)) : null;
  const latest = useSelector((state) => markDevice && state.session.positions[markDevice.id]);
  const socket = useSelector((state) => state.session.socket);

  // The window is recomputed when it ends, so an open page clears (plan KTD9).
  const [tick, setTick] = useState(0);
  const win = useMemo(() => {
    const { from, to } = messageWindow();
    return { from: from.getTime(), to: to.getTime(), active: to.getTime() > Date.now() };
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [tick]);
  useEffect(() => {
    if (!win.active) return undefined;
    // setTimeout fires at once past about 24 days; a far `to` then just re-arms.
    const delay = Math.min(win.to - Date.now() + 500, 2 ** 31 - 1);
    const timer = setTimeout(() => setTick((t) => t + 1), delay);
    return () => clearTimeout(timer);
  }, [win]);

  // Tagged with their device and window, so a failed load after 04:00 shows nothing old.
  const [loadedPositions, setLoadedPositions] = useState({ key: null, list: [] });
  const [error, setError] = useState(false);

  const paramsRef = useRef();
  paramsRef.current = { deviceId: markDevice?.id, from: win.from, to: win.to, active: win.active };
  const runRef = useRef({ running: false, queued: false, attempt: 0, timer: null, dead: false });

  // At most one load runs and one waits; a failed load retries (plan KTD8).
  const load = useCallback(() => {
    const run = runRef.current;
    if (run.dead) return;
    if (run.running) {
      run.queued = true;
      return;
    }
    const { deviceId, from, to, active } = paramsRef.current;
    if (!deviceId || !active) {
      setLoadedPositions({ key: null, list: [] });
      return;
    }
    clearTimeout(run.timer);
    run.running = true;
    const key = `${deviceId}:${from}:${to}`;
    const query = new URLSearchParams({
      deviceId,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
    fetch(`/api/positions?${query}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      .then((response) => {
        if (!response.ok) throw new Error(response.statusText);
        return response.json();
      })
      .then((loaded) => {
        const current = paramsRef.current;
        if (!run.dead && key === `${current.deviceId}:${current.from}:${current.to}`) {
          setLoadedPositions({ key, list: loaded });
          setError(false);
        }
        run.attempt = 0;
      })
      .catch(() => {
        if (run.dead) return;
        run.attempt += 1;
        const delay = retryDelay(run.attempt);
        if (delay === null) {
          run.attempt = 0;
          setError(true);
        } else {
          run.timer = setTimeout(load, delay * 1000);
        }
      })
      .finally(() => {
        run.running = false;
        if (run.queued) {
          run.queued = false;
          load();
        }
      });
  }, []);

  useEffect(() => {
    const run = runRef.current;
    run.dead = false;
    return () => {
      run.dead = true;
      clearTimeout(run.timer);
    };
  }, []);

  useEffect(load, [load, markDevice?.id, win, latest?.id]);

  useEffect(() => {
    if (socket) load();
  }, [load, socket]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const vanIds = useMemo(
    () =>
      Object.values(devices)
        .filter(isVan)
        .sort((a, b) => a.name.localeCompare(b.name, 'nb', { numeric: true }))
        .map((device) => String(device.id)),
    [devices],
  );

  const currentKey = `${markDevice?.id}:${win.from}:${win.to}`;
  const all = useMemo(
    () =>
      win.active && loadedPositions.key === currentKey
        ? messagesFromPositions(loadedPositions.list, new Set(vanIds))
        : [],
    [loadedPositions, currentKey, vanIds, win],
  );
  const messages = useMemo(() => (viewer ? visibleTo(all, viewer) : []), [all, viewer]);

  // Keyed by viewer: the driver page learns its viewer after the devices load.
  const [lastReadBy, setLastReadBy] = useState({});
  const lastRead = viewer in lastReadBy ? lastReadBy[viewer] : readLastRead(viewer);
  const unread = viewer ? unreadCount(all, viewer, lastRead) : 0;

  const markRead = useCallback(() => {
    const id = messages.at(-1)?.id;
    if (!id || id === lastRead) return;
    setLastReadBy({ [viewer]: id });
    try {
      window.localStorage.setItem(lastReadKey(viewer), String(id));
    } catch {
      // unread counts then reset on reload
    }
  }, [messages, lastRead, viewer]);

  // Removed pins are per browser; the message stays in the list (R33).
  const [removedBy, setRemovedBy] = useState({});
  const stored = useMemo(() => readRemoved(viewer), [viewer]);
  const removed = viewer in removedBy ? removedBy[viewer] : stored;
  // The address picked in the draft, shown on the map before the send.
  const [draftPin, setDraftPin] = useState(null);
  const pins = useMemo(() => (viewer ? pinsFor(all, viewer, removed) : []), [all, viewer, removed]);
  const removePin = (id) => {
    // Re-read storage: another tab may have removed pins since this one loaded.
    const next = [...new Set([...readRemoved(viewer), ...removed, id])];
    setRemovedBy({ [viewer]: next });
    try {
      window.localStorage.setItem(removedKey(viewer), JSON.stringify(next));
    } catch {
      // the pin then comes back on reload
    }
  };

  const send = async ({ to, text, re, pin }) => {
    await sendReport(
      buildMessageReport({ uniqueId: markDevice.uniqueId, from: viewer, to, text, re, pin }),
    );
    // The server holds a report about 3 s; the second load does not rely on the websocket.
    load();
    setTimeout(load, RELOAD_AFTER_SEND_MS);
  };

  return {
    enabled: Boolean(markDevice),
    all,
    messages,
    vanIds,
    unread,
    lastRead,
    error,
    reload: load,
    send,
    markRead,
    pins,
    removePin,
    draftPin,
    setDraftPin,
  };
};

export default useMessages;
