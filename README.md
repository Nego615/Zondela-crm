# Zondela CRM

A pipeline CRM for Zondela's marketing team — companies and contacts,
appointments, follow-ups, and the season's STO rate sheet for Zondela House —
published once, sent to every tour operator, and accepted by each of them on a
link of their own. Pricing is shared via email/WhatsApp from reusable
templates. Built with React + Vite on the frontend and
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
   follow_ups, sto_agreement_versions, sto_version_rates,
   sto_version_supplements, sto_version_sections, sto_agreement_sends,
   sto_rate_card, email_templates, sent_messages, profiles, permissions,
   role_permissions, activity_logs, org_settings), indexes, the role and
   permission model, row-level security policies, and the two `security
   definer` functions the operator's acceptance page calls. It installs empty —
   publish the season's rates on the STO page's Agreement versions tab.
   It also creates the public `pricing`, `branding` and `sto` storage buckets,
   for price list PDFs, your logo and the season's signed rate sheet. If your
   database predates any of them, re-run the script to add it.
3. It's safe to re-run — the script drops/recreates policies and uses
   `if not exists` for tables.
4. **Optional, and the fastest way to see the section working:** run
   [`supabase/seed-sto-2026.sql`](./supabase/seed-sto-2026.sql). It enters the
   2026 Standard Tour Operator Rate Contract exactly as signed — the six room
   types with their BB/HB/FB rates and occupancies, both supplements, and all
   six policies word for word — as a draft. Open it under STO → Agreement
   versions, attach the PDF, and activate it. Re-running replaces that one
   contract rather than adding a second.

**Upgrading an existing database?** Re-running `schema.sql` is the whole
migration. It renames the old roles (`owner` → `super_admin`,
`marketing` → `staff`), adds the new profile columns with everyone already in
the system left `active`, installs the permission tables and audit log, and
adds the agreement letterhead and message delivery tracking, and installs the
rate sheet model (versions, rates, sends) beside the old priced agreements —
which keep their data, untouched. Existing sent messages backfill as `sent`,
which is what they were.

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
- **STO Agreements** (`/sto`) is the season's rates for Zondela House and
  everyone who has them. Zondela is not quoting each operator a different
  price: it publishes **one rate sheet a season** and sends that same document
  to every tour operator, who accepts it. The section is five tabs.

  **Agreement versions** is the rate contracts themselves, shaped like the
  signed document: an overview of the property, the **rates chart**, the
  supplements, and the numbered policies.

  A rate is **one row per room type**, quoted at three meal plans at once and
  carrying how many people it sleeps — exactly as the contract prints it:

  | Room type | STO BB | STO HB | STO FB | Max occupancy |
  |---|---|---|---|---|
  | Standard Single | 130 | 150 | 170 | 1 |
  | Standard Double | 170 | 210 | 250 | 2 |
  | Family Room | 340 | 420 | 500 | 4 |

  Under it sit the line about VAT and the tourism levy, the **supplements**
  (lunch $20 per person, dinner $20 per person — priced per person, so they
  cannot live in the rates table without lying about what the number means),
  and the **policies**: children, tour leader, check-in/out, deposit,
  cancellation, no-show. Each policy is a row rather than one blob of terms,
  because the document numbers them and each is renegotiated on its own; a
  line starting with • or - prints as a bullet.

  All of it is entered as data rather than left inside a file, because
  everything downstream reads it: the document the operator opens, the tag on
  the card ("6 room types · sleeps up to 4"), the description in a report. The
  **signed PDF is attached as well** and travels with it — it is the file
  operators know — but the CRM renders its own branded contract, so a phone
  opens something readable without downloading anything. A version is a
  **draft** until it is **activated**; only an active contract can be sent, and
  a past season is **archived** rather than deleted. Each card carries what came
  back from it: sent to how many operators, how many opened it, how many
  accepted.

  **Sent agreements** is one row per operator the sheet went to, with where it
  got to — Sent, Viewed, Accepted, Declined — the date it was opened, the date
  it was answered, a follow-up date you can set inline, and a **Copy link**
  button for when someone loses the email. **Accepted agreements** is the
  answers: who accepted, when, and anything they wrote back, with the
  agreement page and the PDF one click away.

  **Email templates** are what the operator receives. Placeholders are filled
  in as it is sent: `{{contact_name}}`, `{{company_name}}`,
  `{{agreement_year}}`, `{{agreement_name}}`, `{{agreement_button}}` and
  `{{sender_name}}` — the button becomes that operator's own link, which is
  how the CRM knows when they open it. (`/templates` still redirects here.)
  **Settings** is the letterhead and email defaults — see "Branding the rate
  sheet" below — and, under it, the older **service rate card** and price list
  PDF, which are what **Share pricing** on a company's page still uses.
- **Sending a rate sheet** records the send first (the emailed link is the
  token on that row, so there is nothing to compose until the database has
  issued it), then opens your email client with the message written out. It is
  logged to `sent_messages` like any other share. Sending to the same operator
  again issues a new link; the old one keeps working. A rep can also mark a
  send **Accepted** or **Declined** by hand, for an operator who answers by
  email or on the phone.
