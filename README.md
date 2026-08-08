# Team Tasks

A small team task tracker that runs entirely inside your Google Drive: a Google Sheet holds
the data, an Apps Script Web App serves the interface. Anyone on your team opens one URL on
their phone or laptop, signs in with their normal Google account, and sees the tasks.

No server, no hosting bill, nothing to install.

## Why not "just put it on Drive"

Google Drive stopped serving HTML files as web pages in 2016, so a plain `.html` in Drive
can't be opened as an app. Apps Script is Google's supported replacement — the script and
its sheet both live in your Drive, and every visitor is identified by their Google login.
That login is what makes the permission rules real: the browser can't lie about who it is.

## What it does

- **Reporting lines.** Each member has a `ReportsTo`. A reporting officer sees and edits the
  tasks of everyone below them — direct reports *and* their reports, to any depth.
- **Edit rules, enforced on the server.** A task can be edited only by its assignee, by
  anyone above that assignee in the reporting chain, or by you (the app owner).
- **Open visibility.** Everyone can read every task. The scope filter (My tasks / My team /
  Everyone) narrows the view; it isn't a wall.
- **Details + automatic timestamps.** Free-text details per task. `UpdatedAt` and `UpdatedBy`
  are stamped on every save — the form has no field for them.
- **Reverse chronological.** Newest activity first by default; sort by priority instead if
  you prefer.
- **Priorities.** Critical / High / Medium / Low, shown as a coloured dot.
- **Search.** One box, matching title, details, person, status, priority and task ID. Multiple
  words must all match.
- **Activity feed.** Every create / edit / delete is logged with a timestamp and a summary of
  what changed, so you can see what the team did without opening each task.
- **Built for a phone.** Tab bar at the bottom within thumb reach, forms that open as bottom
  sheets, finger-sized controls, padding that clears a notch, and a dark theme that follows
  the phone's own setting. Overdue dates turn red, closed tasks grey out, and each person
  carries a coloured initial so a long list is scannable at a glance. The same markup lays
  itself out as a centred column with a top tab strip on a laptop.

## Setup (about ten minutes, once)

**1. Create the sheet**

