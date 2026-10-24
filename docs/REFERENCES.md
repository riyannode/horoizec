# References and pinned source

## Specifications and documentation

- [Zcash Developer Documentation](https://zcash.readthedocs.io/en/latest/)
- [Zcash Improvement Proposals](https://zips.z.cash/)
- [ZIP 226: Orchard Zcash Shielded Assets transfer/burn](https://zips.z.cash/zip-0226)
- [ZIP 227: Issuance of Zcash Shielded Assets](https://zips.z.cash/zip-0227)
- [Orchard proof-of-balance draft](https://github.com/zcash/zips/blob/main/zips/draft-str4d-orchard-balance-proof.md)
- [librustzcash](https://github.com/zcash/librustzcash)
- [Zebra](https://github.com/ZcashFoundation/zebra)
- [Cachet](https://github.com/cachet-zec/cachet)

## Exact source revisions inspected

Horoi's QEDIT transaction-tool reference was checked at 45413e8a9159bfeb6a9ca829c72f315a49266bc6. Its lockfile pins these relevant sources:

| Source | Revision |
| --- | --- |
| QED-it/orchard | cf801a5d6701bc128e21678ba0034564af4a2aca |
| QED-it/librustzcash | c5c232db9c54eeb8bc1d0f4dc1b8a0e40f981bb0 |
| QED-it/sapling-crypto | e785faaa5eaf67bd2cb328fdd82a345df44e5754 |
| QED-it/halo2 | ef3d0ba2e9a513658f8d3d00294ddebd92cc649e |
| QED-it/zcash_spec | d5e84264d2ad0646b587a837f4e2424ca64d3a05 |
| zcash/sinsemilla | aabb707e862bc3d7b803c77d14e5a771bcee3e8c |
| zcash/zcash_note_encryption | 9f7e93d42cef839d02b9d75918117941d453f8cb |
| QED-it/zebra CI revision | 8c9c93fdd91b89fab387ec68362a93b2baca7bab |
| Cachet reference checkout | 87cec756c1f3dd316250024137ba71f33db53bd4 |

The separately inspected QEDIT Orchard checkout was 870112d4e92af57dc6cbdd78c77175a74c7634b0; implementation uses the lockfile revision above. Dependency constraints, local source adaptation, and reproduction commands are in [SETUP.md](SETUP.md). The balance-proof draft and alternate-nullifier proposal are research references, not accepted standards or audits.
