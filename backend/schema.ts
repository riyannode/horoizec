import { z } from "zod";
const u64Max = 18446744073709551615n;
export const createClaimSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(""),
  assetId: z.string().regex(/^(?:[0-9a-fA-F]{2}){66}$/),
  threshold: z.string().regex(/^[1-9][0-9]*$/).refine((value) => BigInt(value) <= u64Max),
  snapshotHeight: z.number().int().nonnegative().max(4294967295),
  expiresAt: z.number().int().positive().nullable().default(null)
});
export const verifySchema = z.object({
  claimId: z.string().regex(/^[0-9a-f]{64}$/),
  protocolVersion: z.literal(1),
  proof: z.string().min(1).max(2_000_000),
  alternateNullifiers: z.array(z.string().regex(/^[0-9a-f]{64}$/)).length(1)
});
export type CreateClaimInput = z.infer<typeof createClaimSchema>;
