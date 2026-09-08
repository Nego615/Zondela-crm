-- ============================================================================
-- 0008 — the agreement email becomes an editable template
-- ============================================================================
-- The message that carries a rate contract used to be built in the frontend
-- and could only be changed by shipping code. Worse, it wrote the whole rate
-- table into the body: every room, all three meal plans, the supplements. The
-- prices already live in the agreement the link opens, signed and dated, so
-- repeating them in the covering email created a second copy that nothing kept
-- in step — and an operator reading the email had no way of telling which of
-- the two was the contract.
--
-- The email now says what it is and hands over the link. The wording lives in
-- `email_templates`, so the team rewords it from the Templates tab without a
-- deploy.
--
-- `is_default` marks the one the send modal reaches for, mirroring how
-- `pricing_documents` already picks a default price list.

alter table email_templates
  add column if not exists is_default boolean not null default false;

-- Only one default, enforced by the database rather than by whoever is
-- clicking. Rows with is_default = false are not indexed and so never collide
-- — the same trick pricing_documents uses.
drop index if exists email_templates_one_default;
create unique index email_templates_one_default
  on email_templates (is_default) where is_default;

-- The default itself, inserted only when there is no default already: re-running
-- the schema must not overwrite wording the team has since edited.
--
-- `body_html` holds plain text with line breaks, which is what the column has
-- always really carried — the editor is a textarea and both delivery routes
-- want text. The mail client is handed it as-is, and `send-email` turns it into
-- HTML on the way out.
--
-- {{org_name}} rather than a hardcoded name, so the letterhead in org_settings
-- is the single place the business is named.
insert into email_templates (name, subject, body_html, category, is_default)
select
  'Default STO Agreement',
  '{{org_name}} STO Agreement — {{agreement_year}}',
  'Dear {{contact_name}},

Please find the STO agreement between {{org_name}} and {{company_name}} for the {{agreement_year}} season.

Kindly click the button below to view the rates, terms and conditions, and accept the agreement.

{{agreement_button}}

Should you have any questions, please do not hesitate to reach out.',
  'pricing',
  true
where not exists (select 1 from email_templates where is_default);
