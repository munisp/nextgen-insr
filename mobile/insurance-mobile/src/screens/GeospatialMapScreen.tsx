/**
 * GeospatialMapScreen.tsx — 2026-10-03 (W9-B4): HONEST UNAVAILABLE STATE.
 *
 * This screen previously called worldView.getPolicyDensity and
 * worldView.getFloodRiskZones (server/routers/worldView.ts). worldView is a
 * PORTFOLIO-WIDE underwriting/analytics surface (policy density by LGA,
 * flood-risk polygons across ALL policies) — not member data — and no
 * member* router exposes a geospatial equivalent. Per the W9-B4 mobile
 * rewire the member app must not call non-member analytics routers, so the
 * screen now fails loud with this honest state. No density, zone, or risk
 * figure is fabricated; the previous offline cache of portfolio data is no
 * longer refreshed or shown.
 *
 * Server gap (feeds W9-B5): if member-facing geospatial value is wanted
 * (e.g. "flood risk at MY insured address"), the monolith would need a
 * member-safe procedure that resolves the caller's own insured locations
 * and returns only their property-level risk — never portfolio aggregates.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function GeospatialMapScreen() {
  return (
    <View style={styles.centered}>
      <Text style={styles.title}>Risk Maps Unavailable</Text>
      <Text style={styles.body}>
        Geospatial risk maps are not available on this channel. The portfolio
        risk views are internal underwriting tools and are not exposed to the
        member app. For flood or location risk on your insured property,
        please contact your agent.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#f8fafc' },
  title: { fontSize: 18, fontWeight: '700', color: '#1a365d', marginBottom: 12 },
  body: { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 22 },
});
