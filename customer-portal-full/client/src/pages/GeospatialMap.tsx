import React, { useState, useEffect, useRef, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, MapPin, Shield, AlertTriangle, Wifi, WifiOff, Layers, Navigation, Search } from 'lucide-react';
import { toast } from 'sonner';

interface GeoZone {
  name: string;
  risk: string;
  polygon: string | number[][];
  lat?: number;
  lng?: number;
  policies?: number;
  claims?: number;
  lossRatio?: number;
}

interface HeatmapPoint {
  lat: number;
  lng: number;
  intensity: number;
}

const TILE_CACHE_NAME = 'insureportal-map-tiles';
const OFFLINE_DATA_KEY = 'insureportal-geospatial-offline';

const RISK_COLORS: Record<string, string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
};

async function cacheMapTile(url: string): Promise<void> {
  try {
    const cache = await caches.open(TILE_CACHE_NAME);
    const existing = await cache.match(url);
    if (!existing) {
      await cache.add(url);
    }
  } catch {
    // Cache API not available (e.g., non-HTTPS)
  }
}

function saveOfflineData(key: string, data: unknown): void {
  try {
    const stored = JSON.parse(localStorage.getItem(OFFLINE_DATA_KEY) || '{}');
    stored[key] = { data, timestamp: Date.now() };
    localStorage.setItem(OFFLINE_DATA_KEY, JSON.stringify(stored));
  } catch {
    // localStorage full or unavailable
  }
}

function loadOfflineData<T>(key: string, maxAgeMs = 24 * 60 * 60 * 1000): T | null {
  try {
    const stored = JSON.parse(localStorage.getItem(OFFLINE_DATA_KEY) || '{}');
    const entry = stored[key];
    if (entry && Date.now() - entry.timestamp < maxAgeMs) {
      return entry.data as T;
    }
  } catch {
    // localStorage unavailable
  }
  return null;
}

