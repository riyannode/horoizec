/* tslint:disable */
/* eslint-disable */

export function claim_proof_alternate_nullifier(proof_bytes: Uint8Array): string;

export function derive_claim_domain(network_id: string, asset_id: Uint8Array, threshold: bigint, snapshot_height: number, commitment_root: Uint8Array, exclusion_root: Uint8Array, expires_at: bigint | null | undefined, creator_nonce: Uint8Array): string;

export function derive_claim_id(network_id: string, asset_id: Uint8Array, threshold: bigint, snapshot_height: number, commitment_root: Uint8Array, exclusion_root: Uint8Array, expires_at: bigint | null | undefined, creator_nonce: Uint8Array): string;

export function derive_claim_public_inputs(network_id: string, asset_id: Uint8Array, threshold: bigint, snapshot_height: number, commitment_root: Uint8Array, exclusion_root: Uint8Array, expires_at: bigint | null | undefined, creator_nonce: Uint8Array, alternate_nullifier: Uint8Array, randomized_spend_key: Uint8Array): Uint8Array;

export function derive_spend_authorization_message(network_id: string, asset_id: Uint8Array, threshold: bigint, snapshot_height: number, commitment_root: Uint8Array, exclusion_root: Uint8Array, expires_at: bigint | null | undefined, creator_nonce: Uint8Array, alternate_nullifier: Uint8Array): string;

export function derive_zsa_asset_base(asset_id: Uint8Array): string;

export function prove_single_note_claim_wasm(network_id: string, asset_id: Uint8Array, threshold: bigint, snapshot_height: number, commitment_root: Uint8Array, exclusion_root: Uint8Array, expires_at: bigint | null | undefined, creator_nonce: Uint8Array, spending_key: Uint8Array, value: bigint, rho: Uint8Array, rseed: Uint8Array, diversifier_index: number, scope: number, merkle_position: number, merkle_path: Uint8Array, exclusion_low: Uint8Array, exclusion_width: Uint8Array, exclusion_position: number, exclusion_path: Uint8Array): Uint8Array;

export function scan_and_prove_single_note_claim_wasm(network_id: string, asset_id: Uint8Array, threshold: bigint, snapshot_height: number, commitment_root: Uint8Array, exclusion_root: Uint8Array, expires_at: bigint | null | undefined, creator_nonce: Uint8Array, spending_key: Uint8Array, packed_actions: Uint8Array): Uint8Array;

export function sign_spend_authorization(spending_key: Uint8Array, randomizer: Uint8Array, message: Uint8Array): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly claim_proof_alternate_nullifier: (a: number, b: number) => [number, number, number, number];
    readonly derive_claim_domain: (a: number, b: number, c: number, d: number, e: bigint, f: number, g: number, h: number, i: number, j: number, k: number, l: bigint, m: number, n: number) => [number, number, number, number];
    readonly derive_claim_id: (a: number, b: number, c: number, d: number, e: bigint, f: number, g: number, h: number, i: number, j: number, k: number, l: bigint, m: number, n: number) => [number, number, number, number];
    readonly derive_claim_public_inputs: (a: number, b: number, c: number, d: number, e: bigint, f: number, g: number, h: number, i: number, j: number, k: number, l: bigint, m: number, n: number, o: number, p: number, q: number, r: number) => [number, number, number, number];
    readonly derive_spend_authorization_message: (a: number, b: number, c: number, d: number, e: bigint, f: number, g: number, h: number, i: number, j: number, k: number, l: bigint, m: number, n: number, o: number, p: number) => [number, number, number, number];
    readonly derive_zsa_asset_base: (a: number, b: number) => [number, number, number, number];
    readonly prove_single_note_claim_wasm: (a: number, b: number, c: number, d: number, e: bigint, f: number, g: number, h: number, i: number, j: number, k: number, l: bigint, m: number, n: number, o: number, p: number, q: bigint, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number, a1: number, b1: number, c1: number, d1: number, e1: number, f1: number, g1: number) => [number, number, number, number];
    readonly scan_and_prove_single_note_claim_wasm: (a: number, b: number, c: number, d: number, e: bigint, f: number, g: number, h: number, i: number, j: number, k: number, l: bigint, m: number, n: number, o: number, p: number, q: number, r: number) => [number, number, number, number];
    readonly sign_spend_authorization: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly rustsecp256k1_v0_10_0_default_error_callback_fn: (a: number, b: number) => void;
    readonly rustsecp256k1_v0_10_0_default_illegal_callback_fn: (a: number, b: number) => void;
    readonly rustsecp256k1_v0_10_0_context_create: (a: number) => number;
    readonly rustsecp256k1_v0_10_0_context_destroy: (a: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
