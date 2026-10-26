import { z } from "zod";
const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default("127.0.0.1"),
  NETWORK_ID: z.enum(["zebra-regtest", "zsa-testnet"]).default("zebra-regtest"),
  ZCASH_RPC_URL: z.string().url().default("http://127.0.0.1:18232"),
  ZCASH_RPC_USER: z.string().optional(),
  ZCASH_RPC_PASSWORD: z.string().optional(),
  HOROI_DEMO_MODE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  DATABASE_PATH: z.string().default("./horoi.db"),
  VERIFIER_PATH: z.string().default("./rust/target/release/horoi-verifier")
}).superRefine((value, ctx) => {
  if (value.HOROI_DEMO_MODE && value.NETWORK_ID !== "zebra-regtest") {
    ctx.addIssue({ code: "custom", path: ["NETWORK_ID"], message: "Docker demo mode requires its pinned zebra-regtest statement." });
  }
});
export const config = configSchema.parse(Bun.env);
