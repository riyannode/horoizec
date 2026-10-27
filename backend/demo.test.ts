import { afterAll, beforeAll, describe, expect, it } from "bun:test";

let server: typeof import("./server").default;
let db: typeof import("./db").db | undefined;

function getDb(): typeof import("./db").db {
  if (!db) throw new Error("TEST_DATABASE_UNAVAILABLE");
  return db;
}

beforeAll(async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.HOROI_DEMO_MODE = "true";
  process.env.HOROI_TRUST_PROXY_CLIENT_IP = "true";
  process.env.NETWORK_ID = "zebra-regtest";
  ({ default: server } = await import("./server"));
  ({ db } = await import("./db"));
});

afterAll(async () => {
  if (db) {
    db.query("DELETE FROM nullifiers").run();
    db.query("DELETE FROM claims").run();
  }
  const { config } = await import("./config");
  config.HOROI_DEMO_MODE = false;
});

describe("Docker judge fixture", () => {
  it("uses the native HCP1 verifier and repeats an isolated SQLite replay walkthrough", async () => {
    const fixtureResponse = await server.fetch(new Request("http://localhost/api/v1/demo/fixture"));
    const fixture = await fixtureResponse.json() as { claimId: string; alternateNullifier: string; provenance: string };
    expect(fixtureResponse.status).toBe(200);
    expect(fixture.provenance).toBe("LOCAL SYNTHETIC TEST FIXTURE");

    const validResponse = await server.fetch(new Request("http://localhost/api/v1/demo/verify", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: "valid" }),
    }));
    expect(validResponse.status).toBe(200);
    expect(await validResponse.json()).toMatchObject({ valid: true, verifier: "horoi-verifier", alternateNullifier: fixture.alternateNullifier });

    const tamperedResponse = await server.fetch(new Request("http://localhost/api/v1/demo/verify", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: "tampered" }),
    }));
    expect(tamperedResponse.status).toBe(200);
    expect(await tamperedResponse.json()).toMatchObject({ valid: false, verifier: "horoi-verifier", verifierErrorCode: "INVALID_PROOF" });

    const request = () => server.fetch(new Request("http://localhost/api/v1/demo/submit", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fixtureId: "judge-hcp1" }),
    }));
    for (let run = 0; run < 2; run++) {
      const walkthrough = await request();
      expect(walkthrough.status).toBe(200);
      expect(await walkthrough.json()).toMatchObject({
        firstSubmission: { accepted: true },
        replay: { accepted: false, errorCode: "NULLIFIER_USED" },
        replayProtection: "note-level",
        state: "isolated-sqlite-per-run",
        alternateNullifier: fixture.alternateNullifier,
      });
    }

    const stored = getDb().query("SELECT COUNT(*) AS count FROM nullifiers WHERE claim_id = ? AND nullifier = ?").get(fixture.claimId, fixture.alternateNullifier) as { count: number };
    expect(stored.count).toBe(0);
  });

  it("limits per-client admissions using only the trusted proxy header", async () => {
    const request = (headers: Record<string, string>) => server.fetch(new Request("http://localhost/api/v1/demo/verify", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ scenario: "invalid" }),
    }));

    for (let i = 0; i < 9; i++) {
      expect((await request({ "x-forwarded-for": "192.0.2.44" })).status).toBe(400);
    }
    for (let i = 0; i < 8; i++) {
      expect((await request({ "x-horoi-client-ip": "192.0.2.44" })).status).toBe(400);
    }
    const limited = await request({ "x-horoi-client-ip": "192.0.2.44" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("bounds concurrent native verifier requests", async () => {
    const request = (address: string) => server.fetch(new Request("http://localhost/api/v1/demo/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-horoi-client-ip": address },
      body: JSON.stringify({ scenario: "valid" }),
    }));
    const responses = await Promise.all([
      request("192.0.2.51"), request("192.0.2.52"), request("192.0.2.53"),
    ]);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(2);
    const limited = responses.find((response) => response.status === 429);
    expect(limited).toBeDefined();
    expect(Number(limited?.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("keeps demo rate limits out of normal mode", async () => {
    const { config } = await import("./config");
    config.HOROI_DEMO_MODE = false;
    try {
      for (let i = 0; i < 49; i++) {
        const response = await server.fetch(new Request("http://localhost/api/v1/proofs/verify", {
          method: "POST", headers: { "content-type": "application/json" }, body: "{}",
        }));
        expect(response.status).toBe(400);
      }
    } finally {
      config.HOROI_DEMO_MODE = true;
    }
  });

  it("keeps judge requests off the public-chain snapshot path", async () => {
    const creation = await server.fetch(new Request("http://localhost/api/v1/claims", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(creation.status).toBe(403);
    expect(await creation.json()).toMatchObject({ error: { code: "DEMO_READ_ONLY" } });

    const actions = await server.fetch(new Request("http://localhost/api/v1/snapshots/7596/actions?start=1&end=1"));
    expect(actions.status).toBe(403);
    expect(await actions.json()).toMatchObject({ error: { code: "DEMO_READ_ONLY" } });
  });
});
