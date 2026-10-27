import { beforeAll, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";


let server: typeof import("./server").default;
let db: typeof import("./db").db;
let Verifier: typeof import("./proof").Verifier;

beforeAll(async () => {
  process.env.DATABASE_PATH = ":memory:";
  ({ Verifier } = await import("./proof"));
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
  it.each(["/api/v1/claims", "/api/v1/claims/jobs", "/api/v1/proofs/verify"])("returns BAD_REQUEST for %s", async (path) => {
    const response = await server.fetch(new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });
});

describe("proof submission jobs", () => {
  it("returns before native verification and exposes the completed job result", async () => {
    const { config } = await import("./config");
    config.HOROI_DEMO_MODE = false;
    config.NETWORK_ID = "zebra-regtest";
    config.HOROI_TRUST_PROXY_CLIENT_IP = false;
    const claimId = "f".repeat(64);
    const now = Math.floor(Date.now() / 1000);
    db.query("INSERT INTO claims (id, protocol_version, network_id, name, description, asset_id, threshold, snapshot_height, commitment_root, exclusion_root, claim_domain, creator_nonce, expires_at, created_at) VALUES (?, 1, 'zebra-regtest', 'Job test', '', ?, '1', 1, ?, ?, ?, ?, NULL, ?)").run(
      claimId, "11".repeat(66), "00".repeat(32), "00".repeat(32), "test-domain", "22".repeat(32), now,
    );

    const create = await server.fetch(new Request(`http://localhost/api/v1/claims/${claimId}/submit/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claimId, protocolVersion: 1, proof: "AA==", alternateNullifiers: ["00".repeat(32)] }),
    }));
    expect(create.status).toBe(202);
    const started = await create.json() as { jobId: string; status: string };
    expect(started.status).toBe("running");
    expect(started).not.toHaveProperty("proof");

    let completed: { jobId: string; status: string; error?: { code: string } } | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await server.fetch(new Request(`http://localhost/api/v1/claims/${claimId}/submit/jobs/${started.jobId}`));
      completed = await response.json() as typeof completed;
      if (completed?.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(completed).toMatchObject({ jobId: started.jobId, status: "failed", error: { code: "PROOF_INVALID" } });
  });

  it("cancels a running job without exposing its submitted proof", async () => {
    const { config } = await import("./config");
    config.HOROI_DEMO_MODE = false;
    config.NETWORK_ID = "zebra-regtest";
    const claimId = "d".repeat(64);
    const now = Math.floor(Date.now() / 1000);
    db.query("INSERT INTO claims (id, protocol_version, network_id, name, description, asset_id, threshold, snapshot_height, commitment_root, exclusion_root, claim_domain, creator_nonce, expires_at, created_at) VALUES (?, 1, 'zebra-regtest', 'Job cancel test', '', ?, '1', 1, ?, ?, ?, ?, NULL, ?)").run(
      claimId, "11".repeat(66), "00".repeat(32), "00".repeat(32), "cancel-domain", "33".repeat(32), now,
    );
    const create = await server.fetch(new Request(`http://localhost/api/v1/claims/${claimId}/submit/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claimId, protocolVersion: 1, proof: "AA==", alternateNullifiers: ["00".repeat(32)] }),
    }));
    const started = await create.json() as { jobId: string };
    const cancel = await server.fetch(new Request(`http://localhost/api/v1/claims/${claimId}/submit/jobs/${started.jobId}/cancel`, { method: "POST" }));
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toMatchObject({ jobId: started.jobId, status: "cancelled" });
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

  it("returns a stable not-found error for unknown status and cancellation", async () => {
    const claimId = "e".repeat(64);
    const status = await server.fetch(new Request(`http://localhost/api/v1/claims/${claimId}/submit/jobs/missing`));
    expect(status.status).toBe(404);
    expect(await status.json()).toMatchObject({ error: { code: "PROOF_JOB_NOT_FOUND" } });

    const cancel = await server.fetch(new Request(`http://localhost/api/v1/claims/${claimId}/submit/jobs/missing/cancel`, { method: "POST" }));
    expect(cancel.status).toBe(404);
    expect(await cancel.json()).toMatchObject({ error: { code: "PROOF_JOB_NOT_FOUND" } });
  });
});

describe("claim creation jobs", () => {
  it("returns a stable not-found error for an unknown job and cancellation", async () => {
    const status = await server.fetch(new Request("http://localhost/api/v1/claims/jobs/missing"));
    expect(status.status).toBe(404);
    expect(await status.json()).toMatchObject({ error: { code: "CLAIM_JOB_NOT_FOUND" } });

    const cancel = await server.fetch(new Request("http://localhost/api/v1/claims/jobs/missing/cancel", { method: "POST" }));
    expect(cancel.status).toBe(404);
    expect(await cancel.json()).toMatchObject({ error: { code: "CLAIM_JOB_NOT_FOUND" } });
  });
});

describe("native verifier timeout recovery", () => {
  it("kills a timed-out child and starts a clean verifier for the next request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "horoi-verifier-"));
    const counterPath = join(directory, "starts");
    const verifierPath = join(directory, "verifier");
    const script = [
      "#!/bin/sh",
      "count=0",
      "if [ -f '__COUNTER__' ]; then count=$(cat '__COUNTER__'); fi",
      "count=$((count + 1))",
      "printf '%s' \"$count\" > '__COUNTER__'",
      "IFS= read -r request || exit 1",
      "if [ \"$count\" -eq 1 ]; then while IFS= read -r request; do :; done; fi",
      "echo '{\"valid\":true}'",
      "",
    ].join(String.fromCharCode(10)).replaceAll("__COUNTER__", counterPath);
    await writeFile(verifierPath, script);
    await chmod(verifierPath, 0o755);
    try {
      const verifier = new Verifier(verifierPath, 100);
      await expect(verifier.request({ operation: "timeout" })).rejects.toThrow("VERIFIER_UNAVAILABLE");
      await expect(verifier.request({ operation: "recovery" })).resolves.toEqual({ valid: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("snapshot creation admission", () => {
  it("does not consume snapshot budget for invalid requests or AssetIds", async () => {
    const { config } = await import("./config");
    config.HOROI_DEMO_MODE = false;
    config.HOROI_TRUST_PROXY_CLIENT_IP = false;
    for (let i = 0; i < 4; i++) {
      const invalid = await server.fetch(new Request("http://localhost/api/v1/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }));
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
    }
    const invalidAsset = await server.fetch(new Request("http://localhost/api/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Invalid asset",
        assetId: "00".repeat(66),
        threshold: "1",
        snapshotHeight: 1,
        expiresAt: null,
      }),
    }));
    expect(invalidAsset.status).toBe(400);
    expect(await invalidAsset.json()).toMatchObject({ error: { code: "INVALID_ASSET_ID" } });

    const invalidAssetJob = await server.fetch(new Request("http://localhost/api/v1/claims/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Invalid asset job",
        assetId: "00".repeat(66),
        threshold: "1",
        snapshotHeight: 1,
        expiresAt: null,
      }),
    }));
    expect(invalidAssetJob.status).toBe(400);
    expect(await invalidAssetJob.json()).toMatchObject({ error: { code: "INVALID_ASSET_ID" } });
  });
});

describe("native verifier cancellation", () => {
  it("does not start work for an already-aborted request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "horoi-verifier-already-aborted-"));
    const startsPath = join(directory, "starts");
    const verifierPath = join(directory, "verifier");
    await writeFile(verifierPath, `#!/bin/sh\nprintf started > '${startsPath}'\n`);
    await chmod(verifierPath, 0o755);
    try {
      const verifier = new Verifier(verifierPath);
      const controller = new AbortController();
      controller.abort();
      await expect(verifier.request({ operation: "never-start" }, controller.signal)).rejects.toThrow("SNAPSHOT_UNAVAILABLE");
      await expect(readFile(startsPath, "utf8")).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects queued cancellation immediately and never sends it to the child", async () => {
    const directory = await mkdtemp(join(tmpdir(), "horoi-verifier-queue-"));
    const logPath = join(directory, "requests");
    const releasePath = join(directory, "release");
    const startsPath = join(directory, "starts");
    const verifierPath = join(directory, "verifier");
    const script = [
      "#!/bin/sh",
      "count=0",
      "if [ -f '__STARTS__' ]; then count=$(cat '__STARTS__'); fi",
      "count=$((count + 1))",
      "printf '%s' \"$count\" > '__STARTS__'",
      "while IFS= read -r request; do",
      "echo \"$request\" >> '__LOG__'",
      "if [ \"$request\" = '{\"operation\":\"first\"}' ]; then while [ ! -f '__RELEASE__' ]; do sleep 0.01; done; fi",
      "echo '{\"valid\":true}'",
      "done",
      "",
    ].join(String.fromCharCode(10))
      .replaceAll("__LOG__", logPath)
      .replaceAll("__RELEASE__", releasePath)
      .replaceAll("__STARTS__", startsPath);
    await writeFile(verifierPath, script);
    await chmod(verifierPath, 0o755);
    let firstPending: Promise<unknown> | undefined;
    try {
      const verifier = new Verifier(verifierPath, 5000);
      const first = verifier.request({ operation: "first" });
      firstPending = first;
      let firstReceived = false;
      for (let i = 0; i < 100; i++) {
        try {
          firstReceived = (await readFile(logPath, "utf8")).includes('"operation":"first"');
        } catch {}
        if (firstReceived) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(firstReceived).toBe(true);

      const controller = new AbortController();
      const queued = verifier.request({ operation: "cancelled" }, controller.signal);
      const abortStartedAt = performance.now();
      controller.abort();
      await expect(queued).rejects.toThrow("SNAPSHOT_UNAVAILABLE");
      expect(performance.now() - abortStartedAt).toBeLessThan(100);
      expect((await readFile(logPath, "utf8")).trim().split(String.fromCharCode(10))).toHaveLength(1);

      await writeFile(releasePath, "go");
      await expect(first).resolves.toEqual({ valid: true });
      firstPending = undefined;
      await expect(verifier.request({ operation: "after" })).resolves.toEqual({ valid: true });
      const requests = (await readFile(logPath, "utf8")).trim().split(String.fromCharCode(10));
      expect(requests).toHaveLength(2);
      expect(requests[1]).toContain('"operation":"after"');
      expect((await readFile(startsPath, "utf8")).trim()).toBe("1");
    } finally {
      await writeFile(releasePath, "go").catch(() => undefined);
      if (firstPending) await firstPending.catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("kills and reaps an active child when its scan signal aborts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "horoi-verifier-abort-"));
    const counterPath = join(directory, "starts");
    const verifierPath = join(directory, "verifier");
    const script = [
      "#!/bin/sh",
      "count=0",
      "if [ -f '__COUNTER__' ]; then count=$(cat '__COUNTER__'); fi",
      "count=$((count + 1))",
      "printf '%s' \"$count\" > '__COUNTER__'",
      "IFS= read -r request || exit 1",
      "if [ \"$count\" -eq 1 ]; then while IFS= read -r request; do :; done; fi",
      "echo '{\"valid\":true}'",
      "",
    ].join(String.fromCharCode(10)).replaceAll("__COUNTER__", counterPath);
    await writeFile(verifierPath, script);
    await chmod(verifierPath, 0o755);
    try {
      const verifier = new Verifier(verifierPath, 5000);
      const controller = new AbortController();
      const active = verifier.request({ operation: "cancel" }, controller.signal);
      await new Promise((resolve) => setTimeout(resolve, 25));
      controller.abort();
      await expect(active).rejects.toThrow("SNAPSHOT_UNAVAILABLE");
      await expect(verifier.request({ operation: "after-abort" })).resolves.toEqual({ valid: true });
      expect((await readFile(counterPath, "utf8")).trim()).toBe("2");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
