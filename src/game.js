// src/game.js

import {
  TIME_BUCKET,
  START_COORD,
  END_COORD,
  MAX_STEP_METERS
} from "./config.js";

import {
  nodes,
  edges,
  dijkstra,
  nearestNodeId,
  totalLength,
  shadeScoreForRoute,
  edgesToLineFeature
} from "./graph.js";

import {
  initShadeHeatmap,
  updateShadeHeatmap,
  updateFog
} from "./shadeFog.js";

// DOM elements
const optDistEl = document.getElementById("opt-dist");
const optShadeEl = document.getElementById("opt-shade");
const playerDistEl = document.getElementById("player-dist");
const playerShadeEl = document.getElementById("player-shade");
const statusLabel = document.getElementById("status-label");
const resetBtn = document.getElementById("reset-btn");
const playerEffEl = document.getElementById("player-efficiency");
const scenicScoreEl = document.getElementById("scenic-score");
const backroadsScoreEl = document.getElementById("backroads-score");
const natureScoreEl = document.getElementById("nature-score");
const streetViewEl = document.getElementById("street-view");

// game state
let startNodeId = null;
let endNodeId = null;
let startCoordSnap = null;
let endCoordSnap = null;

let startMarker = null;
let endMarker = null;
let playerMarker = null;

let arrowMarker = null;
let arrowEl = null;

let playerCoords = [];
let playerCurrentCoord = null;

let coolestLen = 0;
let coolestShade = 0;

let shortestLen = 0;

let shadePopup = null;

let streetViewPanorama = null;

let gameMap = null;

// Traffic animation
let trafficAnimationFrame = null;
let trafficPhase = 0;

// Camera drift
let driftAnimationFrame = null;
let driftTime = 0;

// Breathing/pulsing animation
let breatheAnimationFrame = null;
let breathePhase = 0;

function createPlayerMarkerElement() {
  const outer = document.createElement("div");
  outer.className = "player-marker";
  
  // Multiple pulse rings for more life
  for (let i = 0; i < 3; i++) {
    const pulse = document.createElement("div");
    pulse.className = "player-marker-pulse";
    pulse.style.animationDelay = `${i * 0.6}s`;
    outer.appendChild(pulse);
  }
  
  const inner = document.createElement("div");
  inner.className = "player-marker-inner";
  outer.appendChild(inner);
  
  return outer;
}

function createArrowMarker(map, coord) {
  arrowEl = document.createElement("div");
  arrowEl.innerHTML = `
    <svg width="60" height="60" viewBox="0 0 60 60" style="filter: drop-shadow(0 4px 12px rgba(33,150,243,0.9));">
      <defs>
        <linearGradient id="arrowGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#64b5f6;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#2196f3;stop-opacity:1" />
        </linearGradient>
      </defs>
      <path d="M 30 5 L 50 45 L 30 35 L 10 45 Z" fill="url(#arrowGradient)" stroke="#fff" stroke-width="2"/>
      <circle cx="30" cy="30" r="3" fill="#fff" opacity="0.8"/>
    </svg>
  `;
  arrowEl.style.transformOrigin = "50% 50%";
  arrowEl.style.pointerEvents = "none";
  arrowEl.style.transition = "transform 0.4s ease-out";
  arrowEl.className = "arrow-pulse";

  arrowMarker = new maplibregl.Marker({
    element: arrowEl,
    anchor: "center"
  })
    .setLngLat(coord)
    .addTo(map);
}

function updateArrow(coord) {
  if (!arrowMarker || !arrowEl) return;
  arrowMarker.setLngLat(coord);
  const bearing = turf.bearing(coord, endCoordSnap);
  arrowEl.style.transform = `rotate(${bearing}deg)`;
}

