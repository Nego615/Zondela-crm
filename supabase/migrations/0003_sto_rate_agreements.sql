-- ============================================================================
-- 0003 — STO RATE AGREEMENTS (versions, sends, acceptance)
-- ============================================================================
-- What Zondela actually sends an operator is not an invoice. It is the season's
-- rate sheet for Zondela House — the same document for everybody, published
-- once a year, sent to many tour operators, and accepted by each of them.
--
-- The 0001/0002 model was invoice-shaped: one agreement per company, priced
-- line by line with quantities and a discount. This replaces it with three
-- tables that match the real thing:
--
--   1. sto_agreement_versions — the season's rate agreement. Carries the PDF
--      as uploaded (what the operator asked for) *and* the rates as data (what
--      the CRM renders, what the accept page shows, what reports describe).
--   2. sto_version_rates — one row per room type per season inside a version.
--   3. sto_agreement_sends — one row per operator the version went to, with
--      where it got to: sent, viewed, accepted, declined.
--
-- Acceptance happens on a public page reached by a token in the email. No
-- login, and no tax details asked for — the operator confirms who they are and
-- accepts the rates, and that is the whole record.
--
-- The old sto_agreements / sto_agreement_items tables are left in place and
-- untouched: they hold real history, and dropping them would lose it. Nothing
-- in the app writes to them any more.
--
-- Included verbatim in schema.sql; run on its own to apply just this to a live
-- database. Idempotent.

