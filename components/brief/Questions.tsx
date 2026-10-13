"use client";

import type { ReactNode } from "react";
import type { DiscoveryAnswers, Plot, Profile } from "@/lib/model/schema";
import { ACCESSIBILITY_OPTIONS, EXTRA_ROOM_OPTIONS, OUTDOOR_OPTIONS, STYLE_WORD_SUGGESTIONS } from "@/lib/brief/rooms";
import { plotImplications } from "@/lib/land/implications";
import { Choice, Field, MultiChoice, Scale, Stepper, TagEditor } from "./controls";

type Props = {
  answers: DiscoveryAnswers;
  setAnswers: (patch: Partial<DiscoveryAnswers>, key: string) => void;
  profile: Profile;
  setProfile: (patch: Partial<Profile>, key: string) => void;
  plot: Plot | null;
};

type Step = { title: string; intro: string; body: (p: Props) => ReactNode };

/** The question pages, in order. Each one is a few related questions. */
export const QUESTION_STEPS: Step[] = [
  {
    title: "Who will live here?",
    intro: "This sets how many bedrooms make sense and where quiet spaces go.",
    body: ({ profile, setProfile }) => (
      <div className="grid grid-cols-2 gap-6">
        <Field label="Adults">
          <Stepper label="adults" min={1} value={profile.adults ?? 2} onChange={(n) => setProfile({ adults: n }, "adults")} />
        </Field>
        <Field label="Kids">
          <Stepper label="kids" value={profile.kids ?? 0} onChange={(n) => setProfile({ kids: n }, "kids")} />
        </Field>
        <Field label="People who work from home">
          <Stepper
            label="people who work from home"
            max={6}
            value={profile.workFromHome ?? 0}
            onChange={(n) => setProfile({ workFromHome: n }, "wfh")}
          />
        </Field>
        <Field label="Older relatives living here or visiting often?">
          <Choice
            label="Older relatives"
            value={profile.olderRelatives ? "yes" : "no"}
            options={[
              { value: "no", label: "No" },
              { value: "yes", label: "Yes" },
            ]}
            onChange={(v) => setProfile({ olderRelatives: v === "yes" }, "older")}
          />
        </Field>
        <div className="col-span-2">
          <label className="field-label" htmlFor="pets">
            Pets
          </label>
          <input
            id="pets"
            className="input"
            placeholder="For example: two big dogs, one cat"
            maxLength={200}
            value={profile.pets ?? ""}
            onChange={(e) => setProfile({ pets: e.target.value || undefined }, "pets")}
          />
        </div>
        <div className="col-span-2">
          <p className="field-label">Rough budget for the house (optional)</p>
          <div className="flex items-center gap-3">
            <MoneyInput
              label="Budget low"
              value={profile.budget?.low}
              onChange={(low) => setProfile({ budget: { ...profile.budget, low } }, "budget.low")}
            />
            <span className="text-sm text-muted">to</span>
            <MoneyInput
              label="Budget high"
              value={profile.budget?.high}
              onChange={(high) => setProfile({ budget: { ...profile.budget, high } }, "budget.high")}
            />
          </div>
          <p className="field-hint">Not including the land. The cost panel arrives in milestone 8.</p>
        </div>
      </div>
    ),
  },
  {
    title: "How big should it be?",
    intro: "Floors, bedrooms and bathrooms.",
    body: ({ answers: a, setAnswers, plot }) => {
      const foundation = plot ? plotImplications(plot).foundation : null;
      const suitsBasement = foundation?.type === "walkout" || foundation?.type === "stepped";
      return (
        <div className="grid grid-cols-2 gap-6">
          <Field label="Floors above ground">
            <Choice
              label="Floors above ground"
              value={String(a.floors)}
              options={[
                { value: "1", label: "One story" },
                { value: "2", label: "Two stories" },
                { value: "3", label: "Three" },
              ]}
              onChange={(v) => setAnswers({ floors: Number(v) }, "floors")}
            />
          </Field>
          <Field
            label="Basement"
            hint={
              foundation
                ? suitsBasement
                  ? "Your land slopes enough for a walkout basement with daylight and its own door."
                  : "Your land is fairly flat, so a basement would be fully underground."
                : undefined
            }
          >
            <Choice
              label="Basement"
              value={a.basement}
              options={[
                { value: "if-land-suits", label: "If the land suits it" },
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
              onChange={(basement) => setAnswers({ basement }, "basement")}
            />
          </Field>
          <Field label="Bedrooms" hint="Including the primary bedroom.">
            <Stepper label="bedrooms" min={1} value={a.bedrooms} onChange={(bedrooms) => setAnswers({ bedrooms }, "bedrooms")} />
          </Field>
          <Field label="Full bathrooms" hint="Including the primary bath.">
            <Stepper label="full bathrooms" min={1} value={a.fullBaths} onChange={(fullBaths) => setAnswers({ fullBaths }, "fullBaths")} />
          </Field>
          <Field label="Half baths (powder rooms)">
            <Stepper label="half baths" max={3} value={a.halfBaths} onChange={(halfBaths) => setAnswers({ halfBaths }, "halfBaths")} />
          </Field>
          {a.floors > 1 && (
            <Field label="Primary suite on">
              <Choice
                label="Primary suite on"
                value={a.primarySuite}
                options={[
                  { value: "main", label: "Main floor" },
                  { value: "upper", label: "Upstairs" },
                  { value: "either", label: "Either" },
                ]}
                onChange={(primarySuite) => setAnswers({ primarySuite }, "primarySuite")}
              />
            </Field>
          )}
        </div>
      );
    },
  },
  {
    title: "Kitchen and everyday spaces",
    intro: "The rooms you use every day.",
    body: ({ answers: a, setAnswers }) => (
      <div className="grid grid-cols-2 gap-6">
        <Field label="Kitchen">
          <Choice
            label="Kitchen"
            value={a.kitchen}
            options={[
              { value: "open", label: "Open to living" },
              { value: "semi", label: "Partly open" },
              { value: "closed", label: "Its own room" },
            ]}
            onChange={(kitchen) => setAnswers({ kitchen }, "kitchen")}
          />
        </Field>
        <Field label="Dining">
          <Choice
            label="Dining"
            value={a.dining}
            options={[
              { value: "eat-in", label: "Table in the kitchen" },
              { value: "open", label: "Open dining area" },
              { value: "separate", label: "Separate dining room" },
            ]}
            onChange={(dining) => setAnswers({ dining }, "dining")}
          />
        </Field>
        <Field label="Pantry">
          <Choice
            label="Pantry"
            value={a.pantry}
            options={[
              { value: "walk-in", label: "Walk-in" },
              { value: "cabinet", label: "Pantry cabinet" },
              { value: "none", label: "None" },
            ]}
            onChange={(pantry) => setAnswers({ pantry }, "pantry")}
          />
        </Field>
        <Field label="Mudroom" hint="A drop zone for coats, shoes and bags by the side door.">
          <Choice
            label="Mudroom"
            value={a.mudroom ? "yes" : "no"}
            options={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
            onChange={(v) => setAnswers({ mudroom: v === "yes" }, "mudroom")}
          />
        </Field>
        <Field label="Laundry">
          <Choice
            label="Laundry"
            value={a.laundry}
            options={[
              { value: "near-bedrooms", label: "Near the bedrooms" },
              { value: "off-mudroom", label: "Off the mudroom" },
              { value: "basement", label: "In the basement" },
            ]}
            onChange={(laundry) => setAnswers({ laundry }, "laundry")}
          />
        </Field>
        <Field label="Home offices">
          <Stepper label="home offices" max={4} value={a.offices} onChange={(offices) => setAnswers({ offices }, "offices")} />
        </Field>
      </div>
    ),
  },
  {
    title: "Garage, storage and extras",
    intro: "Pick anything that sounds right. You can change it all in the brief.",
    body: ({ answers: a, setAnswers }) => (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-6">
          <Field label="Garage (cars)">
            <Stepper label="garage bays" max={4} value={a.garageBays} onChange={(garageBays) => setAnswers({ garageBays }, "garageBays")} />
          </Field>
          <Field label="Storage">
            <Choice
              label="Storage"
              value={a.storage}
              options={[
                { value: "light", label: "A little" },
                { value: "average", label: "Average" },
                { value: "lots", label: "Lots" },
              ]}
              onChange={(storage) => setAnswers({ storage }, "storage")}
            />
          </Field>
        </div>
        <Field label="Extra rooms">
          <MultiChoice
            label="Extra rooms"
            value={a.extraRooms}
            options={EXTRA_ROOM_OPTIONS.map((o) => o.label)}
            onChange={(extraRooms) => setAnswers({ extraRooms }, "extraRooms")}
          />
        </Field>
        <Field label="Outdoor living">
          <MultiChoice
            label="Outdoor living"
            value={a.outdoor}
            options={OUTDOOR_OPTIONS.map((o) => o.label)}
            onChange={(outdoor) => setAnswers({ outdoor }, "outdoor")}
          />
        </Field>
      </div>
    ),
  },
  {
    title: "How should it feel?",
    intro: "There are no wrong answers. Drag each slider toward what sounds like home.",
    body: ({ answers: a, setAnswers }) => (
      <div className="space-y-6">
        <Field label="Size of the rooms">
          <Scale left="Cozy, snug rooms" right="Airy, tall ceilings" value={a.cozyAiry} onChange={(cozyAiry) => setAnswers({ cozyAiry }, "cozyAiry")} />
        </Field>
        <Field label="Layout">
          <Scale left="Open, flowing spaces" right="Separate, defined rooms" value={a.openDefined} onChange={(openDefined) => setAnswers({ openDefined }, "openDefined")} />
        </Field>
        <Field label="Social life">
          <Scale
            left="A quiet retreat"
            right="Made for entertaining"
            value={a.quietEntertaining}
            onChange={(quietEntertaining) => setAnswers({ quietEntertaining }, "quietEntertaining")}
          />
        </Field>
        <div className="grid grid-cols-2 gap-6">
          <Field label="Bedroom privacy">
            <Choice
              label="Bedroom privacy"
              value={a.bedroomPrivacy}
              options={[
                { value: "together", label: "All close together" },
                { value: "split", label: "Primary apart" },
                { value: "separate-wing", label: "Primary in its own wing" },
              ]}
              onChange={(bedroomPrivacy) => setAnswers({ bedroomPrivacy }, "bedroomPrivacy")}
            />
          </Field>
          <Field label="Indoor-outdoor connection">
            <Choice
              label="Indoor-outdoor connection"
              value={a.indoorOutdoor}
              options={[
                { value: "low", label: "A little" },
                { value: "some", label: "Some" },
                { value: "lots", label: "Lots, big doors out" },
              ]}
              onChange={(indoorOutdoor) => setAnswers({ indoorOutdoor }, "indoorOutdoor")}
            />
          </Field>
        </div>
        <Field label="Accessibility needs">
          <MultiChoice
            label="Accessibility needs"
            value={a.accessibility}
            options={ACCESSIBILITY_OPTIONS}
            onChange={(accessibility) => setAnswers({ accessibility }, "accessibility")}
          />
        </Field>
      </div>
    ),
  },
  {
    title: "Your style and your day",
    intro: "In your own words. This is where the house starts to feel like yours.",
    body: ({ answers: a, setAnswers }) => (
      <div className="space-y-6">
        <Field label="Style words you like">
          <TagEditor
            label="Style words"
            value={a.styleWords}
            suggestions={STYLE_WORD_SUGGESTIONS}
            onChange={(styleWords) => setAnswers({ styleWords }, "styleWords")}
          />
        </Field>
        <div>
          <label className="field-label" htmlFor="daily-routine">
            Walk me through a typical day in the house
          </label>
          <textarea
            id="daily-routine"
            className="input min-h-28"
            maxLength={2000}
            placeholder="For example: up at 6, coffee by a sunny window, kids out the door through the garage, I work from home until 4, we cook together and eat on the patio in summer…"
            value={a.dailyRoutine}
            onChange={(e) => setAnswers({ dailyRoutine: e.target.value }, "dailyRoutine")}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="anything-else">
            Anything else that matters?
          </label>
          <textarea
            id="anything-else"
            className="input min-h-20"
            maxLength={2000}
            placeholder="Must-haves, things you never want again, hobbies that need space…"
            value={a.anythingElse}
            onChange={(e) => setAnswers({ anythingElse: e.target.value }, "anythingElse")}
          />
        </div>
      </div>
    ),
  },
];

function MoneyInput({ value, onChange, label }: { value?: number; onChange: (v: number | undefined) => void; label: string }) {
  return (
    <div className="relative w-44">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
      <input
        className="input pl-6"
        inputMode="numeric"
        aria-label={label}
        value={value ? value.toLocaleString("en-US") : ""}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/[^0-9]/g, ""));
          onChange(n > 0 ? n : undefined);
        }}
      />
    </div>
  );
}

export type { Props as QuestionProps };
