/**
 * Marketplace Grid InsurancePortal Template Components
 * Compact grid layout for large catalogs with sidebar filters.
 */
import React from "react";

interface StoreConfig {
  name: string;
  logo?: string;
  primaryColor?: string;
  categories?: string[];
}

interface ProductCardProps {
  id: number;
  name: string;
  price: number;
  currency?: string;
  imageUrl?: string;
  vendor?: string;
  rating?: number;
  reviewCount?: number;
  onAddToCart?: (id: number) => void;
}

interface FilterOption {
  label: string;
  value: string;
  count?: number;
}

export function Header({
  store,
  onSearch,
}: {
  store: StoreConfig;
  onSearch?: (query: string) => void;
}) {
  return (
    <header className="sf-header">
      <div className="sf-container">
        <div className="sf-header__inner">
          <span className="sf-header__logo">{store.name}</span>
          <div className="sf-header__search">
            <input
              type="text"
              placeholder="Search products..."
              onChange={e => onSearch?.(e.target.value)}
            />
            <button type="button">Search</button>
          </div>
        </div>
      </div>
      {store.categories && (
        <nav className="sf-categories">
          <div className="sf-container">
            <ul className="sf-categories__list">
              {store.categories.map(cat => (
                <li key={cat}>
                  <a href={`#${cat.toLowerCase()}`}>{cat}</a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      )}
    </header>
  );
}

export function Sidebar({
  filters,
  onFilterChange,
}: {
  filters: { name: string; options: FilterOption[] }[];
  onFilterChange?: (filterName: string, value: string) => void;
}) {
  return (
    <aside className="sf-sidebar">
      {filters.map(group => (
        <div key={group.name} className="sf-sidebar__section">
          <h4 className="sf-sidebar__title">{group.name}</h4>
          {group.options.map(opt => (
            <label key={opt.value} className="sf-sidebar__option">
              <input
                type="checkbox"
                onChange={() => onFilterChange?.(group.name, opt.value)}
              />
              <span>
                {opt.label} {opt.count !== undefined && `(${opt.count})`}
              </span>
            </label>
          ))}
        </div>
      ))}
    </aside>
  );
}

export function ProductCard({
  id,
  name,
  price,
  currency = "₦",
  imageUrl,
  vendor,
  rating,
  reviewCount,
  onAddToCart,
}: ProductCardProps) {
  return (
    <article className="sf-product-card">
      <div className="sf-product-card__image">
        {imageUrl ? (
          <img src={imageUrl} alt={name} loading="lazy" />
        ) : (
          <div className="sf-product-card__placeholder" />
        )}
      </div>
      <div className="sf-product-card__info">
        <h3 className="sf-product-card__name">{name}</h3>
        <div className="sf-product-card__price">
          {currency}
          {price.toLocaleString()}
        </div>
        {vendor && <div className="sf-product-card__vendor">by {vendor}</div>}
        {rating !== undefined && (
          <div className="sf-product-card__rating">
            {"★".repeat(Math.round(rating))}
            {"☆".repeat(5 - Math.round(rating))}
            <span>({reviewCount || 0})</span>
          </div>
        )}
        <button
          className="sf-product-card__add"
          onClick={() => onAddToCart?.(id)}
        >
          Add to Cart
        </button>
      </div>
    </article>
  );
}

export function ProductGrid({ children }: { children: React.ReactNode }) {
  return <div className="sf-product-grid">{children}</div>;
}

export function Footer({ store }: { store: StoreConfig }) {
  return (
    <footer className="sf-footer">
      <div className="sf-container">
        <div className="sf-footer__grid">
          <div>
            <h4 className="sf-footer__title">About {store.name}</h4>
            <p>Your trusted marketplace for quality products.</p>
          </div>
          <div>
            <h4 className="sf-footer__title">Customer Service</h4>
            <ul className="sf-footer__links">
              <li>
                <a href="#help">Help Center</a>
              </li>
              <li>
                <a href="#returns">Returns</a>
              </li>
              <li>
                <a href="#shipping">Shipping Info</a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="sf-footer__title">Sell on {store.name}</h4>
            <ul className="sf-footer__links">
              <li>
                <a href="#become-seller">Become a Seller</a>
              </li>
              <li>
                <a href="#seller-guide">Seller Guide</a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="sf-footer__title">Connect</h4>
            <ul className="sf-footer__links">
              <li>
                <a href="#facebook">Facebook</a>
              </li>
              <li>
                <a href="#instagram">Instagram</a>
              </li>
              <li>
                <a href="#twitter">Twitter</a>
              </li>
            </ul>
          </div>
        </div>
        <p>
          &copy; {new Date().getFullYear()} {store.name}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
