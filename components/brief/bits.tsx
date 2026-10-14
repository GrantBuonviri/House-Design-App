"use client";

export function Note({ text }: { text?: string }) {
  if (!text) return null;
  return <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{text}</p>;
}