function updatePlayerRouteLine(map) {
  const feature =
    playerCoords.length >= 2
      ? {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: playerCoords
          }
        }
      : null;

  const fc = {
    type: "FeatureCollection",
    features: feature ? [feature] : []
  };

  const src = map.getSource("player-route");
  if (src) {
    src.setData(fc);
  } else {
    map.addSource("player-route", { type: "geojson", data: fc });
    map.addLayer({
      id: "player-route-glow",
      type: "line",
      source: "player-route",
      paint: {
        "line-color": "#ffcc00",
        "line-width": 12,
        "line-opacity": 0.3,
        "line-blur": 4
      }
    });
    map.addLayer({
      id: "player-route-layer",
      type: "line",
      source: "player-route",
      paint: {
        "line-color": "#ffcc00",
        "line-width": 6,
        "line-opacity": 0.95
      }
    });
  }
}

function shadeAtPoint(coord) {
  const pt = turf.point(coord);
  const radiusMeters = 60;
  const candidates = [];

  edges.forEach(e => {
    const line = turf.lineString(e.geometry);
    const dKm = turf.pointToLineDistance(pt, line, { units: "kilometers" });
    const dM = dKm * 1000;
    if (dM <= radiusMeters) {
      const shadeVal = e.shade[TIME_BUCKET];
      const weight = radiusMeters - dM;
      candidates.push({ shade: shadeVal, weight });
    }
  });

  if (candidates.length === 0) {
    return null;
  }

  let wSum = 0;
  let sSum = 0;
  candidates.forEach(c => {
    sSum += c.shade * c.weight;
    wSum += c.weight;
  });

  return sSum / wSum;
}

function computePlayerRouteMetrics() {
  if (playerCoords.length < 2) {
    return { distance: 0, shade: null, scenic: null, backroads: null, nature: null };
  }

  let totalDistM = 0;
  let totalWeightedShade = 0;
  let totalWeightedScenic = 0;
  let totalWeightedBackroads = 0;
  let totalWeightedNature = 0;

  for (let i = 0; i < playerCoords.length - 1; i++) {
    const a = playerCoords[i];
    const b = playerCoords[i + 1];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

    const dKm = turf.distance(a, b, { units: "kilometers" });
    const dM = dKm * 1000;

    const s = shadeAtPoint(mid);
    const shadeVal = s === null ? 0.5 : s;

    const scenicVal = Math.random() * 0.3 + 0.4;
    const backroadsVal = Math.random() * 0.4 + 0.3;
    const natureVal = Math.random() * 0.3 + 0.2;

    totalDistM += dM;
    totalWeightedShade += shadeVal * dM;
    totalWeightedScenic += scenicVal * dM;
    totalWeightedBackroads += backroadsVal * dM;
    totalWeightedNature += natureVal * dM;
  }

  const avgShade = totalDistM > 0 ? totalWeightedShade / totalDistM : null;
  const avgScenic = totalDistM > 0 ? totalWeightedScenic / totalDistM : null;
  const avgBackroads = totalDistM > 0 ? totalWeightedBackroads / totalDistM : null;
  const avgNature = totalDistM > 0 ? totalWeightedNature / totalDistM : null;

  return { 
    distance: totalDistM, 
    shade: avgShade,
    scenic: avgScenic,
    backroads: avgBackroads,
    nature: avgNature
  };
}

