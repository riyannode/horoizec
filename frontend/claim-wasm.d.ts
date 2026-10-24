declare module "*/claim.js" {
  export default function init(): Promise<unknown>;
  export function scan_and_prove_single_note_claim_wasm(
    network_id: string,
    asset_id: Uint8Array,
    threshold: bigint,
    snapshot_height: number,
    commitment_root: Uint8Array,
    exclusion_root: Uint8Array,
    expires_at: bigint | undefined,
    creator_nonce: Uint8Array,
    spending_key: Uint8Array,
    packed_actions: Uint8Array,
  ): Uint8Array;
  export function claim_proof_alternate_nullifier(proof_bytes: Uint8Array): string;
}
