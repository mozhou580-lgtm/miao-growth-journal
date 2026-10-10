begin;
create schema if not exists miao_private;
revoke all on schema miao_private from public;
grant usage on schema miao_private to authenticated;

create table public.miao_households (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  profile jsonb,
  profile_version bigint not null default 0,
  budget_cents integer check (budget_cents is null or budget_cents between 1 and 100000000),
  budget_version bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table public.miao_members (
  household_id uuid not null references public.miao_households(id),
  user_id uuid not null references auth.users(id),
  display_name text not null check (length(display_name) between 1 and 30),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);
create table public.miao_records (
  household_id uuid not null references public.miao_households(id),
  id text not null check (length(id) between 1 and 100),
  payload jsonb not null,
  version bigint not null,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (household_id, id)
);
create index miao_records_updated_idx on public.miao_records(household_id, updated_at);
create table miao_private.invitations (
  token_hash text primary key,
  household_id uuid not null references public.miao_households(id),
  target_kind text not null check (target_kind in ('email','phone')),
  target text not null,
  expires_at timestamptz not null,
  used_by uuid references auth.users(id)
);
create index miao_invitations_household_idx on miao_private.invitations(household_id);
create table miao_private.receipts (
  household_id uuid not null references public.miao_households(id),
  operation_id uuid not null,
  user_id uuid not null references auth.users(id),
  request jsonb not null,
  result jsonb not null,
  primary key (household_id, operation_id)
);
alter table public.miao_households enable row level security;
alter table public.miao_members enable row level security;
alter table public.miao_records enable row level security;
alter table miao_private.invitations enable row level security;
alter table miao_private.receipts enable row level security;
revoke all on public.miao_households, public.miao_members, public.miao_records from anon, authenticated;
revoke all on miao_private.invitations, miao_private.receipts from public, anon, authenticated;

create function miao_private.is_member(p_household uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.miao_members where household_id=p_household and user_id=(select auth.uid()));
$$;
revoke all on function miao_private.is_member(uuid) from public;
grant execute on function miao_private.is_member(uuid) to authenticated;
create policy miao_household_read on public.miao_households for select to authenticated using (miao_private.is_member(id));
create policy miao_member_read on public.miao_members for select to authenticated using (miao_private.is_member(household_id));
create policy miao_record_read on public.miao_records for select to authenticated using (miao_private.is_member(household_id));
grant select on public.miao_households, public.miao_members, public.miao_records to authenticated;

create function public.miao_create_household(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception '请先登录' using errcode='42501'; end if;
  if length(trim(p_name)) not between 1 and 30 then raise exception '请填写 1 至 30 字的称呼'; end if;
  if exists(select 1 from public.miao_members where user_id=v_uid) then raise exception '你已经加入一个共享档案'; end if;
  insert into public.miao_households(owner_id) values(v_uid) returning id into v_id;
  insert into public.miao_members(household_id,user_id,display_name) values(v_id,v_uid,trim(p_name));
  return v_id;
end $$;

create function public.miao_my_household() returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.miao_members where user_id=(select auth.uid());
$$;

create function public.miao_invite(p_household uuid,p_kind text,p_target text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_h public.miao_households; v_token text; v_target text;
begin
  select * into v_h from public.miao_households where id=p_household for update;
  if v_h.owner_id is distinct from auth.uid() or auth.uid() is null then raise exception '只有创建者可以邀请' using errcode='42501'; end if;
  if (select count(*) from public.miao_members where household_id=p_household)>=2 then raise exception '共享档案已满两人'; end if;
  if p_kind='email' then
    v_target:=lower(trim(p_target));
    if v_target !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v_target)>254 then raise exception '请填写有效邮箱'; end if;
  elsif p_kind='phone' then
    v_target:=regexp_replace(p_target,'[^0-9]','','g');
    if v_target !~ '^[1-9][0-9]{7,14}$' then raise exception '请填写带国家区号的手机号'; end if;
  else raise exception '邀请方式不支持'; end if;
  v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  delete from miao_private.invitations where household_id=p_household;
  insert into miao_private.invitations values(encode(sha256(convert_to(v_token,'UTF8')),'hex'),p_household,p_kind,v_target,now()+interval '24 hours',null);
  return jsonb_build_object('token',v_token,'expiresAt',now()+interval '24 hours');
end $$;

create function public.miao_revoke_invites(p_household uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.miao_households where id=p_household and owner_id=auth.uid()) then raise exception '无权撤销邀请' using errcode='42501'; end if;
  delete from miao_private.invitations where household_id=p_household;
end $$;

create function public.miao_join(p_token text,p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_inv miao_private.invitations; v_uid uuid:=auth.uid(); v_identity text; v_hash text;
begin
  if v_uid is null then raise exception '请先登录' using errcode='42501'; end if;
  if length(trim(p_name)) not between 1 and 30 then raise exception '请填写 1 至 30 字的称呼'; end if;
  if length(p_token)<>64 then raise exception '邀请码无效或已过期'; end if;
  v_hash:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  select * into v_inv from miao_private.invitations where token_hash=v_hash;
  if not found then raise exception '邀请码无效或已过期'; end if;
  perform 1 from public.miao_households where id=v_inv.household_id for update;
  select * into v_inv from miao_private.invitations where token_hash=v_hash;
  if not found or v_inv.expires_at<=now() or v_inv.used_by is not null then raise exception '邀请码无效或已过期'; end if;
  select case when v_inv.target_kind='email' and email_confirmed_at is not null then lower(email)
         when v_inv.target_kind='phone' and phone_confirmed_at is not null then regexp_replace(phone,'[^0-9]','','g') end
    into v_identity from auth.users where id=v_uid;
  if v_identity is distinct from v_inv.target then raise exception '请用被邀请的邮箱或手机号登录' using errcode='42501'; end if;
  if exists(select 1 from public.miao_members where user_id=v_uid) then raise exception '你已经加入一个共享档案'; end if;
  if (select count(*) from public.miao_members where household_id=v_inv.household_id)>=2 then raise exception '共享档案已满两人'; end if;
  insert into public.miao_members(household_id,user_id,display_name) values(v_inv.household_id,v_uid,trim(p_name));
  update miao_private.invitations set used_by=v_uid where token_hash=v_hash;
  return v_inv.household_id;
end $$;

create function public.miao_snapshot(p_household uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not miao_private.is_member(p_household) then raise exception '没有共享档案的访问权限' using errcode='42501'; end if;
  select jsonb_build_object('id',h.id,'ownerId',h.owner_id,'profile',h.profile,'profileVersion',h.profile_version,
    'budgetCents',h.budget_cents,'budgetVersion',h.budget_version,
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',m.display_name) order by m.joined_at) from public.miao_members m where m.household_id=h.id),'[]'::jsonb),
    'records',coalesce((select jsonb_agg(jsonb_build_object('value',r.payload,'version',r.version,'createdBy',r.created_by,'updatedBy',r.updated_by) order by r.id) from public.miao_records r where r.household_id=h.id),'[]'::jsonb))
    into v_result from public.miao_households h where h.id=p_household;
  return v_result;
end $$;

create function miao_private.validate_asset(p_asset jsonb,p_household uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(p_asset) is distinct from 'object' or jsonb_typeof(p_asset->'name') is distinct from 'string'
    or p_asset->>'path' is null or split_part(p_asset->>'path','/',1)<>p_household::text
    or p_asset->>'path' !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9]{64}$'
    or (p_asset ? 'data') or length(coalesce(p_asset->>'name','')) not between 1 and 200
    or coalesce(p_asset->>'mime','') not in ('image/jpeg','image/png','image/webp','application/pdf') then
    raise exception '附件必须保存在当前档案的私密文件区';
  end if;
end $$;
revoke all on function miao_private.validate_asset(jsonb,uuid) from public;

create function public.miao_apply(p_household uuid,p_operation uuid,p_kind text,p_entity text,p_expected bigint,p_value jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); v_h public.miao_households; v_rec public.miao_records;
  v_receipt miao_private.receipts; v_version bigint; v_remote jsonb; v_result jsonb;
  v_request jsonb; v_asset jsonb; v_stamp text; v_field text;
begin
  if not miao_private.is_member(p_household) then raise exception '没有共享档案的访问权限' using errcode='42501'; end if;
  if p_kind not in ('profile','budget','record') or p_expected<0 or p_expected is null then raise exception '同步操作无效'; end if;
  if p_kind='budget' then p_value:=coalesce(p_value,'null'::jsonb); end if;
  v_request:=jsonb_build_object('kind',p_kind,'entity',p_entity,'expected',p_expected,'value',p_value);
  select * into v_h from public.miao_households where id=p_household for update;
  select * into v_receipt from miao_private.receipts where household_id=p_household and operation_id=p_operation;
  if found then
    if v_receipt.user_id<>v_uid or v_receipt.request<>v_request then raise exception '重复操作不匹配' using errcode='42501'; end if;
    return v_receipt.result;
  end if;
  if p_kind='record' then
    select * into v_rec from public.miao_records where household_id=p_household and id=p_entity;
    v_version:=coalesce(v_rec.version,0); v_remote:=v_rec.payload;
  elsif p_kind='profile' then v_version:=v_h.profile_version; v_remote:=v_h.profile;
  else v_version:=v_h.budget_version; v_remote:=to_jsonb(v_h.budget_cents); end if;
  if v_version<>p_expected then
    return jsonb_build_object('status','conflict','version',v_version,'value',v_remote,'createdBy',v_rec.created_by,'updatedBy',v_rec.updated_by);
  end if;
  if p_value is null or pg_column_size(p_value)>262144 then raise exception '同步内容无效或过大'; end if;
  if p_kind='record' then
    if p_entity is null or length(p_entity) not between 1 and 100 or p_value->>'id' is distinct from p_entity
      or coalesce(p_value->>'type','') not in ('feed','weight','health','behavior','journal','expense','reminder')
      or jsonb_typeof(p_value->'assets') is distinct from 'array' or jsonb_array_length(p_value->'assets')>3 then raise exception '记录格式不正确'; end if;
    perform (p_value->>'at')::timestamptz,(p_value->>'updatedAt')::timestamptz,(p_value->>'day')::date;
    if p_value->>'at' is null or p_value->>'updatedAt' is null or p_value->>'day' is null then raise exception '记录日期不完整'; end if;
    if p_value->>'at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' or p_value->>'updatedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' or p_value->>'day' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception '记录日期格式不正确'; end if;
    foreach v_field in array array['title','note','food','kind','appetite','category'] loop
      if p_value ? v_field and p_value->v_field<>'null'::jsonb and (jsonb_typeof(p_value->v_field)<>'string' or length(p_value->>v_field)>5000) then raise exception '记录文本格式不正确'; end if;
    end loop;
    if p_value->>'type'='expense' and (coalesce(p_value->>'cents','') !~ '^[0-9]{1,9}$' or (p_value->>'cents')::numeric not between 1 and 100000000) then raise exception '金额无效'; end if;
    if p_value->>'type'='expense' and coalesce(p_value->>'category','') not in ('食物','猫砂','医疗','用品 / 玩具','清洁 / 护理','服务','其他') then raise exception '花费分类不支持'; end if;
    if p_value->>'type'='weight' and (jsonb_typeof(p_value->'kg') is distinct from 'number' or (p_value->>'kg')::numeric<=0 or (p_value->>'kg')::numeric>30) then raise exception '体重无效'; end if;
    foreach v_field in array array['grams','minutes'] loop
      if p_value->v_field is not null and p_value->v_field<>'null'::jsonb and (jsonb_typeof(p_value->v_field)<>'number' or (p_value->>v_field)::numeric<=0 or (p_value->>v_field)::numeric>9999) then raise exception '投喂量或时长无效'; end if;
    end loop;
    if p_value->>'due' is not null then perform (p_value->>'due')::date; end if;
    if p_value->>'deletedAt' is not null then perform (p_value->>'deletedAt')::timestamptz; end if;
    if p_value->>'completedAt' is not null then perform (p_value->>'completedAt')::timestamptz; end if;
    for v_asset in select value from jsonb_array_elements(p_value->'assets') loop perform miao_private.validate_asset(v_asset,p_household); end loop;
    if v_version=0 and (select count(*) from public.miao_records where household_id=p_household)>=10000 then raise exception '当前档案已达到 10000 条记录'; end if;
    v_stamp:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    p_value:=jsonb_set(p_value,'{updatedAt}',to_jsonb(v_stamp));
    if p_value->>'deletedAt' is not null then p_value:=jsonb_set(p_value,'{deletedAt}',to_jsonb(v_stamp)); end if;
    insert into public.miao_records(household_id,id,payload,version,created_by,updated_by)
      values(p_household,p_entity,p_value,1,v_uid,v_uid)
      on conflict(household_id,id) do update set payload=excluded.payload,version=miao_records.version+1,updated_by=v_uid,updated_at=now();
  elsif p_kind='profile' then
    if jsonb_typeof(p_value->'id') is distinct from 'string' or length(p_value->>'id') not between 1 and 100
      or jsonb_typeof(p_value->'name') is distinct from 'string' or length(p_value->>'name') not between 1 and 30
      or p_value->>'birthday' is null then raise exception '猫咪档案格式不正确'; end if;
    perform (p_value->>'birthday')::date;
    if v_h.profile is not null and v_h.profile->>'id' is distinct from p_value->>'id' then raise exception '不能覆盖为另一只猫'; end if;
    if p_value->'avatar' is not null and p_value->'avatar'<>'null'::jsonb then perform miao_private.validate_asset(p_value->'avatar',p_household); end if;
    update public.miao_households set profile=p_value,profile_version=profile_version+1,updated_at=now() where id=p_household;
  else
    if p_value<>'null'::jsonb and (jsonb_typeof(p_value)<>'number' or p_value::text !~ '^[0-9]{1,9}$' or p_value::text::numeric not between 1 and 100000000) then raise exception '预算格式不正确'; end if;
    update public.miao_households set budget_cents=case when p_value='null'::jsonb then null else p_value::text::integer end,budget_version=budget_version+1,updated_at=now() where id=p_household;
  end if;
  v_result:=jsonb_build_object('status','applied','version',v_version+1,'value',p_value,'createdBy',coalesce(v_rec.created_by,v_uid),'updatedBy',v_uid);
  insert into miao_private.receipts values(p_household,p_operation,v_uid,v_request,v_result);
  return v_result;
end $$;

revoke all on function public.miao_create_household(text), public.miao_my_household(), public.miao_invite(uuid,text,text),
  public.miao_revoke_invites(uuid),public.miao_join(text,text),public.miao_snapshot(uuid),public.miao_apply(uuid,uuid,text,text,bigint,jsonb) from public,anon;
grant execute on function public.miao_create_household(text), public.miao_my_household(), public.miao_invite(uuid,text,text),
  public.miao_revoke_invites(uuid),public.miao_join(text,text),public.miao_snapshot(uuid),public.miao_apply(uuid,uuid,text,text,bigint,jsonb) to authenticated;
commit;
