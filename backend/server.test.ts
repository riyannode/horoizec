import { beforeAll, describe, expect, it } from "bun:test";

let server: typeof import("./server").default;

beforeAll(async () => {
  process.env.DATABASE_PATH = ":memory:";
  ({ default: server } = await import("./server"));
});

describe("malformed JSON request bodies", () => {
  it.each(["/api/v1/claims", "/api/v1/proofs/verify"])("returns BAD_REQUEST for %s", async (path) => {
    const response = await server.fetch(new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });
});
