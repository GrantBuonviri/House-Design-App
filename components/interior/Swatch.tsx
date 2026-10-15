import type { CSSProperties } from "react";
import type { Product } from "@/lib/model/schema";

/** Lighter or darker version of a hex color, for drawing patterns. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** A drawn sample of a finish: its color with a simple pattern (planks, tile, stone, carpet, metal). */
export function swatchStyle(color: string, pattern: Product["pattern"] = "solid"): CSSProperties {
  const dark = shade(color, -0.18);
  const light = shade(color, 0.12);
  switch (pattern) {
    case "plank":
      return {
        backgroundColor: color,
        backgroundImage: `repeating-linear-gradient(0deg, ${dark} 0 1px, transparent 1px 22px),
          repeating-linear-gradient(90deg, transparent 0 60px, ${dark} 60px 61px, transparent 61px 140px),
          repeating-linear-gradient(0deg, ${light}55 0 3px, transparent 3px 9px, ${dark}22 9px 11px, transparent 11px 22px)`,
      };
    case "tile":
      return {
        backgroundColor: color,
        backgroundImage: `repeating-linear-gradient(0deg, ${light} 0 2px, transparent 2px 28px), repeating-linear-gradient(90deg, ${light} 0 2px, transparent 2px 28px)`,
      };
    case "stone":
      return {
        backgroundColor: color,
        backgroundImage: `radial-gradient(circle at 20% 30%, ${dark}66 0 2px, transparent 3px), radial-gradient(circle at 70% 60%, ${light}88 0 3px, transparent 4px),
          radial-gradient(circle at 45% 80%, ${dark}44 0 1.5px, transparent 2.5px), linear-gradient(115deg, transparent 40%, ${light}44 45%, transparent 55%)`,
        backgroundSize: "23px 19px, 31px 27px, 17px 21px, 100% 100%",
      };
    case "carpet":
      return {
        backgroundColor: color,
        backgroundImage: `repeating-linear-gradient(45deg, ${dark}33 0 1px, transparent 1px 3px), repeating-linear-gradient(-45deg, ${light}33 0 1px, transparent 1px 3px)`,
      };
    case "metal":
      return { backgroundColor: color, backgroundImage: `linear-gradient(135deg, ${light} 0%, ${color} 35%, ${dark} 60%, ${light} 85%, ${color} 100%)` };
    default:
      return { backgroundColor: color };
  }
}

export default function Swatch({ product, className = "", title }: { product: Pick<Product, "color" | "pattern" | "imageUrl" | "name">; className?: string; title?: string }) {
  if (product.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={product.imageUrl} alt={product.name} className={`object-cover ${className}`} title={title} />
    );
  }
  return <div className={className} style={swatchStyle(product.color ?? "#d9d6cf", product.pattern)} title={title ?? product.name} />;
}
