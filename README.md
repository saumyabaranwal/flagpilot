# FlagPilot

A **feature-flag manager** for developers, built as a VS Code extension.

A feature flag is a switch that turns a feature on or off **without changing code or redeploying**.
You manage those switches from a sidebar inside VS Code; your app asks one question —
*"is `dark_mode` on for this user?"* — and gets `true` or `false` back.

Built as a DBMS course project, so the database does real work: primary and foreign keys, unique
constraints, a view, an index, a trigger for auditing, and transactions.

---

## Contents

1. [What it does](#1-what-it-does)
2. [How it works](#2-how-it-works)
3. [Tech stack](#3-tech-stack)
4. [Prerequisites](#4-prerequisites)
5. [Setup](#5-setup)
6. [Using it](#6-using-it)
7. [API reference](#7-api-reference)
8. [The database](#8-the-database)
9. [Testing](#9-testing)
10. [Design decisions](#10-design-decisions)
11. [Troubleshooting](#11-troubleshooting)
12. [Known limitations](#12-known-limitations)
13. [Project layout](#project-layout)

---

## 1. What it does

| Feature | Where |
|---|---|
| See all flags for a project, grouped by environment | VS Code sidebar |
| Turn a flag on or off | Click it in the sidebar |
| Create a new flag | Command palette, or the `+` button in the sidebar |
| Target individual test users with an exception | `POST /api/targeting` |
| Check whether a flag is on for a user | `GET /api/check` |
| See who changed what, and when | Right-click a flag → Show History |
| Copy a ready-to-paste `if` block for a flag | Right-click a flag → Copy Code Snippet |

**What a flag is *not*:** it doesn't generate or edit code. A developer writes the `if` once and
commits it. Both branches ship in every build. The flag decides which branch runs at runtime.

---

## 2. How it works

```
┌──────────────────────┐
│  VS Code extension   │  the sidebar: shows flags, sends changes
│  (no rules, no data) │
└──────────┬───────────┘
           │ HTTP + Bearer token
           ▼
┌──────────────────────┐
│  Node + Express API  │  the only thing that holds the database password
│  (all the rules)     │  creates, toggles, targets, evaluates
└──────────┬───────────┘
           │ SQL
           ▼
┌──────────────────────┐
│       MySQL 8        │  the source of truth
│  7 tables + trigger  │
└──────────▲───────────┘
           │ GET /api/check?key=&env=&user=
┌──────────┴───────────┐
│      demo-app        │  a small pretend app that shows a flag working
└──────────────────────┘
```

**Setup flow:** developer opens FlagPilot in VS Code → sees flags for their project → clicks one to
toggle it → the extension calls the API → the API updates one row in MySQL → a trigger writes the
audit entry.

**Runtime flow:** an app asks `/api/check` *"is `dark_mode` on for `u_1002` in `development`?"* →
the API reads the environment's default and any per-user exception → replies
`{ "enabled": false, "reason": "targeting_rule" }` → the app shows the old UI.

Full file-by-file breakdown: **[ARCHITECTURE.md](ARCHITECTURE.md)**.
Day-by-day explanation of every concept and line of code: **[STUDY_GUIDE.md](STUDY_GUIDE.md)**.

---

## 3. Tech stack

| Layer | Choice |
|---|---|
| Database | MySQL 8 (InnoDB, `utf8mb4`) |
| API | Node.js + Express 4, plain JavaScript (`require`) |
| DB driver | `mysql2/promise`, with a connection pool |
| Extension | VS Code Extension API, JavaScript, no build step |
| Demo app | Express + one HTML page |
| Config | `dotenv` for the server, `.env` files |
| Auth | one shared Bearer token (v1 simplification — see §10) |

No TypeScript, no bundler, no frameworks. Everything runs directly with `node`.

---

## 4. Prerequisites

- **Node.js 18.11 or newer** (needs `--watch` and built-in `fetch`)

  ```bash
  node -v
  ```

- **MySQL 8** running locally, and the `mysql` client on your PATH
- **VS Code 1.85 or newer** (the extension uses the global `fetch`)

  ```bash
  code -v
  ```

- **Git Bash** (Windows) or any bash shell

> On Windows, if `mysql` is not found, add it to PATH once in Git Bash:
>
> ```bash
> echo 'export PATH="$PATH:/c/Program Files/MySQL/MySQL Server 8.0/bin"' >> ~/.bashrc
> source ~/.bashrc
> ```
>
> Adjust `8.0` to your installed version. Note Git Bash writes `C:\Program Files` as `/c/Program Files`.

---

## 5. Setup

Clone the repo and run each part in its own terminal window. **Order matters** — the API needs the
database, the extension needs the API, the demo app needs the API.

### 5.1 Database

```bash
./db/rebuild.sh
```

That runs `00_reset.sql` → `01_schema.sql` → `02_seed.sql` → `03_indexes_views.sql` →
`04_triggers.sql`, in that order, in a single MySQL session. It asks for your root password once.

**Verify:**

```bash
mysql -u root -p -e "USE flagpilot; SHOW TABLES;"
```

Expect **7 tables**: `projects`, `environments`, `feature_flags`, `test_users`,
`flag_environments`, `targeting_rules`, `flag_history`.

Re-run `./db/rebuild.sh` any time to get back to a clean state.

### 5.2 API server

```bash
cd server
npm install
```

Create `server/.env`:

```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=flagpilot
PORT=3000
API_TOKEN=dev-token-123
```

`API_TOKEN` can be any string you like — the extension will ask for it once.

```bash
npm run dev
```

**Verify:**

```bash
curl http://localhost:3000/health
# {"ok":true,"db":"connected"}
```

### 5.3 VS Code extension

```bash
cd extension
code .
```

A new VS Code window opens on the `extension/` folder. Press **F5** — a second window opens, the
"Extension Development Host", with the extension loaded from source.

**Verify:** the FlagPilot icon appears in the Activity Bar (far left). If you can't see it, right-click
the Activity Bar and make sure it isn't hidden in the `…` overflow.

Then expand a project. To change anything, first run **Ctrl+Shift+P → FlagPilot: Set API Token** and
paste your `API_TOKEN`. It's stored in VS Code's secret storage, never in a settings file.

No `npm install` is needed for the extension — it has zero dependencies.

### 5.4 Demo app

```bash
cd demo-app
npm install
npm start
```

Open **http://localhost:4000**.

You should see `demo app on http://localhost:4000` in the terminal — that line means it's running. If
it prints `Completed running`, the file is empty or the wrong one.

A `.env` is optional here: the defaults point at `http://localhost:3000` and the `development`
environment. Copy `.env.example` to `.env` only if you want to change those.

---

## 6. Using it

### The demo that shows what this is for

1. Keep the demo app open in a browser and the extension sidebar visible in VS Code.
2. Click **`dark_mode`** in the sidebar → it turns `off`.
3. Refresh the browser → **the page goes light.**
4. Click it again, refresh → dark.

Same code, same running page, different behaviour — no redeploy.

### Better demo (per-user exceptions)

On the demo page, click the **`u_1002`** button. The page reloads.

Now `dark_mode` reads **false** with `reason: targeting_rule`, because the seed data turns `dark_mode`
**off** for that one user in development, while everyone else gets it on.

Same flag, same page, two users, two answers. That's the reason feature flags exist.

### Best demo (environments)

The page has an **env** switcher at the top. Click **`production`**.

`dark_mode` is **off** there, so the theme goes light — while `beta_banner` is **on** in production but
off in development. No config change, no restart, no redeploy.

The page also lists **every** flag with its state and the `reason` the API returned, so you can point at
the reason column while showing the theme change.

### In the extension

| Action | How |
|---|---|
| Refresh the tree | The ↻ button in the sidebar title bar |
| Change environment / user in the demo | The `env` and `user` buttons at the top of the page |
| Toggle a flag | Click the flag row |
| Create a flag | The **+** button, or Ctrl+Shift+P → FlagPilot: Create Flag |
| Show history | Right-click a flag → Show History |
| Copy a code snippet | Right-click a flag → Copy Code Snippet |
| Change the API token | Ctrl+Shift+P → FlagPilot: Set API Token |

---

## 7. API reference

Base URL `http://localhost:3000`. **Bold** = the request needs
`Authorization: Bearer <API_TOKEN>`.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `GET` | `/health` | — | `{ ok, db }` — proves the DB connection works |
| `GET` | `/api/projects` | — | all projects |
| `GET` | `/api/environments` | `?project_id=1` | environments of that project |
| `GET` | `/api/flags` | `?project_id=1&env=development` | every flag with its on/off state in that environment |
| **`POST`** | **`/api/flags`** | `{ project_id, flag_key, description }` | `201 { flag_id, flag_key, environments }` |
| **`PATCH`** | **`/api/flags/:flagId/state`** | `{ environment_id, is_enabled, changed_by }` | `{ ok, flag_id, environment_id, is_enabled }` |
| **`POST`** | **`/api/targeting`** | `{ flag_id, environment_id, user_key, is_enabled }` | `201 { ok, flag_key, user_key }` |
| `GET` | `/api/history` | `?flag_id=1` (optional) | audit rows, newest first |
| `GET` | `/api/check` | `?key=dark_mode&env=development&user=u_1001` | `{ enabled, reason }` |

### The `reason` field

`/api/check` always explains itself. Possible values:

| `reason` | Meaning |
|---|---|
| `targeting_rule` | a per-user exception decided it |
| `environment_default` | no exception; the environment's own switch decided |
| `unknown_flag` | no flag with that key exists |
| `unknown_environment` | that environment doesn't exist |
| `flag_not_in_environment` | the flag exists but has no switch for that environment |

Example:

```bash
curl "http://localhost:3000/api/check?key=dark_mode&env=development&user=u_1002"
# {"enabled":false,"reason":"targeting_rule"}
```

> **Quotes matter.** Wrap any URL containing `&` in quotes, otherwise bash treats `&` as "run in the
> background" and curls only the first half of the URL.

---

## 8. The database

### The 7 tables

| Table | Stores | Why it's separate |
|---|---|---|
| `projects` | your apps | one row per project; the description lives here once |
| `environments` | development, production | a place the app runs |
| `feature_flags` | flag keys and descriptions | the flag itself, named once |
| `test_users` | users you target flags at | one row per person |
| `flag_environments` | **the on/off switch** | state belongs to a (flag, environment) pair, not to a flag |
| `targeting_rules` | per-user exceptions | "on for this person" |
| `flag_history` | audit trail | who changed what, when, with name snapshots |

**The important idea:** the on/off value is **not** a column on `feature_flags`. If it were, there
would be one switch for all environments, and you could never have a flag on in development and off in
production. The state belongs to the pair — which is why `flag_environments` exists.

### Constraints

- **9 foreign keys** — every one is `ON DELETE CASCADE` except `flag_history`'s two, which are
  `ON DELETE SET NULL` so deleting a flag doesn't erase its history.
- **5 unique constraints** — `(project_id, environment_name)`, `(project_id, flag_key)`,
  `(project_id, user_key)`, `(flag_id, environment_id)`, `(flag_environment_id, test_user_id)`.
  Each one stops a lookup from returning two rows.
- A **view** `v_flag_status` — the flag/environment join, saved under a name and used by
  `GET /api/flags`.
- A **trigger** `trg_fe_audit_update` — writes the history row whenever a flag is toggled.
- An **index** `idx_hist_changed_at` — for the history panel sorted by date.

`ARCHITECTURE.md` has the ER diagram and a full relationship map.

### Resetting the data

```bash
./db/rebuild.sh
```

The database is disposable in development. `00_reset.sql` drops the view and all 7 tables, so a
rebuild always starts from nothing.

---

## 9. Testing

Two scripts, both expecting the server to be running.

```bash
# 10 evaluation cases: every branch of the flag logic
./server/check-tests.sh
```

Covers: flag on, flag off, exception turning a flag ON, exception turning a flag OFF, unknown user,
second environment, unknown flag, unknown environment. Prints PASS/FAIL per row.

```bash
# create / toggle / target / history round trip, plus auth failures
./server/api-tests.sh
```

**Run `./db/rebuild.sh` between the two.** `api-tests.sh` changes data (it adds a flag and a targeting
rule), which makes `check-tests.sh` fail afterwards on the cases that expect the original seed.

### Test cases and expected answers

Seed state:

| Flag | development | production |
|---|---|---|
| `dark_mode` | ON | off |
| `new_checkout` | ON | off |
| `beta_banner` | off | ON |

Exceptions: `dark_mode`/production/`u_1001` → ON · `new_checkout`/production/`u_1002` → ON ·
`dark_mode`/development/`u_1002` → **OFF**

| # | Flag | Env | User | Expected | Reason |
|---|---|---|---|---|---|
| 1 | `dark_mode` | development | `u_1001` | true | `environment_default` |
| 2 | `dark_mode` | development | `u_1002` | **false** | `targeting_rule` |
| 3 | `dark_mode` | development | `u_9999` | true | `environment_default` |
| 4 | `dark_mode` | production | `u_1001` | true | `targeting_rule` |
| 5 | `dark_mode` | production | `u_1002` | false | `environment_default` |
| 6 | `new_checkout` | production | `u_1002` | true | `targeting_rule` |
| 7 | `beta_banner` | development | `u_1001` | false | `environment_default` |
| 8 | `beta_banner` | production | `u_1001` | true | `environment_default` |
| 9 | `dark_mode` | staging | `u_1001` | false | `unknown_environment` |
| 10 | `nope_flag` | development | `u_1001` | false | `unknown_flag` |

Cases **2 and 4** are the important pair: the same logic working in both directions (exception turns a
flag off over an ON default, and on over an OFF default).

### Manual database checks

```sql
-- does the trigger write history? (run in mysql>, then undo it)
SET @changed_by = 'manual-test';
UPDATE flag_environments SET is_enabled = NOT is_enabled WHERE flag_environment_id = 1;
SELECT flag_key, action, changed_by FROM flag_history ORDER BY history_id DESC LIMIT 1;

-- does the unique constraint actually refuse duplicates?
INSERT INTO environments (project_id, environment_name) VALUES (1, 'production');
-- ERROR 1062: Duplicate entry '1-production' for key 'environments.uq_env_name'

-- is the index being used?
EXPLAIN SELECT * FROM flag_history ORDER BY changed_at DESC LIMIT 20;
-- look for key: idx_hist_changed_at
```

`db/99_verify.sql` collects six of these checks in one file.

---

## 10. Design decisions

**History stores snapshots, not links.**
`flag_history` keeps its own copy of `flag_key` and `environment_name`. If a flag is later renamed,
old audit rows must not change meaning — they record what happened, not what is true now.

**Deleting a flag keeps its history.**
`flag_id` is nullable with `ON DELETE SET NULL`. Every other relationship cascades. An audit trail
that disappears when the thing it audits is deleted isn't an audit trail.

**A trigger writes the audit entry for toggles.**
The route runs one `UPDATE` and never inserts history. So even a manual change in a SQL console gets
recorded. The server tells the trigger who did it by setting a session variable `@changed_by` on the
same connection as the `UPDATE` (session variables are per-connection).

**The decision is made in JavaScript, not clever SQL.**
The query fetches two values — the environment default and the user's exception — and one `if` decides.
It returns a `reason` alongside the answer, which is what makes debugging and demos possible.

**Evaluation order: explicit targeting beats the environment default.**
A named exception is more specific than a broad default, so it wins.

**The extension holds no logic.**
It renders state and sends requests. Delete it and all the data is intact. The API and database own
the truth.

**Every lookup uses `?` placeholders.**
User input is never concatenated into SQL, so it can always be treated as data and never as code.

**Auth is one shared token (v1).**
Write routes require `Authorization: Bearer <token>` compared against `API_TOKEN`. A real version
would store hashed per-developer tokens in a table and scope projects by owner.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `mysql: command not found` | MySQL `bin` not on PATH | see §4 |
| `Cannot GET /api/...` (an HTML page) | route missing, or an old server is still holding port 3000 | check the file, then close every server terminal and start one |
| `curl` prints `[1] 404` and `{"error":"...required"}` | the URL had `&` and no quotes, so bash split it | wrap the URL in quotes |
| Sidebar shows a project but nothing inside | a children call is failing | expand the error row the tree now shows, or run the two `curl` commands for `/api/environments` and `/api/flags` |
| `EADDRINUSE` | two servers on the same port | close the extra terminal |
| `{"error":"project_id and env are required"}` | a query parameter didn't arrive | re-check the URL |
| `Cannot read properties of undefined` in the server | code touched `rows[0]` when the query returned nothing | check `rows.length === 0` first |
| History rows show `changed_by: "system"` | the `SET @changed_by` and the `UPDATE` used different pooled connections | both must run on the same borrowed `conn` |
| `(node) DeprecationWarning: url.parse()` | VS Code's own internals, not this project | ignore it |
| Extension: `fetch is not defined` | VS Code older than 1.85 | update VS Code |
| Demo page won't load | the demo server isn't running | `cd demo-app && npm start`, look for `demo app on http://localhost:4000` |

---

## 12. Known limitations

Deliberate, for a 5-day build. Useful to know so you don't over-claim.

- **No caching.** Every `/api/check` is a query. Fine at this scale; a real tool would cache a
  snapshot in memory and evaluate without a network call.
- **No percentage rollout.** Targeting is per-user only. Rollout would be
  `hash(flag_key + user_key) % 100 < percentage`, stateless, no schema change.
- **Auth is a single shared token.** No users, no ownership scoping.
- **Targeting changes aren't written by the trigger.** The trigger watches `flag_environments` only,
  so the targeting route inserts its own history row.
- **No flag deletion or archiving** in the UI. The schema supports it; the route doesn't exist.
- **The extension is not published.** It runs from source via F5. Packaging is `vsce package`.

---

## Project layout

```
flagpilot/
├── db/          schema, seed, view + index, trigger, verify, rebuild script
├── server/      Express API, db pool, evaluation logic, test scripts
├── extension/   the VS Code extension
├── demo-app/    a small app that consumes a flag
├── ARCHITECTURE.md
└── STUDY_GUIDE.md
```

See **ARCHITECTURE.md** for what each file does and why.
