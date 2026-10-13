import { describe, expect, it } from "vitest";
import { formatFeetInches, formatSqFt, parseFeetInches } from "@/lib/model/units";

describe("formatFeetInches", () => {
  it.each([
    [0, '0"'],
    [6, '6"'],
    [12, "1'"],
    [150, "12' 6\""],
    [149.6, "12' 6\""],
    [-18, "-1' 6\""],
  ])("%s inches -> %s", (inches, text) => {
    expect(formatFeetInches(inches)).toBe(text);
  });
});

describe("parseFeetInches", () => {
  it.each([
    ["12' 6\"", 150],
    ["12'6", 150],
    ["12 ft 6 in", 150],
    ["12.5'", 150],
    ["150\"", 150],
    ["150 in", 150],
    ["12", 144],
    ["8'", 96],
  ])("%s -> %s inches", (text, inches) => {
    expect(parseFeetInches(text)).toBe(inches);
  });

  it.each(["", "abc", "12 6", "'"])("rejects %j", (text) => {
    expect(parseFeetInches(text)).toBeNull();
  });
});

describe("formatSqFt", () => {
  it("converts square inches to square feet", () => {
    expect(formatSqFt(144 * 2400)).toBe("2,400 sq ft");
  });
});
