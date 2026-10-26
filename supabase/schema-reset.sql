-- ============================================================================
--  CREE WRLD — FRESH START (DESTRUCTIVE)
--
--  Wipes the shop's database and rebuilds it from nothing: three tables, the
--  four categories, RLS policies that suit a passphrase-gated studio, the
--  `product-images` bucket and its policies, and the Realtime publication.
--
--  Supabase dashboard → SQL Editor → New query → paste all of this → Run.
--
--  ⚠  THIS DELETES EVERY PRODUCT AND EVERY ORDER. Uploaded images are left in
--     the `product-images` bucket (a bucket is not a table), so a re-created
--     row keeps working if you paste its URL back in. Take a backup first:
--     Database → Backups, or `Table editor → products → Export as CSV`.
--
--  Safe to run top to bottom on a project of any age: it drops what is there,
--  then builds what should be. Run it again whenever you want a clean slate —
--  re-running never errors.
--
--  After running it:
--    • the storefront renders an empty collection until a piece is published
--      (or until you run supabase/seed.sql for the original ten)
--    • the studio passphrase is unchanged — it lives in the browser bundle,
--      not in the database: creewrld.com
--
--  ── About the policies at the bottom ──────────────────────────────────────
--  The studio is unlocked by a passphrase compared in the browser, so the page
--  writes with the public anon key and the database must allow anonymous
--  writes. A passphrase shipped in the bundle is not a security boundary; it
--  keeps casual visitors out of the merchant UI, nothing more. If you later
--  move to real Supabase Auth, replace the write policies with
--  `to authenticated` ones — see "Studio access" in the README.
-- ============================================================================


-- =========================================================== 0. housekeeping
-- Supabase projects always have these two roles; a plain Postgres database
-- does not, and `create policy ... to anon` would fail without them.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end
$roles$;


-- ============================================================ 1. clean reset
-- Children before parents (`products` references `categories`), and `cascade`
-- takes the dependent policies, indexes and constraints with each table. The
-- order is a formality — cascade would drop all three either way — but it keeps
-- the intent readable.
drop table if exists public.orders     cascade;
drop table if exists public.products   cascade;
drop table if exists public.categories cascade;

-- Triggers go with their tables. The helper function does not, because it
-- lives in `public` rather than on a table.
drop function if exists public.touch_updated_at() cascade;
drop function if exists public.set_updated_at()   cascade;

-- Any enum types an earlier version of the schema may have created. Tables are
-- already gone, so nothing depends on them any more. A DO block rather than a
-- fixed list, because the exact names vary between versions of this project.
do $drop_types$
declare
  leftover record;
begin
  for leftover in
    select t.typname
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
       and t.typtype = 'e'
  loop
    execute format('drop type if exists public.%I cascade', leftover.typname);
  end loop;
end
$drop_types$;


