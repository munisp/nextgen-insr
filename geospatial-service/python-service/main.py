"""
Geospatial Python Service - Geocoding and Address Validation
Nigerian Insurance Platform
"""

import os
import json
import hashlib
import httpx
from typing import Optional, List, Dict, Any
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import asyncpg
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response

# ── Middleware Clients ─────────────────────────────────────────────────────
import redis
import json as _json
from datetime import datetime

# Redis client
_redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
_redis_client = None
try:
    _redis_client = redis.from_url(_redis_url, decode_responses=True, socket_timeout=5)
    _redis_client.ping()
    print(f"[middleware] Redis connected: {_redis_url}")
except Exception as _e:
    print(f"[middleware] Redis not available: {_e}")
    _redis_client = None

# Kafka producer helper
_kafka_brokers = os.environ.get("KAFKA_BROKERS", "localhost:9092")
class KafkaEventPublisher:
    def __init__(self, brokers: str, service_name: str):
        self.brokers = brokers
        self.service_name = service_name
    
    def publish(self, event_type: str, key: str, payload: dict):
        """Publish event to Kafka topic. In production, use confluent-kafka or aiokafka."""
        event = {
            "event_type": event_type,
            "source": self.service_name,
            "key": key,
            "payload": payload,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
        # Production: producer.produce(topic, key=key, value=json.dumps(event))
        print(f"[kafka] event published: {event_type} key={key}")

_kafka_publisher = KafkaEventPublisher(_kafka_brokers, "python-service")

# OpenSearch structured logger
_opensearch_url = os.environ.get("OPENSEARCH_URL", "http://localhost:9200")
class OpenSearchLogger:
    def __init__(self, url: str, service_name: str):
        self.url = url
        self.service_name = service_name
    
    def index_log(self, level: str, message: str, fields: dict = None):
        """Index structured log to OpenSearch."""
        doc = {
            "@timestamp": datetime.utcnow().isoformat() + "Z",
            "level": level,
            "message": message,
            "service": self.service_name,
            "fields": fields or {},
        }
        # Production: requests.post(f"{self.url}/logs-python-service/_doc", json=doc)
        print(f"[opensearch] {level}: {message}")

_os_logger = OpenSearchLogger(_opensearch_url, "python-service")

# Permify authorization client
_permify_addr = os.environ.get("PERMIFY_ADDR", "")
async def check_permission(entity_type: str, entity_id: str, permission: str, user_id: str, tenant_id: str = "default") -> bool:
    """Check permission against Permify ReBAC."""
    if not _permify_addr:
        return True  # Permissive when Permify is not configured
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"http://{_permify_addr}/v1/tenants/{tenant_id}/permissions/check",
                json={
                    "entity": {"type": entity_type, "id": entity_id},
                    "permission": permission,
                    "subject": {"type": "user", "id": user_id},
                },
            )
            data = resp.json()
            return data.get("can") == "RESULT_ALLOWED"
    except Exception:
        return True  # Fail open

# Keycloak JWT authentication middleware
from fastapi import Request, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

_security = HTTPBearer(auto_error=False)

async def keycloak_auth_middleware(request: Request, call_next):
    """Validate JWT token from Keycloak. Skip for health/ready/live probes."""
    path = request.url.path
    if path in ("/health", "/ready", "/live", "/metrics", "/docs", "/openapi.json"):
        return await call_next(request)
    
    # Dev bypass
    if os.environ.get("DEV_AUTH_BYPASS") == "true":
        request.state.user_id = "dev-user"
        request.state.tenant_id = "default"
        request.state.roles = ["admin", "user"]
        return await call_next(request)
    
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "missing bearer token"})
    
    # In production: validate JWT against Keycloak JWKS endpoint
    # For now, pass through (validation handled by APISIX gateway)
    request.state.user_id = request.headers.get("X-User-ID", "unknown")
    request.state.tenant_id = request.headers.get("X-Tenant-ID", "default")
    return await call_next(request)



# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/geospatial")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
OPENSTREETMAP_NOMINATIM_URL = os.getenv("NOMINATIM_URL", "https://nominatim.openstreetmap.org")
PORT = int(os.getenv("PORT", "8091"))

# Metrics
geocode_requests = Counter("geocode_requests_total", "Total geocoding requests", ["provider", "status"])
geocode_latency = Histogram("geocode_latency_seconds", "Geocoding latency", ["provider"])
address_validation_requests = Counter("address_validation_requests_total", "Total address validation requests")

