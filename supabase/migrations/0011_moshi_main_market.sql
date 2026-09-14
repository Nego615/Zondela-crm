-- ============================================================================
-- 0011 — MOSHI AS A MAIN MARKET
-- ============================================================================
-- Moshi sits at the foot of Kilimanjaro and has its own operators, who until
-- now could only be filed under Arusha or Tanzania-wide. The list of markets is
-- a check constraint, so a new one is a constraint swap: dropped and re-added
-- with the wider list. Nothing already stored falls outside it, so no row needs
-- touching first.
-- ----------------------------------------------------------------------------

alter table companies drop constraint if exists companies_main_market_check;
alter table companies add constraint companies_main_market_check
  check (main_market is null or main_market in
    ('arusha', 'dar_es_salaam', 'dodoma', 'moshi', 'mwanza', 'zanzibar', 'tanzania',
     'east_africa', 'international'));
