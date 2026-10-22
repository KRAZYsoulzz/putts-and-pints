-- 005: seed Season 9 schedule as scheduled events (idempotent: skips existing date+name).
-- Requires 004. settings_snapshot / bar match are filled when the director taps Start.
insert into pp_events (season_id, event_date, status, name)
select '81298495-f87c-4d7c-a344-89b97e587d9b'::uuid, v.d::date, 'scheduled', v.n
from (values
  ('2026-11-05','Week 1'),
  ('2026-11-19','Week 2'),
  ('2026-11-27','Black Friday Dubs'),
  ('2026-12-03','Week 3'),
  ('2026-12-17','Week 4'),
  ('2027-01-02','Special Saturday Putt Night @ The Horny Toad'),
  ('2027-01-07','Week 5'),
  ('2027-01-21','Week 6'),
  ('2027-02-04','Week 7'),
  ('2027-02-13','Special Saturday Putt Night @ The Horny Toad'),
  ('2027-02-18','Week 8'),
  ('2027-03-04','Week 9'),
  ('2027-03-18','Week 10 Season Finale')
) as v(d, n)
where not exists (
  select 1 from pp_events e
  where e.season_id = '81298495-f87c-4d7c-a344-89b97e587d9b'::uuid
    and e.event_date = v.d::date and e.name = v.n
);