# Database connection pool
db_pool: Optional[asyncpg.Pool] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=5, max_size=20)
    yield
    if db_pool:
        await db_pool.close()


app = FastAPI(
    title="Geospatial Python Service",
    description="Geocoding, address validation, and geospatial analytics for Nigerian Insurance Platform",
    version="1.0.0",
    lifespan=lifespan
)
app.middleware("http")(keycloak_auth_middleware)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic Models
class Address(BaseModel):
    address_line1: str
    address_line2: Optional[str] = None
    city: str
    state: str
    postal_code: Optional[str] = None
    country: str = "Nigeria"


class GeocodingResult(BaseModel):
    latitude: float
    longitude: float
    formatted_address: str
    accuracy: str  # ROOFTOP, RANGE_INTERPOLATED, GEOMETRIC_CENTER, APPROXIMATE
    source: str  # GOOGLE, OPENSTREETMAP, CACHE
    confidence: float  # 0.0 - 1.0
    components: Dict[str, Any] = {}


class ReverseGeocodingResult(BaseModel):
    address_line1: str
    city: str
    state: str
    state_code: str
    lga: Optional[str] = None
    postal_code: Optional[str] = None
    country: str = "Nigeria"
    formatted_address: str


class AddressValidationResult(BaseModel):
    is_valid: bool
    normalized_address: Address
    geocoding: Optional[GeocodingResult] = None
    suggestions: List[str] = []
    issues: List[str] = []


class NigerianState(BaseModel):
    code: str
    name: str
    capital: str
    region: str


class BatchGeocodeRequest(BaseModel):
    addresses: List[Address]


class BatchGeocodeResult(BaseModel):
    results: List[Optional[GeocodingResult]]
    success_count: int
    failure_count: int


class DistanceRequest(BaseModel):
    origin_lat: float
    origin_lon: float
    destination_lat: float
    destination_lon: float


class DistanceResult(BaseModel):
    distance_km: float
    distance_meters: float
    bearing_degrees: float


class RouteRequest(BaseModel):
    origin_lat: float
    origin_lon: float
    destination_lat: float
    destination_lon: float
    waypoints: List[Dict[str, float]] = []


# Nigerian States Data
NIGERIAN_STATES = {
    "AB": {"name": "Abia", "capital": "Umuahia", "region": "South-East"},
    "AD": {"name": "Adamawa", "capital": "Yola", "region": "North-East"},
    "AK": {"name": "Akwa Ibom", "capital": "Uyo", "region": "South-South"},
    "AN": {"name": "Anambra", "capital": "Awka", "region": "South-East"},
    "BA": {"name": "Bauchi", "capital": "Bauchi", "region": "North-East"},
    "BY": {"name": "Bayelsa", "capital": "Yenagoa", "region": "South-South"},
    "BE": {"name": "Benue", "capital": "Makurdi", "region": "North-Central"},
    "BO": {"name": "Borno", "capital": "Maiduguri", "region": "North-East"},
    "CR": {"name": "Cross River", "capital": "Calabar", "region": "South-South"},
    "DE": {"name": "Delta", "capital": "Asaba", "region": "South-South"},
    "EB": {"name": "Ebonyi", "capital": "Abakaliki", "region": "South-East"},
    "ED": {"name": "Edo", "capital": "Benin City", "region": "South-South"},
    "EK": {"name": "Ekiti", "capital": "Ado-Ekiti", "region": "South-West"},
    "EN": {"name": "Enugu", "capital": "Enugu", "region": "South-East"},
    "FC": {"name": "FCT", "capital": "Abuja", "region": "North-Central"},
    "GO": {"name": "Gombe", "capital": "Gombe", "region": "North-East"},
    "IM": {"name": "Imo", "capital": "Owerri", "region": "South-East"},
    "JI": {"name": "Jigawa", "capital": "Dutse", "region": "North-West"},
    "KD": {"name": "Kaduna", "capital": "Kaduna", "region": "North-West"},
    "KN": {"name": "Kano", "capital": "Kano", "region": "North-West"},
    "KT": {"name": "Katsina", "capital": "Katsina", "region": "North-West"},
    "KE": {"name": "Kebbi", "capital": "Birnin Kebbi", "region": "North-West"},
    "KO": {"name": "Kogi", "capital": "Lokoja", "region": "North-Central"},
    "KW": {"name": "Kwara", "capital": "Ilorin", "region": "North-Central"},
    "LA": {"name": "Lagos", "capital": "Ikeja", "region": "South-West"},
    "NA": {"name": "Nasarawa", "capital": "Lafia", "region": "North-Central"},
    "NI": {"name": "Niger", "capital": "Minna", "region": "North-Central"},
    "OG": {"name": "Ogun", "capital": "Abeokuta", "region": "South-West"},
    "ON": {"name": "Ondo", "capital": "Akure", "region": "South-West"},
    "OS": {"name": "Osun", "capital": "Osogbo", "region": "South-West"},
    "OY": {"name": "Oyo", "capital": "Ibadan", "region": "South-West"},
    "PL": {"name": "Plateau", "capital": "Jos", "region": "North-Central"},
    "RI": {"name": "Rivers", "capital": "Port Harcourt", "region": "South-South"},
    "SO": {"name": "Sokoto", "capital": "Sokoto", "region": "North-West"},
    "TA": {"name": "Taraba", "capital": "Jalingo", "region": "North-East"},
    "YO": {"name": "Yobe", "capital": "Damaturu", "region": "North-East"},
    "ZA": {"name": "Zamfara", "capital": "Gusau", "region": "North-West"},
}


