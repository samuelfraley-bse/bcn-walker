// src/main.js

import {
  MAP_CENTER,
  MAP_BOUNDS,
  MIN_ZOOM,
  MAX_ZOOM
} from "./config.js";

import { loadGraph } from "./graph.js";
import { initGame } from "./game.js";

// styles for basemap + mini satellite view
const streetStyle = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors"
    }
  },
  layers: [
    {
      id: "osm-layer",
      type: "raster",
      source: "osm"
    }
  ]
};

const satelliteStyle = {
  version: 8,
  sources: {
    "esri-satellite": {
      type: "raster",
      tiles: [
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      ],
      tileSize: 256,
      attribution: "Tiles © Esri"
    }
  },
  layers: [
    {
      id: "esri-satellite-layer",
      type: "raster",
      source: "esri-satellite"
    }
  ]
};

// main map
// src/main.js (excerpt)

const map = new maplibregl.Map({
  container: "map",
  style: streetStyle,
  center: MAP_CENTER,
  zoom: 16,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
  maxBounds: MAP_BOUNDS
});

// 🔒 Disable all zooming (scroll, double-click, pinch)
map.scrollZoom.disable();
map.boxZoom.disable();
map.doubleClickZoom.disable();
map.touchZoomRotate.disable();
map.keyboard.disable();


// mini "first-person" map
const miniMap = new maplibregl.Map({
  container: "mini-map",
  style: satelliteStyle,
  center: MAP_CENTER,
  zoom: 18,
  pitch: 70,
  bearing: 0,
  interactive: false
});

// link mini map to mouse-move on main map
let lastMouseLngLat = null;
map.on("mousemove", e => {
  if (!miniMap) return;
  const { lng, lat } = e.lngLat;
  miniMap.setCenter([lng, lat]);

  if (lastMouseLngLat) {
    const dx = lng - lastMouseLngLat.lng;
    const dy = lat - lastMouseLngLat.lat;
    const angle = Math.atan2(dx, dy) * (180 / Math.PI);
    const currentBearing = miniMap.getBearing();
    const targetBearing = 180 - angle;
    const newBearing = currentBearing + 0.15 * (targetBearing - currentBearing);
    miniMap.setBearing(newBearing);
  }
  lastMouseLngLat = { lng, lat };
});

// bootstrap: load graph, then init game logic
map.on("load", async () => {
  await loadGraph();
  initGame({ map, miniMap });
});
