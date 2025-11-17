// src/config.js

export const TIME_BUCKET = "afternoon";

export const START_COORD = [2.1680, 41.3870]; // lon, lat
export const END_COORD   = [2.1755, 41.3890];

export const MAX_STEP_METERS = 120;       // max distance per click
export const SHADE_RADIUS_METERS = 200;   // how far shade detail is revealed

// Start map roughly on the start coord
export const MAP_CENTER = START_COORD;

// No zoom allowed: min and max are equal
export const MIN_ZOOM = 17;
export const MAX_ZOOM = 17;

// Keep bounds around the game area (Plaça Catalunya)
export const MAP_BOUNDS = [
  [2.160, 41.381], // SW
  [2.185, 41.393]  // NE
];
