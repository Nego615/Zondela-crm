# Zondela CRM

A pipeline CRM for Zondela's marketing team — companies and contacts,
appointments, follow-ups, STO rates and agreements built from a rate card and
tracked from draft to accepted, pricing shared via email/WhatsApp, and
reusable email templates. Built with React + Vite on the frontend and
Supabase (Postgres + Auth) for persistence.

## Stack

- **Frontend**: React 19 + TypeScript, Vite, React Router
- **Backend**: Supabase (Postgres, Auth, Row Level Security) — the frontend
  talks to Supabase directly. The one exception is creating and deleting
  accounts, which needs the service role key and so runs in the `admin-users`
  edge function.
- **Styling**: Plain CSS with design tokens (no UI framework).

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project (the
   free tier is enough for a small team).
2. In the project dashboard, go to **Project settings → API** and copy:
   - **Project URL**
   - **anon public** key

## 2. Set up the database

1. In the Supabase dashboard, open **SQL Editor → New query**.
2. Paste the entire contents of [`supabase/schema.sql`](./supabase/schema.sql)
   and run it. This creates all tables (companies, contacts, site_visits,
   follow_ups, sto_rate_card, sto_agreements, sto_agreement_items,
   email_templates, sent_messages, profiles, permissions, role_permissions,
   activity_logs, org_settings), indexes, the role and permission model, and
   row-level security policies. It installs empty — add your own services on
   the STO page's Rate card tab.
   It also creates the public `pricing` and `branding` storage buckets, for
   price list PDFs and your logo. If your database predates either, re-run the
   script to add it.
3. It's safe to re-run — the script drops/recreates policies and uses
   `if not exists` for tables.

**Upgrading an existing database?** Re-running `schema.sql` is the whole
migration. It renames the old roles (`owner` → `super_admin`,
`marketing` → `staff`), adds the new profile columns with everyone already in
the system left `active`, installs the permission tables and audit log, and
adds the agreement letterhead and message delivery tracking. Existing sent
messages backfill as `sent`, which is what they were.

Each migration also stands alone in
[`supabase/migrations/`](./supabase/migrations), if you would rather apply one
without the rest; `schema.sql` includes them verbatim, in order, and
`npm run sync:schema` regenerates those copies after an edit. Run them in
order if you run them separately — `0001` re-seeds the role grants from
scratch, so running it after `0002` would drop `settings.branding`.

### Turn off public sign-up

This is a closed system, and the database enforces that — but Supabase will
still happily mint an Auth account if its signup endpoint is left open, and
that account would land as a `pending` `viewer` who can see nothing. Close it
properly:

**Authentication → Sign In / Providers → Email** — turn **off** "Allow new
users to sign up". Leave **Confirm email** *on*: it is what marks an invited
account as active once they use their link.

## 3. Configure the app

```bash
cp .env.example .env
```

Edit `.env` and fill in your project URL and anon key:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Also set **Authentication → URL Configuration → Redirect URLs** to include
your app's `/set-password` and `/reset-password` paths (and the same two on
`http://localhost:5173` for local work). Invitation and reset links are
refused if their destination is not on that list.

## 4. Deploy the admin-users function

Creating and deleting accounts needs the Supabase **service role key**, which
can do anything in the project and so must never reach a browser bundle. Those
two operations live in an edge function instead:

```bash
supabase functions deploy admin-users
supabase secrets set SITE_URL=https://your-app.example.com
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected by the platform; `SITE_URL` is where invitation and reset links
should land, and defaults to `http://localhost:5173`.

Everything else — roles, activation, password resets — works without this.
Until it is deployed, "Add user" reports that it cannot reach the user
service, and you can still create accounts from **Authentication → Users →
Add user** in the dashboard and set their role from Admin → Users.

## 5. Install and run

```bash
npm install
npm run dev
```

## 6. Create the first Super Admin

