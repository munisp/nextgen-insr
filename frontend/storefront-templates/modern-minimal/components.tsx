/**
 * Modern Minimal InsurancePortal Template Components
 * Clean, image-first layout for fashion and lifestyle brands.
 */
import React from "react";

interface StoreConfig {
  name: string;
  logo?: string;
  banner?: string;
  primaryColor?: string;
  secondaryColor?: string;
  categories?: string[];
}

interface ProductCardProps {
  id: number;
  name: string;
  price: number;
  compareAtPrice?: number;
  currency?: string;
  imageUrl?: string;
  onAddToCart?: (id: number) => void;
}

export function Header({ store }: { store: StoreConfig }) {
  return (
    <header className="sf-header">
      <div className="sf-container">
        {store.logo ? (
          <img
            src={store.logo}
            alt={store.name}
            className="sf-header__logo-img"
          />
        ) : (
          <span className="sf-header__logo">{store.name}</span>
        )}
        {store.categories && (
          <nav className="sf-header__nav">
            {store.categories.map(cat => (
              <a key={cat} href={`#${cat.toLowerCase()}`}>
                {cat}
              </a>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}

export function Hero({
  title,
  subtitle,
  imageUrl,
  ctaText,
  ctaLink,
}: {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  ctaText?: string;
  ctaLink?: string;
}) {
  return (
    <section className="sf-hero">
      {imageUrl && (
        <img src={imageUrl} alt={title} className="sf-hero__image" />
      )}
      <div className="sf-hero__content">
        <h1 className="sf-hero__title">{title}</h1>
        {subtitle && <p className="sf-hero__subtitle">{subtitle}</p>}
        {ctaText && (
          <a href={ctaLink || "#shop"} className="sf-hero__cta">
            {ctaText}
          </a>
        )}
      </div>
    </section>
  );
}

export function ProductCard({
  id,
  name,
  price,
  compareAtPrice,
  currency = "₦",
  imageUrl,
  onAddToCart,
}: ProductCardProps) {
  const isOnSale = compareAtPrice && compareAtPrice > price;

  return (
    <article className="sf-product-card" onClick={() => onAddToCart?.(id)}>
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
          <span className={isOnSale ? "sf-product-card__price--sale" : ""}>
            {currency}
            {price.toLocaleString()}
          </span>
          {isOnSale && (
            <span className="sf-product-card__price--original">
              {currency}
              {compareAtPrice.toLocaleString()}
            </span>
          )}
        </div>
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
        <p>
          &copy; {new Date().getFullYear()} {store.name}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
