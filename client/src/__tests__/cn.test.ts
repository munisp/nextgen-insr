import { describe, it, expect } from "vitest";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tests for the cn() utility (clsx + twMerge composition).
 * This is the standard utility for conditional Tailwind class merging.
 */

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

describe("cn() utility (clsx + twMerge)", () => {
  it("should pass through single class names", () => {
    expect(cn("text-red-500")).toBe("text-red-500");
    expect(cn("bg-blue-100")).toBe("bg-blue-100");
  });

  it("should merge multiple class names", () => {
    expect(cn("text-red-500", "bg-white")).toBe("text-red-500 bg-white");
  });

  it("should resolve falsy values", () => {
    expect(cn("base", false, undefined, null, "", 0)).toBe("base");
  });

  it("should merge conflicting Tailwind classes (last wins)", () => {
    // twMerge should resolve the conflict, keeping the last one
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    expect(cn("bg-blue-100", "bg-gray-200")).toBe("bg-gray-200");
    expect(cn("p-4", "p-8")).toBe("p-8");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("should merge conflicting font sizes correctly", () => {
    expect(cn("text-base", "text-xl")).toBe("text-xl");
  });

  it("should merge conflicting spacing correctly", () => {
    expect(cn("m-2", "m-4")).toBe("m-4");
    expect(cn("p-2", "p-6")).toBe("p-6");
  });

  it("should merge conflicting width/height correctly", () => {
    expect(cn("w-1/2", "w-full")).toBe("w-full");
    expect(cn("h-10", "h-screen")).toBe("h-screen");
  });

  it("should handle conditional classes with boolean expressions", () => {
    const isActive = true;
    expect(cn("base-class", isActive && "active-state")).toBe("base-class active-state");

    const isVisible = false;
    expect(cn("base-class", isVisible && "visible-state")).toBe("base-class");
  });

  it("should handle object-style conditional classes", () => {
    expect(cn("base", { "active": true, "disabled": false })).toBe("base active");
    expect(cn("base", { "active": false, "disabled": false })).toBe("base");
  });

  it("should handle array-style conditional classes", () => {
    const conditions = [true, false, true];
    expect(cn("base", conditions[0] && ["opt-a", "opt-b"], conditions[1] && "opt-c")).toBe(
      "base opt-a opt-b"
    );
  });

  it("should merge complex conflicting utilities", () => {
    // Border conflicts
    expect(cn("border-2", "border-4")).toBe("border-4");
    expect(cn("border-red-500", "border-blue-500")).toBe("border-blue-500");

    // Rounded conflicts
    expect(cn("rounded-md", "rounded-full")).toBe("rounded-full");

    // Shadow conflicts
    expect(cn("shadow-md", "shadow-lg")).toBe("shadow-lg");

    // Z-index conflicts
    expect(cn("z-10", "z-50")).toBe("z-50");
  });

  it("should preserve non-conflicting classes", () => {
    expect(cn("flex", "text-red-500", "bg-white", "rounded", "shadow-md")).toBe(
      "flex text-red-500 bg-white rounded shadow-md"
    );
  });

  it("should handle empty inputs", () => {
    expect(cn()).toBe("");
    expect(cn([])).toBe("");
    expect(cn(false)).toBe("");
  });

  it("should preserve both non-conflicting and important variants", () => {
    // twMerge keeps both: non-important is not removed by !important
    expect(cn("text-red-500", "!text-blue-500")).toBe("text-red-500 !text-blue-500");
  });
});
