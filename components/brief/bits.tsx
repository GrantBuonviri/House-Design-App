"use client";

export function SourceBadge({ source }: { source: "ai" | "rules" | undefined }) {
  if (!source) return null;
  return source === "ai" ? (
    <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-800">Written by Claude</span>
  ) : (
    <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-700">Built-in suggestions</span>
  );
}

export function Note({ text }: { text?: string }) {
  if (!text) return null;
  return <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{text}</p>;
}

export function Working({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-sm text-muted" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-line border-t-accent" />
      {text}
    </div>
  );
}
