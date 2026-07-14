/**
 * Micro-Moment Insurance — Client SDK
 * Sub-second policy activation/deactivation
 * Supports GPS-triggered, event-triggered, and manual activation
 */

export interface MicroProduct {
  id: string;
  name: string;
  category: string;
  min_premium: number;
  max_premium: number;
  max_coverage: number;
  duration_type: 'minutes' | 'hours' | 'days' | 'rides';
  max_duration: number;
  description: string;
  activation_triggers: string[];
}

export interface MicroPolicy {
  id: string;
  product_id: string;
  customer_id: string;
  status: 'active' | 'expired' | 'canceled';
  premium: number;
  coverage: number;
  activated_at: string;
  expires_at: string;
  trigger_type: string;
}

export interface ActivateRequest {
  product_id: string;
  customer_id: string;
  duration: number;
  trigger_type: string;
  metadata?: Record<string, string>;
}

class MicroInsuranceClient {
  private baseUrl: string;

  constructor(baseUrl: string = '/api/v1/micro') {
    this.baseUrl = baseUrl;
  }

  async getProducts(category?: string): Promise<{ products: MicroProduct[]; total: number }> {
    const url = category
      ? `${this.baseUrl}/products?category=${category}`
      : `${this.baseUrl}/products`;
    const response = await fetch(url);
    return response.json();
  }

  async activate(request: ActivateRequest): Promise<{ policy: MicroPolicy; activation_ms: number }> {
    const response = await fetch(`${this.baseUrl}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Activation failed');
    }
    return response.json();
  }

  async deactivate(policyId: string): Promise<{ status: string; message: string }> {
    const response = await fetch(`${this.baseUrl}/deactivate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy_id: policyId }),
    });
    return response.json();
  }

  async getActivePolicies(customerId: string): Promise<{ policies: MicroPolicy[]; total: number }> {
    const response = await fetch(`${this.baseUrl}/policies?customer_id=${customerId}`);
    return response.json();
  }

  setupGPSTrigger(options: {
    productId: string;
    customerId: string;
    triggerZone: { lat: number; lng: number; radius: number };
    onEnter: () => void;
  }) {
    if (!('geolocation' in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const distance = this.haversine(
          position.coords.latitude,
          position.coords.longitude,
          options.triggerZone.lat,
          options.triggerZone.lng
        );
        if (distance <= options.triggerZone.radius) {
          options.onEnter();
          this.activate({
            product_id: options.productId,
            customer_id: options.customerId,
            duration: 1,
            trigger_type: 'gps_enter',
            metadata: {
              lat: String(position.coords.latitude),
              lng: String(position.coords.longitude),
            },
          });
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 30000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

export function createMicroInsuranceClient(baseUrl?: string): MicroInsuranceClient {
  return new MicroInsuranceClient(baseUrl);
}

export default MicroInsuranceClient;
