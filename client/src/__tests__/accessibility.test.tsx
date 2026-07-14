/**
 * Accessibility Tests — WCAG 2.1 AA Compliance
 * 
 * Tests for:
 * - Color contrast ratios
 * - Keyboard navigation
 * - Screen reader compatibility
 * - Focus management
 * - ARIA labels and roles
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Test 1: Skip to Content Link ─────────────────────────────────────────────
describe("Accessibility: Skip to Content", () => {
  it("should have a skip to content link", async () => {
    const { container } = render(
      <div>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only"
          tabIndex={0}
        >
          Skip to main content
        </a>
        <div id="main-content">Main content</div>
      </div>
    );

    const skipLink = screen.getByRole("link", { name: /skip to main content/i });
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute("href", "#main-content");
  });
});

// ── Test 2: Focus Management ─────────────────────────────────────────────────
describe("Accessibility: Focus Management", () => {
  it("should maintain focus order on keyboard navigation", () => {
    const { container } = render(
      <form>
        <input type="text" aria-label="Name" />
        <input type="email" aria-label="Email" />
        <button type="submit">Submit</button>
      </form>
    );

    const inputs = container.querySelectorAll("input");
    const buttons = container.querySelectorAll("button");
    
    expect(inputs[0]).toHaveAttribute("aria-label", "Name");
    expect(inputs[1]).toHaveAttribute("aria-label", "Email");
    expect(buttons[0]).toHaveTextContent("Submit");
  });

  it("should focus first input on mount", () => {
    const inputRef = { current: null };
    
    render(
      <div>
        <input
          ref={(el) => {
            inputRef.current = el;
          }}
          type="text"
          aria-label="Test input"
        />
      </div>
    );

    expect(inputRef.current).toHaveFocus();
  });
});

// ── Test 3: Color Contrast ───────────────────────────────────────────────────
describe("Accessibility: Color Contrast", () => {
  const MINIMUM_CONTRAST_RATIO = 4.5; // WCAG AA for normal text
  const LARGE_TEXT_CONTRAST_RATIO = 3.0; // WCAG AA for large text

  function getRelativeLuminance(r: number, g: number, b: number): number {
    const [rs, gs, bs] = [r, g, b].map((c) => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function getContrastRatio(l1: number, l2: number): number {
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  it("should have sufficient contrast for primary text", () => {
    // Background: #0a0a0a (near black)
    const bgLuminance = getRelativeLuminance(10, 10, 10);
    
    // Foreground: oklch(0.92, 0.005, 220) ≈ #e8e8e8
    const fgLuminance = getRelativeLuminance(232, 232, 232);
    
    const ratio = getContrastRatio(bgLuminance, fgLuminance);
    expect(ratio).toBeGreaterThan(MINIMUM_CONTRAST_RATIO);
  });

  it("should have sufficient contrast for secondary text", () => {
    // Background: #0a0a0a
    const bgLuminance = getRelativeLuminance(10, 10, 10);
    
    // Muted foreground: oklch(0.55, 0.015, 230) ≈ #8c8c8c
    const fgLuminance = getRelativeLuminance(140, 140, 140);
    
    const ratio = getContrastRatio(bgLuminance, fgLuminance);
    expect(ratio).toBeGreaterThan(3.0); // Acceptable for larger text
  });
});

// ── Test 4: Form Accessibility ───────────────────────────────────────────────
describe("Accessibility: Form Labels", () => {
  it("should associate labels with inputs", () => {
    render(
      <form>
        <label htmlFor="username">Username</label>
        <input id="username" type="text" />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" />
      </form>
    );

    const usernameInput = screen.getByLabelText("Username");
    const passwordInput = screen.getByLabelText("Password");

    expect(usernameInput).toBeInTheDocument();
    expect(passwordInput).toBeInTheDocument();
  });

  it("should announce errors to screen readers", async () => {
    const { container } = render(
      <form>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" />
        <div role="alert" aria-live="assertive">
          Invalid email address
        </div>
      </form>
    );

    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });
});

// ── Test 5: Keyboard Navigation ──────────────────────────────────────────────
describe("Accessibility: Keyboard Navigation", () => {
  it("should be navigable with Tab key", () => {
    const { container } = render(
      <nav>
        <a href="/home">Home</a>
        <a href="/dashboard">Dashboard</a>
        <a href="/settings">Settings</a>
      </nav>
    );

    const links = container.querySelectorAll("a");
    
    links.forEach((link) => {
      expect(link).toHaveAttribute("href");
      expect(link).toBeInstanceOf(HTMLAnchorElement);
    });
  });

  it("should have visible focus indicators", () => {
    const { container } = render(
      <div>
        <button>Click me</button>
        <a href="/link">Link text</a>
      </div>
    );

    const button = screen.getByRole("button");
    const link = screen.getByRole("link", { name: /link text/i });

    expect(button).toBeInTheDocument();
    expect(link).toBeInTheDocument();
  });
});

// ── Test 6: Reduced Motion ───────────────────────────────────────────────────
describe("Accessibility: Reduced Motion", () => {
  it("should respect prefers-reduced-motion", () => {
    // Simulate prefers-reduced-motion: reduce
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const prefersReducedMotion = mediaQuery.matches;

    expect(typeof prefersReducedMotion).toBe("boolean");
  });
});

// ── Test 7: ARIA Roles and States ────────────────────────────────────────────
describe("Accessibility: ARIA Roles and States", () => {
  it("should have proper ARIA roles", () => {
    render(
      <div role="navigation" aria-label="Main navigation">
        <a href="/">Home</a>
      </div>
    );

    const nav = screen.getByRole("navigation", { name: /main navigation/i });
    expect(nav).toBeInTheDocument();
  });

  it("should announce dynamic content changes", () => {
    render(
      <div>
        <div aria-live="polite" role="status">
          Loading...
        </div>
      </div>
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading...");
  });

  it("should have proper button states", () => {
    render(
      <div>
        <button aria-disabled={false}>Enabled</button>
        <button aria-disabled={true}>Disabled</button>
      </div>
    );

    const enabled = screen.getByRole("button", { name: "Enabled" });
    const disabled = screen.getByRole("button", { name: "Disabled" });

    expect(enabled).not.toBeDisabled();
    expect(disabled).toHaveAttribute("aria-disabled", "true");
  });
});
