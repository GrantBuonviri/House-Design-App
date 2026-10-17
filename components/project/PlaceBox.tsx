"use client";

import { useState } from "react";
import { LOCATION_FIELDS, type Location, type LocationField } from "@/lib/model/schema";
import { cityById, placeFromCity, placeLabel, searchCities, type City } from "@/lib/location/cities";
import { DEFAULT_PLACE, cityValue, editPlace, resetPlaceField } from "@/lib/location/current";
import { FIELD_INFO, placeSummary } from "@/lib/location/fields";
import { useProjectStore } from "@/lib/store/projectStore";

/**
 * "Where will you build?" on step one: type a city or state, pick it, and a
 * card shows the place's numbers. "Edit numbers" opens each one with a hint
 * and a way back to the city's own value.
 */
export default function PlaceBox() {
  const location = useProjectStore((s) => s.project!.location);
  const update = useProjectStore((s) => s.update);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState(0);
  const matches = searchCities(query);

  const setLocation = (loc: Location, coalesce?: string) => update((p) => ({ ...p, location: loc }), coalesce ? { coalesce } : undefined);

  const pick = (city: City) => {
    if (location?.edited.length && !window.confirm(`Replace the numbers you edited with ${placeLabel(city)}'s?`)) return;
    setLocation(placeFromCity(city));
    setQuery("");
    setOpen(false);
  };

  return (
    <div data-tour="place-picker">
      <label className="field-label" htmlFor="place-search">
        Where will you build?
      </label>
      <div className="relative">
        <input
          id="place-search"
          className="input"
          placeholder={location ? "Type another city or state to change it" : "Type a city or state, like Denver or Texas"}
          autoComplete="off"
          value={query}
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls="place-results"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, matches.length - 1));
            else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
            else if (e.key === "Enter" && matches[active]) pick(matches[active]);
            else if (e.key === "Escape") setOpen(false);
            else return;
            e.preventDefault();
          }}
        />
        {open && matches.length > 0 && (
          <ul id="place-results" role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-line bg-white py-1 shadow-lg" data-testid="place-results">
            {matches.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={`flex w-full justify-between px-3 py-1.5 text-left text-sm ${i === active ? "bg-stone-100" : "hover:bg-stone-50"}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(c)}
                >
                  <span>{placeLabel(c)}</span>
                  <span className="text-xs text-muted">{c.elsewhere ? "numbers from a typical city" : c.stateName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {location ? (
        <PlaceCard location={location} editing={editing} onToggleEdit={() => setEditing(!editing)} onChange={setLocation} />
      ) : (
        <p className="field-hint">Until you pick, the app uses {DEFAULT_PLACE.name}, {DEFAULT_PLACE.state} numbers. The place sets the sun, the weather the house is built for, and the cost level.</p>
      )}
    </div>
  );
}

function PlaceCard({ location, editing, onToggleEdit, onChange }: { location: Location; editing: boolean; onToggleEdit: () => void; onChange: (loc: Location, coalesce?: string) => void }) {
  const elsewhere = location.cityId.startsWith("elsewhere-");
  const unsure = (cityById(location.cityId)?.unverified ?? [])
    .filter((f): f is LocationField => f in FIELD_INFO && !location.edited.includes(f as LocationField))
    .map((f) => FIELD_INFO[f].label.toLowerCase());
  return (
    <div className="mt-3 rounded-md border border-line bg-stone-50 p-3" data-testid="place-card">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm">
          <span className="font-semibold">{placeLabel(location)}</span>
          <span className="text-muted"> · {placeSummary(location)}</span>
          {location.edited.length > 0 && <span className="ml-1 text-xs text-amber-700">({location.edited.length} edited)</span>}
        </p>
        <button type="button" className="btn shrink-0 text-xs" onClick={onToggleEdit} aria-expanded={editing}>
          {editing ? "Done" : "Edit numbers"}
        </button>
      </div>
      {elsewhere ? (
        <p className="mt-1 text-xs text-muted">These are a typical city&apos;s numbers for the state. Check them with your building department.</p>
      ) : unsure.length > 0 ? (
        <p className="mt-1 text-xs text-muted">Not yet confirmed from a published source: {unsure.join(", ")}. Check them with your building department.</p>
      ) : null}
      {editing && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {LOCATION_FIELDS.map((f) => (
            <PlaceField key={f} field={f} location={location} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlaceField({ field, location, onChange }: { field: LocationField; location: Location; onChange: (loc: Location, coalesce?: string) => void }) {
  const info = FIELD_INFO[field];
  const value = location[field];
  const edited = location.edited.includes(field);
  const original = cityValue(location, field);
  const id = `place-${field}`;
  const set = (v: string) => {
    if (info.choices) return onChange(editPlace(location, field, v as never), `location.${field}`);
    const n = Number(v);
    if (v.trim() === "" || !Number.isFinite(n)) return;
    onChange(editPlace(location, field, n as never), `location.${field}`);
  };
  return (
    <div>
      <label className="field-label flex items-center gap-1" htmlFor={id}>
        {info.label}
        {edited && <span className="inline-block size-1.5 rounded-full bg-amber-600" title="Edited" aria-label="edited" />}
      </label>
      <div className="flex items-center gap-2">
        {info.choices ? (
          <select id={id} className="input" value={String(value)} onChange={(e) => set(e.target.value)}>
            {info.choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          <input id={id} className="input" type="number" step={info.step} defaultValue={String(value)} key={`${location.cityId}-${String(value)}`} onChange={(e) => set(e.target.value)} />
        )}
        {info.unit && <span className="text-sm text-muted">{info.unit}</span>}
      </div>
      <p className="field-hint">{info.hint}</p>
      {edited && original !== undefined && (
        <button type="button" className="text-xs text-accent underline-offset-2 hover:underline" onClick={() => onChange(resetPlaceField(location, field))}>
          Back to {location.name}&apos;s number ({String(original)})
        </button>
      )}
    </div>
  );
}
