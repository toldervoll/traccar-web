// Route colors and tuning constants for the planned routes. Pure module: no app
// imports, so node --test and the route editor can import it.

export const ROUTE_COLORS = {
  1: '#e6194b',
  2: '#3cb44b',
  3: '#4363d8',
  4: '#f58231',
  5: '#911eb4',
  6: '#42d4f4',
  7: '#f032e6',
};

export const MANUAL_COLOR = '#757575';

// Start values from the April 2026 event, see the plan's Tuning Constants.
export const STOP_MAX_SPEED = 1.5; // m/s
export const STOP_SEG_MAX_M = 60;
export const STOP_MIN_S = 40;
export const STOP_MAX_S = 1200;
export const INTERSECTION_RADIUS_M = 25;
export const SIGNAL_RADIUS_M = 40;
export const TRAFFIC_MAX_S = 120;
export const SERVICE_REACH_M = 75;
export const LINK_MAX_M = 300;
export const COVER_RADIUS_M = 20;
export const SAMPLE_STEP_M = 10;
export const BASE = [10.751, 59.9535]; // lon, lat: Tåsen skole
export const BASE_RADIUS_M = 150;
export const THIN_STEP_M = 5;
export const MAX_GAP_M = 500;

export const ETA_MIN_PROGRESS = 0.2;
export const STRIPE_WIDTH = 8;
