import osmnx as ox
import json
import numpy as np

# ---- 1. Download small walking network around central Barcelona ----
center_point = (41.3869, 2.1700)  # (lat, lon)
G = ox.graph_from_point(center_point, dist=800, network_type="walk")

# ---- 2. Convert to GeoDataFrames ----
nodes_gdf, edges_gdf = ox.graph_to_gdfs(G)

# ---- 3. Fake shade score for now ----
np.random.seed(0)
edges_gdf["shade_afternoon"] = np.random.uniform(0.2, 0.9, size=len(edges_gdf))

# ---- 4. Map original node IDs to compact string IDs ----
node_id_map = {orig_id: str(i) for i, orig_id in enumerate(nodes_gdf.index)}

nodes_out = []
for orig_id, row in nodes_gdf.iterrows():
    nid = node_id_map[orig_id]
    lon = float(row["x"])
    lat = float(row["y"])
    nodes_out.append({
        "id": nid,
        "coord": [lon, lat],
    })

edges_out = []
for idx, row in edges_gdf.iterrows():
    # osmnx usually stores (u, v, key) in the index; in some versions also as columns
    if isinstance(idx, tuple):
        u_orig, v_orig = idx[0], idx[1]
    else:
        # fallback if u/v are columns
        u_orig = row["u"]
        v_orig = row["v"]

    u = node_id_map[u_orig]
    v = node_id_map[v_orig]

    geom = row["geometry"]
    xs, ys = geom.xy
    coords = [[float(x), float(y)] for x, y in zip(xs, ys)]

    # use length column if present, otherwise geometry length (meters)
    if "length" in row:
        length_m = float(row["length"])
    else:
        # geom.length is in degrees; for small distance it's okay-ish,
        # but better would be to project. For now, rely on 'length' normally.
        length_m = float(geom.length)

    edges_out.append({
        "id": str(idx),
        "from": u,
        "to": v,
        "length_m": length_m,
        "shade": {"afternoon": float(row["shade_afternoon"])},
        "geometry": coords,
    })

graph = {
    "nodes": nodes_out,
    "edges": edges_out,
}

with open("graph.json", "w", encoding="utf-8") as f:
    json.dump(graph, f)

print("Wrote graph.json with", len(nodes_out), "nodes and", len(edges_out), "edges")