There is no sign-up page, so the first account cannot come from the app. It
comes from the database, which is the point — only someone holding the project
credentials can mint it.

1. **Authentication → Users → Add user → Send invitation**, using the address
   that will own the system.
2. Open [`supabase/bootstrap-super-admin.sql`](./supabase/bootstrap-super-admin.sql),
   change the email on the last line to that address, and run it in the SQL
   editor.
3. That person opens their invitation email, sets a password, and signs in.

`bootstrap_super_admin()` has execute revoked from the `anon` and
`authenticated` roles, so it is not reachable over the API however anyone
prods at it.

From then on nobody touches SQL: the Super Admin creates everyone else from
**Admin → Users**, and can promote another Super Admin from the same page.

## Project structure

```
src/
  components/     Shared UI: app shell/nav, the rate card panel, modals
                   (company, contact, appointment, follow-up, share-pricing,
                   agreement builder, send-agreement, user forms) and the
                   activity log renderer
  hooks/           useAuth (session/profile/permissions), useCrmData (all
                   Supabase data hooks: companies, contacts, appointments,
                   follow-ups, rate card, agreements, templates, profiles,
                   sent messages), useUsers (user management, activity log,
                   role grants)
  lib/             Supabase client, TypeScript types, the role hierarchy and
                   permission helpers, stage and agreement colour/label/total
                   utilities, report date ranges and CSV export
  pages/           Route-level pages: Dashboard, Companies,
                   CompanyDetail, Contacts, Appointments, FollowUps, Sto,
                   Reports, Login, SetPassword
  pages/admin/     Users, UserDetail, RolesPermissions, ActivityLogs,
                   SystemSettings
supabase/
  schema.sql       Full Postgres schema + RLS policies (generated: includes
                   the migrations below verbatim — run `npm run sync:schema`
                   after editing one)
  migrations/
    0001_closed_access_rbac.sql
                   The closed-access auth layer: roles, permissions, the
                   audit log, the privileged RPCs and the profiles policies
    0002_sto_branding_and_delivery.sql
                   org_settings (the agreement letterhead), the message
                   delivery lifecycle and its triggers, the branding bucket
  bootstrap-super-admin.sql
                   Creates the first Super Admin (SQL editor only)
  build-schema.mjs Expands the migration include in schema.sql
  functions/admin-users/
                   Edge function: creates, re-invites and deletes accounts
  reset-data.sql   Deletes every business record (run in the SQL editor)
```

## How the pieces fit together

- **Dashboard** (`/`) is the home view — what needs doing now. Overdue and
  due-today counts, one agenda merging follow-ups with appointments over the
  next seven days, a pipeline summary by stage, the unclaimed pool, and
  active deals with nothing booked next. Anyone who can see the whole
  pipeline can switch between the team's work and their own.
- A company's stage is set from the stage field on its own page, or in the
  add/edit form.