def get_state_code(state_name: str) -> Optional[str]:
    """Get state code from state name"""
    state_name_lower = state_name.lower().strip()
    for code, info in NIGERIAN_STATES.items():
        if info["name"].lower() == state_name_lower:
            return code
    return None


def normalize_nigerian_address(address: Address) -> Address:
    """Normalize Nigerian address components"""
    # Normalize state
    state = address.state.strip()
    state_code = get_state_code(state)
    if state_code:
        state = NIGERIAN_STATES[state_code]["name"]
    
    # Normalize city
    city = address.city.strip().title()
    
    # Normalize address lines
    address_line1 = address.address_line1.strip()
    address_line2 = address.address_line2.strip() if address.address_line2 else None
    
    return Address(
        address_line1=address_line1,
        address_line2=address_line2,
        city=city,
        state=state,
        postal_code=address.postal_code,
        country="Nigeria"
    )


async def geocode_with_google(address: str) -> Optional[GeocodingResult]:
    """Geocode address using Google Maps API"""
    if not GOOGLE_MAPS_API_KEY:
        return None
    
    with geocode_latency.labels(provider="google").time():
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    "https://maps.googleapis.com/maps/api/geocode/json",
                    params={
                        "address": address,
                        "key": GOOGLE_MAPS_API_KEY,
                        "region": "ng",  # Nigeria
                        "components": "country:NG"
                    },
                    timeout=10.0
                )
                data = response.json()
                
                if data["status"] == "OK" and data["results"]:
                    result = data["results"][0]
                    location = result["geometry"]["location"]
                    
                    # Map Google accuracy types
                    accuracy_map = {
                        "ROOFTOP": "ROOFTOP",
                        "RANGE_INTERPOLATED": "RANGE_INTERPOLATED",
                        "GEOMETRIC_CENTER": "GEOMETRIC_CENTER",
                        "APPROXIMATE": "APPROXIMATE"
                    }
                    accuracy = accuracy_map.get(
                        result["geometry"].get("location_type", "APPROXIMATE"),
                        "APPROXIMATE"
                    )
                    
                    # Extract address components
                    components = {}
                    for comp in result.get("address_components", []):
                        for comp_type in comp["types"]:
                            components[comp_type] = comp["long_name"]
                    
                    geocode_requests.labels(provider="google", status="success").inc()
                    
                    return GeocodingResult(
                        latitude=location["lat"],
                        longitude=location["lng"],
                        formatted_address=result["formatted_address"],
                        accuracy=accuracy,
                        source="GOOGLE",
                        confidence=0.95 if accuracy == "ROOFTOP" else 0.8,
                        components=components
                    )
                
                geocode_requests.labels(provider="google", status="no_results").inc()
                return None
                
        except Exception as e:
            geocode_requests.labels(provider="google", status="error").inc()
            print(f"Google geocoding error: {e}")
            return None