- **The operator's page** (`/agreement/:token`) is the only part of the app a
  client ever sees: no login, no app shell. They read the whole contract —
  rates, supplements, policies — download the PDF if they want it, and accept
  under the sentence the paper contract uses: *"I, on behalf of …, accept the
  rates offered by Zondela House and accept the terms and conditions pertaining
  thereto."* They give a **name in print** and a **position/title**, which is
  what the paper asks for under a signature, plus an optional email and note.
  **No tax numbers, no registration details**; Zondela is publishing rates, not
  onboarding a supplier. Opening the link marks the send **viewed** on its own,
  which is the only delivery signal the CRM gets without an email provider
  wired up, and accepting marks it **accepted** the moment they do it — after
  which the document's signature block prints who accepted and when instead of
  a blank rule.

  The page reaches the database through two `security definer` functions —
  `sto_public_agreement(token)` and
  `sto_public_respond(token, accept, name, title, …)` —
  and nothing else. `anon` holds no grant on any table: the functions take a
  token, act on the one row it names, and return only what the page prints,
  so there is no list to ask for and no policy to get wrong.
- **Preview** opens the rate sheet as the operator will see it, with
  Print / Save as PDF. The browser's own print dialogue is the export — it
  produces a better PDF than the app could assemble, and needs no library.
  A sheet still in draft prints with a DRAFT watermark.

> **The old priced agreements.** Before this, an STO agreement was invoice-
> shaped: one per company, priced line by line with quantities and a discount.
> `sto_agreements` and `sto_agreement_items` are left in place with their data
> intact — they are real history — but nothing writes to them any more, and
> `/agreements` redirects to the rate sheets.

### Branding the rate sheet

**STO → Settings** is one row (`org_settings`) holding the letterhead:
organisation and legal name, tagline, address and contact block, logo, the two
brand colours, the opening paragraph, default terms, footer line and signatory.
The rate sheet reads all of it, so rebranding is this form rather than
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

**Approved and Rejected are not marked by hand.** They followed the old priced
agreements, mirrored down by a database trigger. A rate sheet's own answer now
lives on its send row instead — Sent, Viewed, Accepted, Declined, on the STO
page — and the operator sets it themselves by opening and accepting their link.

Timestamps are stamped by the database and only ever filled once, so "delivered
on the 3rd" stays true after the message is later marked viewed.
- **Price list PDF** — upload the PDF you already send clients, on the STO
  page's Settings tab under the service rate card. One is marked default and is
  offered automatically when sharing. It is stored in the `pricing` bucket and
  reaches the client exactly as uploaded. (The season's own rate sheet PDF is
  separate: it is attached to its version and lives in the `sto` bucket.)
- **Share STO pricing** builds a message from selected rate card items
  (optionally starting from a saved template) plus a link to the price list
  PDF, and either opens your email client (`mailto:`) or WhatsApp (`wa.me`)
  with the message pre-filled. Neither `mailto:` nor `wa.me` can carry a file
  attachment, so the PDF travels as a link the client opens; **Download PDF**
  is there for when you would rather attach it by hand. Every
  share is logged to `sent_messages` so it shows up in that company's
  activity and rolls up into reports.
- **Reports** (`/reports`) is seven executive reports over one period and one
  set of filters:

  | Report | What it answers |
  |---|---|
  | **Monthly Visits** | How many visits a month, and what happened on each — company, agent, type, outcome, what happens next, and the summary written after it |
  | **Agent Performance** | Per agent: visits, new companies, STO agreements sent, site visits requested and completed, and active partners |
  | **Property Interest** | Where every company stands with the house — their type, location, interest status and the agent who owns them |
  | **Follow-ups** | What was due, who owns it, what it says, and how late it is |
  | **Site Visit Conversion** | Of the companies visited on site, how many were sent the rates afterwards, how quickly, and how many accepted |
  | **STO Agreements** | Every operator sent the season's rates: whether they opened them, when they answered, who accepted and what they wrote back |
  | **Feedback & Recs** | What was actually said — visit summaries, operators' own replies, follow-up notes and company notes, newest first |

  **Monthly Visits opens with the months**, a card per month over the period
  carrying the count, how many were completed, how many companies were seen and
  how many carry a summary. Empty months are kept, because a month with no
  visits in it is the finding; over a span too long for that only the months
  with something in them are listed.

  **Feedback & Recs is not a table.** Feedback is a paragraph, and a paragraph
  in a cell is unreadable, so each note is a card: the date, company and type
  above with the agent on the right, and the words underneath. Everywhere else
  the free text travels *with* its row — a visit's summary, an operator's
  reply — printed under the row rather than squeezed into a column, and
  exported as a column of its own.

  The filter bar — **From, To, Agent, Company type, Location, Agreement,
  Status** — applies to every report and **lives in the URL**, so a filtered
  report is a link you can send a colleague. **Location** is the country on the
  company record, offered as the spellings actually on file; **Agreement**
  narrows to the operators sent one season's rates; **Status** means whatever
  the open report understands (a visit's outcome, a follow-up's state, a send's
  status, a company's interest), and a status left over from another tab is
  ignored rather than silently narrowing the next table you open.

  **CSV** exports the table as shown — the same column definitions drive both,
  so the file can never disagree with the screen — and **PDF** prints it
  through the browser with the shell, filters and tabs stripped out and a
  header stamped with the property, the period, the filters applied and the row
  count. The browser's own dialogue is the export: it makes a better PDF than
  the app could assemble, and needs no library.

  The **Agent** dropdown offers team members with logins and, under "No login",
  every name that has been typed against a visit, follow-up or company — so an
  agent without an account still gets a row.
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
rep's row. A rep sees the same seven reports computed over just the records
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