-- ----------------------------------------------------------------------------
-- VERSIONS
-- ----------------------------------------------------------------------------
create table if not exists sto_agreement_versions (
  id uuid primary key default gen_random_uuid(),
  -- What the team calls it: "Zondela House STO Rates 2026".
  name text not null,
  -- The season the rates are for. Separate from valid_from/valid_to because a
  -- 2026 sheet is often published in 2025 and quoted as "the 2026 rates".
  year int not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  valid_from date,
  valid_to date,

  -- Prose. `summary` is the one-line description read in lists and reports;
  -- `intro` is what the operator reads above the rates on the accept page;
  -- `terms` is the conditions block under them.
  summary text,
  intro text,
  terms text,

  -- The uploaded rate sheet, kept exactly as supplied. The CRM renders its own
  -- branded version from sto_version_rates, but the operator still gets the
  -- original: it is the document they know. Key into the `sto` bucket below.
  pdf_path text,
  pdf_name text,
  pdf_size_bytes bigint not null default 0,

  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sto_agreement_versions_year_idx
  on sto_agreement_versions(year desc);
create index if not exists sto_agreement_versions_status_idx
  on sto_agreement_versions(status);

-- ----------------------------------------------------------------------------
-- RATES (room type × season, inside one version)
-- ----------------------------------------------------------------------------
-- Zondela House is one property, so the scope of a version is its room types
-- and the seasons they are priced for. Both are free text rather than lookup
-- tables: a season is renamed ("Green season", "Festive") more often than a
-- schema should have to be migrated, and the rate sheet is the authority.
create table if not exists sto_version_rates (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references sto_agreement_versions(id) on delete cascade,
  season text not null default 'All year',
  room_type text not null,
  -- How the price is read: "Per person sharing, half board", "Per room, B&B".
  basis text,
  description text,
  price numeric(12,2) not null default 0 check (price >= 0),
  currency text not null default 'USD',
  sort_order int not null default 0
);

create index if not exists sto_version_rates_version_idx on sto_version_rates(version_id);

-- ----------------------------------------------------------------------------
-- SENDS (one operator, one version)
-- ----------------------------------------------------------------------------
create table if not exists sto_agreement_sends (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references sto_agreement_versions(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,

  -- Copied from the contact at send time. The email is the address it actually
  -- went to, and it has to stay true after the contact is edited or removed.
  to_name text,
  to_email text,

  -- What the emailed button points at. Random rather than the row id: the id
  -- appears in URLs the team shares internally, and a link that opens an
  -- agreement should not be guessable from one you have already seen.
  token text not null unique default encode(gen_random_bytes(18), 'hex'),

  status text not null default 'sent'
    check (status in ('sent', 'viewed', 'accepted', 'declined')),
  subject text,
  body text,
  -- The team's own note about this send: "asked for the 2027 rates too".
  note text,
  follow_up_at date,

  sent_by uuid references profiles(id) on delete set null,
  sent_at timestamptz not null default now(),
  viewed_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,

  -- What the operator typed on the accept page. Their name and their words —
  -- no tax numbers, no registration details: Zondela is publishing rates, not
  -- onboarding a supplier.
  responded_name text,
  responded_email text,
  responded_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sto_agreement_sends_version_idx on sto_agreement_sends(version_id);
create index if not exists sto_agreement_sends_company_idx on sto_agreement_sends(company_id);
create index if not exists sto_agreement_sends_status_idx on sto_agreement_sends(status);

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Same rule as the rest of the business data: any active user reads, only
-- someone with data.write changes anything. A version is company-independent,
-- so there is nothing to scope by owner; a send is scoped by nothing either,
-- because knowing the season's rates went to an operator is not private
-- between reps the way a company's notes are.
alter table sto_agreement_versions enable row level security;
alter table sto_version_rates enable row level security;
alter table sto_agreement_sends enable row level security;

drop policy if exists "sto_agreement_versions_select" on sto_agreement_versions;
create policy "sto_agreement_versions_select" on sto_agreement_versions for select
  using (public.is_active_user());

drop policy if exists "sto_agreement_versions_write" on sto_agreement_versions;
create policy "sto_agreement_versions_write" on sto_agreement_versions for all
  using (public.can_write_data()) with check (public.can_write_data());

drop policy if exists "sto_version_rates_select" on sto_version_rates;
create policy "sto_version_rates_select" on sto_version_rates for select
  using (public.is_active_user());

drop policy if exists "sto_version_rates_write" on sto_version_rates;
create policy "sto_version_rates_write" on sto_version_rates for all
  using (public.can_write_data()) with check (public.can_write_data());

drop policy if exists "sto_agreement_sends_select" on sto_agreement_sends;
create policy "sto_agreement_sends_select" on sto_agreement_sends for select
  using (public.is_active_user());

drop policy if exists "sto_agreement_sends_write" on sto_agreement_sends;
create policy "sto_agreement_sends_write" on sto_agreement_sends for all
  using (public.can_write_data()) with check (public.can_write_data());

-- ----------------------------------------------------------------------------
-- THE PUBLIC SIDE
-- ----------------------------------------------------------------------------
-- The operator has no login, so the accept page reaches the database as `anon`.
-- Rather than open the tables to anon and rely on a policy to hold the line,
-- three security-definer functions are the entire public surface: they take a
-- token, act on exactly the one row it names, and return only what the page
-- prints. There is no way to ask them for a list, and no anon grant on any
-- table to fall back on.

-- Everything the accept page shows, for one token. Also records the view: the
-- first open moves a send from sent to viewed, which is the only "delivered"
-- signal Zondela gets without an email provider wired up.
create or replace function public.sto_public_agreement(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send sto_agreement_sends;
  v_version sto_agreement_versions;
  v_org org_settings;
  v_company text;
begin
  select * into v_send from sto_agreement_sends where token = p_token;
  if not found then
    return null;
  end if;

  -- Opening the link is not an answer, so a send that has already been
  -- accepted or declined keeps the status it earned.
  if v_send.status = 'sent' then
    update sto_agreement_sends
      set status = 'viewed', viewed_at = coalesce(viewed_at, now()), updated_at = now()
      where id = v_send.id
      returning * into v_send;
  end if;

  select * into v_version from sto_agreement_versions where id = v_send.version_id;
  select * into v_org from org_settings where id = 1;
  select name into v_company from companies where id = v_send.company_id;

  return jsonb_build_object(
    'send', jsonb_build_object(
      'status', v_send.status,
      'to_name', v_send.to_name,
      'company_name', v_company,
      'sent_at', v_send.sent_at,
      'viewed_at', v_send.viewed_at,
      'accepted_at', v_send.accepted_at,
      'declined_at', v_send.declined_at,
      'responded_name', v_send.responded_name,
      'responded_note', v_send.responded_note
    ),
    'version', jsonb_build_object(
      'name', v_version.name,
      'year', v_version.year,
      'summary', v_version.summary,
      'intro', v_version.intro,
      'terms', v_version.terms,
      'valid_from', v_version.valid_from,
      'valid_to', v_version.valid_to,
      'pdf_path', v_version.pdf_path,
      'pdf_name', v_version.pdf_name
    ),
    'rates', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'season', r.season,
            'room_type', r.room_type,
            'basis', r.basis,
            'description', r.description,
            'price', r.price,
            'currency', r.currency
          ) order by r.sort_order, r.room_type
        )
        from sto_version_rates r
        where r.version_id = v_version.id
      ),
      '[]'::jsonb
    ),
    'org', jsonb_build_object(
      'org_name', v_org.org_name,
      'legal_name', v_org.legal_name,
      'tagline', v_org.tagline,
      'address', v_org.address,
      'city', v_org.city,
      'country', v_org.country,
      'phone', v_org.phone,
      'email', v_org.email,
      'website', v_org.website,
      'logo_url', v_org.logo_url,
      'brand_color', v_org.brand_color,
      'accent_color', v_org.accent_color,
      'agreement_footer', v_org.agreement_footer,
      'signatory_name', v_org.signatory_name,
      'signatory_title', v_org.signatory_title
    )
  );
