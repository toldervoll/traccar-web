// Manual marks are OsmAnd reports from a virtual device (plan KTD12). Pure module.
import { ROUTE_COLORS } from './plannedRoutes.js';

// Reduces the virtual device's positions to the marks that are on:
// { stretches: { id: time }, routes: { route: time } }. The last report wins.
export const marksFromPositions = (positions, knownStretches) => {
  const result = { stretches: {}, routes: {} };
  [...positions]
    .sort((a, b) => a.id - b.id)
    .forEach((position) => {
      const { stretches, markRoute, on } = position.attributes || {};
      const time = Date.parse(position.fixTime);
      if (typeof on !== 'boolean') return;
      if (typeof stretches === 'string') {
        const ids = stretches.split(',');
        if (!ids.every((id) => knownStretches.has(id))) return;
        ids.forEach((id) => {
          if (on) result.stretches[id] = time;
          else delete result.stretches[id];
        });
      } else if (typeof markRoute === 'number' && ROUTE_COLORS[markRoute]) {
        if (on) result.routes[markRoute] = time;
        else delete result.routes[markRoute];
      }
    });
  return result;
};

// The report body. No time: the server stamps it on receipt.
export const buildMarkReport = ({ uniqueId, lon, lat, stretches, route, on }) => {
  const params = new URLSearchParams({ id: uniqueId, lat, lon });
  if (stretches) params.set('stretches', stretches.join(','));
  else params.set('markRoute', route);
  params.set('on', on);
  return params.toString();
};
