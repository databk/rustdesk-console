# User Group API Contract

User groups are distinct from device groups. Each user belongs to exactly one
user group, and a protected default group is used whenever an administrator or
identity provider does not select a group.

All `/api/user-groups` routes require an authenticated administrator. The
application-wide `/api` prefix is omitted from route declarations in the NestJS
controllers but included below.

## Group CRUD

```text
GET    /api/user-groups?current=1&pageSize=20&search=term
POST   /api/user-groups
PUT    /api/user-groups/:guid
DELETE /api/user-groups/:guid
```

Create body:

```json
{ "name": "Operations", "note": "Primary operators" }
```

Update body fields are optional:

```json
{ "name": "Operations", "note": "Updated note" }
```

List response:

```json
{
  "data": [
    {
      "guid": "f2d89530-94d8-4ca9-9122-62c136d9a384",
      "name": "Operations",
      "note": "Primary operators",
      "user_count": 12,
      "is_default": false,
      "created_at": "2026-07-15T12:00:00.000Z",
      "updated_at": "2026-07-15T12:00:00.000Z"
    }
  ],
  "total": 1
}
```

Names are trimmed and unique case-insensitively. The display casing is
preserved. The default group can be renamed or annotated but cannot be deleted.

Deleting another group moves its members to the default group and removes its
address-book grants in one transaction:

```json
{
  "message": "用户组删除成功",
  "moved_user_count": 4,
  "deleted_rule_count": 2
}
```

## Membership

```text
GET  /api/user-groups/:guid/users?current=1&pageSize=20&search=term
POST /api/user-groups/:guid/users
```

Bulk move body:

```json
{
  "user_guids": [
    "9c89174d-bc33-4139-b3c8-7c20ca26bebe",
    "f5d3e63a-d4e6-4c56-936f-a34ba7002c05"
  ]
}
```

The operation validates every user before writing and is atomic. Posting users
to the default group is the canonical removal operation; users are never left
without a group.

## User Assignment

Administrator-controlled create and invite requests accept:

```json
{ "user_group_guid": "f2d89530-94d8-4ca9-9122-62c136d9a384" }
```

The field is optional and falls back to the default group. User list/detail
responses expose both:

```json
{
  "user_group_guid": "f2d89530-94d8-4ca9-9122-62c136d9a384",
  "user_group_name": "Operations"
}
```

Legacy `group_name` input remains accepted by create/invite DTOs but is a
deprecated no-op. It is not translated into a user group because the existing
API also uses `group_name` for device-group-derived filters. Public
registration, default-admin seeding, LDAP JIT, and OIDC JIT always resolve the
default group internally.

## Address-Book Grants

The existing address-book rule endpoint accepts a user-group GUID:

```text
POST /api/ab/rule
```

```json
{
  "guid": "address-book-guid",
  "group": "f2d89530-94d8-4ca9-9122-62c136d9a384",
  "rule": 2
}
```

`rule` is `1` (read), `2` (read/write), or `3` (full control). The caller must
already have full control of the address book. A group target must exist, and
`user` and `group` cannot be supplied together.

Rule management uses the existing paginated endpoints:

```text
GET    /api/ab/rules?ab=<address-book-guid>&current=1&pageSize=100
PATCH  /api/ab/rule
DELETE /api/ab/rules
```

The list response is `{ "data": [...], "total": number }`; clients that
manage every rule must continue requesting pages until `total` rows have been
read. `PATCH` accepts `{ "guid": "rule-guid", "rule": 1|2|3 }`. `DELETE`
accepts the rule GUID array as its raw JSON body, for example
`["rule-guid"]`, not a wrapper such as `{ "ids": [...] }`.

Owners always have full control. Other users receive the strongest applicable
direct-user, current-user-group, or everyone rule. Membership is evaluated at
read time, so moving a user changes access immediately without copying grants
onto the user.

The shared-address-book list endpoints apply the same aggregation:

```text
GET  /api/ab/shared/profiles
POST /api/ab/shared/profiles
```

## Upgrade Behavior

Startup creates one default group and backfills users with missing or invalid
assignments. Legacy empty-string address-book targets are normalized to SQL
`NULL`. Rules that reference unknown user groups are removed because they never
granted effective access in earlier releases and must not become everyone
rules accidentally.

The schema remains managed by TypeORM `synchronize: true`. Back up the SQLite
database before every application upgrade.

## Frontend Integration

The companion `rustdesk-console-web` implementation extends the existing user
group, user, and shared-address-book pages. It provides member listing and
bulk moves, validated `user_group_guid` selectors for create/invite, assigned
group display, and group-grant list/add/update/delete controls. The default
group is labeled and cannot be deleted in the UI.

The group-grant surface filters to rules with a group target and leaves
direct-user and everyone rules untouched. It is shown only to administrators
with full control of the address book. The frontend does not relabel or
reinterpret the legacy `group_name` field.
