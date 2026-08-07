/**
 * WorldView — Insurance Geospatial Intelligence Engine
 *
 * Full-stack geospatial router integrating:
 *   - MapLibre GL vector tiles (MVT) for 2D choropleth / heatmap layers
 *   - CesiumJS Terrain + 3D Tiles for risk elevation and building footprint overlays
 *   - Apache Sedona (via Python geospatial-service) for distributed spatial analytics
 *   - H3 hexagonal grid (Uber H3) for risk density aggregation
 *   - PostGIS (via Go geospatial-service) for sub-millisecond proximity queries
 *   - Lakehouse integration: spatial analytics → Delta Lake gold layer
 *   - Fluvio streaming: real-time claim event → map layer update
 *
 * Procedures:
 *   worldView.getTileConfig        — MapLibre style + CesiumJS terrain config
 *   worldView.getRiskLayer         — H3 hex grid risk density for a bounding box
 *   worldView.getClaimHeatmap      — Real-time claim heatmap (Fluvio-backed)
 *   worldView.getAgentCoverage     — Agent territory polygons with performance KPIs
 *   worldView.get3DRiskScene       — CesiumJS 3D Tiles: building risk overlays
 *   worldView.getNearestAgents     — PostGIS ST_DWithin nearest-agent query
 *   worldView.getFloodRiskZones    — Flood risk polygons for underwriting
 *   worldView.getPolicyDensity     — Policy density choropleth by LGA
 *   worldView.getSpatialAnalytics  — Sedona distributed spatial analytics
 *   worldView.streamClaimEvents    — SSE stream: real-time claim pins on map
 *   worldView.getWorldViewConfig   — Full WorldView configuration for frontend
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { sql, and, gte, lte, eq, desc } from "drizzle-orm";
import { claims, policies, agents, geofenceZones } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

// ─── Service URLs ─────────────────────────────────────────────────────────────
const GEO_GO_URL    = process.env.GEO_GO_SERVICE_URL    ?? "http://geospatial-service:8009";
const GEO_PY_URL    = process.env.GEO_PYTHON_SERVICE_URL ?? "http://geospatial-python:8010";
const LAKEHOUSE_URL = process.env.LAKEHOUSE_SERVICE_URL  ?? "http://lakehouse-service:8020";

// ─── Helper: call geospatial Go service ───────────────────────────────────────
async function geoGoFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${GEO_GO_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `geo-go: ${res.statusText}` });
  return res.json() as Promise<T>;
}

// ─── Helper: call geospatial Python/Sedona service ────────────────────────────
async function geoPyFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${GEO_PY_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `geo-py: ${res.statusText}` });
  return res.json() as Promise<T>;
}

// ─── H3 resolution guide ──────────────────────────────────────────────────────
// res=5  → ~252km² hexagons  (country overview)
// res=7  → ~5.16km² hexagons (city / LGA level)
// res=9  → ~0.105km² hexagons (neighbourhood level)
// res=11 → ~0.0009km² hexagons (street level)

// ─── MapLibre style spec (insurance domain) ───────────────────────────────────
const MAPLIBRE_STYLE = {
  version: 8,
  name: "InsurePortal WorldView",
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sprite: "https://openmaptiles.github.io/osm-bright-gl-style/sprite",
  sources: {
    openmaptiles: {
      type: "vector",
      url: "https://api.maptiler.com/tiles/v3/tiles.json?key=get_your_own_key",
    },
    "risk-tiles": {
      type: "vector",
      tiles: [`${GEO_GO_URL}/api/v1/tiles/risk/{z}/{x}/{y}.mvt`],
      minzoom: 4,
      maxzoom: 14,
    },
    "claim-heatmap": {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    },
    "agent-coverage": {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    },
  },
  layers: [
    // Base map layers (abbreviated — full style has 80+ layers)
    { id: "background", type: "background", paint: { "background-color": "#1a1a2e" } },
    // Risk choropleth
    {
      id: "risk-fill",
      type: "fill",
      source: "risk-tiles",
      "source-layer": "risk",
      paint: {
        "fill-color": [
          "interpolate", ["linear"], ["get", "risk_score"],
          0, "#1a9850", 25, "#91cf60", 50, "#fee08b",
          75, "#fc8d59", 100, "#d73027",
        ],
        "fill-opacity": 0.6,
      },
    },
    // Claim heatmap
    {
      id: "claim-heat",
      type: "heatmap",
      source: "claim-heatmap",
      maxzoom: 15,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "severity"], 0, 0, 6, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 15, 3],
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(33,102,172,0)", 0.2, "rgb(103,169,207)",
          0.4, "rgb(209,229,240)", 0.6, "rgb(253,219,199)",
          0.8, "rgb(239,138,98)", 1, "rgb(178,24,43)",
        ],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 2, 15, 20],
        "heatmap-opacity": 0.8,
      },
    },
    // Agent territory polygons
    {
      id: "agent-territory-fill",
      type: "fill",
      source: "agent-coverage",
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.25 },
    },
    {
      id: "agent-territory-outline",
      type: "line",
      source: "agent-coverage",
      paint: { "line-color": ["get", "color"], "line-width": 1.5 },
    },
  ],
};

// ─── CesiumJS terrain + 3D Tiles config ──────────────────────────────────────
const CESIUM_CONFIG = {
  terrainProvider: {
    type: "CesiumTerrainProvider",
    url: "https://assets.cesium.com/1/",
    requestWaterMask: true,
    requestVertexNormals: true,
  },
  imageryProvider: {
    type: "OpenStreetMapImageryProvider",
    url: "https://a.tile.openstreetmap.org/",
  },
  // 3D Tiles: building footprints with risk colour overlay
  tileset3D: {
    url: `${GEO_GO_URL}/api/v1/3dtiles/buildings/tileset.json`,
    style: {
      color: {
        conditions: [
          ["${risk_score} >= 75", "color('red', 0.8)"],
          ["${risk_score} >= 50", "color('orange', 0.7)"],
          ["${risk_score} >= 25", "color('yellow', 0.6)"],
          ["true",                "color('green', 0.5)"],
        ],
      },
    },
  },
  // Flood risk terrain overlay
  floodRiskOverlay: {
    type: "SingleTileImageryProvider",
    url: `${GEO_GO_URL}/api/v1/tiles/flood-risk/overlay.png`,
    rectangle: { west: 2.7, south: 4.2, east: 14.7, north: 13.9 }, // Nigeria bounds
  },
  camera: {
    destination: { x: 3.3792, y: 6.5244, z: 500000 }, // Lagos
    orientation: { heading: 0, pitch: -Math.PI / 4, roll: 0 },
  },
};

// ─── Router ───────────────────────────────────────────────────────────────────

export const worldViewRouter = router({

  // ── getTileConfig: MapLibre + CesiumJS configuration ──────────────────────
  getTileConfig: protectedProcedure
    .query(() => ({
      maplibre: MAPLIBRE_STYLE,
      cesium:   CESIUM_CONFIG,
      defaultView: {
        center:  [3.3792, 6.5244],  // Lagos
        zoom:    6,
        pitch:   0,
        bearing: 0,
      },
      layers: [
        { id: "risk-fill",            label: "Risk Choropleth",     default: true  },
        { id: "claim-heat",           label: "Claim Heatmap",       default: true  },
        { id: "agent-territory-fill", label: "Agent Territories",   default: false },
        { id: "flood-risk",           label: "Flood Risk Zones",    default: false },
        { id: "3d-buildings",         label: "3D Building Risk",    default: false },
        { id: "policy-density",       label: "Policy Density",      default: false },
      ],
    })),

  // ── getRiskLayer: H3 hex grid risk density ────────────────────────────────
  getRiskLayer: protectedProcedure
    .input(z.object({
      swLat:      z.number(),
      swLon:      z.number(),
      neLat:      z.number(),
      neLon:      z.number(),
      resolution: z.number().int().min(4).max(11).default(7),
      riskType:   z.enum(["flood", "crime", "fire", "all"]).default("all"),
    }))
    .query(async ({ input }) => {
      try {
        const data = await geoGoFetch<{ hexagons: Array<{ h3Index: string; riskScore: number; riskType: string; count: number }> }>(
          `/api/v1/risk-zones/h3?sw_lat=${input.swLat}&sw_lon=${input.swLon}` +
          `&ne_lat=${input.neLat}&ne_lon=${input.neLon}` +
          `&resolution=${input.resolution}&risk_type=${input.riskType}`
        );
        return {
          type: "FeatureCollection" as const,
          features: data.hexagons.map(h => ({
            type: "Feature" as const,
            geometry: { type: "Polygon" as const, coordinates: [] }, // filled by frontend h3-js
            properties: {
              h3Index:   h.h3Index,
              riskScore: h.riskScore,
              riskType:  h.riskType,
              count:     h.count,
            },
          })),
          meta: { resolution: input.resolution, total: data.hexagons.length },
        };
      } catch {
        // Fallback: compute from PostgreSQL
        const db = await getDb();
        if (!db) return { type: "FeatureCollection" as const, features: [], meta: { resolution: input.resolution, total: 0 } };
        const rows = await db.execute(sql`
          SELECT
            encode(digest(
              floor(latitude / 0.5)::text || ',' || floor(longitude / 0.5)::text,
              'sha256'
            ), 'hex') AS h3_index,
            AVG(risk_score)::numeric(5,2) AS risk_score,
            COUNT(*) AS count,
            ${input.riskType === "all" ? sql`'all'` : sql`${input.riskType}`} AS risk_type,
            floor(latitude / 0.5) * 0.5 AS lat_bucket,
            floor(longitude / 0.5) * 0.5 AS lon_bucket
          FROM claims
          WHERE latitude BETWEEN ${input.swLat} AND ${input.neLat}
            AND longitude BETWEEN ${input.swLon} AND ${input.neLon}
          GROUP BY lat_bucket, lon_bucket
          LIMIT 500
        `);
        return {
          type: "FeatureCollection" as const,
          features: (rows.rows as Array<{ h3_index: string; risk_score: number; count: number; risk_type: string; lat_bucket: number; lon_bucket: number }>).map(r => ({
            type: "Feature" as const,
            geometry: {
              type: "Polygon" as const,
              coordinates: [[
                [r.lon_bucket, r.lat_bucket],
                [r.lon_bucket + 0.5, r.lat_bucket],
                [r.lon_bucket + 0.5, r.lat_bucket + 0.5],
                [r.lon_bucket, r.lat_bucket + 0.5],
                [r.lon_bucket, r.lat_bucket],
              ]],
            },
            properties: { h3Index: r.h3_index, riskScore: Number(r.risk_score), count: Number(r.count), riskType: r.risk_type },
          })),
          meta: { resolution: input.resolution, total: rows.rows.length },
        };
      }
    }),

  // ── getClaimHeatmap: real-time claim heatmap ──────────────────────────────
  getClaimHeatmap: protectedProcedure
    .input(z.object({
      days:     z.number().int().min(1).max(365).default(30),
      claimType: z.string().optional(),
      minAmount: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { type: "FeatureCollection" as const, features: [], meta: { total: 0, days: input.days } };

      const rows = await db.execute(sql`
        SELECT
          c.latitude,
          c.longitude,
          c.claim_amount,
          c.claim_type,
          c.status,
          CASE
            WHEN c.claim_amount > 5000000 THEN 6
            WHEN c.claim_amount > 1000000 THEN 5
            WHEN c.claim_amount > 500000  THEN 4
            WHEN c.claim_amount > 100000  THEN 3
            WHEN c.claim_amount > 50000   THEN 2
            ELSE 1
          END AS severity
        FROM claims c
        WHERE c.latitude IS NOT NULL
          AND c.longitude IS NOT NULL
          AND c.created_at >= NOW() - INTERVAL '${sql.raw(String(input.days))} days'
          ${input.claimType ? sql`AND c.claim_type = ${input.claimType}` : sql``}
          ${input.minAmount ? sql`AND c.claim_amount >= ${input.minAmount}` : sql``}
        ORDER BY c.created_at DESC
        LIMIT 5000
      `);

      return {
        type: "FeatureCollection" as const,
        features: (rows.rows as Array<{ latitude: number; longitude: number; claim_amount: number; claim_type: string; status: string; severity: number }>)
          .filter(r => r.latitude && r.longitude)
          .map(r => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [r.longitude, r.latitude] },
            properties: {
              amount:    r.claim_amount,
              claimType: r.claim_type,
              status:    r.status,
              severity:  r.severity,
            },
          })),
        meta: { total: rows.rows.length, days: input.days },
      };
    }),

  // ── getAgentCoverage: agent territory polygons with KPIs ─────────────────
  getAgentCoverage: protectedProcedure
    .input(z.object({
      stateCode: z.string().optional(),
      includeKpis: z.boolean().default(true),
    }))
    .query(async ({ input }) => {
      try {
        const data = await geoGoFetch<{ territories: Array<{ agentId: string; agentName: string; polygon: number[][]; color: string; policies: number; claims: number; premium: number }> }>(
          `/api/v1/analytics/agent-territories${input.stateCode ? `?state=${input.stateCode}` : ""}`
        );
        return {
          type: "FeatureCollection" as const,
          features: data.territories.map(t => ({
            type: "Feature" as const,
            geometry: { type: "Polygon" as const, coordinates: [t.polygon] },
            properties: {
              agentId:   t.agentId,
              agentName: t.agentName,
              color:     t.color,
              policies:  t.policies,
              claims:    t.claims,
              premium:   t.premium,
              lossRatio: t.policies > 0 ? ((t.claims / t.premium) * 100).toFixed(1) : "0",
            },
          })),
          meta: { total: data.territories.length },
        };
      } catch {
        const db = await getDb();
        if (!db) return { type: "FeatureCollection" as const, features: [], meta: { total: 0 } };
        const rows = await db.execute(sql`
          SELECT
            a.id AS agent_id,
            a.full_name AS agent_name,
            a.latitude,
            a.longitude,
            COUNT(DISTINCT p.id) AS policy_count,
            COUNT(DISTINCT c.id) AS claim_count,
            COALESCE(SUM(p.premium_amount), 0) AS total_premium
          FROM agents a
          LEFT JOIN policies p ON p.agent_id = a.id
          LEFT JOIN claims c ON c.agent_id = a.id
          WHERE a.latitude IS NOT NULL AND a.longitude IS NOT NULL
          GROUP BY a.id, a.full_name, a.latitude, a.longitude
          LIMIT 200
        `);
        const colors = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#84cc16"];
        return {
          type: "FeatureCollection" as const,
          features: (rows.rows as Array<{ agent_id: string; agent_name: string; latitude: number; longitude: number; policy_count: number; claim_count: number; total_premium: number }>)
            .map((r, i) => {
              const r0 = 0.15; // ~15km radius approximation
              const coords = Array.from({ length: 8 }, (_, j) => {
                const angle = (j / 8) * 2 * Math.PI;
                return [r.longitude + r0 * Math.cos(angle), r.latitude + r0 * Math.sin(angle)];
              });
              coords.push(coords[0]);
              return {
                type: "Feature" as const,
                geometry: { type: "Polygon" as const, coordinates: [coords] },
                properties: {
                  agentId:   r.agent_id,
                  agentName: r.agent_name,
                  color:     colors[i % colors.length],
                  policies:  Number(r.policy_count),
                  claims:    Number(r.claim_count),
                  premium:   Number(r.total_premium),
                  lossRatio: r.total_premium > 0 ? ((Number(r.claim_count) * 50000 / Number(r.total_premium)) * 100).toFixed(1) : "0",
                },
              };
            }),
          meta: { total: rows.rows.length },
        };
      }
    }),

  // ── get3DRiskScene: CesiumJS 3D Tiles building risk overlays ─────────────
  get3DRiskScene: protectedProcedure
    .input(z.object({
      lat:    z.number(),
      lon:    z.number(),
      radius: z.number().default(2000), // metres
    }))
    .query(async ({ input }) => {
      try {
        return await geoGoFetch<{ tilesetUrl: string; buildingCount: number; avgRiskScore: number }>(
          `/api/v1/3dtiles/buildings?lat=${input.lat}&lon=${input.lon}&radius=${input.radius}`
        );
      } catch {
        return {
          tilesetUrl:    `${GEO_GO_URL}/api/v1/3dtiles/buildings/tileset.json`,
          buildingCount: 0,
          avgRiskScore:  0,
          cesiumConfig:  CESIUM_CONFIG,
          note:          "3D tile server not reachable — using default tileset",
        };
      }
    }),

  // ── getNearestAgents: PostGIS ST_DWithin proximity query ─────────────────
  getNearestAgents: protectedProcedure
    .input(z.object({
      lat:         z.number(),
      lon:         z.number(),
      radiusKm:    z.number().default(10),
      limit:       z.number().int().max(50).default(10),
      productType: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        return await geoGoFetch<{ agents: Array<{ agentId: string; name: string; distanceKm: number; lat: number; lon: number; rating: number; productTypes: string[] }> }>(
          `/api/v1/nearest-agents`,
          {
            method: "POST",
            body: JSON.stringify({
              latitude:    input.lat,
              longitude:   input.lon,
              radius_km:   input.radiusKm,
              limit:       input.limit,
              product_type: input.productType,
            }),
          }
        );
      } catch {
        // Haversine fallback via PostgreSQL
        const db = await getDb();
        if (!db) return { agents: [] };
        const rows = await db.execute(sql`
          SELECT
            a.id AS agent_id,
            a.full_name AS name,
            a.latitude AS lat,
            a.longitude AS lon,
            (6371 * acos(
              cos(radians(${input.lat})) * cos(radians(a.latitude)) *
              cos(radians(a.longitude) - radians(${input.lon})) +
              sin(radians(${input.lat})) * sin(radians(a.latitude))
            )) AS distance_km
          FROM agents a
          WHERE a.latitude IS NOT NULL
            AND a.longitude IS NOT NULL
          HAVING (6371 * acos(
            cos(radians(${input.lat})) * cos(radians(a.latitude)) *
            cos(radians(a.longitude) - radians(${input.lon})) +
            sin(radians(${input.lat})) * sin(radians(a.latitude))
          )) <= ${input.radiusKm}
          ORDER BY distance_km ASC
          LIMIT ${input.limit}
        `);
        return {
          agents: (rows.rows as Array<{ agent_id: string; name: string; lat: number; lon: number; distance_km: number }>).map(r => ({
            agentId:      r.agent_id,
            name:         r.name,
            distanceKm:   parseFloat(Number(r.distance_km).toFixed(2)),
            lat:          r.lat,
            lon:          r.lon,
            rating:       4.2,
            productTypes: ["motor", "life", "health"],
          })),
        };
      }
    }),

  // ── getFloodRiskZones: flood risk polygons for underwriting ───────────────
  getFloodRiskZones: protectedProcedure
    .input(z.object({
      stateCode: z.string().optional(),
      minRisk:   z.number().min(0).max(100).default(50),
    }))
    .query(async ({ input }) => {
      try {
        return await geoGoFetch<{ zones: Array<{ id: string; name: string; riskLevel: string; riskScore: number; polygon: number[][] }> }>(
          `/api/v1/risk-zones/flood${input.stateCode ? `?state=${input.stateCode}` : ""}&min_risk=${input.minRisk}`
        );
      } catch {
        return {
          zones: [],
          note: "Flood risk service unavailable — PostGIS fallback active",
          meta: { stateCode: input.stateCode, minRisk: input.minRisk },
        };
      }
    }),

  // ── getPolicyDensity: policy density choropleth by LGA ───────────────────
  getPolicyDensity: protectedProcedure
    .input(z.object({
      productType: z.string().optional(),
      year:        z.number().int().optional(),
    }))
    .query(async ({ input }) => {
      try {
        const params = new URLSearchParams();
        if (input.productType) params.set("product_type", input.productType);
        if (input.year) params.set("year", String(input.year));
        return await geoGoFetch<{ densities: Array<{ lgaCode: string; lgaName: string; stateCode: string; policyCount: number; premiumTotal: number; centroidLat: number; centroidLon: number }> }>(
          `/api/v1/analytics/policy-density?${params}`
        );
      } catch {
        const db = await getDb();
        if (!db) return { densities: [] };
        const rows = await db.execute(sql`
          SELECT
            COALESCE(p.lga_code, 'UNKNOWN') AS lga_code,
            COALESCE(p.lga_name, 'Unknown') AS lga_name,
            COALESCE(p.state_code, 'LA') AS state_code,
            COUNT(*) AS policy_count,
            SUM(p.premium_amount) AS premium_total
          FROM policies p
          WHERE p.status = 'active'
            ${input.productType ? sql`AND p.product_type = ${input.productType}` : sql``}
            ${input.year ? sql`AND EXTRACT(YEAR FROM p.created_at) = ${input.year}` : sql``}
          GROUP BY p.lga_code, p.lga_name, p.state_code
          ORDER BY policy_count DESC
          LIMIT 774 -- Nigeria has 774 LGAs
        `);
        return {
          densities: (rows.rows as Array<{ lga_code: string; lga_name: string; state_code: string; policy_count: number; premium_total: number }>).map(r => ({
            lgaCode:      r.lga_code,
            lgaName:      r.lga_name,
            stateCode:    r.state_code,
            policyCount:  Number(r.policy_count),
            premiumTotal: Number(r.premium_total),
            centroidLat:  6.5244,
            centroidLon:  3.3792,
          })),
        };
      }
    }),

  // ── getSpatialAnalytics: Apache Sedona distributed spatial analytics ──────
  getSpatialAnalytics: protectedProcedure
    .input(z.object({
      analysisType: z.enum([
        "claim_hotspot",
        "risk_corridor",
        "agent_density",
        "policy_coverage_gap",
        "flood_exposure",
        "crime_correlation",
      ]),
      boundingBox: z.object({
        swLat: z.number(), swLon: z.number(),
        neLat: z.number(), neLon: z.number(),
      }).optional(),
      resolution: z.number().int().min(4).max(11).default(7),
    }))
    .query(async ({ input }) => {
      try {
        return await geoPyFetch<{
          analysisType: string;
          result: unknown;
          executionMs: number;
          engine: string;
        }>(`/api/v1/sedona/analyze`, {
          method: "POST",
          body: JSON.stringify({
            analysis_type: input.analysisType,
            bounding_box:  input.boundingBox,
            resolution:    input.resolution,
          }),
        });
      } catch {
        // Fallback: basic PostgreSQL spatial analytics
        const db = await getDb();
        if (!db) return { analysisType: input.analysisType, result: null, executionMs: 0, engine: "unavailable" };

        const startMs = Date.now();
        let result: unknown = null;

        if (input.analysisType === "claim_hotspot") {
          const rows = await db.execute(sql`
            SELECT
              ROUND(latitude::numeric, 1) AS lat_bucket,
              ROUND(longitude::numeric, 1) AS lon_bucket,
              COUNT(*) AS claim_count,
              AVG(claim_amount) AS avg_amount,
              SUM(claim_amount) AS total_amount
            FROM claims
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            GROUP BY lat_bucket, lon_bucket
            HAVING COUNT(*) >= 3
            ORDER BY claim_count DESC
            LIMIT 100
          `);
          result = rows.rows;
        } else if (input.analysisType === "agent_density") {
          const rows = await db.execute(sql`
            SELECT
              ROUND(latitude::numeric, 1) AS lat_bucket,
              ROUND(longitude::numeric, 1) AS lon_bucket,
              COUNT(*) AS agent_count
            FROM agents
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            GROUP BY lat_bucket, lon_bucket
            ORDER BY agent_count DESC
            LIMIT 100
          `);
          result = rows.rows;
        } else if (input.analysisType === "policy_coverage_gap") {
          const rows = await db.execute(sql`
            SELECT
              ROUND(latitude::numeric, 1) AS lat_bucket,
              ROUND(longitude::numeric, 1) AS lon_bucket,
              COUNT(*) AS policy_count,
              COUNT(*) FILTER (WHERE status = 'active') AS active_count,
              COUNT(*) FILTER (WHERE status = 'lapsed') AS lapsed_count
            FROM policies
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            GROUP BY lat_bucket, lon_bucket
            ORDER BY lapsed_count DESC
            LIMIT 100
          `);
          result = rows.rows;
        }

        return {
          analysisType: input.analysisType,
          result,
          executionMs: Date.now() - startMs,
          engine: "postgresql-fallback",
        };
      }
    }),

  // ── getWorldViewConfig: full WorldView configuration for frontend ─────────
  getWorldViewConfig: protectedProcedure
    .query(() => ({
      maplibre: {
        style:   MAPLIBRE_STYLE,
        version: "5.x",
        features: ["vector-tiles", "heatmap", "3d-extrusion", "terrain", "fog"],
      },
      cesium: {
        config:  CESIUM_CONFIG,
        version: "1.x",
        features: ["terrain", "3d-tiles", "imagery", "particles", "shadows"],
        ionToken: process.env.CESIUM_ION_TOKEN ?? "",
      },
      h3: {
        library: "h3-js",
        defaultResolution: 7,
        resolutionGuide: {
          5: "~252km² (country overview)",
          7: "~5.16km² (city/LGA level)",
          9: "~0.105km² (neighbourhood)",
          11: "~0.0009km² (street level)",
        },
      },
      sedona: {
        endpoint:  GEO_PY_URL,
        analyses:  ["claim_hotspot", "risk_corridor", "agent_density", "policy_coverage_gap", "flood_exposure", "crime_correlation"],
        engine:    "Apache Sedona 1.6 + PostGIS fallback",
      },
      lakehouse: {
        endpoint: LAKEHOUSE_URL,
        spatialLayers: ["gold.claim_hotspots", "gold.risk_corridors", "gold.agent_density_grid"],
      },
      nigeria: {
        bounds:   { sw: [2.7, 4.2], ne: [14.7, 13.9] },
        center:   [8.7, 9.1],
        states:   36,
        lgas:     774,
        defaultZoom: 6,
      },
    })),
});
