# [1.11.0](https://github.com/databk/rustdesk-console/compare/1.10.0...1.11.0) (2026-11-08)


### Bug Fixes

* **compose:** persist native server data and connect the relay control channel ([#460](https://github.com/databk/rustdesk-console/issues/460)) ([c18c93f](https://github.com/databk/rustdesk-console/commit/c18c93f6e2ba6a2a72f078d10a5162f9cbc5d5c6))
* **devices:** add opt-in isolation for cloned client UUIDs ([#464](https://github.com/databk/rustdesk-console/issues/464)) ([9a7cebe](https://github.com/databk/rustdesk-console/commit/9a7cebed4f99e09e9a0b3599244f6e866a9de465))
* **oidc:** accept apiDomain sent by recent RustDesk clients ([#483](https://github.com/databk/rustdesk-console/issues/483)) ([80fa383](https://github.com/databk/rustdesk-console/commit/80fa383a20c6571bcd7929d121aa66cad14d2270))
* **server-management:** show a relay that reuses the primary node id ([#469](https://github.com/databk/rustdesk-console/issues/469)) ([e277c54](https://github.com/databk/rustdesk-console/commit/e277c54cde15aa17f3d2faac9a0d48f02f299bc2))


### Features

* **audit:** record canonical actions for console audit ([#490](https://github.com/databk/rustdesk-console/issues/490)) ([47c5092](https://github.com/databk/rustdesk-console/commit/47c5092194e632777167c8580ad0f9de6bc04541))
* **settings:** manage device clone isolation via general settings UI/API ([#471](https://github.com/databk/rustdesk-console/issues/471)) ([bde2a7d](https://github.com/databk/rustdesk-console/commit/bde2a7d009ca1bf267bf6d4c4d70da1055ff0373))



# [1.10.0](https://github.com/databk/rustdesk-console/compare/1.9.1...1.10.0) (2026-10-18)


### Bug Fixes

* **ci:** install git in Alpine container for musl SEA build ([#419](https://github.com/databk/rustdesk-console/issues/419)) ([c3c5bf0](https://github.com/databk/rustdesk-console/commit/c3c5bf046dafb7a8142a7e0b6d023b61d157185b))
* **ci:** pass SOURCE_COMMIT to Alpine container to avoid git call ([#420](https://github.com/databk/rustdesk-console/issues/420)) ([c55f0aa](https://github.com/databk/rustdesk-console/commit/c55f0aa125a44ad761ef04bf5704e2232648b512))
* **ci:** use App token for release push by disabling checkout credential persistence ([#400](https://github.com/databk/rustdesk-console/issues/400)) ([2fc563e](https://github.com/databk/rustdesk-console/commit/2fc563edbbaacae5426a23dd412d27403deab89e))
* **db:** repair stray legacy unique constraints when baselining ([#441](https://github.com/databk/rustdesk-console/issues/441)) ([884dafb](https://github.com/databk/rustdesk-console/commit/884dafb1b3a98b2c31a7389ed9705b0633fe6730)), closes [#432](https://github.com/databk/rustdesk-console/issues/432)
* **legacy-ab:** align legacy address book peer lookup with new API behavior ([#423](https://github.com/databk/rustdesk-console/issues/423)) ([0f7673a](https://github.com/databk/rustdesk-console/commit/0f7673a82a937173c797af693aa279a8c98ddde8))
* **rbac:** replace dashboard super-admin-only access with dashboard.view permission ([#424](https://github.com/databk/rustdesk-console/issues/424)) ([630cdba](https://github.com/databk/rustdesk-console/commit/630cdba399608b93a8ae6667f78bff995fd2b23c)), closes [#415](https://github.com/databk/rustdesk-console/issues/415)


### Features

* add coordinated system updates for managed Docker and Linux installations ([#394](https://github.com/databk/rustdesk-console/issues/394)) ([abec7c0](https://github.com/databk/rustdesk-console/commit/abec7c05fd4c1ee5c0bf834fce7531967f36f51b))
* **auth:** add self-service password reset via email links ([#444](https://github.com/databk/rustdesk-console/issues/444)) ([3ee986f](https://github.com/databk/rustdesk-console/commit/3ee986f8a8471fc74171080837386256fa872e07))
* **compose:** replace the integrated template with a server profile ([#443](https://github.com/databk/rustdesk-console/issues/443)) ([030119c](https://github.com/databk/rustdesk-console/commit/030119c0d9d7685c0070ce0fc3b85ccb14b6d2df))
* **db:** replace production schema sync with migrations ([#399](https://github.com/databk/rustdesk-console/issues/399)) ([80f5710](https://github.com/databk/rustdesk-console/commit/80f57106c8e31d467110cf312bf74d88cd37c1c5))
* **devices:** enforce disable at the hbbs admission layer ([#450](https://github.com/databk/rustdesk-console/issues/450)) ([b8062dd](https://github.com/databk/rustdesk-console/commit/b8062dd830d8f082086eaa6d598917426fdf15b2))
* **devices:** keep deleted devices deleted with tombstones ([#451](https://github.com/databk/rustdesk-console/issues/451)) ([7e383ae](https://github.com/databk/rustdesk-console/commit/7e383ae022f8b6d989a6fed3766e51b5e7bd3fbb))
* **devices:** release the device id at hbbs when deleting a device ([#452](https://github.com/databk/rustdesk-console/issues/452)) ([2c61dec](https://github.com/databk/rustdesk-console/commit/2c61decb698e42e1130450abc52eefec124863cf)), closes [databk/rustdesk-server#66](https://github.com/databk/rustdesk-server/issues/66)
* integrate hbbs and hbbr management with node agents ([#396](https://github.com/databk/rustdesk-console/issues/396)) ([dc2100f](https://github.com/databk/rustdesk-console/commit/dc2100f29edd57f6ccff7b5f05b5f01d8b32ffcc))
* **oidc:** sync user avatars from the OIDC provider picture claim ([#446](https://github.com/databk/rustdesk-console/issues/446)) ([ec94658](https://github.com/databk/rustdesk-console/commit/ec946585de4cad47951b6769a241ed71905ff1c1))
* **server-management:** talk to the hbbs management API directly ([#439](https://github.com/databk/rustdesk-console/issues/439)) ([44dc9da](https://github.com/databk/rustdesk-console/commit/44dc9da98b9a4007930f0942a13486b6e5325193))
* **settings:** manage web client and server management config in the database ([#447](https://github.com/databk/rustdesk-console/issues/447)) ([4e51792](https://github.com/databk/rustdesk-console/commit/4e51792e17d609a653c3b5da83a4025b480048e9))
* **web-client:** authorize browser sessions and add TCP diagnostics ([#393](https://github.com/databk/rustdesk-console/issues/393)) ([a73f005](https://github.com/databk/rustdesk-console/commit/a73f005e8a288f4a3bb894475eb3ab60356fa9b4))


### Performance Improvements

* **auth:** deduplicate authorization queries per request ([#445](https://github.com/databk/rustdesk-console/issues/445)) ([78fe9fd](https://github.com/databk/rustdesk-console/commit/78fe9fddd4a3d9602f24eb91f7098da3a3fe1b3a))
* **heartbeat:** buffer writes in memory and flush periodically ([#398](https://github.com/databk/rustdesk-console/issues/398)) ([1c823fc](https://github.com/databk/rustdesk-console/commit/1c823fce5e688fe02c59aece0001ddd1fc10eebd))
* **heartbeat:** cache strategy resolution, eliminate redundant peer query, and harden shutdown flush ([#418](https://github.com/databk/rustdesk-console/issues/418)) ([1358287](https://github.com/databk/rustdesk-console/commit/1358287d95ff874be0f03bb9f43bda6c87196848))



## [1.9.1](https://github.com/databk/rustdesk-console/compare/1.9.0...1.9.1) (2026-10-02)


### Bug Fixes

* **address-book:** add missing note filter to shared address book list API ([#385](https://github.com/databk/rustdesk-console/issues/385)) ([4b1f74d](https://github.com/databk/rustdesk-console/commit/4b1f74d4674c76a6e6cbbecbec1651ce314dd294))
* **auth:** expose 2FA status in currentUser and login payloads ([#377](https://github.com/databk/rustdesk-console/issues/377)) ([d13b918](https://github.com/databk/rustdesk-console/commit/d13b9182293ec7a5bd58f9317dd450e9a07aaf79))
* **auth:** prevent locking out system owner ([#382](https://github.com/databk/rustdesk-console/issues/382)) ([d07e8bc](https://github.com/databk/rustdesk-console/commit/d07e8bcc7640c098dbd168ee73d6b228f8c7744c))
* **update-check:** refresh cached results after frontend upgrades ([#383](https://github.com/databk/rustdesk-console/issues/383)) ([7eeea9c](https://github.com/databk/rustdesk-console/commit/7eeea9c19252e4cb28b9f06ecc69c8fbc23ab9b4))
* **update-check:** use singular 'result' to match cachedResult field ([#384](https://github.com/databk/rustdesk-console/issues/384)) ([f2caf89](https://github.com/databk/rustdesk-console/commit/f2caf892b3e1ddac207043a736e9c381578735fe))



# [1.9.0](https://github.com/databk/rustdesk-console/compare/1.8.1...1.9.0) (2026-09-27)


### Bug Fixes

* **ci:** build arm64 musl SEA on native ARM64 runner ([#340](https://github.com/databk/rustdesk-console/issues/340)) ([ab84c5c](https://github.com/databk/rustdesk-console/commit/ab84c5cb90e71f94b2f056cbd0e7102a1f5ef6e3)), closes [#339](https://github.com/databk/rustdesk-console/issues/339)
* **ci:** build arm64 musl SEA via QEMU on x64 runner ([#339](https://github.com/databk/rustdesk-console/issues/339)) ([db317fb](https://github.com/databk/rustdesk-console/commit/db317fb82b6fa9329b03b3de5b7404c17bce2a12))
* **dashboard:** include current day in trends range ([#365](https://github.com/databk/rustdesk-console/issues/365)) ([a2fcac9](https://github.com/databk/rustdesk-console/commit/a2fcac90ffafc0608e9da6a70285554c86b3c316))
* **dashboard:** merge userGroups and deviceGroups into single groups count ([#361](https://github.com/databk/rustdesk-console/issues/361)) ([b929b1c](https://github.com/databk/rustdesk-console/commit/b929b1cf62be0aebb51502d8250aac031a720cbc))
* **heartbeat:** align response fields with rustdesk client ([#336](https://github.com/databk/rustdesk-console/issues/336)) ([ca2532f](https://github.com/databk/rustdesk-console/commit/ca2532f7d64c3a2a74254d255bc7cde8df14632e))
* **sea:** handle MODULE_NOT_FOUND in require patch for native modules ([#356](https://github.com/databk/rustdesk-console/issues/356)) ([7650158](https://github.com/databk/rustdesk-console/commit/7650158a65f227abcfae93727bb62c277c8446ed))


### Features

* **audit:** adapt to new fields from RustDesk client audit reports ([#357](https://github.com/databk/rustdesk-console/issues/357)) ([04cbbda](https://github.com/databk/rustdesk-console/commit/04cbbda3ed83be405a7329620c2eac6ccccd8b85)), closes [#1](https://github.com/databk/rustdesk-console/issues/1) [#2](https://github.com/databk/rustdesk-console/issues/2) [#3](https://github.com/databk/rustdesk-console/issues/3) [#4](https://github.com/databk/rustdesk-console/issues/4)
* **audit:** record console management operations ([#359](https://github.com/databk/rustdesk-console/issues/359)) ([86993f3](https://github.com/databk/rustdesk-console/commit/86993f3ad58370426a1c67bf4a19b89383d0f0e5))
* **ci:** add musl builds for SEA executables ([#335](https://github.com/databk/rustdesk-console/issues/335)) ([8e4c333](https://github.com/databk/rustdesk-console/commit/8e4c3330eded9a1e3d528745c043643288288e1b))
* **dashboard:** redesign dashboard API with consolidated endpoints and restructured data model ([#360](https://github.com/databk/rustdesk-console/issues/360)) ([ecb6989](https://github.com/databk/rustdesk-console/commit/ecb698991d702a6e688d007e5a421ef4ad85d443))
* **database:** add MySQL database support ([#330](https://github.com/databk/rustdesk-console/issues/330)) ([8f9d447](https://github.com/databk/rustdesk-console/commit/8f9d4475246a468bd383a227d394249ea84b5061))
* **oidc:** add icon field and return common-oidc format in login options ([#337](https://github.com/databk/rustdesk-console/issues/337)) ([641bb5d](https://github.com/databk/rustdesk-console/commit/641bb5df9b89f0d5728219ffc1dc99265b8b0026))
* **rbac:** enforce fine-grained console permissions ([#310](https://github.com/databk/rustdesk-console/issues/310)) ([cbbf7ce](https://github.com/databk/rustdesk-console/commit/cbbf7ce86a524e7f8880bb2a03995efb99031bde))
* **settings:** add audit retention days to general settings API ([#308](https://github.com/databk/rustdesk-console/issues/308)) ([660c51d](https://github.com/databk/rustdesk-console/commit/660c51d9f0d6ce8e4f9e58eb04bb000784b82c24))
* **settings:** make JWT token expiry configurable via settings/general API ([#306](https://github.com/databk/rustdesk-console/issues/306)) ([5476354](https://github.com/databk/rustdesk-console/commit/5476354e7bcbe137a6562255e41f877585b94e5e))
* **user:** add admin password reset via security endpoint ([#329](https://github.com/databk/rustdesk-console/issues/329)) ([28d31d1](https://github.com/databk/rustdesk-console/commit/28d31d1e262e200b0f3c11c701f9b826bde258a1)), closes [#289](https://github.com/databk/rustdesk-console/issues/289)



## [1.8.1](https://github.com/databk/rustdesk-console/compare/1.8.0...1.8.1) (2026-08-26)


### Bug Fixes

* **avatar:** bust browser cache with timestamp query parameter ([#282](https://github.com/databk/rustdesk-console/issues/282)) ([5780528](https://github.com/databk/rustdesk-console/commit/5780528e18863d02943e172bc4cb8fcb37b87278))
* **avatar:** persist user avatars across Docker updates via DATA_DIR ([#279](https://github.com/databk/rustdesk-console/issues/279)) ([ee70b40](https://github.com/databk/rustdesk-console/commit/ee70b401fef27ed2d8dc2d2cb3503bbb51f11077))
* **nexus:** persist build artifacts across Docker updates via unified DATA_DIR ([#276](https://github.com/databk/rustdesk-console/issues/276)) ([6df09fe](https://github.com/databk/rustdesk-console/commit/6df09fe32e135210fea6046cabb91e520af94d47))