function updatePlayerMetrics() {
  const { distance, shade, scenic, backroads, nature } = computePlayerRouteMetrics();

  if (playerCoords.length < 2) {
    playerDistEl.textContent = "—";
    playerShadeEl.textContent = "—";
    if (playerEffEl) playerEffEl.textContent = "—";
    if (scenicScoreEl) scenicScoreEl.textContent = "—";
    if (backroadsScoreEl) backroadsScoreEl.textContent = "—";
    if (natureScoreEl) natureScoreEl.textContent = "—";
    return;
  }

  playerDistEl.textContent = distance.toFixed(1);
  playerShadeEl.textContent = shade !== null ? shade.toFixed(2) : "—";

  if (playerEffEl) {
    if (shortestLen > 0 && distance > 0) {
      const eff = shortestLen / distance;
      const effPct = eff * 100;
      playerEffEl.textContent = effPct.toFixed(1) + "%";
    } else {
      playerEffEl.textContent = "—";
    }
  }

  if (scenicScoreEl) {
    scenicScoreEl.textContent = scenic !== null ? scenic.toFixed(2) : "—";
  }
  if (backroadsScoreEl) {
    backroadsScoreEl.textContent = backroads !== null ? backroads.toFixed(2) : "—";
  }
  if (natureScoreEl) {
    natureScoreEl.textContent = nature !== null ? nature.toFixed(2) : "—";
  }
}

function updateShadePopup(map, coord) {
  const s = shadeAtPoint(coord);
  if (s === null) {
    if (shadePopup) shadePopup.remove();
    shadePopup = null;
    return;
  }

  let label = "Warm spot";
  let bg = "#ff9800";
  let emoji = "☀️";
  if (s >= 0.7) {
    label = "Cool shade";
    bg = "#2e7d32";
    emoji = "🌳";
  } else if (s <= 0.4) {
    label = "Hot zone";
    bg = "#d32f2f";
    emoji = "🔥";
  }

  const html = `
    <div style="
      padding: 12px 18px;
      border-radius: 12px;
      background: ${bg};
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      box-shadow: 0 4px 16px rgba(0,0,0,0.8);
      text-align: center;
      min-width: 150px;
      animation: popIn 0.3s ease-out;
    ">
      <div style="font-size: 24px; margin-bottom: 4px;">${emoji}</div>
      ${label}<br/>
      <span style="font-weight:400;font-size:14px; opacity: 0.95;">
        Shade score: ${s.toFixed(2)}
      </span>
    </div>
  `;

  if (!shadePopup) {
    shadePopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 32
    })
      .setLngLat(coord)
      .setHTML(html)
      .addTo(map);
  } else {
    shadePopup.setLngLat(coord).setHTML(html);
  }
}

function initStreetView() {
  if (typeof google !== 'undefined' && google.maps && google.maps.StreetViewPanorama && streetViewEl) {
    try {
      streetViewPanorama = new google.maps.StreetViewPanorama(streetViewEl, {
        position: { lat: startCoordSnap[1], lng: startCoordSnap[0] },
        pov: { heading: 0, pitch: 0 },
        zoom: 1,
        addressControl: false,
        linksControl: true,
        panControl: true,
        enableCloseButton: false,
        fullscreenControl: false,
        clickToGo: true
      });

      // Listen for Street View position changes
      streetViewPanorama.addListener('position_changed', () => {
        const pos = streetViewPanorama.getPosition();
        if (pos && playerCurrentCoord) {
          const newCoord = [pos.lng(), pos.lat()];
          const stepDistKm = turf.distance(playerCurrentCoord, newCoord, { units: "kilometers" });
          const stepDistM = stepDistKm * 1000;
          
          // Only accept reasonable moves
          if (stepDistM <= MAX_STEP_METERS && stepDistM > 1) {
            handleMove(newCoord);
          }
        }
      });

    } catch (e) {
      console.warn('Street View not available:', e);
      if (streetViewEl) {
        streetViewEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;text-align:center;padding:20px;background:#1a1a1a;">Street View unavailable<br/><small style="display:block;margin-top:8px;opacity:0.7;">Google Maps API key needed</small></div>';
      }
    }
  } else if (streetViewEl) {
    streetViewEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;text-align:center;padding:20px;background:#1a1a1a;">Street View unavailable<br/><small style="display:block;margin-top:8px;opacity:0.7;">Google Maps API key needed</small></div>';
  }
}

