import { describe, expect, it } from "vitest";
import { formatFeetInches, formatSqFt, lengthPreview, parseFeetInches, parseTypedLength } from "@/lib/model/units";

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
    ["12 6", 150],
    ["150", 1800],
    ["0 6", 6],
  ])("%s -> %s inches", (text, inches) => {
    expect(parseFeetInches(text)).toBe(inches);
  });

  it.each(["", "abc", "12 6 3", "'"])("rejects %j", (text) => {
    expect(parseFeetInches(text)).toBeNull();
  });
});

describe("parseTypedLength", () => {
  it("reads a plain number as feet, like every length box", () => {
    expect(parseTypedLength("150")).toBe(1800);
    expect(parseTypedLength("150\"")).toBe(150);
    expect(parseTypedLength("12'6")).toBe(150);
    expect(parseTypedLength("12 6")).toBe(150);
  });
  it("rejects zero and junk", () => {
    expect(parseTypedLength("0")).toBeNull();
    expect(parseTypedLength("abc")).toBeNull();
  });
});

describe("lengthPreview", () => {
  it("shows what the typed text means", () => {
    expect(lengthPreview("12 6")).toBe("= 12' 6\"");
    expect(lengthPreview("150")).toBe("= 150'");
    expect(lengthPreview("150\"")).toBe("= 12' 6\"");
    expect(lengthPreview("abc")).toBeNull();
    expect(lengthPreview("")).toBeNull();
  });
});

describe("formatSqFt", () => {
  it("converts square inches to square feet", () => {
    expect(formatSqFt(144 * 2400)).toBe("2,400 sq ft");
  });
});