Go to [sheets.new](https://sheets.new) and name it something like `Team Tasks`. This file is
your database — keep it in a Drive folder only you can edit.

**2. Add the script**

In the sheet: **Extensions → Apps Script**. Then:

- Rename the default `Code.gs` contents to match [Code.gs](Code.gs) — paste the whole file in,
  replacing what's there.
- Click **+ → HTML**, name it exactly `Index` (Apps Script adds the `.html`), and paste in
  [Index.html](Index.html).
- Gear icon **⚙ Project Settings → tick "Show appsscript.json manifest file"**, then open the
  `appsscript.json` that appears in the editor and paste in [appsscript.json](appsscript.json).
  Adjust `timeZone` if you aren't on IST.

**3. Initialise**

In the editor's function dropdown pick `setup`, click **Run**, and approve the permission
prompt. This creates the `Members`, `Tasks` and `Activity` tabs and adds you as the first
member.

**4. Enter your team**

On the **Members** tab, one row per person:

| Email | Name | ReportsTo | Active |
|---|---|---|---|
| `aneesh@example.com` | Aneesh | | TRUE |
| `ravi@example.com` | Ravi | `aneesh@example.com` | TRUE |
| `sunita@example.com` | Sunita | `ravi@example.com` | TRUE |

- `ReportsTo` is that person's reporting officer. Leave it blank for the top of the chain.
- `Active` blank or `TRUE` means active; `FALSE` or `no` marks someone as left/inactive.
- Sunita reports to Ravi, so Aneesh can edit Sunita's tasks too — that's the "reports to
  people under him" rule, and it works to any depth.

You manage the team here, in the sheet. There's no admin screen to learn, and the app's Team
tab shows the resulting chart.

**5. Deploy**

**Deploy → New deployment → ⚙ → Web app**:

| Setting | Value |
|---|---|
| Execute as | **Me** |
| Who has access | **Anyone within *your organisation*** |

Both matter:

- *Execute as Me* lets the app write to the sheet without giving anyone direct sheet access —
  so nobody can edit around the permission rules.
- *Anyone within your organisation* is what makes Google reveal each visitor's email address.
  If you pick "Anyone", visitors on personal Google accounts arrive anonymous and the app
  will tell them it can't identify them. Only use "Anyone" if your team is all on the same
  Workspace domain anyway.

Copy the `/exec` URL and send it to the team.

**6. Put it on the home screen**

The URL is the whole app. On a phone: open it in Chrome or Safari → **Add to Home screen**.
It then behaves like an installed app.

## Day-to-day

- **+ New** creates a task. You can assign it to yourself or anyone under you.
- Tap a task to open it. Yours (or your team's) opens editable; others open read-only and are
  marked *view only*.
- Reassigning is allowed only to yourself or someone under you — you can't push work sideways
  into another manager's team.
- Deleting is limited to the same people who may edit, and the Activity tab keeps the record.

## Changing it later

After editing `Code.gs` or `Index.html`, use **Deploy → Manage deployments → ✎ → Version: New
version**. The URL stays the same, so nobody needs a new link.

To add a status or priority, edit the `PRIORITIES` / `STATUSES` arrays near the top of
[Code.gs](Code.gs) and re-run `setup()` to refresh the sheet's dropdowns. New priorities also
want a colour — add a `.p-YourName` rule beside the existing ones in
[Index.html](Index.html). You can't forget that step: `sh test/run.sh` fails with the name of
any priority that has no colour rule.

## Working on the interface

You don't need to deploy to see a change. This builds a browser-runnable copy of the app —
the real `Code.gs`, driven by in-memory fakes instead of a sheet — and opens it:

```sh
sh test/preview.sh --open
```

It comes seeded with a small team and ten tasks, and nothing in it reaches Google. Add
`?as=deep@example.com` to the URL to see the same data as somebody else; tasks outside that
person's reporting line go *view only*, which is the quickest way to eyeball the permission
rules. `test/.preview.html` is a build artefact — regenerate it, don't edit it.

## Checking the rules still hold

The permission logic is the part you least want to get wrong, so it has a test suite that runs
locally against in-memory fakes — no Google account, no deployment:

```sh
sh test/run.sh              # needs Node.js
```

**67 rule checks** covering the reporting chain (including a deliberate loop and a dangling
manager link in the sheet), who may edit and who may not, reassignment limits, search,
sorting, paging and the activity log. Run it after changing anything in [Code.gs](Code.gs); if
you add a rule, add a case to [test/tests.js](test/tests.js).

**18 interface checks** ([test/ui-check.js](test/ui-check.js)) that read `Index.html` and
`Code.gs` together. The UI is one inlined file talking to the backend by function name, so
what breaks it is drift rather than logic: an element id renamed in the markup but not the
script, a server call that no longer exists, a priority or status with no colour, or user text
being written as HTML instead of as text. Each is caught by reading both files.

There is also an optional layout check, kept out of `run.sh` because it needs a browser:

```sh
sh test/layout-check.sh     # needs Chrome or Chromium; skips cleanly without one
```

It loads the real UI at 320, 360, 390, 430 and 768px wide and fails if the page can be
scrolled sideways or if anything tappable is smaller than a fingertip. Worth running after
touching the stylesheet — it is how the card layout's phone-width overflow was found.

## Things worth knowing

- **Scale.** Every list request reads the whole Tasks tab. That's comfortable into the low
  thousands of rows. Past that, archive closed tasks to another tab once a year.
- **Concurrency.** Writes take a script lock, so two people saving at once can't corrupt a
  row. The loser waits a moment.
- **Backups.** The sheet is version-history-backed by Drive (**File → Version history**), and
  you can download it as `.xlsx` any time. Your data isn't locked in this app.
- **The sheet is the source of truth.** You can fix data by hand in the sheet — just don't
  change the header rows or reuse a task ID, and note that hand-edits skip the activity log.
