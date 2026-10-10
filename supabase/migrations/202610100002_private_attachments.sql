begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('miao-private','miao-private',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf']);
create policy miao_files_read on storage.objects for select to authenticated using (
  bucket_id='miao-private' and exists(select 1 from public.miao_members where user_id=(select auth.uid()) and household_id::text=split_part(name,'/',1))
);
create policy miao_files_insert on storage.objects for insert to authenticated with check (
  bucket_id='miao-private' and split_part(name,'/',2)=(select auth.uid())::text
  and exists(select 1 from public.miao_members where user_id=(select auth.uid()) and household_id::text=split_part(name,'/',1))
);
-- Immutable paths include a content hash. No update/delete grant: an edit cannot overwrite
-- a partner's attachment, and soft-deleted records remain recoverable in backups.
commit;
