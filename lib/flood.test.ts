import { describe, it, expect } from "vitest";
import {
  classifyFloodZone,
  floodInsuranceBump,
  floodInsuranceNote,
} from "./flood";

describe("classifyFloodZone", () => {
  it("classifies V and VE as high risk + coastal high-velocity", () => {
    expect(classifyFloodZone("V", "")).toMatchObject({
      risk: "high",
      isCoastalHigh: true,
    });
    expect(classifyFloodZone("VE", "")).toMatchObject({
      risk: "high",
      isCoastalHigh: true,
    });
  });

  it("classifies A / AE / AH / AO / A99 as high risk, NOT coastal high-velocity", () => {
    for (const z of ["A", "AE", "AH", "AO", "A99"]) {
      const zone = classifyFloodZone(z, "");
      expect(zone.risk).toBe("high");
      expect(zone.isCoastalHigh).toBe(false);
    }
  });

  it("classifies shaded X (0.2% annual chance) as moderate", () => {
    const zone = classifyFloodZone("X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD");
    expect(zone.risk).toBe("moderate");
    expect(zone.isCoastalHigh).toBe(false);
  });

  it("classifies unshaded X (minimal hazard) as low risk", () => {
    const zone = classifyFloodZone("X", "AREA OF MINIMAL FLOOD HAZARD");
    expect(zone.risk).toBe("low");
  });

  it("classifies Zone D (undetermined) as low risk with the undetermined label", () => {
    const zone = classifyFloodZone("D", "");
    expect(zone.risk).toBe("low");
    expect(zone.label.toLowerCase()).toMatch(/undetermined/);
  });

  it("normalises whitespace and case in raw zone codes", () => {
    expect(classifyFloodZone("  ae  ", "").zone).toBe("AE");
    expect(classifyFloodZone("ve", "").zone).toBe("VE");
  });
});

describe("floodInsuranceBump", () => {
  it("V/VE (coastal high-velocity) get the biggest bump", () => {
    const ve = classifyFloodZone("VE", "");
    expect(floodInsuranceBump(ve)).toBeGreaterThanOrEqual(3000);
  });

  it("inland SFHA (AE) gets a moderate bump, less than coastal high-velocity", () => {
    const ae = classifyFloodZone("AE", "");
    const ve = classifyFloodZone("VE", "");
    expect(floodInsuranceBump(ae)).toBeGreaterThan(1000);
    expect(floodInsuranceBump(ae)).toBeLessThan(floodInsuranceBump(ve));
  });

  it("shaded X gets a small bump", () => {
    const shadedX = classifyFloodZone("X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD");
    const bump = floodInsuranceBump(shadedX);
    expect(bump).toBeGreaterThan(0);
    expect(bump).toBeLessThan(1000);
  });

  it("minimal X and zone D get zero bump", () => {
    expect(floodInsuranceBump(classifyFloodZone("X", ""))).toBe(0);
    expect(floodInsuranceBump(classifyFloodZone("D", ""))).toBe(0);
  });
});

describe("floodInsuranceNote", () => {
  it("formats the dollar bump and cites the raw FEMA zone", () => {
    const ae = classifyFloodZone("AE", "");
    const note = floodInsuranceNote(ae, 1800);
    expect(note).toMatch(/\$1,800/);
    expect(note).toMatch(/AE/);
  });
});
