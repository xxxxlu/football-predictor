import { describe, expect, it } from "vitest";
import { generateQrMatrix } from "./qr-generator";

describe("qr-generator", () => {
  it("generates a square matrix for a typical URL", () => {
    const url = "https://pulse.app/r/vip-room-88";
    const matrix = generateQrMatrix(url);
    expect(Array.isArray(matrix)).toBe(true);
    expect(matrix.length).toBeGreaterThan(20);
    expect(matrix[0].length).toBe(matrix.length); // Must be a square

    // Finder patterns must be present at top-left
    expect(matrix[0][0]).toBe(true);
    expect(matrix[0][1]).toBe(true);
    expect(matrix[0][6]).toBe(true);
    expect(matrix[1][1]).toBe(false);
  });
});
