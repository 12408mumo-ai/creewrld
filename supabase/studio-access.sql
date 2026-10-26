-- ============================================================================
--  CREE WRLD — studio access without Supabase Auth
--
--  The storefront no longer signs in through Supabase. The studio is unlocked
--  in the browser with a passphrase, and the page writes with the public anon
--  key, so the database has to allow that. This file is what allows it.
--
--  Run once in Supabase → SQL Editor → New query → Run. Safe to re-run.
--  schema.sql already contains the same policies for fresh projects.
--
--  ── Read this before running it ───────────────────────────────────────────
--
--  These policies let ANYONE holding the anon key insert, update and delete
--  catalogue rows. The anon key ships in the site's JavaScript bundle, and so
--  does the passphrase — a check that runs in the browser can be read by
--  anyone who opens the bundle. The passphrase therefore keeps casual visitors
--  out of the merchant controls; it is not a security boundary.
--
--  If that is not acceptable, do not run this file. Keep the original
--  `to authenticated` policies from schema.sql and use a real Supabase session
--  instead — that is the only arrangement where the database itself decides
--  who may change the catalogue.
-- ============================================================================


-- Grants. Supabase's default privileges normally cover new tables in `public`,
-- but an anonymous role that cannot touch the table never reaches a policy —
-- so say it out loud. These are idempotent. Storage grants are managed by
-- Supabase itself and are deliberately not repeated here.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.products   to anon, authenticated;
grant select, insert, update, delete on public.categories to anon, authenticated;
grant insert                          on public.orders   to anon, authenticated;


-- ---------------------------------------------------------------- products
drop policy if exists "products are public"          on public.products;
drop policy if exists "products writable by staff"    on public.products;
drop policy if exists "products writable from studio" on public.products;

create policy "products are public"
  on public.products for select
  using (true);

create policy "products writable from studio"
  on public.products for all
  to anon, authenticated
  using (true)
  with check (true);


-- -------------------------------------------------------------- categories
drop policy if exists "categories are public"          on public.categories;
drop policy if exists "categories writable by staff"    on public.categories;
drop policy if exists "categories writable from studio" on public.categories;

create policy "categories are public"
  on public.categories for select
  using (true);

create policy "categories writable from studio"
  on public.categories for all
  to anon, authenticated
  using (true)
  with check (true);


-- ------------------------------------------------------------------ orders
-- Unchanged in spirit: a shopper may place an order and never read the list.
-- Reads stay staff-only, which now means "not possible from the browser" —
-- read them in the Supabase table editor.
drop policy if exists "anyone can place an order" on public.orders;
drop policy if exists "orders readable by staff"  on public.orders;
drop policy if exists "orders updatable by staff" on public.orders;
drop policy if exists "orders deletable by staff" on public.orders;

create policy "anyone can place an order"
  on public.orders for insert
  to anon, authenticated
  with check (true);


-- ----------------------------------------------------------- storage objects
-- Supabase-only: guarded so this file can also be run against a plain Postgres
-- database (where `storage` does not exist) without failing at the last step.
do $storage$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not found — skipping the product-images policies.';
    return;
  end if;

  execute 'drop policy if exists "product images are public"    on storage.objects';
  execute 'drop policy if exists "staff upload product images"  on storage.objects';
  execute 'drop policy if exists "staff update product images"  on storage.objects';
  execute 'drop policy if exists "staff delete product images"  on storage.objects';
  execute 'drop policy if exists "studio uploads product images" on storage.objects';
  execute 'drop policy if exists "studio updates product images" on storage.objects';
  execute 'drop policy if exists "studio deletes product images" on storage.objects';

  execute $pol$
    create policy "product images are public"
      on storage.objects for select
      using (bucket_id = 'product-images')
  $pol$;

  execute $pol$
    create policy "studio uploads product images"
      on storage.objects for insert
      to anon, authenticated
      with check (bucket_id = 'product-images')
  $pol$;

  execute $pol$
    create policy "studio updates product images"
      on storage.objects for update
      to anon, authenticated
      using (bucket_id = 'product-images')
      with check (bucket_id = 'product-images')
  $pol$;

  execute $pol$
    create policy "studio deletes product images"
      on storage.objects for delete
      to anon, authenticated
      using (bucket_id = 'product-images')
  $pol$;
end
$storage$;