function updateStreetView(coord, nextCoord) {
  if (!streetViewPanorama) return;
  
  const bearing = nextCoord ? turf.bearing(coord, nextCoord) : 0;
  
  // Temporarily remove listener to avoid recursive updates
  google.maps.event.clearListeners(streetViewPanorama, 'position_changed');
  
  streetViewPanorama.setPosition({ lat: coord[1], lng: coord[0] });
  streetViewPanorama.setPov({
    heading: bearing,
    pitch: 0
  });

  // Re-add listener after a brief delay
  setTimeout(() => {
    streetViewPanorama.addListener('position_changed', () => {
      const pos = streetViewPanorama.getPosition();
      if (pos && playerCurrentCoord) {
        const newCoord = [pos.lng(), pos.lat()];
        const stepDistKm = turf.distance(playerCurrentCoord, newCoord, { units: "kilometers" });
        const stepDistM = stepDistKm * 1000;
        
        if (stepDistM <= MAX_STEP_METERS && stepDistM > 1) {
          handleMove(newCoord);
        }
      }
    });
  }, 500);
}

// Centralized move handler
function handleMove(destCoord) {
  const currentCoord = playerCurrentCoord;
  
  const stepDistKm = turf.distance(currentCoord, destCoord, { units: "kilometers" });
  const stepDistM = stepDistKm * 1000;
  
  if (stepDistM > MAX_STEP_METERS) {
    statusLabel.textContent = "⚠️ Too far away – move closer to your position.";
    statusLabel.style.background = "rgba(255,87,34,0.4)";
    setTimeout(() => {
      statusLabel.style.background = "rgba(255,255,255,0.25)";
    }, 1200);
    return;
  }

  playerCoords.push(destCoord);
  playerCurrentCoord = destCoord;

  driftTime = 0;

  gameMap.jumpTo({
    center: destCoord
  });

  playerMarker.setLngLat(destCoord);
  updatePlayerRouteLine(gameMap);
  updatePlayerMetrics();
  updateShadeHeatmap(gameMap, destCoord);
  updateArrow(destCoord);
  updateFog(gameMap, destCoord);
  updateShadePopup(gameMap, destCoord);
  updateStreetView(destCoord, endCoordSnap);

  const goalDistKm = turf.distance(destCoord, endCoordSnap, { units: "kilometers" });
  const goalDistM = goalDistKm * 1000;

  if (goalDistM <= 25) {
    const { distance, shade, scenic, backroads, nature } = computePlayerRouteMetrics();
    const eff = (shortestLen > 0 && distance > 0)
      ? (shortestLen / distance) * 100
      : null;

    statusLabel.textContent =
      `🎉 Goal reached! Distance ${distance.toFixed(1)}m, ` +
      `shade ${shade !== null ? shade.toFixed(2) : "—"}. ` +
      (eff !== null ? `Efficiency: ${eff.toFixed(1)}%. ` : ``) +
      `AI: ${coolestLen.toFixed(1)}m, shade ${coolestShade.toFixed(2)}.`;
    statusLabel.style.background = "rgba(76,175,80,0.5)";
  } else {
    const distRemaining = goalDistM.toFixed(0);
    statusLabel.textContent = `🚶 Nice step! ${distRemaining}m to go – follow the arrow.`;
    statusLabel.style.background = "rgba(255,255,255,0.25)";
  }
}

// Gentle camera drift for organic feel
function startCameraDrift(map) {
  function drift() {
    if (!playerCurrentCoord) return;
    
    driftTime += 0.008;
    
    // More pronounced figure-8 pattern
    const driftX = Math.sin(driftTime * 0.6) * 0.00004;
    const driftY = Math.cos(driftTime * 0.4) * 0.00003;
    
    const driftedCenter = [
      playerCurrentCoord[0] + driftX,
      playerCurrentCoord[1] + driftY
    ];
    
    map.setCenter(driftedCenter);
    
    driftAnimationFrame = requestAnimationFrame(drift);
  }
  
  drift();
}

