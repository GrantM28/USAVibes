import os
import json
from typing import Any, Dict, Literal, Tuple

import httpx
from cachetools import TTLCache
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="USA Vibes Map API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

OVERPASS_ENDPOINT = os.getenv("OVERPASS_ENDPOINT", "https://overpass-api.de/api/interpreter")
CACHE_TTL = int(os.getenv("CACHE_TTL_SECONDS", "3600"))
cache = TTLCache(maxsize=256, ttl=CACHE_TTL)

UA = "USAVibesMap/1.0 (self-hosted)"

def _round_bbox(bbox: Tuple[float, float, float, float], places=2):
    s, w, n, e = bbox
    return (round(s, places), round(w, places), round(n, places), round(e, places))

def _cache_key(prefix: str, **kwargs):
    return prefix + ":" + json.dumps(kwargs, sort_keys=True)

async def _fetch_overpass(q: str) -> Dict[str, Any]:
    headers = {"User-Agent": UA}
    async with httpx.AsyncClient(timeout=60.0, headers=headers) as client:
        r = await client.post(OVERPASS_ENDPOINT, data={"data": q})
        r.raise_for_status()
        return r.json()

def _overpass_to_geojson(osm: Dict[str, Any]) -> Dict[str, Any]:
    feats = []
    for el in osm.get("elements", []):
        t = el.get("type")
        tags = el.get("tags", {})
        name = tags.get("name") or tags.get("brand") or tags.get("operator") or "Unknown"

        if t == "node":
            lat = el.get("lat"); lon = el.get("lon")
        else:
            c = el.get("center") or {}
            lat = c.get("lat"); lon = c.get("lon")

        if lat is None or lon is None:
            continue

        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {"id": f"{t}/{el.get('id')}", "name": name, "tags": tags}
        })
    return {"type": "FeatureCollection", "features": feats}

def _overpass_query(bbox: Tuple[float, float, float, float], body: str) -> str:
    s, w, n, e = bbox
    return f"""
[out:json][timeout:45];
(
{body}
);
out center;
"""

@app.get("/health")
def health():
    return {"ok": True, "overpass": OVERPASS_ENDPOINT, "cache_ttl": CACHE_TTL}

@app.get("/api/osm/brand")
async def osm_brand(
    brand: Literal["mcdonalds", "starbucks", "dollargeneral"] = "mcdonalds",
    bbox: str = Query(..., description="south,west,north,east"),
):
    s, w, n, e = map(float, bbox.split(","))
    bbox_t = _round_bbox((s, w, n, e), places=2)

    brand_map = {
        "mcdonalds": r"McDonald",
        "starbucks": r"Starbucks",
        "dollargeneral": r"Dollar General",
    }
    pat = brand_map[brand]

    body = f"""
nwr({bbox_t[0]},{bbox_t[1]},{bbox_t[2]},{bbox_t[3]})["brand"~"{pat}",i];
nwr({bbox_t[0]},{bbox_t[1]},{bbox_t[2]},{bbox_t[3]})["name"~"{pat}",i];
nwr({bbox_t[0]},{bbox_t[1]},{bbox_t[2]},{bbox_t[3]})["operator"~"{pat}",i];
"""

    q = _overpass_query(bbox_t, body)
    key = _cache_key("brand", brand=brand, bbox=bbox_t)

    if key in cache:
        return cache[key]

    data = await _fetch_overpass(q)
    gj = _overpass_to_geojson(data)
    cache[key] = gj
    return gj

@app.get("/api/usgs/quakes")
async def usgs_quakes(
    hours: int = 24,
    minmag: float = 2.5,
    bbox: str = Query(..., description="south,west,north,east"),
):
    # USGS supports bbox params:
    # minlatitude, minlongitude, maxlatitude, maxlongitude
    # We'll use their geojson endpoint.
    s, w, n, e = map(float, bbox.split(","))
    key = _cache_key("quakes", hours=hours, minmag=minmag, bbox=_round_bbox((s, w, n, e), 2))
    if key in cache:
        return cache[key]

    url = "https://earthquake.usgs.gov/fdsnws/event/1/query"
    params = {
        "format": "geojson",
        "starttime": (httpx.Timestamp.now() - hours * 3600).isoformat(),
        "minmagnitude": minmag,
        "minlatitude": s,
        "minlongitude": w,
        "maxlatitude": n,
        "maxlongitude": e,
        "orderby": "time",
        "limit": 2000,
    }

    async with httpx.AsyncClient(timeout=30.0, headers={"User-Agent": UA}) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        data = r.json()

    cache[key] = data
    return data
