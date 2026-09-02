-- ============================================================================
-- SEED — STANDARD TOUR OPERATOR RATE CONTRACT 2026
-- ============================================================================
-- The contract as it stands, entered as data: the rates chart, the supplements
-- and every numbered policy from the signed PDF, word for word.
--
-- Run it once, after schema.sql. It is idempotent on the version's name, so
-- re-running replaces the sheet rather than creating a second 2026.
--
-- Afterwards: open STO → Agreement versions, check it reads the way the
-- contract does, attach the PDF, and activate it.

do $$
declare
  v_id uuid;
begin
  -- Replace any earlier attempt at this season. Rates, supplements and
  -- sections cascade, and no send can exist yet on a sheet nobody activated.
  delete from sto_agreement_versions where name = 'Zondela House STO Rate Contract 2026';

  insert into sto_agreement_versions (
    name, year, status, valid_from, valid_to, summary, intro, rate_basis, rates_note, terms
  ) values (
    'Zondela House STO Rate Contract 2026',
    2026,
    'draft',
    '2026-01-01',
    '2026-12-31',
    'Standard tour operator rates for Zondela House, 1 January to 31 December 2026.',
    'Zondela House is a boutique property with 12 comfortable rooms built from distinctive red clay bricks, offering a warm and inviting stay. Ideal for leisure, business, and safari travelers, the house provides personalized service, meal options (breakfast, lunch, and dinner), free Wi-Fi, a rooftop bar and restaurant, and a swimming pool.',
    'Per room, per night',
    'All rates quoted are inclusive of VAT and Tourism development levy.',
    null
  )
  returning id into v_id;

  -- Rates chart — from 1st Jan 2026 up to 31st Dec 2026.
  insert into sto_version_rates
    (version_id, season, room_type, description, bb_price, hb_price, fb_price, max_occupancy, currency, sort_order)
  values
    (v_id, '2026 season', 'Standard Single', null, 130, 150, 170, 1, 'USD', 0),
    (v_id, '2026 season', 'Standard Double', null, 170, 210, 250, 2, 'USD', 1),
    (v_id, '2026 season', 'Standard Twin Room', null, 170, 210, 250, 2, 'USD', 2),
    (v_id, '2026 season', 'Standard Triple', null, 230, 290, 350, 3, 'USD', 3),
    (v_id, '2026 season', 'Family Room', null, 340, 420, 500, 4, 'USD', 4),
    (v_id, '2026 season', 'Deluxe Room', null, 250, 310, 370, 3, 'USD', 5);

  insert into sto_version_supplements (version_id, name, price, currency, unit, sort_order)
  values
    (v_id, 'Lunch', 20, 'USD', 'per person', 0),
    (v_id, 'Dinner', 20, 'USD', 'per person', 1);

  insert into sto_version_sections (version_id, title, body, sort_order)
  values
    (
      v_id,
      'Children’s Policy',
      '• Children under the age of 5 years, sharing with a paying adult, will be free of charge.
• Children between the ages of 5 to 12 years, sharing with a paying adult, will be charged 50% of per person rate.
• Children between the ages of 5 to 12 years, occupying their own room, will be charged 75% of per person rate.
• Children between the ages of 5 to 12 years, sharing a family room, will be charged 50% of per person rate.',
      0
    ),
    (
      v_id,
      'Tour Leader Policy',
      '• Subject to the availability of rooms, a bona fide Tour Leader accompanying a group will be entitled to 1 (one) complimentary room on bed and breakfast basis after every group of 15 paying clients.',
      1
    ),
    (
      v_id,
      'Check-In / Check-Out',
      'Check-in: 2:00 PM
Check-out: 10:00 AM',
      2
    ),
    (
      v_id,
      'Deposit Policy',
      '• A deposit of 20% is required 14 days after confirming the booking. The remaining balance is payable 30 days prior to arrival.
• A full rooming list shall be required no later than 14 (fourteen) days prior to arrival.

NB: Zondela House booking system is automated, so all bookings without payments will be cancelled automatically as per the policy mentioned above.',
      3
    ),
    (
      v_id,
      'Cancellation Policy',
      'All cancellations must be received by Zondela House in writing and not via phone.

• Cancellations made 45 (forty-five) days or more prior to arrival: 0% penalty will be levied, but the Client may, subject to Zondela House’s sole discretion, forfeit any deposits/prepayments made thus far.
• Cancellations made within 44 (forty-four) to 31 (thirty-one) days prior to arrival: a 20% penalty will be levied.
• Cancellations made within 30 (thirty) to 15 (fifteen) days prior to arrival: a 50% penalty will be levied.
• Cancellations made within 15 (fifteen) days prior to arrival, or a No-Show: a 100% penalty will be levied.',
      4
    ),
    (
      v_id,
      'No-Show Policy',
      'A No-Show is the non-arrival of a guest without notification in writing by email to Zondela House.

In the case of a no-show, a no-show fee of the rate applicable for the full stay, including any other government taxes or levies, will be levied against the Client.',
      5
    );
end
$$;

-- The letterhead the document prints, from the contract's contact block.
-- org_settings is a single row installed by 0002; this fills in what the PDF
-- carries and leaves anything already set alone where it is not blank.
update org_settings set
  org_name = 'Zondela House',
  phone = coalesce(nullif(phone, ''), '+255 696 179 265 / +255 756 357 557'),
  email = coalesce(nullif(email, ''), 'info@zondelahouse.com'),
  website = coalesce(nullif(website, ''), 'www.zondelahouse.com'),
  city = coalesce(nullif(city, ''), 'Arusha'),
  country = coalesce(nullif(country, ''), 'Tanzania'),
  updated_at = now()
where id = 1;