async def geocode_with_nominatim(address: str) -> Optional[GeocodingResult]:
    """Geocode address using OpenStreetMap Nominatim"""
    with geocode_latency.labels(provider="nominatim").time():
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{OPENSTREETMAP_NOMINATIM_URL}/search",
                    params={
                        "q": address,
                        "format": "json",
                        "addressdetails": 1,
                        "countrycodes": "ng",
                        "limit": 1
                    },
                    headers={"User-Agent": "NigerianInsurancePlatform/1.0"},
                    timeout=10.0
                )
                data = response.json()
                
                if data:
                    result = data[0]
                    
                    # Determine accuracy based on OSM class/type
                    osm_type = result.get("type", "")
                    if osm_type in ["house", "building"]:
                        accuracy = "ROOFTOP"
                        confidence = 0.9
                    elif osm_type in ["street", "road"]:
                        accuracy = "RANGE_INTERPOLATED"
                        confidence = 0.7
                    elif osm_type in ["suburb", "neighbourhood"]:
                        accuracy = "GEOMETRIC_CENTER"
                        confidence = 0.5
                    else:
                        accuracy = "APPROXIMATE"
                        confidence = 0.3
                    
                    geocode_requests.labels(provider="nominatim", status="success").inc()
                    
                    return GeocodingResult(
                        latitude=float(result["lat"]),
                        longitude=float(result["lon"]),
                        formatted_address=result["display_name"],
                        accuracy=accuracy,
                        source="OPENSTREETMAP",
                        confidence=confidence,
                        components=result.get("address", {})
                    )
                
                geocode_requests.labels(provider="nominatim", status="no_results").inc()
                return None
                
        except Exception as e:
            geocode_requests.labels(provider="nominatim", status="error").inc()
            print(f"Nominatim geocoding error: {e}")
            return None


async def get_cached_geocode(address_hash: str) -> Optional[GeocodingResult]:
    """Get cached geocoding result from database"""
    if not db_pool:
        return None
    
    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT latitude, longitude, formatted_address, accuracy, source, confidence, components
                FROM geospatial.geocoding_cache
                WHERE address_hash = $1 AND expires_at > NOW()
                """,
                address_hash
            )
            
            if row:
                geocode_requests.labels(provider="cache", status="hit").inc()
                return GeocodingResult(
                    latitude=row["latitude"],
                    longitude=row["longitude"],
                    formatted_address=row["formatted_address"],
                    accuracy=row["accuracy"],
                    source="CACHE",
                    confidence=row["confidence"],
                    components=json.loads(row["components"]) if row["components"] else {}
                )
    except Exception as e:
        print(f"Cache lookup error: {e}")
    
    geocode_requests.labels(provider="cache", status="miss").inc()
    return None


async def cache_geocode_result(address_hash: str, result: GeocodingResult):
    """Cache geocoding result in database"""
    if not db_pool:
        return
    
    try:
        async with db_pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO geospatial.geocoding_cache 
                (address_hash, latitude, longitude, formatted_address, accuracy, source, confidence, components, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '30 days')
                ON CONFLICT (address_hash) DO UPDATE SET
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    formatted_address = EXCLUDED.formatted_address,
                    accuracy = EXCLUDED.accuracy,
                    source = EXCLUDED.source,
                    confidence = EXCLUDED.confidence,
                    components = EXCLUDED.components,
                    expires_at = NOW() + INTERVAL '30 days'
                """,
                address_hash,
                result.latitude,
                result.longitude,
                result.formatted_address,
                result.accuracy,
                result.source,
                result.confidence,
                json.dumps(result.components)
            )
    except Exception as e:
        print(f"Cache write error: {e}")


def format_address_string(address: Address) -> str:
    """Format address object to string for geocoding"""
    parts = [address.address_line1]
    if address.address_line2:
        parts.append(address.address_line2)
    parts.extend([address.city, address.state, address.country])
    return ", ".join(parts)


def calculate_address_hash(address: str) -> str:
    """Calculate hash for address caching"""
    return hashlib.sha256(address.lower().encode()).hexdigest()


# API Endpoints
@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


@app.get("/ready")
async def readiness_check():
    if db_pool:
        try:
            async with db_pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            return {"status": "ready"}
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"Database not ready: {e}")
    raise HTTPException(status_code=503, detail="Database pool not initialized")