- **Appointments** (`/appointments`) is every site visit and meeting across
  the team, filterable by upcoming/past. Schedule straight from this page —
  it asks which company — or from a company's own page, which already knows.
  Each one is a **Site visit** (at the client's premises) or a **Meeting**
  (a call, or a sit-down elsewhere); the distinction is what tells you whether
  a day costs travel.
- **Contacts** (`/contacts`) lists every person across every company you can
  see, searchable by name, job title, company, email or phone, with a
  primary-only filter. It is a read-and-reach view — email, call and WhatsApp
  links are live; adding and editing happen on the company's page.
- **Company detail** (`/companies/:id`) is where the day-to-day work
  happens: manage contacts, schedule appointments, schedule follow-ups,
  and share STO pricing. A company records its **country**, **main market**
  (where its own customers are, which is what STO keywords target) and
  **relationship** (where they stand with Zondela — New, Existing Partner,
  Works with Zondela, Dormant, Not Interested).
- **STO** (`/sto`) is the whole quoting section, in four tabs — everything an
  agreement needs, in the order it is needed.
  **Rate card** is the price list — the single place a service is priced.
  **Agreements** is the pipeline for the documents themselves: build one from
  the rate card (or type lines in by hand), send it, and track the answer.
  **Email templates** are the reusable openings the send modal offers (they
  used to be their own top-level section; nothing outside STO read them, so
  `/templates` now redirects here).
  **Branding & email** is the letterhead and the email defaults — see
  "Branding an agreement" below.
  Each agreement gets a reference the database generates (`STO-0001`), and
  its lines **copy** the rate card's name, price and unit rather than pointing
  at them — repricing a service later cannot rewrite a number a client has
  already accepted. Filter by status (Drafts, Sent, Accepted, Declined),
  by company, or search reference, title and company name; the filter lives in
  the URL, so a filtered list is a link you can send a colleague. The tiles
  across the top count drafts, agreements awaiting a reply (flagging any past
  their **valid until** date as expired), and accepted work.
- **Sending an agreement** marks it sent, stamps `sent_at`, and opens your
  email client or WhatsApp with the lines, totals, dates and terms already
  written out — plus a link to the price list PDF if one is uploaded. It is
  logged to `sent_messages` like any other share, linked to the agreement it
  carried. **Accepted** and **Declined** stamp their own dates; **Reopen**
  puts a settled agreement back in play.
- **Preview** opens the branded agreement as the client will see it, with
  Print / Save as PDF. The browser's own print dialogue is the export — it
  produces a better PDF than the app could assemble, and needs no library.
  Anything still in draft prints with a DRAFT watermark.

### Branding an agreement

**STO → Branding & email** is one row (`org_settings`) holding the letterhead:
organisation and legal name, tagline, address and contact block, logo, the two
brand colours, the opening paragraph, default terms, footer line and signatory.
The agreement document reads all of it, so rebranding is this form rather than
a search for hardcoded strings. A live preview beside the form updates as you
type.

The colours are applied as **inline styles**, not CSS variables — the same
markup is printed to PDF and pasted into mail, and inline styles are the only
styling that survives both. The logo goes to a public `branding` bucket for the
same reason the price list does: it has to load for a recipient who has never
signed in here.

The same tab holds the **email settings** — from name and address, reply-to, a
BCC applied to every send, and the signature that closes each message. Nothing
here sends email on your behalf; they are the values the app composes with
before handing off to your mail client.

Editing needs the `settings.branding` permission (Super Admin, Admin, Manager).
Everyone else sees the tab read-only.

### Delivery tracking

Every send records where it got to, shown as a **Delivery** column on the
agreements list and as a timeline inside the expanded row:

| | |
|---|---|
| **Queued** | Composed, not sent yet |
| **Sent** | Handed to the mail client or WhatsApp |
| **Delivered** | It reached them |
| **Viewed** | They opened it, or replied |
| **Failed** | It bounced, with a reason |
| **Approved** | The client accepted the agreement |
| **Rejected** | The client declined it |

Be clear about what is known and what is recorded. **`Sent` is the last state
the app establishes by itself** — it opens your mail client or WhatsApp, and
neither reports back. Delivered, Viewed and Failed are marked by whoever sent
it, from the buttons on the Delivery panel. The columns they write
(`delivered_at`, `viewed_at`, `failed_at`, `provider_message_id`) are the ones
an email provider's webhooks would set instead, once one is connected; nothing
else has to change for that.

**Approved and Rejected cannot be marked there.** They follow the agreement, and
a database trigger mirrors them down: moving an agreement to Accepted marks
every message it went out on as approved, Declined marks them rejected, and
Reopen drops them back to delivered. Marking them by hand on the message would
let it contradict the agreement it carried.

An agreement's Delivery column shows its **furthest-along** send, so resending
after a bounce stops the row reading as failed for good. Timestamps are stamped
by the database and only ever filled once, so "delivered on the 3rd" stays true
after the message is later marked viewed.
- **Price list PDF** — upload the PDF you already send clients, on the STO
  page's Rate card tab. One is marked default and is offered automatically when
  sharing. It is stored in the `pricing` bucket and reaches the client
  exactly as uploaded.
- **Share STO pricing** builds a message from selected rate card items
  (optionally starting from a saved template) plus a link to the price list
  PDF, and either opens your email client (`mailto:`) or WhatsApp (`wa.me`)
  with the message pre-filled. Neither `mailto:` nor `wa.me` can carry a file
  attachment, so the PDF travels as a link the client opens; **Download PDF**
  is there for when you would rather attach it by hand. Every
  share is logged to `sent_messages` so it shows up in that company's
  activity and rolls up into reports.
- **Reports** (`/reports`) is ten executive reports over one period and one
  set of filters — **Overview** (pipeline funnel, period totals, month-by-month
  activity, and companies split by market and relationship), **Visits & site
  visits** (every appointment with its outcome, what happens next, and the
  summary written after it), **Companies** (one row per client property: stage,
  relationship, market, location, rep, contacts, visits and last visit, open
  and overdue follow-ups, quotes, accepted value and the company note),
  **Reps** (companies, visits, follow-ups, quotes, accepted value and win rate
  per rep), **Follow-ups** (what was due, what is still open and how late),
  **STO agreements** (every agreement raised in the period with its services,
  discount, value, status — expired included — and when it was sent and
  answered), **Service interest** (which rate card services get quoted, to how
  many companies, and what they are worth), **STO outreach** (pricing shares by
  email and WhatsApp, plus the agreements sent), **Visit conversion** (of the
  companies visited, how many were quoted afterwards, how many accepted, and
  the median days from visit to quote), and **Notes & feedback** (visit
  summaries, follow-up notes and company notes in one stream — what clients
  actually said).

  **Every section leads with the month.** Visits, companies, follow-ups,
  agreements, outreach and notes each open with a row of totals and a
  month-by-month table — how many that month, split the way that section is
  read (site visits against meetings, done against overdue, sent against
  accepted), with a total under each column. Empty months are kept, because a
  month with no visits in it is the finding; over a span too long for that
  (All time) only the months with something in them are listed. The free text
  travels with the rows underneath — a visit's summary, a follow-up's
  instruction, an agreement's note — printed under the row rather than squeezed
  into a column, and exported as a column of its own.

  The filter bar — dates with presets, rep, company, location, visit type,
  relationship, market, stage, service, a per-report status and a search box —
  applies to every tab and **lives in the URL**, so a filtered report is a link
  you can send a colleague. **Location** is the country on the company record,
  offered as the spellings actually on file; **Visit type** narrows visits to
  site visits or to meetings wherever a visit is counted; **Status** means
  whatever the open report understands (a visit's outcome, a follow-up's state,
  an agreement's status, a company's activity in the period), and a status left
  over from another tab is ignored rather than silently narrowing the next
  table you open. **Download CSV** exports the table as shown (the same column
  definitions drive both, so the file can never disagree with the screen),
  and **Print / PDF** prints it through the browser with the shell, filters
  and tabs stripped out and a header stamped with the period, the filters
  applied and the row count.

  The **Rep** dropdown offers team members with logins and, under "No login",
  every name that has been typed against a visit, follow-up or company — so
  a rep without an account still gets a row.
- **Admin → Users** (`/admin/users`) is where accounts are created, searched,
  edited, promoted, activated and deleted. `/team` redirects here.
  **Admin → Roles & permissions**, **Activity logs** and **System settings**
  sit alongside it, each shown only to whoever holds its permission.

## Access and roles

Accounts are created by administrators only. There is no sign-up page, and the
Supabase signup endpoint should be switched off (see step 2) — the two things
anyone can do without an account is sign in, and ask for a password reset.

```
SUPER ADMIN  →  ADMIN  →  MANAGER  →  STAFF  →  VIEWER
```

| | Super Admin | Admin | Manager | Staff | Viewer |
|---|---|---|---|---|---|
| See all companies | Yes | Yes | Yes | Own + Unassigned | Own + Unassigned |
| Create and edit business records | Yes | Yes | Yes | Yes | **No — read-only** |
| Reports | Yes | Yes | Yes | Yes (own scope) | Yes (own scope) |
| View users | Yes | Yes | Yes | No | No |
| Create users | Yes | Yes | No | No | No |
| Change roles | Any | Below Admin only | No | No | No |
| Create or change an Admin | Yes | No | No | No | No |
| Activate / deactivate | Yes | Yes | No | No | No |
| Delete users | Yes | No | No | No | No |
| Activity logs | Yes | Yes | No | No | No |
| System settings | Yes | No | No | No | No |

Two rules run through all of it, and both are enforced in Postgres:

- **You may only act on someone strictly below you**, and **only hand out a
  role strictly below your own.** Super Admin is exempt — it is the top of the
  tree and has to be able to appoint peers and successors.
- **Nobody may change their own role or status**, Super Admin included. That
  is what makes self-promotion impossible rather than merely discouraged.

The last active Super Admin cannot be demoted, deactivated or deleted, so the
system can never end up with nobody able to administer it.

Roles are never tested by name. Every check goes through a permission
(`users.create`, `data.view_all`, `logs.view`, …) granted in the
`role_permissions` table, so changing what a role may do is one row, not a
search through the codebase. The grants are seeded by the migration and shown
live on **Admin → Roles & permissions**.

### How a new user gets in

1. An administrator opens **Admin → Users → Add user**, enters their details
   and picks a role.
2. The `admin-users` edge function checks the caller may create that role,
   then invites them through Supabase Auth. The account is created `pending`.
3. They get an email with a one-time link to `/set-password`.
4. They choose a password. Confirming the address flips the account to
   `active`, and they can sign in.

Nobody ever sets or sees anyone else's password. If SMTP is not configured on
the project, the account is still created and the modal hands back the
invitation link to pass on by hand.

### Passwords

**Forgot password** on the sign-in page emails a reset link, and says the same
thing whether or not the address has an account — otherwise the form would be
a way of finding out who works here. Administrators can trigger the same email
from a user's page.

### Deactivated accounts

Deactivating someone does not invalidate the session token already in their
browser, so the lockout lives in the database: `is_active_user()` is part of
every policy, and an inactive account holds no permissions at all. The app
signs them out when it notices, which is a courtesy on top.

### The audit trail

`activity_logs` records user creation and deletion, every role change
(promotion to and demotion from Admin are their own action names), activation
changes, detail edits and password reset requests — written by the database
inside the same transaction as the change, with the names and roles snapshotted
so an entry still reads correctly after the people in it are gone. It is
append-only: the app has no policy that can update or delete a row.

Entries read as sentences — *"Super Admin John promoted Sarah from Staff to
Admin."*

## Who sees what

Business-data visibility is enforced in the database by row-level security,
not just in the UI — a rep cannot reach another rep's accounts even by
crafting their own API call.

| | Sees all data | Own + Unassigned |
|---|---|---|
| Companies | Super Admin, Admin, Manager | Staff, Viewer |
| Contacts, appointments, follow-ups, share history | All | Those on companies they can see |
| Appointments/follow-ups assigned to them | All | Always visible, whoever owns the company |
| Rate card, email templates, price list PDFs | Read/write | Read/write (shared) |
| STO branding and email settings | Read/write with `settings.branding` (Super Admin, Admin, Manager) | Read-only |
| STO branding and email settings | Read/write with  | Read-only |
| STO agreements | All | Those on companies they can see, plus any they built |
| Reassign a company to another rep | Yes | No |

Viewer is the exception to the right-hand column: it can read everything in
its scope and write none of it, because every write policy carries
`can_write_data()` and Viewer is the one role without that grant.

**Every rep field is a typed name.** The company's assigned rep, an
appointment's Zondela rep and a follow-up's assignee are all plain text boxes —
one editable input each, for everybody, with no picker. The link (`owner_id`,
`rep_id`, `assigned_to`) is what row-level security and the per-rep views act
on, so writing a name is a label and nothing more.

The one place a link survives a save is a company created by someone without
`data.view_all`: `companies_insert` requires `owner_id = auth.uid()` from them,
so their own id stays pinned whatever the box says. The typed name is stored
alongside it rather than discarded, and `repLabel` shows the linked profile,
because that is who actually owns the record.

Three consequences worth knowing before you rely on them:

- Companies saved by someone with `data.view_all` land in the **shared pool**
  below, visible to every rep — their save clears the link. A rep saving a
  company themselves is the exception described just above: their own id stays
  pinned and they keep the company.
- The Dashboard's **My work** toggle filters follow-ups and appointments on
  those links, so it has nothing to match and shows none of them. The whole-team
  view is unaffected.
- **Reports**' rep performance table does not read zero, because it falls back
  to the name: a record with no link is credited to the profile whose
  `full_name` matches what was typed on it, so one person does not appear as
  two rows. A name matching no profile gets its own row, marked **no login**.
  The Rep filter matches the same way. The join is on spelling alone, so two
  team members with the same name would be counted as one.

Records created before this change keep whatever links they already had, and
still resolve to the right names, until someone opens and saves them.

**Unassigned is a shared pool.** A company with no assigned rep is visible
to everyone, so new leads can sit there until someone picks them up. A rep
claims one by opening it and saving — that assigns it to them, and from
then on only someone with full visibility can move it. Reps always own what
they create.

**Delegated work stays visible.** If a Manager or Admin books an appointment or a
follow-up against a rep, the rep sees that item even when the company
belongs to someone else — otherwise it would vanish from their queue.

**Reports narrow accordingly.** Anyone with full visibility sees the whole funnel and every
rep's row. A rep sees the same ten reports computed over just the records
row-level security lets them read, so the page reads as a personal
scorecard — including the CSV they export from it.

## Notes and next steps

- **Email sending**: pricing/template emails currently open via `mailto:`,
  which hands off to the user's own email client. If you want the CRM to
  send email itself (so you can track opens, for example), the next step
  is wiring up an email provider (e.g. Resend, Postmark, or Gmail via
  Supabase Edge Functions) — the `sent_messages` table already has the
  shape to support that.
- **WhatsApp sending** uses a `wa.me` deep link with the message
  pre-filled; the team still taps send themselves inside WhatsApp, since
  WhatsApp doesn't allow arbitrary automated sending from a web app
  without their Business API.
- **Row-level security** enforces per-rep visibility (see "Who sees what"
  above). If you'd rather every team member saw the whole pipeline, that's
  a policy change in `supabase/schema.sql`, not an app rewrite — the
  instructions are in a comment at the top of that file's RLS section.
- **Adding a permission** is one row in the `permissions` seed plus the roles
  that get it in `role_permissions`, both in
  `supabase/migrations/0001_closed_access_rbac.sql` — then the matching entry
  in `Permission` and `ROLE_PERMISSIONS` in `src/lib/permissions.ts` so the UI
  agrees with the database. Re-running the migration resets the grants to what
  that file says, which is deliberate: the mapping is code, not data.
- **Editing roles from the UI** is not built. Roles & permissions is a
  read-only view of the live grants, because an edit made there would be
  reverted by the next deploy.
- **Changing someone's email address** is a Supabase Auth operation
  (Authentication → Users), not a profile edit — the column is a mirror of
  `auth.users.email` and the guard trigger keeps it from drifting.
- Run `supabase gen types typescript` (via the Supabase CLI) later if you
  want fully generated, strict types instead of the hand-written ones in
  `src/lib/database.types.ts`.
