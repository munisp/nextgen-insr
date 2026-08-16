import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";

export const geoFenceDedicatedRouter = router({
  zones: protectedProcedure.query(async () => {
    return {
      zones: [
        {
          id: "GZ-001",
          name: "Lagos Island",
          lat: 6.4541,
          lng: 3.4237,
          radius: 5000,
          status: "active",
          agentCount: 45,
        },
        {
          id: "GZ-002",
          name: "Victoria Island",
          lat: 6.4281,
          lng: 3.4219,
          radius: 3000,
          status: "active",
          agentCount: 30,
        },
      ],
    };
  }),
  agentLocations: protectedProcedure.query(async () => {
    return {
      locations: [
        {
          agentId: "AGT-001",
          lat: 6.4541,
          lng: 3.4237,
          lastSeen: new Date().toISOString(),
          zone: "Lagos Island",
        },
      ],
    };
  }),
  analytics: protectedProcedure.query(async () => {
    return {
      totalZones: 15,
      activeZones: 12,
      totalAgentsTracked: 150,
      complianceRate: 92,
      onlineAgents: 130,
    };
  }),
});