@app.get("/metrics")
async def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/api/v1/geocode", response_model=GeocodingResult)
async def geocode_address(address: Address):
    """
    Geocode a Nigerian address to latitude/longitude coordinates.
    Uses Google Maps API with fallback to OpenStreetMap Nominatim.
    Results are cached for 30 days.
    """
    normalized = normalize_nigerian_address(address)
    address_string = format_address_string(normalized)
    address_hash = calculate_address_hash(address_string)
    
    # Check cache first
    cached = await get_cached_geocode(address_hash)
    if cached:
        return cached
    
    # Try Google Maps first
    result = await geocode_with_google(address_string)
    
    # Fallback to Nominatim
    if not result:
        result = await geocode_with_nominatim(address_string)
    
    if not result:
        raise HTTPException(status_code=404, detail="Could not geocode address")
    
    # Cache the result
    await cache_geocode_result(address_hash, result)
    
    return result


@app.post("/api/v1/geocode/batch", response_model=BatchGeocodeResult)
async def batch_geocode(request: BatchGeocodeRequest):
    """
    Geocode multiple addresses in batch.
    Maximum 100 addresses per request.
    """
    if len(request.addresses) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 addresses per batch")
    
    results = []
    success_count = 0
    failure_count = 0
    
    for address in request.addresses:
        try:
            result = await geocode_address(address)
            results.append(result)
            success_count += 1
        except HTTPException:
            results.append(None)
            failure_count += 1
    
    return BatchGeocodeResult(
        results=results,
        success_count=success_count,
        failure_count=failure_count
    )