// Breathing zoom animation - more subtle
function startBreatheAnimation(map) {
  const baseZoom = 18.5;
  
  function breathe() {
    breathePhase += 0.01;
    
    // Slower, more subtle zoom pulse
    const zoomOffset = Math.sin(breathePhase) * 0.08;
    map.setZoom(baseZoom + zoomOffset);
    
    breatheAnimationFrame = requestAnimationFrame(breathe);
  }
  
  breathe();
}

// Initialize traffic animation with more life
function initTrafficLayer(map) {
  const trafficFeatures = edges.map(e => {
    const roadSize = e.length_m > 100 ? 'major' : e.length_m > 50 ? 'medium' : 'minor';
    
    return {
      type: "Feature",
      properties: {
        roadSize: roadSize,
        length: e.length_m,
        flowSpeed: Math.random() * 0.5 + 0.5 // varying speeds
      },
      geometry: {
        type: "LineString",
        coordinates: e.geometry
      }
    };
  });

  const trafficFC = {
    type: "FeatureCollection",
    features: trafficFeatures
  };

  map.addSource("traffic-flow", {
    type: "geojson",
    data: trafficFC
  });

  // Glowing traffic layer underneath
  map.addLayer({
    id: "traffic-glow",
    type: "line",
    source: "traffic-flow",
    paint: {
      "line-color": [
        "match",
        ["get", "roadSize"],
        "major", "#ff6b6b",
        "medium", "#ffa500", 
        "minor", "#4ecdc4",
        "#888888"
      ],
      "line-width": [
        "match",
        ["get", "roadSize"],
        "major", 6,
        "medium", 4,
        "minor", 2.5,
        2
      ],
      "line-opacity": 0.2,
      "line-blur": 3
    }
  });

  // Animated traffic layer
  map.addLayer({
    id: "traffic-animation",
    type: "line",
    source: "traffic-flow",
    paint: {
      "line-color": [
        "match",
        ["get", "roadSize"],
        "major", "#ff8888",
        "medium", "#ffb733", 
        "minor", "#66e0d3",
        "#aaaaaa"
      ],
      "line-width": [
        "match",
        ["get", "roadSize"],
        "major", 3,
        "medium", 2,
        "minor", 1.2,
        1
      ],
      "line-opacity": 0.7,
      "line-dasharray": [1, 3]
    }
  });

  // Animate traffic flow with pulsing
  function animateTraffic() {
    trafficPhase += 0.03;
    
    const opacity = 0.5 + Math.sin(trafficPhase * 0.5) * 0.2;
    
    if (map.getLayer("traffic-animation")) {
      map.setPaintProperty("traffic-animation", "line-opacity", opacity);
    }
    
    trafficAnimationFrame = requestAnimationFrame(animateTraffic);
  }
  
  animateTraffic();
}

function resetPlayerRoute(map) {
  playerCoords = [startCoordSnap];
  playerCurrentCoord = startCoordSnap;

  if (playerMarker) {
    playerMarker.setLngLat(startCoordSnap);
  } else {
    playerMarker = new maplibregl.Marker({
      element: createPlayerMarkerElement(),
      anchor: "center"
    })
      .setLngLat(startCoordSnap)
      .addTo(map);
  }

  map.jumpTo({
    center: startCoordSnap,
    zoom: 18.5
  });

  updatePlayerRouteLine(map);
  updatePlayerMetrics();
  updateShadeHeatmap(map, startCoordSnap);
  updateArrow(startCoordSnap);
  updateFog(map, startCoordSnap);
  updateShadePopup(map, startCoordSnap);
  updateStreetView(startCoordSnap, endCoordSnap);

  statusLabel.textContent = "Click anywhere nearby to start walking";
}

