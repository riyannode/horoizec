import { beforeAll, describe, expect, it } from "bun:test";

let server: typeof import("./server").default;
let db: typeof import("./db").db;

beforeAll(async () => {
  process.env.DATABASE_PATH = ":memory:";
  ({ default: server } = await import("./server"));
  ({ db } = await import("./db"));
});

describe("claim status filtering", () => {
  it("filters before applying cursor and limit, while preserving unfiltered pagination", async () => {
    const now = Math.floor(Date.now() / 1000);
    const rows = [
      { id: "0".repeat(63) + "1", expiresAt: null },
      { id: "0".repeat(63) + "2", expiresAt: now - 1 },
      { id: "0".repeat(63) + "3", expiresAt: now + 3600 },
    ];
    for (const [index, row] of rows.entries()) {
      db.query("INSERT INTO claims (id, protocol_version, network_id, name, description, asset_id, threshold, snapshot_height, commitment_root, exclusion_root, claim_domain, creator_nonce, expires_at, created_at) VALUES (?, 1, 'zsa-testnet', ?, '', ?, '1', 1, ?, ?, ?, ?, ?, ?)").run(
        row.id, `claim-${index}`, "00".repeat(66), "00".repeat(32), "00".repeat(32),
        `domain-${index}`, `nonce-${index}`, row.expiresAt, now,
      );
    }

    const first = await server.fetch(new Request("http://localhost/api/v1/claims?status=active&limit=1"));
    const firstBody = await first.json() as { claims: Array<{ id: string }> };
    expect(first.status).toBe(200);
    expect(firstBody.claims.map((claim) => claim.id)).toEqual([rows[2]!.id]);

    const next = await server.fetch(new Request(`http://localhost/api/v1/claims?status=active&limit=1&cursor=${rows[2]!.id}`));
    const nextBody = await next.json() as { claims: Array<{ id: string }> };
    expect(next.status).toBe(200);
    expect(nextBody.claims.map((claim) => claim.id)).toEqual([rows[0]!.id]);

    const expired = await server.fetch(new Request("http://localhost/api/v1/claims?status=expired"));
    const expiredBody = await expired.json() as { claims: Array<{ id: string }> };
    expect(expired.status).toBe(200);
    expect(expiredBody.claims.map((claim) => claim.id)).toEqual([rows[1]!.id]);

    const unfiltered = await server.fetch(new Request("http://localhost/api/v1/claims?limit=2"));
    const unfilteredBody = await unfiltered.json() as { claims: Array<{ id: string }> };
    expect(unfiltered.status).toBe(200);
    expect(unfilteredBody.claims.map((claim) => claim.id)).toEqual([rows[2]!.id, rows[1]!.id]);

    const invalid = await server.fetch(new Request("http://localhost/api/v1/claims?status=used"));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });
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