@app.get("/api/v1/reverse-geocode", response_model=ReverseGeocodingResult)
async def reverse_geocode(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180)
):
    """
    Convert latitude/longitude coordinates to a Nigerian address.
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{OPENSTREETMAP_NOMINATIM_URL}/reverse",
                params={
                    "lat": latitude,
                    "lon": longitude,
                    "format": "json",
                    "addressdetails": 1
                },
                headers={"User-Agent": "NigerianInsurancePlatform/1.0"},
                timeout=10.0
            )
            data = response.json()
            
            if "error" in data:
                raise HTTPException(status_code=404, detail="Location not found")
            
            address = data.get("address", {})
            
            # Extract Nigerian state
            state_name = address.get("state", "")
            state_code = get_state_code(state_name) or ""
            
            # Build address line
            road = address.get("road", "")
            house_number = address.get("house_number", "")
            address_line1 = f"{house_number} {road}".strip() if road else address.get("suburb", "")
            
            return ReverseGeocodingResult(
                address_line1=address_line1,
                city=address.get("city", address.get("town", address.get("village", ""))),
                state=state_name,
                state_code=state_code,
                lga=address.get("county", address.get("state_district", "")),
                postal_code=address.get("postcode", ""),
                country="Nigeria",
                formatted_address=data.get("display_name", "")
            )
            
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Geocoding service unavailable: {e}")


@app.post("/api/v1/validate-address", response_model=AddressValidationResult)
async def validate_address(address: Address):
    """
    Validate and normalize a Nigerian address.
    Returns validation status, normalized address, and any issues found.
    """
    address_validation_requests.inc()
    
    issues = []
    suggestions = []
    
    # Normalize the address
    normalized = normalize_nigerian_address(address)
    
    # Validate state
    state_code = get_state_code(address.state)
    if not state_code:
        issues.append(f"Unknown state: {address.state}")
        # Find similar state names
        for code, info in NIGERIAN_STATES.items():
            if address.state.lower() in info["name"].lower():
                suggestions.append(f"Did you mean: {info['name']}?")
    
    # Validate city is not empty
    if not address.city or len(address.city.strip()) < 2:
        issues.append("City name is required")
    
    # Validate address line
    if not address.address_line1 or len(address.address_line1.strip()) < 5:
        issues.append("Address line 1 is too short")
    
    # Try to geocode for additional validation
    geocoding_result = None
    try:
        geocoding_result = await geocode_address(normalized)
        
        # Check if geocoded location is in Nigeria
        if geocoding_result:
            if not (4.0 <= geocoding_result.latitude <= 14.0 and 2.5 <= geocoding_result.longitude <= 15.0):
                issues.append("Geocoded location is outside Nigeria")
                geocoding_result = None
    except HTTPException:
        issues.append("Could not verify address location")
    
    is_valid = len(issues) == 0 and geocoding_result is not None
    
    return AddressValidationResult(
        is_valid=is_valid,
        normalized_address=normalized,
        geocoding=geocoding_result,
        suggestions=suggestions,
        issues=issues
    )


@app.get("/api/v1/states", response_model=List[NigerianState])
async def get_nigerian_states():
    """Get list of all Nigerian states"""
    return [
        NigerianState(code=code, **info)
        for code, info in NIGERIAN_STATES.items()
    ]


@app.get("/api/v1/states/{state_code}", response_model=NigerianState)
async def get_state(state_code: str):
    """Get details of a specific Nigerian state"""
    state_code = state_code.upper()
    if state_code not in NIGERIAN_STATES:
        raise HTTPException(status_code=404, detail="State not found")
    
    return NigerianState(code=state_code, **NIGERIAN_STATES[state_code])


@app.post("/api/v1/distance", response_model=DistanceResult)
async def calculate_distance(request: DistanceRequest):
    """
    Calculate the distance between two points using the Haversine formula.
    Returns distance in kilometers and meters, plus bearing in degrees.
    """
    import math
    
    R = 6371  # Earth's radius in kilometers
    
    lat1 = math.radians(request.origin_lat)
    lat2 = math.radians(request.destination_lat)
    delta_lat = math.radians(request.destination_lat - request.origin_lat)
    delta_lon = math.radians(request.destination_lon - request.origin_lon)
    
    # Haversine formula
    a = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    distance_km = R * c
    
    # Calculate bearing
    y = math.sin(delta_lon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
    bearing = math.degrees(math.atan2(y, x))
    bearing = (bearing + 360) % 360  # Normalize to 0-360
    
    return DistanceResult(
        distance_km=round(distance_km, 2),
        distance_meters=round(distance_km * 1000, 0),
        bearing_degrees=round(bearing, 1)
    )


@app.get("/api/v1/within-nigeria")
async def check_within_nigeria(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180)
):
    """
    Check if a coordinate is within Nigeria's boundaries.
    """
    # Approximate bounding box for Nigeria
    is_within = (
        4.0 <= latitude <= 14.0 and
        2.5 <= longitude <= 15.0
    )
    
    # More precise check using PostGIS if available
    if db_pool and is_within:
        try:
            async with db_pool.acquire() as conn:
                result = await conn.fetchval(
                    """
                    SELECT EXISTS(
                        SELECT 1 FROM geospatial.states
                        WHERE ST_Within(
                            ST_SetSRID(ST_MakePoint($1, $2), 4326),
                            boundary
                        )
                    )
                    """,
                    longitude, latitude
                )
                is_within = result if result is not None else is_within
        except Exception:
            pass  # Fall back to bounding box check
    
    return {
        "latitude": latitude,
        "longitude": longitude,
        "is_within_nigeria": is_within
    }


@app.get("/api/v1/find-state")
async def find_state_for_location(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180)
):
    """
    Find which Nigerian state a coordinate falls within.
    """
    if not db_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT id, name, code, capital, region
                FROM geospatial.states
                WHERE ST_Within(
                    ST_SetSRID(ST_MakePoint($1, $2), 4326),
                    boundary
                )
                LIMIT 1
                """,
                longitude, latitude
            )
            
            if row:
                return {
                    "state_id": str(row["id"]),
                    "state_name": row["name"],
                    "state_code": row["code"],
                    "capital": row["capital"],
                    "region": row["region"]
                }
            
            raise HTTPException(status_code=404, detail="Location not within any Nigerian state")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


@app.get("/api/v1/nearby-lgas")
async def find_nearby_lgas(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(default=50, ge=1, le=500)
):
    """
    Find Local Government Areas within a radius of a point.
    """
    if not db_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        async with db_pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT 
                    l.id,
                    l.name as lga_name,
                    s.name as state_name,
                    s.code as state_code,
                    ROUND((ST_Distance(
                        l.centroid::geography,
                        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                    ) / 1000)::numeric, 2) as distance_km
                FROM geospatial.lgas l
                JOIN geospatial.states s ON l.state_id = s.id
                WHERE ST_DWithin(
                    l.centroid::geography,
                    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                    $3 * 1000
                )
                ORDER BY distance_km
                LIMIT 50
                """,
                longitude, latitude, radius_km
            )
            
            return {
                "lgas": [
                    {
                        "id": str(row["id"]),
                        "lga_name": row["lga_name"],
                        "state_name": row["state_name"],
                        "state_code": row["state_code"],
                        "distance_km": float(row["distance_km"])
                    }
                    for row in rows
                ],
                "count": len(rows)
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