export default function GeospatialMap() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [activeLayer, setActiveLayer] = useState<'risk' | 'heatmap' | 'agents' | 'zones'>('zones');
  const [searchQuery, setSearchQuery] = useState('');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedZone, setSelectedZone] = useState<GeoZone | null>(null);

  const [latitude, setLatitude] = useState<string>('9.0820');
  const [longitude, setLongitude] = useState<string>('8.6753');

  const { data: geoData, isLoading: isGeoLoading } = trpc.geospatial.data.useQuery(
    undefined,
    {
      enabled: isAuthenticated,
      onSuccess: (data: any) => saveOfflineData('geoData', data),
      onError: () => {
        const cached = loadOfflineData<any>('geoData');
        if (cached) toast.info('Using cached geospatial data (offline mode)');
      },
    }
  );

  const { data: riskMapData } = trpc.geospatial.riskMap.useQuery(
    undefined,
    {
      enabled: isAuthenticated,
      onSuccess: (data: any) => saveOfflineData('riskMap', data),
    }
  );

  const analyzeMutation = trpc.geospatial.analyze.useMutation({
    onSuccess: () => toast.success('Geospatial analysis complete'),
    onError: (err: any) => toast.error(`Analysis failed: ${err.message}`),
  });

  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); toast.success('Back online — syncing data'); };
    const handleOffline = () => { setIsOnline(false); toast.info('Offline — using cached map data'); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const initMap = useCallback(async () => {
    if (!mapContainerRef.current || mapRef.current) return;

    try {
      const maplibregl = await import('maplibre-gl');
      await import('maplibre-gl/dist/maplibre-gl.css');

      const center = riskMapData?.center || { lat: 9.0820, lng: 8.6753 };
      const zoom = riskMapData?.zoom || 6;

      const map = new maplibregl.default.Map({
        container: mapContainerRef.current,
        style: {
          version: 8,
          name: 'InsurePortal Nigeria',
          sources: {
            'osm-tiles': {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '&copy; OpenStreetMap contributors',
              maxzoom: 18,
            },
          },
          layers: [
            {
              id: 'osm-tiles',
              type: 'raster',
              source: 'osm-tiles',
              minzoom: 0,
              maxzoom: 18,
            },
          ],
        },
        center: [center.lng, center.lat],
        zoom,
        maxBounds: [[-5, -1], [20, 18]],
      });

      map.addControl(new maplibregl.default.NavigationControl(), 'top-right');
      map.addControl(
        new maplibregl.default.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
        }),
        'top-right'
      );
      map.addControl(new maplibregl.default.ScaleControl({ maxWidth: 200 }), 'bottom-left');

      map.on('load', () => {
        setMapLoaded(true);

        // Pre-cache tiles for Nigeria bounding box at zoom levels 5-8
        const nigeriaZoomLevels = [5, 6, 7];
        nigeriaZoomLevels.forEach((z) => {
          const minTileX = Math.floor(((2.5 + 180) / 360) * Math.pow(2, z));
          const maxTileX = Math.floor(((15 + 180) / 360) * Math.pow(2, z));
          const minTileY = Math.floor(
            ((1 - Math.log(Math.tan((14 * Math.PI) / 180) + 1 / Math.cos((14 * Math.PI) / 180)) / Math.PI) / 2) * Math.pow(2, z)
          );
          const maxTileY = Math.floor(
            ((1 - Math.log(Math.tan((3 * Math.PI) / 180) + 1 / Math.cos((3 * Math.PI) / 180)) / Math.PI) / 2) * Math.pow(2, z)
          );
          for (let x = minTileX; x <= maxTileX; x++) {
            for (let y = minTileY; y <= maxTileY; y++) {
              cacheMapTile(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`);
            }
          }
        });
      });

      mapRef.current = map;
    } catch (err) {
      console.error('Failed to initialize map:', err);
      toast.error('Map library failed to load');
    }
  }, [riskMapData]);

  useEffect(() => {
    if (isAuthenticated && mapContainerRef.current) {
      initMap();
    }
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        setMapLoaded(false);
      }
    };
  }, [isAuthenticated, initMap]);

  const addZoneMarkers = useCallback(async () => {
    if (!mapRef.current || !mapLoaded) return;

    const maplibregl = await import('maplibre-gl');
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const effectiveData = geoData || loadOfflineData<any>('geoData');
    if (!effectiveData) return;

    const regions = effectiveData.regions || [];
    regions.forEach((region: any) => {
      const lat = Number(region.lat);
      const lng = Number(region.lng);
      if (isNaN(lat) || isNaN(lng)) return;

      const el = document.createElement('div');
      el.className = 'geo-marker';
      el.style.cssText = `
        width: 36px; height: 36px; border-radius: 50%;
        background: ${RISK_COLORS[String(region.lossRatio > 50 ? 'high' : region.lossRatio > 40 ? 'medium' : 'low')]};
        border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex; align-items: center; justify-content: center;
        color: white; font-weight: bold; font-size: 11px; cursor: pointer;
      `;
      el.textContent = String(region.policies || 0);

      const popup = new maplibregl.default.Popup({ offset: 20 }).setHTML(`
        <div style="padding:8px;min-width:180px">
          <h3 style="margin:0 0 8px;font-weight:bold">${region.name}</h3>
          <div>Policies: <strong>${region.policies}</strong></div>
          <div>Claims: <strong>${region.claims}</strong></div>
          <div>Loss Ratio: <strong>${region.lossRatio}%</strong></div>
        </div>
      `);

      const marker = new maplibregl.default.Marker({ element: el })
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(mapRef.current!);

      el.addEventListener('click', () => {
        setSelectedZone({
          name: region.name,
          risk: region.lossRatio > 50 ? 'high' : region.lossRatio > 40 ? 'medium' : 'low',
          polygon: [],
          lat,
          lng,
          policies: region.policies,
          claims: region.claims,
          lossRatio: Number(region.lossRatio),
        });
      });

      markersRef.current.push(marker);
    });

    const riskZones = effectiveData.riskZones || [];
    riskZones.forEach((zone: any) => {
      const riskColor = RISK_COLORS[zone.level] || RISK_COLORS.medium;
      const el = document.createElement('div');
      el.style.cssText = `
        width: 14px; height: 14px; border-radius: 2px;
        background: ${riskColor}; border: 2px solid white;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3);
      `;
      // Risk zones don't have coordinates in the current data model
    });
  }, [geoData, mapLoaded]);

  useEffect(() => {
    addZoneMarkers();
  }, [addZoneMarkers]);

  const flyToLocation = useCallback((lat: number, lng: number, zoom = 10) => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({ center: [lng, lat], zoom, duration: 1500 });
  }, []);

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return;
    const effectiveData = geoData || loadOfflineData<any>('geoData');
    if (!effectiveData) return;

    const match = effectiveData.regions?.find(
      (r: any) => r.name?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    if (match) {
      flyToLocation(Number(match.lat), Number(match.lng));
      toast.success(`Found: ${match.name}`);
    } else {
      toast.error(`No region found matching "${searchQuery}"`);
    }
  }, [searchQuery, geoData, flyToLocation]);

  const handleGetLocation = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setLatitude(String(lat.toFixed(4)));
        setLongitude(String(lng.toFixed(4)));
        flyToLocation(lat, lng, 12);
        toast.success('Location found');
      },
      () => toast.error('Could not get your location'),
      { enableHighAccuracy: true }
    );
  }, [flyToLocation]);

  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-[350px]">
          <CardHeader><CardTitle>Access Denied</CardTitle></CardHeader>
          <CardContent><p>Please log in to view the Geospatial Risk Map.</p></CardContent>
        </Card>
      </div>
    );
  }

  const effectiveData = geoData || loadOfflineData<any>('geoData');
  const regions = effectiveData?.regions || [];
  const riskZones = effectiveData?.riskZones || [];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header toolbar */}
      <div className="flex items-center gap-2 p-3 bg-background border-b">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search regions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleSearch}>
            <Search className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleGetLocation}>
            <Navigation className="h-4 w-4 mr-1" /> My Location
          </Button>
        </div>

        <div className="flex items-center gap-1">
          {(['zones', 'risk', 'heatmap', 'agents'] as const).map((layer) => (
            <Button
              key={layer}
              variant={activeLayer === layer ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveLayer(layer)}
            >
              {layer === 'zones' && <MapPin className="h-3 w-3 mr-1" />}
              {layer === 'risk' && <Shield className="h-3 w-3 mr-1" />}
              {layer === 'heatmap' && <Layers className="h-3 w-3 mr-1" />}
              {layer === 'agents' && <Navigation className="h-3 w-3 mr-1" />}
              {layer.charAt(0).toUpperCase() + layer.slice(1)}
            </Button>
          ))}
        </div>

        <Badge variant={isOnline ? 'default' : 'destructive'} className="ml-2">
          {isOnline ? <Wifi className="h-3 w-3 mr-1" /> : <WifiOff className="h-3 w-3 mr-1" />}
          {isOnline ? 'Online' : 'Offline'}
        </Badge>
      </div>

      {/* Main content: map + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative">
          <div ref={mapContainerRef} className="w-full h-full" />
          {isGeoLoading && (
            <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="w-80 border-l bg-background overflow-y-auto">
          {/* Analysis card */}
          <Card className="m-3">
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Quick Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Latitude</Label>
                  <Input
                    type="number"
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Longitude</Label>
                  <Input
                    type="number"
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={() => {
                  flyToLocation(parseFloat(latitude), parseFloat(longitude));
                  analyzeMutation.mutate({ location: { lat: parseFloat(latitude), lng: parseFloat(longitude) } });
                }}
                disabled={analyzeMutation.isLoading}
              >
                {analyzeMutation.isLoading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                Analyze Location
              </Button>
            </CardContent>
          </Card>

          {/* Selected zone */}
          {selectedZone && (
            <Card className="m-3 border-2 border-primary">
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  {selectedZone.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Risk Level</span>
                  <Badge
                    style={{ background: RISK_COLORS[selectedZone.risk] }}
                    className="text-white"
                  >
                    {selectedZone.risk.toUpperCase()}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Policies</span>
                  <span className="font-medium">{selectedZone.policies?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Claims</span>
                  <span className="font-medium">{selectedZone.claims?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Loss Ratio</span>
                  <span className="font-medium">{selectedZone.lossRatio}%</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Regions list */}
          <div className="px-3 pb-3">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1">
              <MapPin className="h-3 w-3" /> Regions ({regions.length})
            </h3>
            <div className="space-y-1">
              {regions.map((region: any, i: number) => (
                <button
                  key={i}
                  className="w-full text-left p-2 rounded hover:bg-muted transition text-sm flex items-center justify-between"
                  onClick={() => {
                    flyToLocation(Number(region.lat), Number(region.lng));
                    setSelectedZone({
                      name: region.name,
                      risk: region.lossRatio > 50 ? 'high' : region.lossRatio > 40 ? 'medium' : 'low',
                      polygon: [],
                      policies: region.policies,
                      claims: region.claims,
                      lossRatio: Number(region.lossRatio),
                    });
                  }}
                >
                  <span>{region.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{region.policies} policies</span>
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{
                        background: RISK_COLORS[region.lossRatio > 50 ? 'high' : region.lossRatio > 40 ? 'medium' : 'low'],
                      }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Risk zones */}
          {riskZones.length > 0 && (
            <div className="px-3 pb-3">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Risk Zones ({riskZones.length})
              </h3>
              <div className="space-y-1">
                {riskZones.map((zone: any, i: number) => (
                  <div key={i} className="p-2 rounded bg-muted text-sm flex items-center justify-between">
                    <span>{zone.name}</span>
                    <Badge
                      variant="outline"
                      style={{ borderColor: RISK_COLORS[zone.level], color: RISK_COLORS[zone.level] }}
                    >
                      {zone.level}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
