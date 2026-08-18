import { describe, expect, it } from "vitest";
import { sortByDescending } from "../src/lib/sorting";

describe("presentation sorting", () => {
  it("sorts values from largest to smallest with a stable id tie-breaker", () => {
    const result = sortByDescending(
      [
        { id: "team-b", value: 10 },
        { id: "team-c", value: 4 },
        { id: "team-a", value: 10 },
      ],
      (item) => item.value,
      (item) => item.id,
    );

    expect(result.map((item) => item.id)).toEqual(["team-a", "team-b", "team-c"]);
  });
});