export function initGame({ map, miniMap }) {
  gameMap = map;
  
  startNodeId = nearestNodeId(START_COORD);
  endNodeId = nearestNodeId(END_COORD);
  startCoordSnap = nodes[startNodeId].coord;
  endCoordSnap = nodes[endNodeId].coord;

  startMarker = new maplibregl.Marker({ color: "green", scale: 1.2 })
    .setLngLat(startCoordSnap)
    .addTo(map);

  endMarker = new maplibregl.Marker({ color: "red", scale: 1.2 })
    .setLngLat(endCoordSnap)
    .addTo(map);

  createArrowMarker(map, startCoordSnap);

  initShadeHeatmap(map);
  initStreetView();

  const alpha = 3.0;
  const coolest = dijkstra(startNodeId, endNodeId, e => {
    const shade = e.shade[TIME_BUCKET];
    const penalty = 1 + alpha * (1 - shade);
    return e.length_m * penalty;
  });
  coolestLen = totalLength(coolest.edges);
  coolestShade = shadeScoreForRoute(coolest.edges, TIME_BUCKET);
  optDistEl.textContent = coolestLen.toFixed(1);
  optShadeEl.textContent = coolestShade.toFixed(2);

  const shortest = dijkstra(startNodeId, endNodeId, e => e.length_m);
  shortestLen = totalLength(shortest.edges);

  resetPlayerRoute(map);
  
  // Initialize player route first, then add traffic
  setTimeout(() => {
    initTrafficLayer(map);
    startCameraDrift(map);
    startBreatheAnimation(map);
  }, 100);

  map.on("move", () => {
    if (playerCurrentCoord) {
      updateFog(map, playerCurrentCoord);
    }
  });

  map.on("click", e => {
    const currentCoord = playerCurrentCoord;
    const destCoord = [e.lngLat.lng, e.lngLat.lat];

    const stepDistKm = turf.distance(currentCoord, destCoord, { units: "kilometers" });
    const stepDistM = stepDistKm * 1000;
    if (stepDistM > MAX_STEP_METERS) {
      statusLabel.textContent = "⚠️ Too far away – click closer to your marker.";
      statusLabel.style.background = "rgba(255,87,34,0.4)";
      setTimeout(() => {
        statusLabel.style.background = "rgba(255,255,255,0.25)";
      }, 1200);
      return;
    }

    playerCoords.push(destCoord);
    playerCurrentCoord = destCoord;

    // Reset drift to new position
    driftTime = 0;

    map.jumpTo({
      center: destCoord
    });

    playerMarker.setLngLat(destCoord);
    updatePlayerRouteLine(map);
    updatePlayerMetrics();
    updateShadeHeatmap(map, destCoord);
    updateArrow(destCoord);
    updateFog(map, destCoord);
    updateShadePopup(map, destCoord);
    updateStreetView(destCoord, endCoordSnap);

    const goalDistKm = turf.distance(destCoord, endCoordSnap, { units: "kilometers" });
    const goalDistM = goalDistKm * 1000;

    if (goalDistM <= 25) {
      const { distance, shade, scenic, backroads, nature } = computePlayerRouteMetrics();
      const eff = (shortestLen > 0 && distance > 0)
        ? (shortestLen / distance) * 100
        : null;

      statusLabel.textContent =
        `🎉 Goal reached! Distance ${distance.toFixed(1)}m, ` +
        `shade ${shade !== null ? shade.toFixed(2) : "—"}. ` +
        (eff !== null ? `Efficiency: ${eff.toFixed(1)}%. ` : ``) +
        `AI: ${coolestLen.toFixed(1)}m, shade ${coolestShade.toFixed(2)}.`;
      statusLabel.style.background = "rgba(76,175,80,0.5)";
    } else {
      const distRemaining = goalDistM.toFixed(0);
      statusLabel.textContent = `🚶 Nice step! ${distRemaining}m to go – follow the arrow.`;
      statusLabel.style.background = "rgba(255,255,255,0.25)";
    }
  });

  resetBtn.addEventListener("click", () => {
    resetPlayerRoute(map);
  });
}