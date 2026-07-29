import { describe, expect, it } from "vitest";
import { projectIdFromUrl, projectUrl } from "./projectUrl";

describe("project URL", () => {
  it("builds the canonical create URL", () => {
    expect(projectUrl("232328328")).toBe("/create?id=232328328");
  });

  it("reads the canonical project id", () => {
    expect(projectIdFromUrl("https://example.com/create?id=232328328")).toBe(
      "232328328",
    );
  });

  it("accepts the project alias", () => {
    expect(projectIdFromUrl("/create?project=abc-123")).toBe("abc-123");
  });

  it("ignores project parameters outside the create route", () => {
    expect(projectIdFromUrl("https://example.com/?id=232328328")).toBe("");
  });
});
