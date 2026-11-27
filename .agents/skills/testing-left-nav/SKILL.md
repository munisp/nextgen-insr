---
name: testing-left-nav-improvements
description: Test the left nav sidebar features (search, favorites, recents, collapsible groups) in the InsurePortal customer portal. Use when verifying sidebar UI changes or localStorage persistence.
---

# Testing Left Nav Improvements

## Prerequisites
- Dev server running on localhost:5002 (or configured port)
- Chrome browser available for interaction

## Devin Secrets Needed
- None — the app runs in demo mode with no authentication required

## Setup
1. Start the dev server: `cd /home/ubuntu/repos/InsureTech/customer-portal-full && pnpm dev`
2. Navigate to `http://localhost:5002/dashboard`
3. Clear localStorage before testing for clean state:
   ```js
   localStorage.removeItem('insureportal_recent_pages');
   localStorage.removeItem('insureportal_favorites');
   localStorage.removeItem('insureportal_collapsed_groups');
   ```
4. Refresh the page after clearing localStorage

## Key Files
- `customer-portal-full/client/src/components/UnifiedLayout.tsx` — Main sidebar component with all 3 features
- Custom hooks: `useRecentPages()`, `useFavorites()`, `useCollapsedGroups()` (all in UnifiedLayout.tsx)
- localStorage keys: `insureportal_recent_pages`, `insureportal_favorites`, `insureportal_collapsed_groups`

## Test Procedures

### 1. Search Filtering
- Click the search bar (placeholder: "Search... (Ctrl+K)")
- Type "claims" — expect exactly 6 results across 2 groups (Claims Centre + Intelligent Services)
- Clear search (click X) — all groups should reappear
- Press Ctrl+K — search bar should focus from anywhere on the page

### 2. Favorites
- Hover a nav item to reveal the star icon on the right side
- Click the star to favorite — "Favorites" section should appear at the top of the sidebar
- The star icon might not have its own devinid — use JavaScript to click:
  ```js
  const items = document.querySelectorAll('.group\\/item');
  for (const item of items) {
    if (item.textContent.includes('Insurance Marketplace')) {
      item.querySelectorAll('button')[1].click();
      break;
    }
  }
  ```
- Refresh the page — favorites should persist (localStorage)
- Click the star again to unfavorite — Favorites section should disappear entirely

### 3. Recently Visited
- Click 3+ nav items via the sidebar
- "Recently Visited" section should appear below Favorites (or at top if no favorites)
- Items shown in most-recently-used (MRU) order, limited to 3 displayed
- Recently Visited persists across page refresh

### 4. Collapsible Groups
- Click a group header (e.g., "Insurance Products") to collapse
- All child items should hide; header remains visible with chevron indicator
- Refresh page — collapsed state should persist
- Click header again to re-expand — all items reappear

## Troubleshooting
- **Blank white page:** Check for `process is not defined` error. The vite.config.ts needs `define: { 'process.env': JSON.stringify({ NODE_ENV: 'development', DEMO_MODE: 'true' }) }` — this was fixed in PR #44.
- **Star icon not clickable via browser tool:** The star button uses CSS `opacity-0 group-hover/item:opacity-100` so it might not appear as a separate devinid. Use the JavaScript approach above.
- **Role switching:** Use the "Switch Role (Demo)" dropdown at the bottom of the sidebar to test different roles (Customer, Agent, Underwriter, Administrator). Each role shows a different subset of the 107 nav items.
- **Sidebar not visible:** The sidebar might be collapsed. Click the hamburger/toggle button in the header to expand it.

## Pass/Fail Criteria
- Search must filter items in real-time and show accurate result count
- Favorites must appear at top of sidebar and persist across refresh
- Recently Visited must track pages in MRU order and persist
- Collapsible groups must toggle and persist collapsed state
- All features must work independently and together without conflicts
