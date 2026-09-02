-- ============================================================================
-- 0004 — THE RATE CONTRACT'S REAL SHAPE
-- ============================================================================
-- 0003 modelled a rate as one price with a basis written beside it. The actual
-- Zondela House contract does not work that way, and the document is the
-- authority: a room type is quoted at three prices at once — bed & breakfast,
-- half board, full board — and carries the number of people it sleeps.
--
--   ROOM TYPE          STO BB   STO HB   STO FB   MAX OCCUPANCY
--   Standard Single      130      150      170          1
--   Standard Double      170      210      250          2
--   …
--
-- Three things follow from reading the contract properly:
--
--   1. sto_version_rates gains bb_price, hb_price, fb_price and max_occupancy,
--      and loses the single price/basis pair. The old price is copied into
--      bb_price first, so nothing entered under 0003 is lost.
--   2. Supplements are their own list (lunch $20 per person, dinner $20 per
--      person) — priced per person, not per room, so they cannot sit in the
--      rates table without lying about what the number means.
--   3. The contract is mostly *prose*: children's policy, tour leader,
--      check-in/out, deposit, cancellation, no-show. Those are numbered
--      sections in the PDF, so they are rows here rather than one blob of
--      terms — the document renders them numbered, and each can be edited on
--      its own next season.
--
-- The acceptance block gains the signatory's title, because that is what the
-- paper contract asks for under the client's signature.
--
-- Included verbatim in schema.sql; run on its own to apply just this to a live
-- database. Idempotent.

-- ----------------------------------------------------------------------------
-- RATES: three meal plans, one row
-- ----------------------------------------------------------------------------
alter table sto_version_rates add column if not exists bb_price numeric(12,2) not null default 0;
alter table sto_version_rates add column if not exists hb_price numeric(12,2) not null default 0;
alter table sto_version_rates add column if not exists fb_price numeric(12,2) not null default 0;
alter table sto_version_rates add column if not exists max_occupancy int not null default 2;

-- Carry anything entered under 0003 across before the column goes.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sto_version_rates' and column_name = 'price'
  ) then
    update sto_version_rates set bb_price = price where bb_price = 0 and price > 0;
    alter table sto_version_rates drop column price;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sto_version_rates' and column_name = 'basis'
  ) then
    alter table sto_version_rates drop column basis;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- VERSION: how the rates are read, and the line under the table
-- ----------------------------------------------------------------------------
-- Both are printed on the document and both change wording between seasons, so
-- they are fields rather than strings in the renderer.
alter table sto_agreement_versions
  add column if not exists rate_basis text default 'Per room, per night';
alter table sto_agreement_versions
  add column if not exists rates_note text
  default 'All rates quoted are inclusive of VAT and Tourism development levy.';

-- ----------------------------------------------------------------------------
-- SUPPLEMENTS (priced per person, alongside the room)
-- ----------------------------------------------------------------------------
create table if not exists sto_version_supplements (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references sto_agreement_versions(id) on delete cascade,
  name text not null,
  description text,
  price numeric(12,2) not null default 0 check (price >= 0),
  currency text not null default 'USD',
  unit text not null default 'per person',
  sort_order int not null default 0
);

create index if not exists sto_version_supplements_version_idx
  on sto_version_supplements(version_id);

-- ----------------------------------------------------------------------------
-- SECTIONS (the numbered policies that make up most of the contract)
-- ----------------------------------------------------------------------------
create table if not exists sto_version_sections (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references sto_agreement_versions(id) on delete cascade,
  title text not null,
  -- Free text, blank line separated. Bullet lines starting with • or - are
  -- rendered as a list by the document; everything else is a paragraph.
  body text not null default '',
  sort_order int not null default 0
);

create index if not exists sto_version_sections_version_idx
  on sto_version_sections(version_id);

alter table sto_version_supplements enable row level security;
alter table sto_version_sections enable row level security;

drop policy if exists "sto_version_supplements_select" on sto_version_supplements;
create policy "sto_version_supplements_select" on sto_version_supplements for select
  using (public.is_active_user());

drop policy if exists "sto_version_supplements_write" on sto_version_supplements;
create policy "sto_version_supplements_write" on sto_version_supplements for all
  using (public.can_write_data()) with check (public.can_write_data());

drop policy if exists "sto_version_sections_select" on sto_version_sections;
create policy "sto_version_sections_select" on sto_version_sections for select
  using (public.is_active_user());

drop policy if exists "sto_version_sections_write" on sto_version_sections;
create policy "sto_version_sections_write" on sto_version_sections for all
  using (public.can_write_data()) with check (public.can_write_data());

-- ----------------------------------------------------------------------------
-- ACCEPTANCE: the signature block the paper contract asks for
-- ----------------------------------------------------------------------------
-- Name in print and position/title, which is what the client signs under. No
-- tax or registration details: Zondela is publishing rates, not onboarding a
-- supplier.
alter table sto_agreement_sends add column if not exists responded_title text;

-- ----------------------------------------------------------------------------
-- THE PUBLIC SIDE, WITH THE FULL CONTRACT
-- ----------------------------------------------------------------------------
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
      'responded_title', v_send.responded_title,
      'responded_note', v_send.responded_note
    ),
    'version', jsonb_build_object(
      'name', v_version.name,
      'year', v_version.year,
      'summary', v_version.summary,
      'intro', v_version.intro,
      'terms', v_version.terms,
      'rate_basis', v_version.rate_basis,
      'rates_note', v_version.rates_note,
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
            'description', r.description,
            'bb_price', r.bb_price,
            'hb_price', r.hb_price,
            'fb_price', r.fb_price,
            'max_occupancy', r.max_occupancy,
            'currency', r.currency
          ) order by r.sort_order, r.room_type
        )
        from sto_version_rates r
        where r.version_id = v_version.id
      ),
      '[]'::jsonb
    ),
    'supplements', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'name', s.name,
            'description', s.description,
            'price', s.price,
            'currency', s.currency,
            'unit', s.unit
          ) order by s.sort_order, s.name
        )
        from sto_version_supplements s
        where s.version_id = v_version.id
      ),
      '[]'::jsonb
    ),
    'sections', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', x.id, 'title', x.title, 'body', x.body)
          order by x.sort_order
        )
        from sto_version_sections x
        where x.version_id = v_version.id
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

-- The signature block gained a title, so the old four-argument version is
-- replaced rather than overloaded — two functions answering the same call is
-- how one of them silently stops being the one that runs.
drop function if exists public.sto_public_respond(text, boolean, text, text, text);

create or replace function public.sto_public_respond(
  p_token text,
  p_accept boolean,
  p_name text default null,
  p_title text default null,
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

  -- Accepting twice is not an error — a client who clicks again should see the
  -- same confirmation — so the first answer stands and is returned unchanged.
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
        responded_title = nullif(btrim(coalesce(p_title, '')), ''),
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
revoke all on function public.sto_public_respond(text, boolean, text, text, text, text) from public;
grant execute on function public.sto_public_agreement(text) to anon, authenticated;
grant execute on function public.sto_public_respond(text, boolean, text, text, text, text)
  to anon, authenticated;
