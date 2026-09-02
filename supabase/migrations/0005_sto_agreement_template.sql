-- ============================================================================
-- 0005 — THE FULL AGREEMENT TEMPLATE
-- ============================================================================
-- An STO rate contract is five things, and 0003/0004 only modelled three of
-- them. This adds the two that were missing and squares the rates table with
-- how rates are actually quoted:
--
--   1. Overview          — title, season, validity, status, internal notes
--   2. Property sections — the room categories on offer (Standard, Deluxe),
--                          each with its own description, photographs, gallery
--                          link, meal-plan note and seasonal note
--   3. Rate tables       — per season, per room: pax, and both the STO rate
--                          and the rack rate at each meal plan
--   4. Terms & conditions— the numbered clauses, named
--   5. Official PDF      — the signed file, attached as supplied
--
-- Three changes follow.
--
-- `sto_version_sections` is renamed to `sto_version_terms`. It always held the
-- terms; "sections" is now the room categories, and two things called sections
-- is how the wrong one gets edited.
--
-- Rates gain `pax` (how many the price is for — a Suite at 2 and the same
-- Suite at 4 are different lines), the three rack rates beside the STO ones,
-- and a link to the room category they belong to, so each category prints its
-- own table.
--
-- Photographs live in the `sto` bucket beside the PDFs. Public read, because
-- an operator opens them from an email with no session.
--
-- Included verbatim in schema.sql; run on its own to apply just this to a live
-- database. Idempotent.

-- ----------------------------------------------------------------------------
-- TERMS (renamed from sections)
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'sto_version_sections'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'sto_version_terms'
  ) then
    alter table sto_version_sections rename to sto_version_terms;
  end if;
end
$$;

create table if not exists sto_version_terms (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references sto_agreement_versions(id) on delete cascade,
  title text not null,
  -- Free text, blank line separated. Bullet lines starting with •, - or *
  -- are rendered as a list by the document; everything else is a paragraph.
  body text not null default '',
  sort_order int not null default 0
);

create index if not exists sto_version_terms_version_idx on sto_version_terms(version_id);

alter table sto_version_terms enable row level security;

drop policy if exists "sto_version_sections_select" on sto_version_terms;
drop policy if exists "sto_version_sections_write" on sto_version_terms;
drop policy if exists "sto_version_terms_select" on sto_version_terms;
create policy "sto_version_terms_select" on sto_version_terms for select
  using (public.is_active_user());

drop policy if exists "sto_version_terms_write" on sto_version_terms;
create policy "sto_version_terms_write" on sto_version_terms for all
  using (public.can_write_data()) with check (public.can_write_data());

-- ----------------------------------------------------------------------------
-- PROPERTY SECTIONS (the room categories)
-- ----------------------------------------------------------------------------
-- Zondela House is one property, so what a contract is divided into is its
-- room categories: Standard and Deluxe read differently to an operator, are
-- photographed differently and are priced differently, and the document sets
-- them out one after the other.
create table if not exists sto_version_property_sections (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references sto_agreement_versions(id) on delete cascade,
  name text not null,
  description text,
  /** A link to the full album, for operators who want more than three photos. */
  gallery_url text,
  meal_plan_notes text,
  seasonal_notes text,
  /** Never printed. The team's own reminders about this category. */
  internal_notes text,
  sort_order int not null default 0
);

create index if not exists sto_version_property_sections_version_idx
  on sto_version_property_sections(version_id);

-- Up to three per category in the app; the database does not cap it, because a
-- fourth photograph is a product decision rather than a data one.
create table if not exists sto_section_images (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references sto_version_property_sections(id) on delete cascade,
  /** Key into the `sto` bucket. */
  storage_path text not null,
  caption text,
  sort_order int not null default 0
);

create index if not exists sto_section_images_section_idx on sto_section_images(section_id);

alter table sto_version_property_sections enable row level security;
alter table sto_section_images enable row level security;

drop policy if exists "sto_property_sections_select" on sto_version_property_sections;
create policy "sto_property_sections_select" on sto_version_property_sections for select
  using (public.is_active_user());

drop policy if exists "sto_property_sections_write" on sto_version_property_sections;
create policy "sto_property_sections_write" on sto_version_property_sections for all
  using (public.can_write_data()) with check (public.can_write_data());

drop policy if exists "sto_section_images_select" on sto_section_images;
create policy "sto_section_images_select" on sto_section_images for select
  using (public.is_active_user());

drop policy if exists "sto_section_images_write" on sto_section_images;
create policy "sto_section_images_write" on sto_section_images for all
  using (public.can_write_data()) with check (public.can_write_data());

-- ----------------------------------------------------------------------------
-- RATES: pax, rack rates, and the category they belong to
-- ----------------------------------------------------------------------------
-- `pax` is how many people the price covers, which is not the same as the room
-- s maximum: a Suite quoted at 2 and the same Suite quoted at 4 are two lines
-- on every rate sheet in the trade.
alter table sto_version_rates add column if not exists pax int not null default 2;

-- The published rate beside the contracted one. Operators check the gap, and a
-- contract that shows only one of the two invites the question by email.
alter table sto_version_rates add column if not exists bb_rack numeric(12,2) not null default 0;
alter table sto_version_rates add column if not exists hb_rack numeric(12,2) not null default 0;
alter table sto_version_rates add column if not exists fb_rack numeric(12,2) not null default 0;

alter table sto_version_rates
  add column if not exists section_id uuid references sto_version_property_sections(id) on delete set null;

create index if not exists sto_version_rates_section_idx on sto_version_rates(section_id);

-- Rows written before pax existed took the occupancy as their pax, which is
-- what they meant.
update sto_version_rates set pax = max_occupancy where pax = 2 and max_occupancy <> 2;

-- ----------------------------------------------------------------------------
-- THE PUBLIC SIDE, WITH THE WHOLE CONTRACT
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
    'sections', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', ps.id,
            'name', ps.name,
            'description', ps.description,
            'gallery_url', ps.gallery_url,
            'meal_plan_notes', ps.meal_plan_notes,
            'seasonal_notes', ps.seasonal_notes,
            'images', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id', im.id,
                    'storage_path', im.storage_path,
                    'caption', im.caption
                  ) order by im.sort_order
                )
                from sto_section_images im
                where im.section_id = ps.id
              ),
              '[]'::jsonb
            )
          ) order by ps.sort_order
        )
        from sto_version_property_sections ps
        where ps.version_id = v_version.id
      ),
      '[]'::jsonb
    ),
    'rates', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'section_id', r.section_id,
            'season', r.season,
            'room_type', r.room_type,
            'description', r.description,
            'pax', r.pax,
            'bb_price', r.bb_price,
            'hb_price', r.hb_price,
            'fb_price', r.fb_price,
            'bb_rack', r.bb_rack,
            'hb_rack', r.hb_rack,
            'fb_rack', r.fb_rack,
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
    'conditions', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', x.id, 'title', x.title, 'body', x.body)
          order by x.sort_order
        )
        from sto_version_terms x
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

revoke all on function public.sto_public_agreement(text) from public;
grant execute on function public.sto_public_agreement(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- OVERVIEW: the team's own notes on a season
-- ----------------------------------------------------------------------------
-- Never printed and never sent. Where the negotiation is remembered: what an
-- operator pushed back on, why a rate moved between seasons.
alter table sto_agreement_versions add column if not exists internal_notes text;
