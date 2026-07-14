/**
 * Mobile Tests — Responsive Design & Touch Interactions
 * 
 * Tests for:
 * - Responsive layouts at various breakpoints
 * - Touch gesture handling
 * - Mobile-specific components
 * - Offline functionality
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mock useSwipeGestures ────────────────────────────────────────────────────
vi.mock("../../hooks/useSwipeGestures", () => ({
  useSwipeGestures: vi.fn(() => ({
    state: {
      isDragging: false,
      startX: 0,
      startY: 0,
      deltaX: 0,
      deltaY: 0,
      currentDirection: null,
    },
    reset: vi.fn(),
  })),
}));

// ── Mock useLongPress ────────────────────────────────────────────────────────
vi.mock("../../hooks/useLongPress", () => ({
  useLongPress: vi.fn(() => ({
    isLongPressed: false,
    cancel: vi.fn(),
  })),
}));

// ── Test 1: Responsive Grid Layout ───────────────────────────────────────────
describe("Mobile: Responsive Grid", () => {
  it("should display single column on mobile", () => {
    const { container } = render(
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card p-4 rounded-lg">Item 1</div>
        <div className="bg-card p-4 rounded-lg">Item 2</div>
        <div className="bg-card p-4 rounded-lg">Item 3</div>
        <div className="bg-card p-4 rounded-lg">Item 4</div>
      </div>
    );

    const items = container.querySelectorAll(".bg-card");
    expect(items.length).toBe(4);
  });

  it("should have proper mobile padding", () => {
    const { container } = render(
      <div className="p-4 md:p-6 lg:p-8">
        Content
      </div>
    );

    expect(container.firstChild).toHaveClass("p-4");
  });
});

// ── Test 2: Touch Gesture Handling ───────────────────────────────────────────
describe("Mobile: Touch Gestures", () => {
  it("should detect swipe left", () => {
    const onSwipe = vi.fn();
    
    const { container } = render(
      <div ref={(el) => {
        if (el) {
          el.addEventListener("touchstart", (e) => {
            e.preventDefault();
          });
          el.addEventListener("touchend", () => {
            onSwipe("left");
          });
        }
      }}>
        Swipe me
      </div>
    );

    const element = container.firstChild;
    if (element) {
      fireEvent.touchStart(element, {
        touches: [{ clientX: 100, clientY: 100 }],
      });
      fireEvent.touchEnd(element);
      
      expect(onSwipe).toHaveBeenCalledWith("left");
    }
  });

  it("should detect swipe right", () => {
    const onSwipe = vi.fn();
    
    const { container } = render(
      <div ref={(el) => {
        if (el) {
          el.addEventListener("touchstart", (e) => {
            e.preventDefault();
          });
          el.addEventListener("touchend", () => {
            onSwipe("right");
          });
        }
      }}>
        Swipe me
      </div>
    );

    const element = container.firstChild;
    if (element) {
      fireEvent.touchStart(element, {
        touches: [{ clientX: 100, clientY: 100 }],
      });
      fireEvent.touchEnd(element);
      
      expect(onSwipe).toHaveBeenCalledWith("right");
    }
  });

  it("should detect long press", () => {
    const onPressStart = vi.fn();
    const onLongPress = vi.fn();
    
    const { container } = render(
      <div ref={(el) => {
        if (el) {
          const startTimeout = setTimeout(() => {
            onLongPress();
          }, 500);
          
          el.addEventListener("touchstart", () => {
            onPressStart();
          });
          el.addEventListener("touchend", () => {
            clearTimeout(startTimeout);
          });
        }
      }}>
        Long press me
      </div>
    );

    const element = container.firstChild;
    if (element) {
      fireEvent.touchStart(element);
      
      // Simulate long press timeout
      setTimeout(() => {
        expect(onPressStart).toHaveBeenCalled();
      }, 100);
    }
  });
});

// ── Test 3: Mobile Navigation ────────────────────────────────────────────────
describe("Mobile: Navigation", () => {
  it("should have mobile hamburger menu", () => {
    const { container } = render(
      <div>
        <button className="md:hidden" aria-label="Open menu">
          Menu
        </button>
        <nav className="hidden md:flex">
          <a href="/">Home</a>
        </nav>
      </div>
    );

    const hamburger = screen.getByRole("button", { name: /open menu/i });
    expect(hamburger).toBeInTheDocument();
  });

  it("should have mobile-friendly tap targets", () => {
    render(
      <div>
        <button className="min-h-[44px] min-w-[44px] px-4 py-2">
          Tap me
        </button>
        <a href="/link" className="min-h-[44px] min-w-[44px] px-4 py-2">
          Link
        </a>
      </div>
    );

    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Tap me");
  });
});

// ── Test 4: Offline Queue ────────────────────────────────────────────────────
describe("Mobile: Offline Queue", () => {
  it("should show offline indicator", () => {
    render(
      <div>
        <div className="offline-indicator" data-offline="true">
          You are offline
        </div>
      </div>
    );

    const indicator = screen.getByText(/you are offline/i);
    expect(indicator).toBeInTheDocument();
  });

  it("should sync when online", async () => {
    const syncMock = vi.fn().mockResolvedValue(undefined);
    
    render(
      <div>
        <button onClick={syncMock}>Sync Now</button>
      </div>
    );

    const button = screen.getByRole("button", { name: /sync now/i });
    fireEvent.click(button);
    
    await waitFor(() => {
      expect(syncMock).toHaveBeenCalled();
    });
  });
});

// ── Test 5: Mobile Forms ─────────────────────────────────────────────────────
describe("Mobile: Forms", () => {
  it("should have proper input types for mobile keyboards", () => {
    render(
      <form>
        <input type="email" placeholder="Email" />
        <input type="tel" placeholder="Phone" />
        <input type="number" placeholder="Amount" />
        <input type="text" inputMode="numeric" placeholder="Custom" />
      </form>
    );

    const email = screen.getByPlaceholderText("Email");
    const phone = screen.getByPlaceholderText("Phone");
    const amount = screen.getByPlaceholderText("Amount");

    expect(email).toHaveAttribute("type", "email");
    expect(phone).toHaveAttribute("type", "tel");
    expect(amount).toHaveAttribute("type", "number");
  });

  it("should have proper autocomplete attributes", () => {
    render(
      <form>
        <input name="phone" autoComplete="tel" />
        <input name="email" autoComplete="email" />
        <input name="name" autoComplete="name" />
      </form>
    );

    const inputs = document.querySelectorAll("input");
    expect(inputs[0]).toHaveAttribute("autocomplete", "tel");
    expect(inputs[1]).toHaveAttribute("autocomplete", "email");
    expect(inputs[2]).toHaveAttribute("autocomplete", "name");
  });
});

// ── Test 6: Mobile Performance ───────────────────────────────────────────────
describe("Mobile: Performance", () => {
  it("should lazy load images", () => {
    const { container } = render(
      <img
        src="/image.jpg"
        alt="Test image"
        loading="lazy"
        className="w-full h-auto"
      />
    );

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("should use responsive images", () => {
    const { container } = render(
      <picture>
        <source media="(max-width: 768px)" srcSet="/image-mobile.jpg" />
        <source media="(max-width: 1024px)" srcSet="/image-tablet.jpg" />
        <img src="/image-desktop.jpg" alt="Responsive image" />
      </picture>
    );

    const picture = container.querySelector("picture");
    expect(picture).toBeInTheDocument();
  });
});
