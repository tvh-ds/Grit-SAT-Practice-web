import { describe, expect, it } from "vitest";
import { findExistingTest, parseTestIdentity, type ExistingTestSource } from "../src/testIdentity";
const source = (label: string, extra: Partial<ExistingTestSource> = {}): ExistingTestSource => ({ id: "existing-test-id", kind: "test", label, status: "published", ...extra });

describe("existing SAT test identity", () => {
  it.each(["202609asiav2.pdf", "September 2026 Int 2", "2026 September International 2", "Sep 2026 Asia Version 02"])("recognizes renamed international test %s", label => {
    expect(parseTestIdentity(label)).toEqual({ year: 2026, month: 9, region: "int", variant: 2, section: undefined });
  });
  it("skips renamed full tests and existing draft imports", () => {
    expect(findExistingTest("202609asiav2.pdf", [source("September 2026 Int 2")]).decision).toBe("duplicate");
    expect(findExistingTest("202609asiav2.pdf", [source("2026 September Int 2", { kind: "import", status: "completed", contentScope: "full_test" })]).decision).toBe("duplicate");
  });
  it("keeps US/international, years, months and variants separate", () => {
    for (const label of ["2026 September US 2", "2025 September Int 2", "2026 October Int 2", "2026 September Int 3"]) {
      expect(findExistingTest("202609asiav2.pdf", [source(label)]).decision).toBe("new");
    }
  });
  it("holds ambiguous titles, partial matches, section tests and failed earlier imports", () => {
    for (const label of ["September 2026", "September 2026 Int", "September 2026 Int 2 Math"]) expect(findExistingTest("202609asiav2.pdf", [source(label)]).decision).toBe("review");
    expect(findExistingTest("202609asiav2.pdf", [source("September 2026 Int 2", { status: "failed" })]).decision).toBe("review");
    expect(findExistingTest("Mystery SAT paper.pdf", []).decision).toBe("review");
    expect(findExistingTest("202609asiav2.pdf", [source("September 2026 Int 2", { kind: "import", contentScope: "math" })]).decision).toBe("review");
  });
});
