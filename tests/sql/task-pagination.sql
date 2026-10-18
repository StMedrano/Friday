-- Disposable test transaction only. Same timestamp tests stable UUID tiebreaking.
begin;
set local role service_role;
insert into public.friday_projects(id,name) values('pagination-fixture','Synthetic pagination');
insert into public.friday_work_items(id,project_id,title,objective,creator_principal,request_id,input_fingerprint,created_at)
 select ('00000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,'pagination-fixture','Task '||n,'Synthetic page','fixture-owner','page-'||n,'fp','2026-10-17T12:00:00.123456Z'::timestamptz from generate_series(1,61) n;
do $$
declare last_id uuid; last_time timestamptz; older_count integer;
begin
 select id,created_at into last_id,last_time from public.friday_work_items where project_id='pagination-fixture' order by created_at desc,id desc offset 49 limit 1;
 if last_id<>'00000000-0000-4000-8000-00000000000c'::uuid then raise exception 'Unstable first page';end if;
 select count(*) into older_count from public.friday_work_items where project_id='pagination-fixture' and (created_at<last_time or (created_at=last_time and id<last_id));
 if older_count<>11 then raise exception 'Missing/overlapping older records';end if;
 if to_char(last_time at time zone 'UTC','US')<>'123456' then raise exception 'Lost cursor precision';end if;
 -- A new record ahead of the cursor cannot shift or duplicate the older page.
 insert into public.friday_work_items(project_id,title,objective,creator_principal,request_id,input_fingerprint,created_at) values('pagination-fixture','Newer task','Concurrent insert','fixture-owner','newer','fp','2026-10-17T12:00:01Z');
 if (select count(*) from public.friday_work_items where project_id='pagination-fixture' and (created_at<last_time or (created_at=last_time and id<last_id)))<>11 then raise exception 'Page shifted after insert';end if;
end $$;
rollback;
