# Zondela CRM

A pipeline CRM for Zondela's marketing team — companies and contacts, site
visits, follow-ups, an STO rate card, pricing shared via email/WhatsApp, and
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
   follow_ups, sto_rate_card, email_templates, sent_messages, profiles),
   indexes, row-level security policies, and seeds a starter rate card.
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
  components/     Shared UI: app shell/nav, modals (company, contact,
                   site visit, follow-up, share-pricing forms)
  hooks/           useAuth (session/profile), useCrmData (all Supabase
                   data hooks: companies, contacts, visits, follow-ups,
                   rate card, templates, profiles)
  lib/             Supabase client, TypeScript types, stage color/label
                   utilities
  pages/           Route-level pages: Pipeline (Kanban board), Companies,
                   CompanyDetail, Visits, FollowUps, RateCard, Templates,
                   Reports, Team, Login
supabase/
  schema.sql       Full Postgres schema + RLS policies + seed data
```

## How the pieces fit together

- **Pipeline** (`/`) is the home view — a Kanban board across
  Lead → Contacted → Site visit → Proposal sent → Negotiation, with
  Won/Lost tracked as a summary row. Drag a card to change its stage.
- **Company detail** (`/companies/:id`) is where the day-to-day work
  happens: manage contacts, schedule/log site visits, schedule follow-ups,
  and share STO pricing.
- **Share STO pricing** builds a message from selected rate card items
  (optionally starting from a saved template), and either opens your email
  client (`mailto:`) or WhatsApp (`wa.me`) with the message pre-filled. Every
  share is logged to `sent_messages` so it shows up in that company's
  activity and rolls up into reports.
- **Reports** (`/reports`) shows the pipeline funnel by stage and a
  per-rep breakdown (companies owned, visits completed/upcoming,
  follow-ups done/pending/overdue, win rate) — this is what the Owner
  uses to see how the team is doing.
- **Team** (`/team`, Owner-only) lists everyone with access and lets the
  Owner change roles.

## Who sees what

Visibility is enforced in the database by row-level security, not just in
the UI — a rep cannot reach another rep's accounts even by crafting their
own API call.

| | Owner | Marketing rep |
|---|---|---|
| Companies | All | Own (`owner_id`) + Unassigned |
| Contacts, visits, follow-ups, share history | All | Those on companies they can see |
| Visits/follow-ups assigned to them | All | Always visible, whoever owns the company |
| Rate card, email templates | Read/write | Read/write (shared) |
| Reassign a company to another rep | Yes | No |
| Team page | Yes | No |

**Unassigned is a shared pool.** A company with no assigned rep is visible
to everyone, so new leads can sit there until someone picks them up. A rep
claims one by opening it and saving — that assigns it to them, and from
then on only an Owner can move it. Reps always own what they create.

**Delegated work stays visible.** If an Owner books a site visit or a
follow-up against a rep, the rep sees that item even when the company
belongs to someone else — otherwise it would vanish from their queue.

**Reports narrow accordingly.** An Owner sees the whole funnel and every
rep's row under Team activity. A rep sees the same page computed over just
their own accounts, so it reads as a personal scorecard.

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