-- ========================================================= 2. core schema
-- ---------------------------------------------------------------- categories
-- `name` is unique as well as `slug`: the studio resolves a piece's category by
-- its display name (the four filter tabs), so two rows sharing a name would be
-- ambiguous.
create table public.categories (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null unique,
  slug        text        not null unique,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.categories is 'Filter tabs and the studio''s category menu.';
comment on column public.categories.slug is 'URL-safe identifier: sneakers, streetwear, old-money, y2k.';

-- ------------------------------------------------------------------ products
-- Column order follows the brief; the three columns from `condition` down are
-- required by the storefront (card badge, size run) and the studio (audit of
-- edits), so they live here too.
create table public.products (
  id           uuid         primary key default gen_random_uuid(),
  title        text         not null check (char_length(trim(title)) >= 1),
  description  text,
  price        numeric(12,2) not null check (price > 0),        -- Kenyan shillings
  image_url    text,                                            -- public URL of the uploaded photo
  category_id  uuid         references public.categories (id) on delete set null,
  in_stock     boolean      not null default true,
  created_at   timestamptz  not null default now(),

  -- storefront requirements
  condition    text         not null default 'Excellent'
               check (condition in ('New', 'Like New', 'Excellent', 'Very Good', 'Good')),
  sizes        text[]       not null default '{}',
  updated_at   timestamptz  not null default now()
);

comment on table public.products is 'One row per piece in the collection.';
comment on column public.products.in_stock is 'false = sold out: still shown on the grid, not orderable.';
comment on column public.products.image_url is 'Public URL from the product-images bucket, or a bundled assets/img path.';
comment on column public.products.price is 'Whole Kenyan shillings; the storefront formats it as KSh 6,500.';

-- -------------------------------------------------------------------- orders
-- One row per WhatsApp checkout, written before the chat is opened.
create table public.orders (
  id              uuid          primary key default gen_random_uuid(),
  customer_name   text          not null check (char_length(trim(customer_name)) >= 1),
  customer_phone  text          not null check (char_length(trim(customer_phone)) >= 1),
  delivery_area   text          not null check (char_length(trim(delivery_area)) >= 1),
  items           jsonb         not null default '[]'::jsonb
                  check (jsonb_typeof(items) = 'array'),
  total_price     numeric(12,2) not null default 0 check (total_price >= 0),
  status          text          not null default 'pending'
                  check (status in ('pending', 'new', 'contacted', 'paid', 'dispatched', 'cancelled')),
  created_at      timestamptz   not null default now(),

  -- how the storefront splits the money and where it is going
  zone            text          not null default '',
  zone_label      text          not null default '',
  zone_fee        integer       not null default 0,
  subtotal        integer       not null default 0,
  item_count      integer       not null default 0,
  source          text          not null default 'product'
);

comment on table public.orders is 'Checkout records. Readable in the Supabase table editor only — the browser cannot select them.';
comment on column public.orders.status is 'pending by default; the storefront writes new. Move it along by hand in the table editor.';
comment on column public.orders.total_price is 'Grand total in KSh: subtotal + zone_fee.';
comment on column public.orders.items is 'Snapshot of the basket: [{ product_id, title, size, qty, price, line_total, condition, image_url }].';

-- ------------------------------------------------------------------- indexes
create index products_created_at_idx  on public.products (created_at desc);
create index products_category_id_idx on public.products (category_id);
create index products_in_stock_idx    on public.products (in_stock);
create index orders_created_at_idx    on public.orders   (created_at desc);
create index orders_status_idx        on public.orders   (status);

-- ------------------------------------------------------------ updated_at
-- Keep `updated_at` honest without trusting whoever sent the write.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $touch$
begin
  new.updated_at := now();
  return new;
end;
$touch$;

create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();


-- ==================================================== 3. default categories
insert into public.categories (name, slug, sort_order) values
  ('Sneakers',   'sneakers',   1),
  ('Streetwear', 'streetwear', 2),
  ('Old Money',  'old-money',  3),
  ('Y2K',        'y2k',        4)
on conflict (slug) do update
  set name       = excluded.name,
      sort_order = excluded.sort_order;


-- ============================================================= 4. privileges
-- A role that cannot touch the table never reaches a policy, so the GRANT has
-- to come first. These are the minimum the storefront needs — and on Supabase
-- that means taking something away first: the project's default privileges
-- hand `anon` and `authenticated` ALL on every new table in `public`
-- (`arwdDxtm` — insert, select, update, delete, truncate, references, trigger,
-- maintain). Row level security makes most of that inert, but TRUNCATE and
-- REFERENCES are not subject to RLS at all, so they are revoked rather than
-- relied upon.
revoke all on public.categories from anon, authenticated;
revoke all on public.products   from anon, authenticated;
revoke all on public.orders     from anon, authenticated;

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.products   to anon, authenticated;
grant select, insert on public.categories                 to anon, authenticated;
grant insert on public.orders                             to anon, authenticated;

-- No `select` on orders, and none granted to the browser on purpose: an order
-- carries a customer's name and phone number.


-- ======================================================== 5. row level security
alter table public.categories enable row level security;
alter table public.products   enable row level security;
alter table public.orders     enable row level security;

-- ------------------------------------------------------- public read: the shop
drop policy if exists "Public can view categories" on public.categories;
create policy "Public can view categories"
  on public.categories for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can view products" on public.products;
create policy "Public can view products"
  on public.products for select
  to anon, authenticated
  using (true);

-- --------------------------------- public writes: the passphrase-gated studio
drop policy if exists "Allow public insert products" on public.products;
create policy "Allow public insert products"
  on public.products for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Allow public update products" on public.products;
create policy "Allow public update products"
  on public.products for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Allow public delete products" on public.products;
create policy "Allow public delete products"
  on public.products for delete
  to anon, authenticated
  using (true);

-- -------------------------------------------------- public writes: one order
-- A shopper may place an order and may never read one back.
drop policy if exists "Allow public order placement" on public.orders;
create policy "Allow public order placement"
  on public.orders for insert
  to anon, authenticated
  with check (true);


-- ============================================================ 6. image bucket
-- Supabase-only: `storage` does not exist on a plain Postgres database, so the
-- whole block is skipped there instead of failing the script.
do $storage$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not found — skipping the product-images bucket (expected outside Supabase).';
    return;
  end if;

  -- 6 MB and four image types, matching the dropzone's client-side guard.
  execute $bucket$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'product-images',
      'product-images',
      true,
      6291456,
      array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
    )
    on conflict (id) do update
      set public             = true,
          file_size_limit    = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types
  $bucket$;

  execute 'drop policy if exists "product images are public" on storage.objects';
  execute 'drop policy if exists "studio uploads product images" on storage.objects';
  execute 'drop policy if exists "studio updates product images" on storage.objects';
  execute 'drop policy if exists "studio deletes product images" on storage.objects';

  -- Anyone may load a product photo; only a holder of the passphrase UI may
  -- add, replace or remove one.
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


-- =============================================================== 7. realtime
-- Optional, and skipped where Realtime is not configured. Without it the grid
-- simply refreshes when the tab regains focus.
do $realtime$
begin
  if to_regclass('pg_catalog.pg_publication') is null then
    return;
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'products'
     ) then
    alter publication supabase_realtime add table public.products;
  end if;
end
$realtime$;


-- ============================================================= 8. verification
-- Run this on its own afterwards to see what you now have:
--
--   select 'categories' as table_name, count(*) from public.categories
--   union all
--   select 'products',   count(*) from public.products
--   union all
--   select 'orders',     count(*) from public.orders;
--
-- and this to confirm the studio can write without a Supabase Auth session:
--
--   select cmd, policyname, roles
--     from pg_policies
--    where schemaname in ('public', 'storage')
--    order by schemaname, tablename, cmd;
