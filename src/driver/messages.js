// Messages between the manager and the drivers: OsmAnd reports from the manual-marks
// virtual device (plan KTD6-KTD11). Pure module: node --test imports it.
import { BASE } from '../map/main/plannedRoutes.js';
import { eventDayWindow } from './driverLink.js';

export const MANAGER = 'leder';
export const ALL = 'alle';
export const MSG_MAX_LENGTH = 500;
// Keeps a text such as "10" or "true" a string on the server.
export const MSG_PREFIX = 't:';
export const MSG_LOAD_RETRIES = 5;
export const MSG_LOAD_RETRY_S = 2;
export const MSG_ADDR_MAX_LENGTH = 100;

export const messageWindow = eventDayWindow;

export const messageError = (text) => {
  if (!text.trim()) return 'Skriv en melding';
  if (text.length > MSG_MAX_LENGTH) return `Meldingen er lengre enn ${MSG_MAX_LENGTH} tegn`;
  return null;
};

// The report body: coordinates of BASE and no time, so the server stamps it on receipt.
export const buildMessageReport = ({ uniqueId, from, to, text, re, pin }) => {
  const error = messageError(text);
  if (error) throw new Error(error);
  const params = new URLSearchParams({
    id: uniqueId,
    lat: BASE[1],
    lon: BASE[0],
    msgFrom: from,
    msgTo: to,
    msgText: `${MSG_PREFIX}${text}`,
  });
  if (re !== undefined) params.set('msgRe', re);
  if (pin) {
    params.set('msgLat', pin.lat);
    params.set('msgLon', pin.lon);
    params.set('msgAddr', `${MSG_PREFIX}${pin.address}`);
  }
  return params.toString();
};

const party = (value) =>
  typeof value === 'number' || typeof value === 'string' ? String(value) : null;

const unprefix = (value, maxLength) =>
  typeof value === 'string' &&
  value.startsWith(MSG_PREFIX) &&
  value.length - MSG_PREFIX.length <= maxLength
    ? value.slice(MSG_PREFIX.length)
    : null;

const inRange = (value, limit) => typeof value === 'number' && Math.abs(value) <= limit;

// A pin only with valid coordinates and address; a bad pin leaves the message (KTD19).
const pinOf = ({ msgLat, msgLon, msgAddr }) => {
  const address = unprefix(msgAddr, MSG_ADDR_MAX_LENGTH);
  return inRange(msgLat, 90) && inRange(msgLon, 180) && address !== null
    ? { lat: msgLat, lon: msgLon, address }
    : null;
};

// The messages in the positions, by position id. A bad report is ignored.
export const messagesFromPositions = (positions, vanIds) =>
  positions
    .map((position) => {
      const attributes = position?.attributes || {};
      const { msgFrom, msgTo, msgText, msgRe } = attributes;
      const from = party(msgFrom);
      const to = party(msgTo);
      const text = unprefix(msgText, MSG_MAX_LENGTH);
      if (text === null || !(from === MANAGER || vanIds.has(from))) return null;
      if (!(to === MANAGER || to === ALL || vanIds.has(to))) return null;
      return {
        id: position.id,
        time: Date.parse(position.fixTime),
        from,
        to,
        text,
        re: typeof msgRe === 'number' ? msgRe : null,
        pin: pinOf(attributes),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id - b.id);

// The manager sees all. A van sees what goes to it or to all, and what it sent.
export const visibleTo = (messages, viewer) =>
  viewer === MANAGER
    ? messages
    : messages.filter((m) => m.to === viewer || m.to === ALL || m.from === viewer);

// For a message from the manager: the vans that answered OK and those that have not.
export const okAnswers = (messages, message, vanIds) => {
  if (message.from !== MANAGER) return null;
  const expected = message.to === ALL ? vanIds : vanIds.filter((id) => id === message.to);
  const answered = new Set(
    messages.filter((m) => m.re === message.id && m.text === 'OK').map((m) => m.from),
  );
  return {
    ok: expected.filter((id) => answered.has(id)),
    missing: expected.filter((id) => !answered.has(id)),
  };
};

export const unreadCount = (messages, viewer, lastRead) =>
  visibleTo(messages, viewer).filter(
    (m) => m.from !== viewer && (lastRead === null || m.id > lastRead),
  ).length;

// Seconds before retry number `attempt` of a failed load, or null when used up.
export const retryDelay = (attempt) =>
  attempt <= MSG_LOAD_RETRIES ? MSG_LOAD_RETRY_S * 2 ** (attempt - 1) : null;

// The pins that `viewer` sees, without the removed message ids (plan KTD20). The van of
// a pin is the recipient of a message from the manager, else the sender.
export const pinsFor = (messages, viewer, removed) =>
  visibleTo(messages, viewer)
    .filter((m) => m.pin && !removed.includes(m.id))
    .map((m) => ({ id: m.id, ...m.pin, message: m, van: m.from === MANAGER ? m.to : m.from }));

// "Bil 3 → Tåsenveien 10A": the street address without postal code and place (R34).
export const pinLabel = (vanName, address) => `${vanName} → ${address.split(',')[0]}`;
