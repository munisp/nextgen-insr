/**
 * TelematicsScreen.tsx — 2026-10-03 (W9-B4): HONEST UNAVAILABLE STATE.
 *
 * This screen previously called telematics.getDrivingScore /
 * telematics.getHistory / telematics.recordEvent (innovationRouters.ts).
 * Those are policy-linked UBI surfaces; per the W9-B4 mobile rewire, only
 * the hardened member* routers (server/routers/member*.ts) are member-safe
 * channels for this app, and NO member* telematics procedure exists. Rather
 * than leave calls to a non-member router on a funds-adjacent (premium
 * adjustment) surface, the screen now fails loud with an honest unavailable
 * state. No score, trip, or premium-adjustment figure is fabricated.
 *
 * Server gap (feeds W9-B5): to restore this screen, the monolith would need
 * a memberTelematics router — myDrivingScore/myTrips scoped by
 * assertPolicyOwnershipDual, and a member-safe trip-ingest mutation with
 * device attestation (recordEvent trusts client-supplied metrics today).
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";

const TelematicsScreen: React.FC = () => {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Telematics Unavailable</Text>
      <Text style={styles.body}>
        Driving-score and trip tracking are not available on this channel yet.
        Your premium is never adjusted by unverified data — any usage-based
        discount is applied only through your agent after verified telematics
        review.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: "#f8fafc" },
  title: { fontSize: 18, fontWeight: "700", color: "#1f2937", marginBottom: 12 },
  body: { fontSize: 14, color: "#6b7280", textAlign: "center", lineHeight: 22 },
});

export default TelematicsScreen;
