create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'auto_clock_out_every_5m';
select cron.schedule('auto_clock_out_every_5m', '*/5 * * * *', $$select public.run_auto_clock_out();$$);