end;
$$;

-- The answer. Accepting twice is not an error — a client who clicks the button
-- again should see the same confirmation, not a failure — so the first answer
-- stands and is returned unchanged.
create or replace function public.sto_public_respond(
  p_token text,
  p_accept boolean,
  p_name text default null,
  p_email text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send sto_agreement_sends;
begin
  select * into v_send from sto_agreement_sends where token = p_token;
  if not found then
    return null;
  end if;

  if v_send.status in ('accepted', 'declined') then
    return jsonb_build_object(
      'status', v_send.status,
      'accepted_at', v_send.accepted_at,
      'declined_at', v_send.declined_at,
      'responded_name', v_send.responded_name,
      'already', true
    );
  end if;

  update sto_agreement_sends
    set status = case when p_accept then 'accepted' else 'declined' end,
        accepted_at = case when p_accept then now() else accepted_at end,
        declined_at = case when p_accept then declined_at else now() end,
        responded_name = nullif(btrim(coalesce(p_name, '')), ''),
        responded_email = nullif(btrim(coalesce(p_email, '')), ''),
        responded_note = nullif(btrim(coalesce(p_note, '')), ''),
        updated_at = now()
    where id = v_send.id
    returning * into v_send;

  return jsonb_build_object(
    'status', v_send.status,
    'accepted_at', v_send.accepted_at,
    'declined_at', v_send.declined_at,
    'responded_name', v_send.responded_name,
    'already', false
  );
end;
$$;

revoke all on function public.sto_public_agreement(text) from public;
revoke all on function public.sto_public_respond(text, boolean, text, text, text) from public;
grant execute on function public.sto_public_agreement(text) to anon, authenticated;
grant execute on function public.sto_public_respond(text, boolean, text, text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- STORAGE — the uploaded rate sheet
-- ----------------------------------------------------------------------------
-- Public read, like `pricing`: the operator opens the PDF from an email and
-- from the accept page, with no session either time. The path is a random
-- uuid, so the URL cannot be guessed from another one.
insert into storage.buckets (id, name, public)
values ('sto', 'sto', true)
on conflict (id) do update set public = true;

drop policy if exists "sto_public_read" on storage.objects;
create policy "sto_public_read" on storage.objects for select
  using (bucket_id = 'sto');

drop policy if exists "sto_write_insert" on storage.objects;
create policy "sto_write_insert" on storage.objects for insert
  with check (bucket_id = 'sto' and public.can_write_data());

drop policy if exists "sto_write_update" on storage.objects;
create policy "sto_write_update" on storage.objects for update
  using (bucket_id = 'sto' and public.can_write_data());

drop policy if exists "sto_write_delete" on storage.objects;
create policy "sto_write_delete" on storage.objects for delete
  using (bucket_id = 'sto' and public.can_write_data());
