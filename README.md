# Zondela CRM

A pipeline CRM for Zondela's marketing team — companies and contacts,
appointments, follow-ups, STO rates and agreements built from a rate card and
tracked from draft to accepted, pricing shared via email/WhatsApp, and
reusable email templates. Built with React + Vite on the frontend and
Supabase (Postgres + Auth) for persistence.

## Stack

- **Frontend**: React 19 + TypeScript, Vite, React Router
- **Backend**: Supabase (Postgres, Auth, Row Level Security) — no separate
  server; the frontend talks to Supabase directly.
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
   email_templates, sent_messages, profiles), indexes and row-level security
   policies. It installs empty — add your own services on the STO page's
   Rate card tab.
   It also creates the public `pricing` storage bucket for price list PDFs.
   If your database predates that, re-run the script to add it.
3. It's safe to re-run — the script drops/recreates policies and uses
   `if not exists` for tables.

By default, **email confirmation may be required** for new sign-ups. If you
want your team to sign in immediately without confirming email, go to
**Authentication → Providers → Email** and turn off "Confirm email" (fine
for an internal tool; keep it on if you'd rather verify addresses).

## 3. Configure the app

```bash
cp .env.example .env
```

Edit `.env` and fill in your project URL and anon key:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

## 4. Install and run

```bash
npm install
npm run dev
```

Open the printed local URL. The first person to sign up should promote
themselves to **Owner**:

1. Sign up from the login page (this creates a `marketing`-role profile by
   default).
2. In the Supabase dashboard, go to **Table editor → profiles**, find your
   row, and change `role` from `marketing` to `owner`.
3. Reload the app — you'll now see the **Team** page, where you can promote
   any future teammates yourself without touching the database directly.

Everyone else just signs up from the login page; new accounts default to
the `marketing` role.

## Project structure

```
src/
  components/     Shared UI: app shell/nav, the rate card panel, modals
                   (company, contact, appointment, follow-up, share-pricing,
                   agreement builder, send-agreement forms)
  hooks/           useAuth (session/profile), useCrmData (all Supabase
                   data hooks: companies, contacts, appointments, follow-ups,
                   rate card, agreements, templates, profiles, sent messages)
  lib/             Supabase client, TypeScript types, stage and agreement
                   colour/label/total utilities, report date ranges and
                   CSV export
  pages/           Route-level pages: Dashboard, Companies,
                   CompanyDetail, Contacts, Appointments, FollowUps, Sto,
                   Templates, Reports, Team, Login
supabase/
  schema.sql       Full Postgres schema + RLS policies
  reset-data.sql   Deletes every business record (run in the SQL editor)
```

## How the pieces fit together

- **Dashboard** (`/`) is the home view — what needs doing now. Overdue and
  due-today counts, one agenda merging follow-ups with appointments over the
  next seven days, a pipeline summary by stage, the unclaimed pool, and
  active deals with nothing booked next. Owners can switch between the
  whole team and their own work.
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
- **STO** (`/sto`) is where rates and agreements live, in two tabs.
  **Rate card** is the price list — the single place a service is priced.
  **Agreements** is the pipeline for the documents themselves: build one from
  the rate card (or type lines in by hand), send it, and track the answer.
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
  logged to `sent_messages` like any other share. **Accepted** and
  **Declined** stamp their own dates; **Reopen** puts a settled agreement back
  in play.
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
- **Reports** (`/reports`) is eight reports over one period and one set of
  filters — **Overview** (pipeline funnel, period totals, and companies split
  by market and relationship), **Visits & meetings** (every appointment with
  its outcome, what happens next, and the summary written after it),
  **Rep performance** (companies, visits, follow-ups, quotes, accepted value
  and win rate per rep), **Service interest** (which rate card services get
  quoted, to how many companies, and what they are worth), **Follow-ups**
  (what was due, what is still open and how late), **Visit conversion** (of
  the companies visited, how many were quoted afterwards, how many accepted,
  and the median days from visit to quote), **STO outreach** (pricing shares
  by email and WhatsApp, plus the agreements sent), and **Notes & feedback**
  (visit summaries, follow-up notes and company notes in one stream — what
  clients actually said).

  The filter bar — dates with presets, rep, relationship, market, stage,
  service, a per-report status and a search box — applies to every tab and
  **lives in the URL**, so a filtered report is a link you can send a
  colleague. **Download CSV** exports the table as shown (the same column
  definitions drive both, so the file can never disagree with the screen),
  and **Print / PDF** prints it through the browser with the shell, filters
  and tabs stripped out and a header stamped with the period, the filters
  applied and the row count.

  The **Rep** dropdown offers team members with logins and, under "No login",
  every name that has been typed against a visit, follow-up or company — so
  a rep without an account still gets a row.
- **Team** (`/team`, Owner-only) lists everyone with access and lets the
  Owner change roles.

## Who sees what

Visibility is enforced in the database by row-level security, not just in
the UI — a rep cannot reach another rep's accounts even by crafting their
own API call.

| | Owner | Marketing rep |
|---|---|---|
| Companies | All | Own (`owner_id`) + Unassigned |
| Contacts, appointments, follow-ups, share history | All | Those on companies they can see |
| Appointments/follow-ups assigned to them | All | Always visible, whoever owns the company |
| Rate card, email templates, price list PDFs | Read/write | Read/write (shared) |
| STO agreements | All | Those on companies they can see, plus any they built |
| Reassign a company to another rep | Yes | No |
| Team page | Yes | No |

**Every rep field is a typed name.** The company's assigned rep, an
appointment's Zondela rep and a follow-up's assignee are all plain text boxes —
there is no picker, and saving clears any login link the record had. The link
(`owner_id`, `rep_id`, `assigned_to`) is what row-level security and the
per-rep views act on, so writing a name is a label and nothing more. Each form
says so under the field.

Three consequences worth knowing before you rely on them:

- Companies an Owner saves land in the **shared pool** below, visible to every
  rep. The one exception is a rep saving a company themselves:
  `companies_insert` requires `owner_id = auth.uid()` from a non-owner, so
  their own id is still pinned and they keep the company.
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
then on only an Owner can move it. Reps always own what they create.

**Delegated work stays visible.** If an Owner books an appointment or a
follow-up against a rep, the rep sees that item even when the company
belongs to someone else — otherwise it would vanish from their queue.

**Reports narrow accordingly.** An Owner sees the whole funnel and every
rep's row. A rep sees the same eight reports computed over just the records
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
- Run `supabase gen types typescript` (via the Supabase CLI) later if you
  want fully generated, strict types instead of the hand-written ones in
  `src/lib/database.types.ts`.
