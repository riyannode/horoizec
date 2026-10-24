import { z } from "zod";
const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default("127.0.0.1"),
  NETWORK_ID: z.enum(["zebra-regtest", "zsa-testnet"]).default("zebra-regtest"),
  ZCASH_RPC_URL: z.string().url().default("http://127.0.0.1:18232"),
  ZCASH_RPC_USER: z.string().optional(),
  ZCASH_RPC_PASSWORD: z.string().optional(),
  DATABASE_PATH: z.string().default("./horoi.db"),
  VERIFIER_PATH: z.string().default("./rust/target/release/horoi-verifier")
});
export const config = configSchema.parse(Bun.env);