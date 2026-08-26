## [1.8.1](https://github.com/databk/rustdesk-console/compare/1.8.0...1.8.1) (2026-08-26)


### Bug Fixes

* **avatar:** bust browser cache with timestamp query parameter ([#282](https://github.com/databk/rustdesk-console/issues/282)) ([5780528](https://github.com/databk/rustdesk-console/commit/5780528e18863d02943e172bc4cb8fcb37b87278))
* **avatar:** persist user avatars across Docker updates via DATA_DIR ([#279](https://github.com/databk/rustdesk-console/issues/279)) ([ee70b40](https://github.com/databk/rustdesk-console/commit/ee70b401fef27ed2d8dc2d2cb3503bbb51f11077))
* **nexus:** persist build artifacts across Docker updates via unified DATA_DIR ([#276](https://github.com/databk/rustdesk-console/issues/276)) ([6df09fe](https://github.com/databk/rustdesk-console/commit/6df09fe32e135210fea6046cabb91e520af94d47))



# [1.8.0](https://github.com/databk/rustdesk-console/compare/1.7.0...1.8.0) (2026-08-07)


### Bug Fixes

* **app:** register Invitation entity in root TypeOrmModule ([#270](https://github.com/databk/rustdesk-console/issues/270)) ([9169142](https://github.com/databk/rustdesk-console/commit/9169142625f9bd6e80f54dcc4c676bf7e6d9d314))
* **ci:** resolve nightly build tag_name validation error ([#247](https://github.com/databk/rustdesk-console/issues/247)) ([c1ace8e](https://github.com/databk/rustdesk-console/commit/c1ace8e95e91f77de110262cb727238268d6a50c))
* reorder routes to prevent devices/status from matching devices/:guid ([#253](https://github.com/databk/rustdesk-console/issues/253)) ([8fb191b](https://github.com/databk/rustdesk-console/commit/8fb191bd25892cb1fa2ec9ef75f71190d281c98d))
* resolve dual throttler guard causing 429 on heartbeat endpoint ([#263](https://github.com/databk/rustdesk-console/issues/263)) ([deea4a6](https://github.com/databk/rustdesk-console/commit/deea4a6a82b0fec8f4b7ffda6d7032869934393f))
* **sea:** remove dead code and enrich dist package.json metadata ([#275](https://github.com/databk/rustdesk-console/issues/275)) ([f1819f4](https://github.com/databk/rustdesk-console/commit/f1819f4b9b5277e02072cb4df62a7f60ae5e83c6))
* use fuzzy search for device group name filter ([#265](https://github.com/databk/rustdesk-console/issues/265)) ([0ca0003](https://github.com/databk/rustdesk-console/commit/0ca0003fcb77495bc36b30c402e2b3a72e5cd4f4))
* **user:** specify varchar type for Invitation.note to support sqlite ([#274](https://github.com/databk/rustdesk-console/issues/274)) ([9fc5ec4](https://github.com/databk/rustdesk-console/commit/9fc5ec41287661d1ea354af4df3be2d848c7c7e1))


### Features

* add display_name field to /users/me endpoint ([#249](https://github.com/databk/rustdesk-console/issues/249)) ([e1b0d95](https://github.com/databk/rustdesk-console/commit/e1b0d9586d479089c49cf9a0b58b934e4887cdc6))
* add logo icon above RustDesk Console in README ([#256](https://github.com/databk/rustdesk-console/issues/256)) ([9cf64d5](https://github.com/databk/rustdesk-console/commit/9cf64d5c64accd39937ad50d38c7631a0c1ea5f4))
* **auth:** add Passkey (WebAuthn) login support ([#233](https://github.com/databk/rustdesk-console/issues/233)) ([6e436dd](https://github.com/databk/rustdesk-console/commit/6e436ddb9d8b8e98e35e2b32e2817c1303dbeddb))
* **auth:** associate deviceInfo with login sessions and add session management APIs ([#234](https://github.com/databk/rustdesk-console/issues/234)) ([4a8dbd0](https://github.com/databk/rustdesk-console/commit/4a8dbd041b5bb60cdf7432b41995660f61fbe88b))
* **ci:** add nightly build workflow ([#242](https://github.com/databk/rustdesk-console/issues/242)) ([c92a957](https://github.com/databk/rustdesk-console/commit/c92a957992703b434b74272f7682f621854270f1))
* **sea:** add macOS SEA build support ([#273](https://github.com/databk/rustdesk-console/issues/273)) ([bb96ff7](https://github.com/databk/rustdesk-console/commit/bb96ff7c1b9f8a56a8f8495bdd356dce767dcd31))
* **settings:** add defaultLanguage to general settings ([#267](https://github.com/databk/rustdesk-console/issues/267)) ([dded37d](https://github.com/databk/rustdesk-console/commit/dded37d73f27933f832813a9398c7debe4d170ee))
* **settings:** add public frontend settings endpoint, restrict general to admin ([#269](https://github.com/databk/rustdesk-console/issues/269)) ([1f672d3](https://github.com/databk/rustdesk-console/commit/1f672d3e4fef7905249d0e8ab31140895c9f4d63))
* support user_group_guid/user_group_name filter on admin/users ([#251](https://github.com/databk/rustdesk-console/issues/251)) ([cfa8ac4](https://github.com/databk/rustdesk-console/commit/cfa8ac409d473bbb02673673b4218297c4ad80a3))
* update logo link and make it clickable ([#257](https://github.com/databk/rustdesk-console/issues/257)) ([2678f33](https://github.com/databk/rustdesk-console/commit/2678f338972b106dc3a11e68db0394155dfa1eae))



# [1.7.0](https://github.com/databk/rustdesk-console/compare/1.6.0...1.7.0) (2026-07-22)


### Bug Fixes

* **auth:** align login API with RustDesk client requirements ([#214](https://github.com/databk/rustdesk-console/issues/214)) ([3c2ae52](https://github.com/databk/rustdesk-console/commit/3c2ae52644dce52fe242b19b64ca3a2f7c782d30))
* **auth:** prevent TFA secret exposure in login flow ([#221](https://github.com/databk/rustdesk-console/issues/221)) ([e3a7b0a](https://github.com/databk/rustdesk-console/commit/e3a7b0a998638712265aaca7bcdd96bbb2f17880))
* **auth:** use server-generated secret for login flow control instead of user-controlled tfaCode ([#230](https://github.com/databk/rustdesk-console/issues/230)) ([dfa9250](https://github.com/databk/rustdesk-console/commit/dfa9250053f3d3016ee94b648fb19e263b8e7746))
* disable unsafe type rules for test files in eslint config ([#226](https://github.com/databk/rustdesk-console/issues/226)) ([cd19d1e](https://github.com/databk/rustdesk-console/commit/cd19d1eea12d2dd3e8001ad8caaff4ce16113f83))
* **sysinfo:** return SYSINFO_UPDATED and ID_NOT_FOUND responses ([#222](https://github.com/databk/rustdesk-console/issues/222)) ([3468e97](https://github.com/databk/rustdesk-console/commit/3468e972e7a531eb57d2120f72cded97af23756d))


### Features

* **ab:** support adding IP devices to address book ([#213](https://github.com/databk/rustdesk-console/issues/213)) ([2ba9295](https://github.com/databk/rustdesk-console/commit/2ba9295d9d9e699646ca69ff81e634b0de017699)), closes [#196](https://github.com/databk/rustdesk-console/issues/196)
* add console settings and system metrics ([#227](https://github.com/databk/rustdesk-console/issues/227)) ([45fed76](https://github.com/databk/rustdesk-console/commit/45fed7634518255ca9b1cdf7acc36343c410dc85))
* implement user groups and group-based address-book access ([#211](https://github.com/databk/rustdesk-console/issues/211)) ([1c9753c](https://github.com/databk/rustdesk-console/commit/1c9753c20f61de06f93035041160cc5201a4cce4))
* **oidc:** add PATCH sort endpoint for provider ordering ([#229](https://github.com/databk/rustdesk-console/issues/229)) ([9ca9cbb](https://github.com/databk/rustdesk-console/commit/9ca9cbb38abcccf558f42bc675eb7ced81ced746))
* separate private custom and shared address books ([#212](https://github.com/databk/rustdesk-console/issues/212)) ([0425d7f](https://github.com/databk/rustdesk-console/commit/0425d7fa4c2487567e0269cf0dfcfdbb8d81f147))
* upgrade to Node.js 24, add ARM64 Docker build, and SEA support ([#210](https://github.com/databk/rustdesk-console/issues/210)) ([5b6eb96](https://github.com/databk/rustdesk-console/commit/5b6eb96d8ce699ce24634ec1bc27ae938f6e5365))
* **user:** adapt display_name field in user APIs ([#215](https://github.com/databk/rustdesk-console/issues/215)) ([7daf01b](https://github.com/databk/rustdesk-console/commit/7daf01b2243bc3a04580c220254ed9dee12ab3cd))
* **user:** add user group update to updateUser API ([#224](https://github.com/databk/rustdesk-console/issues/224)) ([1aecf6b](https://github.com/databk/rustdesk-console/commit/1aecf6bd2d5428f7df8e09ccb1dd23d367fd5ed2))
* **user:** implement complete invite user flow ([#223](https://github.com/databk/rustdesk-console/issues/223)) ([0a966e4](https://github.com/databk/rustdesk-console/commit/0a966e466b04b4090e51d95385bb4194c6ffb3f4))



# [1.6.0](https://github.com/databk/rustdesk-console/compare/1.5.1...1.6.0) (2026-07-15)


### Bug Fixes

* make SMTP username and password fields optional ([#194](https://github.com/databk/rustdesk-console/issues/194)) ([eae647c](https://github.com/databk/rustdesk-console/commit/eae647c464ddc08019c4f7063e7cd425ec7503c1)), closes [#193](https://github.com/databk/rustdesk-console/issues/193)
* **update-check:** fix update check API URL and package.json path issues ([#207](https://github.com/databk/rustdesk-console/issues/207)) ([1d1bc6e](https://github.com/databk/rustdesk-console/commit/1d1bc6e92ec881c88d2c32ab129dba81cf686fad))


### Features

* add nexus module for custom client generation ([#192](https://github.com/databk/rustdesk-console/issues/192)) ([a8c0fcf](https://github.com/databk/rustdesk-console/commit/a8c0fcfede80ee2d5a591e283361540ddfa1edb3))
* add update check module ([#182](https://github.com/databk/rustdesk-console/issues/182)) ([b952d41](https://github.com/databk/rustdesk-console/commit/b952d414071635675c328ce22cbbb1cf4e8ed64a))



## [1.5.1](https://github.com/databk/rustdesk-console/compare/1.5.0...1.5.1) (2026-06-26)


### Bug Fixes

* map os field to standardized platform constants in /ab/peers response ([#178](https://github.com/databk/rustdesk-console/issues/178)) ([c1b0d67](https://github.com/databk/rustdesk-console/commit/c1b0d676717d7d93631d9d0358380d63d328775d)), closes [#175](https://github.com/databk/rustdesk-console/issues/175)
* merge saved LDAP config when testing connection ([#180](https://github.com/databk/rustdesk-console/issues/180)) ([7390ca5](https://github.com/databk/rustdesk-console/commit/7390ca54a364c7f91933239ac72aeed6b68774d8))
* specify varchar type for User.email column ([#181](https://github.com/databk/rustdesk-console/issues/181)) ([924bcda](https://github.com/databk/rustdesk-console/commit/924bcdaf6834b7face280e931db0070878767069))
* store null instead of empty string for user email to avoid unique constraint violation ([#176](https://github.com/databk/rustdesk-console/issues/176)) ([cff06b7](https://github.com/databk/rustdesk-console/commit/cff06b77fbf009eab533730935f542ee8bc83395)), closes [#173](https://github.com/databk/rustdesk-console/issues/173)



