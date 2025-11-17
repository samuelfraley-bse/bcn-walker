// src/graph.js

import { TIME_BUCKET } from "./config.js";

export let nodes = {};     // id -> { id, coord }
export let edges = [];     // array of edges
export let adjacency = {}; // id -> [edges]

function buildAdjacency() {
  adjacency = {};
  Object.values(nodes).forEach(n => {
    adjacency[n.id] = [];
  });

  edges.forEach(edge => {
    adjacency[edge.from].push(edge);
    adjacency[edge.to].push({
      ...edge,
      from: edge.to,
      to: edge.from
    });
  });
}

export async function loadGraph() {
  const res = await fetch("../graph.json");
  const data = await res.json();

  nodes = {};
  data.nodes.forEach(n => {
    nodes[n.id] = { id: n.id, coord: n.coord };
  });

  edges = data.edges.map(e => ({
    id: e.id,
    from: e.from,
    to: e.to,
    length_m: e.length_m,
    shade: e.shade,
    geometry: e.geometry
  }));

  buildAdjacency();

  console.log("Graph loaded:", Object.keys(nodes).length, "nodes,", edges.length, "edges");
}

export function dijkstra(startId, endId, costFn) {
  const dist = {};
  const prev = {};
  const visited = new Set();
  const pq = [];

  Object.keys(nodes).forEach(id => {
    dist[id] = Infinity;
    prev[id] = null;
  });

  dist[startId] = 0;
  pq.push({ id: startId, dist: 0 });

  while (pq.length > 0) {
    pq.sort((a, b) => a.dist - b.dist);
    const current = pq.shift();
    const u = current.id;
    if (visited.has(u)) continue;
    visited.add(u);
    if (u === endId) break;

    (adjacency[u] || []).forEach(edge => {
      const v = edge.to;
      if (visited.has(v)) return;

      const cost = costFn(edge);
      const alt = dist[u] + cost;
      if (alt < dist[v]) {
        dist[v] = alt;
        prev[v] = { nodeId: u, edge };
        pq.push({ id: v, dist: alt });
      }
    });
  }

  const pathEdges = [];
  let curr = endId;
  while (prev[curr]) {
    pathEdges.unshift(prev[curr].edge);
    curr = prev[curr].nodeId;
  }

  return {
    distance: dist[endId],
    edges: pathEdges
  };
}

export function totalLength(pathEdges) {
  return pathEdges.reduce((sum, e) => sum + e.length_m, 0);
}

export function shadeScoreForRoute(pathEdges, timeBucket = TIME_BUCKET) {
  if (pathEdges.length === 0) return 0;
  let totalWeightedShade = 0;
  let totalLen = 0;
  pathEdges.forEach(edge => {
    const s = edge.shade[timeBucket];
    totalWeightedShade += s * edge.length_m;
    totalLen += edge.length_m;
  });
  return totalWeightedShade / totalLen;
}

export function edgesToLineFeature(edgeList) {
  if (edgeList.length === 0) return null;
  const coords = edgeList.flatMap(e => e.geometry);
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: coords
    }
  };
}

export function nearestNodeId(coord) {
  const [lon, lat] = coord;
  let bestId = null;
  let bestDist = Infinity;
  Object.values(nodes).forEach(n => {
    const [nLon, nLat] = n.coord;
    const d = Math.hypot(lon - nLon, lat - nLat);
    if (d < bestDist) {
      bestDist = d;
      bestId = n.id;
    }
  });
  return bestId;
}

export function edgeBetween(aId, bId) {
  const list = adjacency[aId] || [];
  for (const e of list) {
    if (e.to === bId) return e;
  }
  return null;
}
