# Cloned Windows clients

`DEVICE_CLONE_ISOLATION=true` enables a Console-only identity mode for clients
with the same reported UUID (for example, Windows images sharing MachineGuid)
but different RustDesk numeric IDs. It defaults to false.

In this mode, new devices get a deterministic internal key derived from the
reported UUID AND RustDesk ID. Existing legacy records are reused only when both
values match. Heartbeats, system information, presets, account binding, audit
records, strategies and connection/disconnect queues use the same internal key.
The numeric connection ID is unchanged. There is no schema migration and clients
do not need registry changes or a special build.

## Deploy and verify

1. Stop the Console and back up its database and deployment configuration.
2. Build this modified source (`docker build -t rustdesk-console:clone-isolation .`).
3. In your Compose file, use that local image for the Console service and pass
   `DEVICE_CLONE_ISOLATION: "true"` in its environment. The supplied Compose file
   already forwards the corresponding `.env` setting. Merely adding the variable
   to `.env` does not pass it into an arbitrary existing Compose service.
4. Recreate the Console container. Bring A and B online and allow their heartbeats
   and system information to arrive. Verify that both IDs remain separate after
   several heartbeat intervals, then add each to the same address book.
5. Check independent aliases, group/strategy assignments, online status, login and
   logout, and remote connections. Test on a database copy before production.

An old address-book entry follows the ID currently stored on its legacy peer row.
If clones previously overwrote that row, check the ID before trusting its alias,
saved password, ownership or strategy. The Console cannot reconstruct overwritten
history or know which clone an old alias/password originally belonged to.
New clone records intentionally do not inherit these settings.

## Limits and rollback

- This does not fix UUID handling in hbbs, change MachineGuid, or separate clones
  that report BOTH the same UUID and the same RustDesk ID. Test routing separately.
- Changing a client's numeric ID creates a new Console device in this mode. The
  old device keeps its address books and policy; reassign these explicitly.
- System-info reporting and account binding require both ID and UUID in this
  mode. A report without an ID is rejected with `ID_NOT_FOUND`; binding/unbinding
  without an ID is skipped, avoiding accidental changes to another clone.
- Keep the flag enabled on every API replica. Do not casually toggle it off:
  older code/legacy mode cannot resolve the derived rows and may create duplicate
  or merged records. Roll back by stopping the Console, restoring the pre-change
  database and configuration, and starting the original image. Changes made since
  that backup will be lost.
- No automatic cleanup of old rows is performed. Existing audit history is kept
  as-is; new audit records use the resolved internal key.

Regression tests use simulated client reports with a real SQLite database. They
do not replace a live test with your RustDesk 1.5.0 clients and hbbs deployment.
