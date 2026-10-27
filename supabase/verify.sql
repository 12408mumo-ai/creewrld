-- ============================================================================
--  CREE WRLD — health check (read only)
--
--  Answers "is this Supabase project actually set up?" in one run. Paste into
--  Supabase → SQL Editor → Run. It changes nothing: no DDL, no writes, no
--  NOTIFY. Use it on the project a deployment is pointing at, to tell an empty
--  project apart from a broken one.
--
--  Read the output top to bottom:
--
--    project ref        should match the `xyz` in https://xyz.supabase.co in
--                       your Vercel settings — if it does not, the deployment
--                       is talking to a different database
--    tables             all three must say true; a missing table is the 404
--                       `Could not find the table 'public.products'`
--    policies           products needs 4, categories 2, orders 1
--    grants             anon needs SELECT+INSERT on categories, SELECT/INSERT/
--                       UPDATE/DELETE on products, INSERT on orders
--    bucket             public = true, 6291456 bytes, four image types — a
--                       missing bucket is the 400 on image upload
--    storage policies   four rows for product-images
-- ============================================================================


-- ---------------------------------------------------------------- 1. identity
-- The Supabase SQL editor has no request headers, so the project ref is not
-- available from SQL. Compare this database name with the dashboard's project
-- ref instead — they are the same string for a default project.
select
  current_database()                as database,
  current_user                      as role,
  (select version())                as postgres,
  pg_postmaster_start_time()        as server_started;


-- ----------------------------------------------------------------- 2. tables
select
  t.expected                                as "table",
  (c.oid is not null)                       as present,
  coalesce(c.relrowsecurity, false)         as rls,
  coalesce((
    select count(*) from pg_policies p
     where p.schemaname = 'public' and p.tablename = t.expected
  ), 0)                                     as policies
from (values ('categories'), ('products'), ('orders')) as t(expected)
left join pg_class c
  on c.relname = t.expected
 and c.relnamespace = 'public'::regnamespace
 and c.relkind = 'r'
order by t.expected;


-- --------------------------------------------------- 3. grants the app needs
select
  g.tbl                        as "table",
  r.role,
  coalesce(string_agg(distinct a.privilege_type, ', ' order by a.privilege_type), '(none)') as privileges
from (values ('categories','SELECT,INSERT'), ('products','SELECT,INSERT,UPDATE,DELETE'), ('orders','INSERT')) as g(tbl, needed)
cross join (values ('anon'), ('authenticated')) as r(role)
left join information_schema.role_table_grants a
  on a.table_schema = 'public'
 and a.table_name = g.tbl
 and a.grantee = r.role
 and a.privilege_type = any(string_to_array(g.needed, ','))
group by g.tbl, r.role
order by g.tbl, r.role;


-- -------------------------------------------------------- 4. policy inventory
select tablename, policyname, cmd, roles::text as roles, coalesce(qual, with_check) as expression
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;


-- -------------------------------------------------------------- 5. the bucket
select
  b.id,
  b.public,
  b.file_size_limit,
  round(b.file_size_limit / 1048576.0, 2) as limit_mb,
  b.allowed_mime_types,
  (select count(*) from storage.objects o where o.bucket_id = b.id) as objects
from storage.buckets b
where b.id = 'product-images';

-- Expect exactly one row. No row = the bucket was never created, which is what
-- makes an upload fail with 400 while reads of the (empty) products table 404.


-- ------------------------------------------------------ 6. storage policies
select policyname, cmd, roles::text as roles, coalesce(qual, with_check) as expression
  from pg_policies
 where schemaname = 'storage'
   and tablename = 'objects'
   and (coalesce(qual, '') like '%product-images%' or coalesce(with_check, '') like '%product-images%')
 order by cmd, policyname;

-- Expect four: public SELECT, and INSERT / UPDATE / DELETE for anon+authenticated.


-- ------------------------------------------------------- 7. category seed data
select name, slug, sort_order
  from public.categories
 order by sort_order;

-- Four rows. Zero rows on a project with tables = the schema ran but the seed
-- did not, so the filter tabs will be empty.
