# FlagPilot — Architecture

How the pieces fit, what each file does, and the data model.
Paste your ER diagram into [§5](#5-data-model--paste-your-er-diagram-here).

---

## 1. The whole system

```
┌─────────────────────────────────────────────────────────────┐
│  VS Code extension   (extension/)                           │
│                                                             │
│   tree.js      the sidebar: projects → environments → flags │
│   extension.js registers commands, wires everything         │
│   api.js       the only file that knows the server exists   │
└───────────────────────────┬─────────────────────────────────┘
                            │  HTTP + Authorization: Bearer <token>
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  API server   (server/)                                     │
│                                                             │
│   index.js     routes: receive, validate, reply             │
│   eval.js      the one decision: on or off, and why         │
│   db.js        the connection pool, created once            │
│   middleware   requireToken: is this request allowed?       │
└───────────────────────────┬─────────────────────────────────┘
                            │  SQL over the pool
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  MySQL 8   (db/)                                            │
│                                                             │
│   7 tables · 9 foreign keys · 5 unique constraints          │
│   1 view (v_flag_status)                                    │
│   1 trigger (trg_fe_audit_update)                           │
│   1 extra index (idx_hist_changed_at)                       │
└───────────────────────────▲─────────────────────────────────┘
                            │  GET /api/check?key=&env=&user=
┌───────────────────────────┴─────────────────────────────────┐
│  demo app   (demo-app/)                                     │
│                                                             │
│   server.js        asks FlagPilot on the browser's behalf   │
│   public/index.html  the if-statement that uses the answer  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Two kinds of traffic

The same API serves two very different clients, and it's worth separating them in your head — this
distinction is what real feature-flag systems are built around.

### Control plane — rare, authenticated, writes

```
Developer → extension → API → MySQL
```

Creating flags, toggling, targeting. Happens when a human decides something. Requires a token.
Latency doesn't matter; correctness and auditability do.

### Data plane — frequent, read-only, on the hot path

```
Application → API → MySQL
```

`GET /api/check`. Happens constantly while the app runs. Must be fast and must never write anything.

Why the split matters: they have opposite requirements. The control plane wants validation,
transactions and history. The data plane wants speed and nothing else. Keeping them separate in your
design is why `/api/check` is a single query with no logging.

---

## 3. File-by-file

**One job per file** — this is what makes the project testable. You could verify `eval.js` before the
extension existed, and you can change the tree without touching the database.

### `db/` — the database

| File | Job | Run order |
|---|---|---|
| `00_reset.sql` | drop the view and all 7 tables | 1 |
| `01_schema.sql` | create the 7 tables with keys and constraints | 2 |
| `02_seed.sql` | insert the demo project, 2 environments, 3 flags, 2 users, 3 exceptions | 3 |
| `03_indexes_views.sql` | create `v_flag_status` and `idx_hist_changed_at` | 4 |
| `04_triggers.sql` | install the audit trigger | 5 |
| `99_verify.sql` | six read-only sanity checks | any time |
| `rebuild.sh` | runs 1–5 in one session, then verifies 7 tables / 1 view / 1 trigger | — |

**Why that order.** A table can only reference a table that already exists. And the trigger must be
installed **after** seeding, or every seeded switch would write a fake history row.

### `server/` — the API

| File | Job |
|---|---|
| `src/db.js` | creates the connection pool once, exports it |
| `src/eval.js` | `evaluateFlag(flagKey, env, userKey)` → `{ enabled, reason }` |
| `src/index.js` | the routes; validates input, calls the layer below, replies |
| `.env` | secrets, **never committed** |
| `.env.example` | the shape of `.env`, committed |
| `check-tests.sh` | 10 evaluation cases |
| `api-tests.sh` | create/toggle/target/history round trip |

`eval.js` has no HTTP code in it. `index.js` has no flag logic in it. That separation is deliberate —
it's why there are two test scripts instead of one.

### `extension/` — the client

| File | Job |
|---|---|
| `package.json` | the declaration: sidebar, tree view, 6 commands, menu placement |
| `src/extension.js` | `activate()`: registers commands, wires them to the tree and API |
| `src/tree.js` | `getChildren()` answers "what's under this?", `getTreeItem()` answers "how does it look?" |
| `src/api.js` | one `fetch` wrapper + token storage |
| `media/icon.svg` | the activity bar icon |
| `.vscode/launch.json` | F5 debug config |

**Why `package.json` matters so much:** VS Code reads it *before* running any code. If a command isn't
declared there, it doesn't exist as far as the editor is concerned, even if you register it in
JavaScript. That's a common hour-long confusion.

### `demo-app/` — the consumer

| File | Job |
|---|---|
| `server.js` | serves the page, and proxies `/state` to the API |
| `public/index.html` | the `if (flag.enabled)` block, written once |

The browser never calls port 3000 directly. It asks its own server, which asks FlagPilot. That avoids
CORS entirely and means a FlagPilot outage can't break the page load.

---

## 4. Request flows

### 4.1 Toggling a flag (control plane)

```
User clicks a flag in the sidebar
   │
   ▼  tree.js: item.command → flagpilot.toggleFlag
extension.js: wanted = flag.is_enabled !== 1
   │
   ▼  api.js: PATCH /api/flags/1/state  { environment_id, is_enabled, changed_by }
index.js: borrow a connection, BEGIN
   │
   ▼  SET @changed_by = 'vscode'
   ▼  UPDATE flag_environments SET is_enabled = ? WHERE flag_id = ? AND environment_id = ?
MySQL: the row changes… and the trigger fires
   │
   ▼  trg_fe_audit_update: INSERT INTO flag_history (…, changed_by = @changed_by, …)
   ▼  COMMIT
res.json({ ok: true })
   │
   ▼  tree.refresh() → getChildren() runs again → icons redraw
```

The extension never inserts a history row. The database does it.

### 4.2 Checking a flag (data plane)

```
App: isEnabled('dark_mode', 'u_1002')
   │
   ▼  GET /api/check?key=dark_mode&env=development&user=u_1002
eval.js: one query
   │
   ▼  flag ─ JOIN switch for this environment ─ LEFT JOIN exception for this user
MySQL returns: default_val = 1, targeted_val = 0
   │
   ▼  exception exists?  → yes → use it
res.json({ enabled: false, reason: 'targeting_rule' })
   │
   ▼  the app takes the else branch
```

Two values, one decision, one reply. No writes, no logging, nothing cached.

---

## 5. Data model — paste your ER diagram here

> **→ Paste the ER diagram image here ←**
>
> Markdown for an image in the same folder:
> `![FlagPilot ER diagram](er-diagram.png)`
> or if it's in a subfolder: `![FlagPilot ER diagram](docs/er-diagram.png)`
>
> Take a screenshot of the diagram you drew for your Notion page, or generate one from
> `01_schema.sql` in MySQL Workbench (Database → Reverse Engineer).

### 5.1 Relationships

```
projects
   │ 1
   ├──────────< environments          (project_id)
   ├──────────< feature_flags         (project_id)
   └──────────< test_users            (project_id)

feature_flags          environments
   │ 1                     │ 1
   └──────┐        ┌───────┘
          ▼        ▼
      flag_environments                 one switch per (flag, environment)
             │ 1
             ├──────────< targeting_rules   (flag_environment_id)
             │                     └──────< test_users (test_user_id)
             │
feature_flags│
   │ 1       │
   └──────────> flag_history            flag_id NULLABLE (SET NULL)
environments │
   └──────────> flag_history            environment_id NULLABLE (SET NULL)
```

### 5.2 Tables at a glance

| Table | Primary key | Foreign keys | Unique constraints |
|---|---|---|---|
| `projects` | `project_id` | — | — |
| `environments` | `environment_id` | `project_id` → projects | `(project_id, environment_name)` |
| `feature_flags` | `flag_id` | `project_id` → projects | `(project_id, flag_key)` |
| `test_users` | `test_user_id` | `project_id` → projects | `(project_id, user_key)` |
| `flag_environments` | `flag_environment_id` | `flag_id`, `environment_id` | `(flag_id, environment_id)` |
| `targeting_rules` | `rule_id` | `flag_environment_id`, `test_user_id` | `(flag_environment_id, test_user_id)` |
| `flag_history` | `history_id` | `flag_id` (NULL), `environment_id` (NULL) | — |

### 5.3 Delete behaviour, in one table

| Parent deleted | Effect on children |
|---|---|
| project | its environments, flags, test users are **deleted** (cascade) |
| flag | its `flag_environments` rows **deleted**; its `flag_history` rows **kept**, `flag_id` set NULL |
| environment | its `flag_environments` rows **deleted**; history rows **kept**, `environment_id` set NULL |
| flag_environments row | its `targeting_rules` **deleted** |

The asymmetry in row 2 is the single most interesting design decision in the schema: **current state
cascades, history survives.**

> Note: MySQL does not fire triggers for cascaded foreign-key actions. So deleting a flag does not
> produce a "deleted" history row automatically — the application would have to insert that itself.

### 5.4 Why the state isn't on `feature_flags`

```
feature_flags                       flag_environments
flag_id | flag_key                  flag_id | environment_id | is_enabled
   1    | dark_mode                   1     |       1        |     1      ← dev: ON
   2    | new_checkout                1     |       2        |     0      ← prod: OFF
```

The answer to "is `dark_mode` on?" depends on **where**. If `is_enabled` sat on `feature_flags`, there
would be one switch for all environments and you could never test something privately. The state
belongs to the pair, so it gets its own table with a unique constraint on that pair.

### 5.5 Normalisation summary

Every table is in 3NF. Two checks cover the whole schema:

1. **Every non-key column depends on the whole key.** All tables use a single-column primary key, so
   this is automatic — except `flag_environments`, where `is_enabled` depends on the **(flag,
   environment)** pair, which is exactly why that table exists.
2. **No non-key column depends on another non-key column.** This is the trap: storing
   `environment_name` inside `flag_environments` would make it depend on `environment_id` rather than
   on the row. Same for `project_name` inside `feature_flags`. Both are avoided by storing the id and
   joining when you need the name.

The one deliberate exception is `flag_history`, which copies names as **snapshots**. That's not a
normalisation error — history records the past, and a renamed flag must not rewrite old rows.

---

## 6. Where each DBMS concept lives

Useful for a report table or a viva checklist.

| Concept | Where |
|---|---|
| ER modelling → relations | 7 tables from the Notion ER diagram |
| Primary keys | every table, `AUTO_INCREMENT` |
| Foreign keys | 9, all named (`fk_*`) |
| Referential actions | `ON DELETE CASCADE` / `SET NULL` |
| Unique constraints | 5 composite, all named (`uq_*`) |
| Normalisation (3NF) | §5.5 |
| Joins | `v_flag_status` (4 tables), `eval.js` (5 tables with LEFT JOINs) |
| Views | `v_flag_status` |
| Triggers | `trg_fe_audit_update` |
| Indexes | `idx_hist_changed_at` (used as the table grows — see README §9), plus the implicit ones from every UNIQUE |
| `EXPLAIN` | README §9, confirms the index is used |
| Transactions | `POST /api/flags`, `PATCH /api/flags/:id/state` |
| Isolation | MySQL default REPEATABLE READ (mention only) |
| Connection pooling | `db.js`, `connectionLimit: 10` |
| SQL injection prevention | `?` placeholders everywhere |
| Session variables | `@changed_by` passed from the app to the trigger |
| Enums / domain constraint | `flag_history.action` |
| Aggregates | `db/99_verify.sql` (counts per environment) |
