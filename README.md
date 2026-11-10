# FlagPilot

A feature-flag manager for developers. Manage flags from a VS Code extension; your app asks one
question — *"is `dark_mode` on for this user?"* — and gets `true` or `false`. Flags let you change
behaviour without redeploying.

Built for a DBMS course project, so the database does real work: constraints, foreign keys, a view, a
trigger, transactions and an index.

## How it fits together

```
VS Code extension  --HTTP-->  server (Node + Express)  --SQL-->  MySQL
   the sidebar                 the only holder of             the source of truth
   no rules, no data            the db password
                                     ^
                                     |
                              demo-app asks /api/check
```

## What's in the box

| Folder | What it is |
|---|---|
| `db/` | schema, seed data, view + index, audit trigger |
| `server/` | Express API: flag CRUD, toggling, targeting, history, `/api/check` |
| `extension/` | the VS Code extension: tree view, toggle, create, history, snippets |
| `demo-app/` | a small app that shows a flag working in a browser |

## Setup

**1. Database** (needs MySQL 8)

```bash
./db/rebuild.sh
```
Creates the database, tables, seed data, the view and the trigger. Re-run it any time to get back to
a clean state.

**2. Server**

```bash
cd server
npm install
cp .env.example .env      # then fill in your MySQL password and pick an API_TOKEN
npm run dev
```
Runs on http://localhost:3000. Check it with `curl http://localhost:3000/health`.

**3. Extension**

```bash
cd extension
npm install               # only if you added dependencies; the extension uses none
code .                    # then press F5
```
A second VS Code window opens with the FlagPilot icon in the activity bar. First time you toggle
something it asks for the API token (the one in `server/.env`).

**4. Demo app**

```bash
cd demo-app
npm install
npm start
```
Open http://localhost:4000, flip `dark_mode` in the extension, reload.

## Testing

```bash
./server/check-tests.sh    # 10 evaluation cases, expects a running server
./server/api-tests.sh      # create / toggle / target / history round trip
```

Run `./db/rebuild.sh` between the two — `api-tests.sh` changes the data.

## The 7 tables

| Table | Holds |
|---|---|
| `projects` | your apps |
| `environments` | development, production |
| `feature_flags` | the flag names |
| `test_users` | users you target flags at |
| `flag_environments` | **the switch** — is this flag on in this place? |
| `targeting_rules` | exceptions, "on for this user" |
| `flag_history` | the audit trail, with name snapshots |

The on/off value is **not** on `feature_flags` — it belongs to the (flag, environment) pair, which is
why `flag_environments` exists.

## Design decisions

- History stores **snapshots** of names, not links — a renamed flag must not rewrite the past.
- Toggling is logged by a **trigger**, so even a manual SQL change appears in the audit trail.
- Deleting a flag **keeps** its history rows (`ON DELETE SET NULL`), everything else cascades.
- Evaluation happens in **JavaScript**, not clever SQL, and returns a `reason` alongside the answer.
- The extension holds **no logic** — delete it and the data is intact.
