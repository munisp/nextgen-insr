import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Platform,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import MapView, { Marker, Circle, Callout, PROVIDER_DEFAULT } from 'react-native-maps';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const OFFLINE_CACHE_KEY = '@insureportal_geospatial_cache';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const RISK_COLORS: Record<string, string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
};

interface Region {
  name: string;
  lat: number;
  lng: number;
  policies: number;
  claims: number;
  lossRatio: number;
}

interface RiskZone {
  name: string;
  level: string;
  affectedPolicies: number;
}

const API_BASE = __DEV__
  ? Platform.OS === 'android'
    ? 'http://10.0.2.2:5002'
    : 'http://localhost:5002'
  : 'https://api.insureportal.ng';

async function fetchGeoData(): Promise<{ regions: Region[]; riskZones: RiskZone[] } | null> {
  try {
    const token = await AsyncStorage.getItem('@auth_token');
    const res = await fetch(`${API_BASE}/trpc/geospatial.data`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.result?.data || json;
  } catch {
    return null;
  }
}

async function saveOfflineCache(data: any): Promise<void> {
  try {
    await AsyncStorage.setItem(
      OFFLINE_CACHE_KEY,
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch {
    // Storage full
  }
}

async function loadOfflineCache(): Promise<any | null> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > CACHE_MAX_AGE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export default function GeospatialMapScreen() {
  const mapRef = useRef<MapView>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [riskZones, setRiskZones] = useState<RiskZone[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showList, setShowList] = useState(false);

  // Monitor network status
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(!!state.isConnected);
    });
    return () => unsubscribe();
  }, []);

  // Load data (online or offline)
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      let data = null;

      if (isOnline) {
        data = await fetchGeoData();
        if (data) {
          await saveOfflineCache(data);
        }
      }

      if (!data) {
        data = await loadOfflineCache();
        if (data && !isOnline) {
          Alert.alert('Offline Mode', 'Showing cached geospatial data.');
        }
      }

      if (data) {
        setRegions(
          (data.regions || []).map((r: any) => ({
            name: r.name,
            lat: Number(r.lat),
            lng: Number(r.lng),
            policies: Number(r.policies || 0),
            claims: Number(r.claims || 0),
            lossRatio: Number(r.lossRatio || 0),
          }))
        );
        setRiskZones(data.riskZones || []);
      }

      setIsLoading(false);
    }
    loadData();
  }, [isOnline]);

  const getRiskLevel = (lossRatio: number): string => {
    if (lossRatio > 50) return 'high';
    if (lossRatio > 40) return 'medium';
    return 'low';
  };

  const flyToRegion = useCallback(
    (region: Region) => {
      mapRef.current?.animateToRegion(
        {
          latitude: region.lat,
          longitude: region.lng,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        },
        1000
      );
      setSelectedRegion(region);
      setShowList(false);
    },
    []
  );

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return;
    const match = regions.find((r) =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    if (match) {
      flyToRegion(match);
    } else {
      Alert.alert('Not Found', `No region matching "${searchQuery}"`);
    }
  }, [searchQuery, regions, flyToRegion]);

  const filteredRegions = searchQuery.trim()
    ? regions.filter((r) =>
        r.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : regions;

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1a365d" />
        <Text style={styles.loadingText}>Loading geospatial data...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search regions..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
          <Text style={styles.searchButtonText}>Search</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.statusBadge, { backgroundColor: isOnline ? '#22c55e' : '#ef4444' }]}
          onPress={() => Alert.alert('Network', isOnline ? 'Connected' : 'Offline — cached data')}
        >
          <Text style={styles.statusText}>{isOnline ? 'Online' : 'Offline'}</Text>
        </TouchableOpacity>
      </View>

      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: 9.082,
          longitude: 8.6753,
          latitudeDelta: 10,
          longitudeDelta: 10,
        }}
        showsUserLocation
        showsMyLocationButton
        showsCompass
        showsScale
        mapType="standard"
      >
        {regions.map((region, i) => {
          const risk = getRiskLevel(region.lossRatio);
          return (
            <React.Fragment key={i}>
              <Marker
                coordinate={{ latitude: region.lat, longitude: region.lng }}
                pinColor={RISK_COLORS[risk]}
                onPress={() => setSelectedRegion(region)}
              >
                <View style={[styles.markerDot, { backgroundColor: RISK_COLORS[risk] }]}>
                  <Text style={styles.markerText}>{region.policies}</Text>
                </View>
                <Callout>
                  <View style={styles.callout}>
                    <Text style={styles.calloutTitle}>{region.name}</Text>
                    <Text>Policies: {region.policies.toLocaleString()}</Text>
                    <Text>Claims: {region.claims.toLocaleString()}</Text>
                    <Text>Loss Ratio: {region.lossRatio}%</Text>
                  </View>
                </Callout>
              </Marker>
              <Circle
                center={{ latitude: region.lat, longitude: region.lng }}
                radius={region.policies * 5}
                fillColor={`${RISK_COLORS[risk]}30`}
                strokeColor={RISK_COLORS[risk]}
                strokeWidth={1}
              />
            </React.Fragment>
          );
        })}
      </MapView>

      {/* Toggle list view */}
      <TouchableOpacity
        style={styles.listToggle}
        onPress={() => setShowList(!showList)}
      >
        <Text style={styles.listToggleText}>
          {showList ? 'Hide List' : `Show Regions (${regions.length})`}
        </Text>
      </TouchableOpacity>

      {/* List panel */}
      {showList && (
        <View style={styles.listPanel}>
          <ScrollView style={styles.listScroll}>
            {filteredRegions.map((region, i) => {
              const risk = getRiskLevel(region.lossRatio);
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.listItem,
                    selectedRegion?.name === region.name && styles.listItemSelected,
                  ]}
                  onPress={() => flyToRegion(region)}
                >
                  <View style={styles.listItemLeft}>
                    <View style={[styles.riskDot, { backgroundColor: RISK_COLORS[risk] }]} />
                    <Text style={styles.listItemName}>{region.name}</Text>
                  </View>
                  <View style={styles.listItemRight}>
                    <Text style={styles.listItemStat}>{region.policies} pol</Text>
                    <Text style={styles.listItemStat}>{region.lossRatio}%</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Selected region detail */}
      {selectedRegion && !showList && (
        <View style={styles.detailCard}>
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle}>{selectedRegion.name}</Text>
            <TouchableOpacity onPress={() => setSelectedRegion(null)}>
              <Text style={styles.closeButton}>X</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.detailGrid}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Policies</Text>
              <Text style={styles.detailValue}>{selectedRegion.policies.toLocaleString()}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Claims</Text>
              <Text style={styles.detailValue}>{selectedRegion.claims.toLocaleString()}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Loss Ratio</Text>
              <Text style={styles.detailValue}>{selectedRegion.lossRatio}%</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Risk Level</Text>
              <View
                style={[
                  styles.riskBadge,
                  { backgroundColor: RISK_COLORS[getRiskLevel(selectedRegion.lossRatio)] },
                ]}
              >
                <Text style={styles.riskBadgeText}>
                  {getRiskLevel(selectedRegion.lossRatio).toUpperCase()}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#64748b' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    height: 36,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    backgroundColor: '#f9fafb',
  },
  searchButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1a365d',
    borderRadius: 8,
  },
  searchButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  map: { flex: 1 },
  markerDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  markerText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  callout: { padding: 8, minWidth: 150 },
  calloutTitle: { fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  listToggle: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    backgroundColor: '#1a365d',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  listToggleText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  listPanel: {
    position: 'absolute',
    bottom: 60,
    left: 16,
    right: 16,
    maxHeight: 280,
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  listScroll: { padding: 8 },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  listItemSelected: { backgroundColor: '#eff6ff' },
  listItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listItemRight: { flexDirection: 'row', gap: 12 },
  listItemName: { fontSize: 14, fontWeight: '500' },
  listItemStat: { fontSize: 12, color: '#64748b' },
  riskDot: { width: 8, height: 8, borderRadius: 4 },
  detailCard: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    width: width * 0.55,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailTitle: { fontSize: 16, fontWeight: 'bold', color: '#1a365d' },
  closeButton: { fontSize: 16, color: '#94a3b8', fontWeight: 'bold' },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detailItem: {
    width: '45%',
    padding: 6,
    backgroundColor: '#f8fafc',
    borderRadius: 6,
  },
  detailLabel: { fontSize: 11, color: '#64748b' },
  detailValue: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  riskBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  riskBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
});
