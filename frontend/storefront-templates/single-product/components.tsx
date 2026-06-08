/**
 * Single Product / DTC InsurancePortal Template Components
 * Hero-focused layout for product launches.
 */
import React, { useState } from "react";

interface StoreConfig {
  name: string;
  logo?: string;
}

interface Variant {
  id: number;
  name: string;
  sku: string;
  price: number;
  attributes: Record<string, string>;
  inStock: boolean;
}

interface ProductProps {
  name: string;
  description: string;
  price: number;
  currency?: string;
  imageUrls: string[];
  variants?: Variant[];
  onAddToCart?: (variantId?: number, quantity?: number) => void;
}

export function Header({ store }: { store: StoreConfig }) {
  return (
    <header className="sf-header">
      <span className="sf-header__logo">{store.name}</span>
      <div className="sf-header__actions">
        <a href="#product">Shop</a>
        <a href="#reviews">Reviews</a>
        <a href="#cart">Cart</a>
      </div>
    </header>
  );
}

export function Hero({
  title,
  tagline,
  subtitle,
  imageUrl,
  ctaText = "Shop Now",
}: {
  title: string;
  tagline?: string;
  subtitle?: string;
  imageUrl?: string;
  ctaText?: string;
}) {
  return (
    <section className="sf-hero">
      {imageUrl && (
        <img src={imageUrl} alt={title} className="sf-hero__image" />
      )}
      <div className="sf-hero__content">
        {tagline && <p className="sf-hero__tagline">{tagline}</p>}
        <h1 className="sf-hero__title">{title}</h1>
        {subtitle && <p className="sf-hero__subtitle">{subtitle}</p>}
        <a href="#product" className="sf-hero__cta">
          {ctaText}
        </a>
      </div>
    </section>
  );
}

export function ProductDetail({
  name,
  description,
  price,
  currency = "₦",
  imageUrls,
  variants,
  onAddToCart,
}: ProductProps) {
  const [selectedVariant, setSelectedVariant] = useState<number | undefined>(
    variants?.[0]?.id
  );
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);

  const currentPrice =
    variants?.find(v => v.id === selectedVariant)?.price || price;

  // Group variants by attribute type
  const variantGroups: Record<string, string[]> = {};
  variants?.forEach(v => {
    Object.entries(v.attributes).forEach(([key, value]) => {
      if (!variantGroups[key]) variantGroups[key] = [];
      if (!variantGroups[key].includes(value)) {
        variantGroups[key].push(value);
      }
    });
  });

  return (
    <section id="product" className="sf-container">
      <div className="sf-product-detail">
        <div className="sf-product-detail__gallery">
          {imageUrls[activeImage] && (
            <img src={imageUrls[activeImage]} alt={name} />
          )}
          {imageUrls.length > 1 && (
            <div className="sf-product-detail__thumbnails">
              {imageUrls.map((url, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImage(i)}
                  className={i === activeImage ? "active" : ""}
                >
                  <img src={url} alt={`${name} ${i + 1}`} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="sf-product-detail__info">
          <h2 className="sf-product-detail__name">{name}</h2>
          <div className="sf-product-detail__price">
            {currency}
            {currentPrice.toLocaleString()}
          </div>
          <p className="sf-product-detail__description">{description}</p>

          {Object.entries(variantGroups).map(([attrName, values]) => (
            <div key={attrName} className="sf-variants">
              <span className="sf-variants__label">{attrName}</span>
              <div className="sf-variants__options">
                {values.map(val => (
                  <button
                    key={val}
                    className={`sf-variants__option ${
                      variants?.find(v => v.id === selectedVariant)?.attributes[
                        attrName
                      ] === val
                        ? "sf-variants__option--active"
                        : ""
                    }`}
                    onClick={() => {
                      const match = variants?.find(
                        v => v.attributes[attrName] === val
                      );
                      if (match) setSelectedVariant(match.id);
                    }}
                  >
                    {val}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="sf-quantity">
            <button onClick={() => setQuantity(Math.max(1, quantity - 1))}>
              -
            </button>
            <span>{quantity}</span>
            <button onClick={() => setQuantity(quantity + 1)}>+</button>
          </div>

          <button
            className="sf-add-to-cart"
            onClick={() => onAddToCart?.(selectedVariant, quantity)}
          >
            Add to Cart — {currency}
            {(currentPrice * quantity).toLocaleString()}
          </button>
        </div>
      </div>
    </section>
  );
}

export function SocialProof({
  stats,
}: {
  stats: { value: string; label: string }[];
}) {
  return (
    <section className="sf-social-proof">
      <div className="sf-container">
        <div className="sf-social-proof__stats">
          {stats.map(stat => (
            <div key={stat.label}>
              <span className="sf-social-proof__stat-value">{stat.value}</span>
              <span className="sf-social-proof__stat-label">{stat.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
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
