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
  it("uses the native HCP1 verifier and atomically rejects a same-domain replay", async () => {
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
    const accepted = await request();
    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toMatchObject({ accepted: true, replayProtection: "note-level" });
    const replay = await request();
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ error: { code: "NULLIFIER_USED" } });

    const stored = getDb().query("SELECT COUNT(*) AS count FROM nullifiers WHERE claim_id = ? AND nullifier = ?").get(fixture.claimId, fixture.alternateNullifier) as { count: number };
    expect(stored.count).toBe(1);

    getDb().query("DELETE FROM nullifiers WHERE claim_id = ? AND nullifier = ?").run(fixture.claimId, fixture.alternateNullifier);
    expect((await request()).status).toBe(201);
    expect((await request()).status).toBe(409);
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
