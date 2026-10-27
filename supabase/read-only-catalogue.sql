-- ============================================================================
--  CREE WRLD — read-only catalogue for the browser
--
--  The shop has no admin panel: pieces are curated by hand in the Supabase
--  Dashboard (Table Editor → products), and photography is uploaded in
--  Storage. The Dashboard uses the service role, which bypasses row level
--  security, so locking the browser down costs nothing there.
--
--  An earlier version of this project ran a passphrase-gated "studio" in the
--  browser and therefore granted the anonymous role insert / update / delete
--  on `products` and write access to the `product-images` bucket. Those grants
--  are still in place on a database that was set up back then. This file
--  removes them.
--
--  Run once in Supabase → SQL Editor → New query → Run. Safe to re-run.
--  schema.sql already ships in this state for fresh projects.
--
--  What the browser keeps afterwards:
--    • select  on products    (the grid: select *, categories(name, slug)
--                              where in_stock = true)
--    • select  on categories  (the filter tabs)
--    • insert  on orders      (a checkout, inserted before WhatsApp opens)
--  and nothing else.
-- ============================================================================


-- ---------------------------------------------------------------- privileges
-- A GRANT cannot narrow Supabase's default privileges, so take everything away
-- and hand back only what the shopfront reads and writes. TRUNCATE and
-- REFERENCES are not subject to RLS at all, which is why `revoke all` matters.
revoke all on public.products   from anon, authenticated;
revoke all on public.categories from anon, authenticated;
revoke all on public.orders     from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.products   to anon, authenticated;
grant select on public.categories to anon, authenticated;
grant insert on public.orders     to anon, authenticated;


-- ------------------------------------------------------------------ policies
-- Read-only surfaces first, so the database still serves the storefront.
drop policy if exists "Public can view products"   on public.products;
create policy "Public can view products"
  on public.products for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can view categories" on public.categories;
create policy "Public can view categories"
  on public.categories for select
  to anon, authenticated
  using (true);

-- Order placement: insert only. An order carries a customer's name and phone
-- number, so the shopper who created one may not read it back.
drop policy if exists "Allow public order placement" on public.orders;
create policy "Allow public order placement"
  on public.orders for insert
  to anon, authenticated
  with check (true);

-- Every catalogue write policy the studio needed is dropped, under both the
-- names this project used and the names earlier scripts used.
drop policy if exists "Allow public insert products"    on public.products;
drop policy if exists "Allow public update products"    on public.products;
drop policy if exists "Allow public delete products"    on public.products;
drop policy if exists "products writable from studio"   on public.products;
drop policy if exists "products writable by staff"      on public.products;
drop policy if exists "categories writable from studio" on public.categories;
drop policy if exists "categories writable by staff"    on public.categories;


-- ------------------------------------------------------------------- storage
-- Supabase-only: a plain Postgres database has no `storage` schema.
do $storage$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not found — skipping the product-images bucket (expected outside Supabase).';
    return;
  end if;

  -- The bucket stays public to read, so <img src> keeps working.
  execute 'drop policy if exists "product images are public"   on storage.objects';
  execute 'drop policy if exists "staff upload product images" on storage.objects';
  execute 'drop policy if exists "staff update product images" on storage.objects';
  execute 'drop policy if exists "staff delete product images" on storage.objects';
  execute 'drop policy if exists "studio uploads product images" on storage.objects';
  execute 'drop policy if exists "studio updates product images" on storage.objects';
  execute 'drop policy if exists "studio deletes product images" on storage.objects';

  execute $pol$
    create policy "product images are public"
      on storage.objects for select
      using (bucket_id = 'product-images')
  $pol$;
end
$storage$;


-- -------------------------------------------------------------- verification
-- Expect: products/categories = SELECT only, orders = INSERT only, and exactly
-- one policy per table (plus the public read on the bucket).
--
--   select table_name, privilege_type
--     from information_schema.role_table_grants
--    where grantee = 'anon'
--      and table_schema = 'public'
--    order by table_name, privilege_type;
--
--   select schemaname, tablename, policyname, cmd, roles
--     from pg_policies
--    where schemaname in ('public', 'storage')
--    order by schemaname, tablename, policyname;
