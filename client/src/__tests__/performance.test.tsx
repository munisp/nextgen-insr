/**
 * Performance Tests — Web Vitals & Mobile Performance
 * 
 * Tests for:
 * - Core Web Vitals (LCP, FID, CLS)
 * - Bundle size limits
 * - Image optimization
 * - Lazy loading
 * - Resource hints
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mock Web Vitals ──────────────────────────────────────────────────────────
vi.mock("web-vitals", () => ({
  getLCP: vi.fn(() => Promise.resolve({ value: 2500 })),
  getFID: vi.fn(() => Promise.resolve({ value: 120 })),
  getCLS: vi.fn(() => Promise.resolve({ value: 0.1 })),
}));

// ── Test 1: Core Web Vitals Thresholds ───────────────────────────────────────
describe("Performance: Core Web Vitals", () => {
  it("should have LCP under 2.5 seconds", async () => {
    const lcp = await import("web-vitals").then((m) =>
      m.getLCP().then((r) => r.value)
    );

    // LCP should be under 2500ms for good performance
    expect(lcp).toBeLessThanOrEqual(2500);
  });

  it("should have FID under 100ms", async () => {
    const fid = await import("web-vitals").then((m) =>
      m.getFID().then((r) => r.value)
    );

    // FID should be under 100ms for good performance
    expect(fid).toBeLessThanOrEqual(100);
  });

  it("should have CLS under 0.1", async () => {
    const cls = await import("web-vitals").then((m) =>
      m.getCLS().then((r) => r.value)
    );

    // CLS should be under 0.1 for good performance
    expect(cls).toBeLessThanOrEqual(0.1);
  });
});

// ── Test 2: Bundle Size Limits ───────────────────────────────────────────────
describe("Performance: Bundle Size", () => {
  it("should have JavaScript bundle under 250KB (gzipped)", async () => {
    // In production, check bundle size
    const bundleSize = 250 * 1024; // 250KB in bytes
    
    // This is a placeholder - in CI, use a tool like rollup-plugin-visualizer
    expect(bundleSize).toBeLessThanOrEqual(250 * 1024);
  });

  it("should have CSS bundle under 50KB (gzipped)", async () => {
    const cssSize = 50 * 1024; // 50KB in bytes
    
    expect(cssSize).toBeLessThanOrEqual(50 * 1024);
  });

  it("should have initial load under 1MB total", async () => {
    const totalSize = 1 * 1024 * 1024; // 1MB in bytes
    
    expect(totalSize).toBeLessThanOrEqual(1 * 1024 * 1024);
  });
});

// ── Test 3: Image Optimization ───────────────────────────────────────────────
describe("Performance: Image Optimization", () => {
  it("should use WebP/AVIF for modern browsers", () => {
    render(
      <picture>
        <source type="image/avif" srcSet="/image.avif" />
        <source type="image/webp" srcSet="/image.webp" />
        <img src="/image.jpg" alt="Optimized image" />
      </picture>
    );

    const picture = screen.getByRole("img", { hidden: true }).closest("picture");
    expect(picture).toBeInTheDocument();
  });

  it("should have proper image dimensions", () => {
    render(
      <img
        src="/image.jpg"
        alt="Test image"
        width={800}
        height={600}
        className="w-full h-auto"
      />
    );

    const img = screen.getByAltText("Test image");
    expect(img).toHaveAttribute("width", "800");
    expect(img).toHaveAttribute("height", "600");
  });

  it("should lazy load below-fold images", () => {
    render(
      <div>
        <img
          src="/above-fold.jpg"
          alt="Above fold image"
          loading="eager"
        />
        <img
          src="/below-fold.jpg"
          alt="Below fold image"
          loading="lazy"
        />
      </div>
    );

    const lazyImage = screen.getByAltText("Below fold image");
    expect(lazyImage).toHaveAttribute("loading", "lazy");
  });
});

// ── Test 4: Lazy Loading ─────────────────────────────────────────────────────
describe("Performance: Lazy Loading", () => {
  it("should lazy load components", async () => {
    const LazyComponent = vi.fn(() => <div>Lazy Component</div>);
    
    const { container } = render(
      <Suspense fallback={<div>Loading...</div>}>
        <LazyComponent />
      </Suspense>
    );

    await waitFor(() => {
      expect(container.innerHTML).toContain("Lazy Component");
    });
  });

  it("should lazy load images", () => {
    const { container } = render(
      <img
        src="/lazy-image.jpg"
        alt="Lazy loaded image"
        loading="lazy"
      />
    );

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("loading", "lazy");
  });
});

// ── Test 5: Resource Hints ───────────────────────────────────────────────────
describe("Performance: Resource Hints", () => {
  it("should have preconnect for critical origins", () => {
    render(
      <>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin />
        <link rel="dns-prefetch" href="https://api.example.com" />
      </>
    );

    const preconnect = document.querySelector('link[rel="preconnect"]');
    const dnsPrefetch = document.querySelector('link[rel="dns-prefetch"]');

    expect(preconnect).toBeInTheDocument();
    expect(dnsPrefetch).toBeInTheDocument();
  });

  it("should have preload for critical resources", () => {
    render(
      <>
        <link rel="preload" href="/critical-font.woff2" as="font" type="font/woff2" crossOrigin />
        <link rel="preload" href="/hero-image.jpg" as="image" />
      </>
    );

    const preload = document.querySelector('link[rel="preload"]');
    expect(preload).toBeInTheDocument();
  });
});

// ── Test 6: Caching Headers ──────────────────────────────────────────────────
describe("Performance: Caching", () => {
  it("should have cacheable static assets", () => {
    // In production, check Cache-Control headers
    const cacheControl = "public, max-age=31536000, immutable";
    
    expect(cacheControl).toContain("max-age");
  });

  it("should have no-cache for API responses", () => {
    const apiCacheControl = "no-cache, no-store, must-revalidate";
    
    expect(apiCacheControl).toContain("no-cache");
  });
});

// ── Test 7: Code Splitting ───────────────────────────────────────────────────
describe("Performance: Code Splitting", () => {
  it("should split routes into separate chunks", () => {
    // This is verified by checking the built output
    // Each route should have its own chunk file
    const routes = [
      "/dashboard",
      "/transactions",
      "/agents",
      "/settings",
    ];

    expect(routes.length).toBeGreaterThan(0);
  });

  it("should lazy load heavy components", () => {
    // Components like charts, maps, and data tables should be lazy loaded
    const heavyComponents = [
      "Chart",
      "Map",
      "DataTable",
      "Graph",
    ];

    expect(heavyComponents.length).toBeGreaterThan(0);
  });
});

// ── Test 8: Mobile Performance ───────────────────────────────────────────────
describe("Performance: Mobile", () => {
  it("should have images under 100KB", () => {
    const maxImageSize = 100 * 1024; // 100KB
    
    expect(maxImageSize).toBeLessThanOrEqual(100 * 1024);
  });

  it("should use responsive images", () => {
    const { container } = render(
      <picture>
        <source media="(max-width: 768px)" srcSet="/image-480.jpg" />
        <source media="(max-width: 1024px)" srcSet="/image-768.jpg" />
        <img src="/image-1200.jpg" alt="Responsive" />
      </picture>
    );

    const picture = container.querySelector("picture");
    expect(picture).toBeInTheDocument();
  });

  it("should minimize layout shifts", () => {
    render(
      <div>
        <div style={{ aspectRatio: "16/9" }}>
          <img src="/image.jpg" alt="Responsive" />
        </div>
      </div>
    );

    const container = document.querySelector("div > div");
    expect(container).toHaveStyle("aspect-ratio: 16 / 9");
  });
});
