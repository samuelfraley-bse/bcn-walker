// src/shadeFog.js

const fogEl = document.getElementById("fog-overlay");

export function initShadeHeatmap(map) {
  // no visible shade layer for now
}

export function updateShadeHeatmap(map, currentCoord) {
  // no-op: shade is still used for logic, but not drawn as coloured lines
}

export function updateFog(map, coord) {
  if (!fogEl || !coord) return;
  const p = map.project(coord);
  
  // Add slight random offset for organic movement
  const jitterX = (Math.random() - 0.5) * 2;
  const jitterY = (Math.random() - 0.5) * 2;
  
  fogEl.style.setProperty("--fog-x", `${p.x + jitterX}px`);
  fogEl.style.setProperty("--fog-y", `${p.y + jitterY}px`);
}