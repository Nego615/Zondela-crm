-- ============================================================================
-- 0007 — THE PARTNER'S MARK ON THE AGREEMENT
-- ============================================================================
-- A contract is between two houses, and until now only one of them appeared at
-- the top of it. The agreement banner now carries the operator's own mark
-- opposite Zondela's, taken from the website already held on their company
-- record — nothing new is stored, and nothing is uploaded.
--
-- All this migration does is let the public page see that website. It is
-- already visible to everyone signed in; the send's own company is the one
-- company an unauthenticated reader of this token is entitled to know about,
-- and they know it already — it is their own.
--
-- The function is re-created whole, as in 0004 and 0005. The only change from
-- 0005 is `company_website` on the send object.
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
  v_website text;
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
  select name, website into v_company, v_website from companies where id = v_send.company_id;

  return jsonb_build_object(
    'send', jsonb_build_object(
      'status', v_send.status,
      'to_name', v_send.to_name,
      'company_name', v_company,
      'company_website', v_website,
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
