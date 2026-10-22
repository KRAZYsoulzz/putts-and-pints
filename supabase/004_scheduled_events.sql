-- 004: allow pre-scheduled events. Scheduled events never count as "tonight".
alter table pp_events drop constraint if exists pp_events_status_check;
alter table pp_events add constraint pp_events_status_check
  check (status in ('scheduled','checkin','scoring','final9','results','complete'));
