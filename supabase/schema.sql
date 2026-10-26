-- ============================================================================
--  CREE WRLD — Supabase schema
--
--  Supabase dashboard → SQL Editor → New query → paste this → Run.
--
--  Safe to re-run, and safe to run on a project that already has some of
--  these tables: every table is created if missing, then topped up with any
--  columns it lacks. Existing rows are never dropped.
--
--  The storefront unlocks the studio with a passphrase rather than a Supabase
--  Auth session, so catalogue writes are granted to `anon` as well as
--  `authenticated`. Read the warning at the top of supabase/studio-access.sql
--  before relying on this: a passphrase checked in the browser is not a
--  security boundary. See "Studio access" in the README.
--
--  gen_random_uuid() is built into Postgres 13+, which every Supabase project
--  runs, so no extension is required.
-- ============================================================================


-- ----------------------------------------------------------------- categories
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  slug        text not null unique,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Top up a `categories` table created by an earlier or different script.
-- Every column gets a default so this is safe on a table that already has rows.
alter table public.categories add column if not exists id         uuid        default gen_random_uuid();
alter table public.categories add column if not exists name       text;
alter table public.categories add column if not exists slug       text;
alter table public.categories add column if not exists sort_order integer     not null default 0;
alter table public.categories add column if not exists created_at timestamptz not null default now();

-- The upsert below needs a unique index on slug to match against.
create unique index if not exists categories_slug_uidx on public.categories (slug);

insert into public.categories (name, slug, sort_order) values
  ('Sneakers',   'sneakers',   1),
  ('Streetwear', 'streetwear', 2),
  ('Old Money',  'old-money',  3),
  ('Y2K',        'y2k',        4)
on conflict (slug) do update
  set name = excluded.name,
      sort_order = excluded.sort_order;


-- ------------------------------------------------------------------- products
-- The category foreign key is added further down, and only when the two
-- columns really are both uuid — a legacy `categories.id` of another type
-- must not stop the table being created.
create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(trim(title)) >= 2),
  category_id  uuid,
  price        numeric(12,2) not null check (price > 0),    -- whole KSh
  condition    text  not null default 'Excellent'
               check (condition in ('New','Like New','Excellent','Very Good','Good')),
  sizes        text[] not null default '{}',
  image_url    text not null,
  description  text not null default '',
  in_stock     boolean not null default true,               -- false = sold out
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.products add column if not exists id          uuid        default gen_random_uuid();
alter table public.products add column if not exists title       text;
alter table public.products add column if not exists category_id uuid;
alter table public.products add column if not exists price       numeric(12,2);
alter table public.products add column if not exists condition   text        not null default 'Excellent';
alter table public.products add column if not exists sizes       text[]      not null default '{}';
alter table public.products add column if not exists image_url   text;
alter table public.products add column if not exists description text        not null default '';
alter table public.products add column if not exists in_stock    boolean     not null default true;
alter table public.products add column if not exists created_at  timestamptz not null default now();
alter table public.products add column if not exists updated_at  timestamptz not null default now();

-- A project created before this schema called the stock column `is_active` and
-- priced in whole integers. Neither rename can be done with `add column`, so
-- both are converted here — once, and without ever resurrecting a sold-out
-- piece (`in_stock` is only ever lowered, never raised, from the old column).
do $upgrade$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'products'
       and column_name = 'price' and data_type = 'integer'
  ) then
    alter table public.products alter column price type numeric(12,2);
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'products'
       and column_name = 'is_active'
  ) then
    update public.products set in_stock = false
     where is_active = false and in_stock = true;
  end if;
end
$upgrade$;

create index if not exists products_created_at_idx  on public.products (created_at desc);
create index if not exists products_category_id_idx on public.products (category_id);

-- Add the category foreign key only if the types line up and it is not there yet.
do $$
declare
  cat_id_type   text;
  product_type  text;
begin
  select data_type into cat_id_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'categories' and column_name = 'id';

  select data_type into product_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'products' and column_name = 'category_id';

  if cat_id_type = 'uuid' and product_type = 'uuid'
     and not exists (select 1 from pg_constraint where conname = 'products_category_id_fkey') then
    alter table public.products
      add constraint products_category_id_fkey
      foreign key (category_id) references public.categories (id) on delete set null;
  end if;
end $$;

-- Keep updated_at honest without trusting the client.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();


-- --------------------------------------------------------------------- orders
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  customer_name     text not null,
  customer_phone    text not null,
  delivery_area     text not null,
  zone              text not null,
  zone_label        text not null default '',
  zone_fee          integer not null default 0,
  subtotal          integer not null default 0,
  total_price       numeric(12,2) not null default 0,
  item_count        integer not null default 0,
  items             jsonb not null default '[]'::jsonb,
  source            text not null default 'product',
  status            text not null default 'pending'
                    check (status in ('pending','new','contacted','paid','dispatched','cancelled'))
);

alter table public.orders add column if not exists id                uuid        default gen_random_uuid();
alter table public.orders add column if not exists created_at        timestamptz not null default now();
alter table public.orders add column if not exists customer_name     text;
alter table public.orders add column if not exists customer_phone    text;
alter table public.orders add column if not exists delivery_area     text;
alter table public.orders add column if not exists zone              text;
alter table public.orders add column if not exists zone_label        text        not null default '';
alter table public.orders add column if not exists zone_fee          integer     not null default 0;
alter table public.orders add column if not exists subtotal          integer     not null default 0;
alter table public.orders add column if not exists total_price       numeric(12,2) not null default 0;
alter table public.orders add column if not exists item_count        integer     not null default 0;
alter table public.orders add column if not exists items             jsonb       not null default '[]'::jsonb;
alter table public.orders add column if not exists source            text        not null default 'product';
alter table public.orders add column if not exists status            text        not null default 'new';

-- Same story for the order columns: carry the old names across once so the
-- table editor reads sensibly after the rename.
do $upgrade_orders$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'phone'
  ) then
    execute 'update public.orders set customer_phone = phone where customer_phone is null';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'delivery_location'
  ) then
    execute 'update public.orders set delivery_area = delivery_location where delivery_area is null';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'total'
  ) then
    execute 'update public.orders set total_price = total where total_price = 0';
  end if;
end
$upgrade_orders$;

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx     on public.orders (status);


-- =========================================================== row level security
-- Anonymous writes need the table grant as well as the policy, or the request is
-- rejected before any policy is consulted.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.products   to anon, authenticated;
grant select, insert, update, delete on public.categories to anon, authenticated;
grant insert                          on public.orders   to anon, authenticated;

alter table public.categories enable row level security;
alter table public.products   enable row level security;
alter table public.orders     enable row level security;

-- Anyone can read the shop. Anyone holding the studio passphrase can change
-- it — enforced in the browser, not here, because there is no session. See the
-- warning in supabase/studio-access.sql.
drop policy if exists "categories are public"          on public.categories;
drop policy if exists "categories writable by staff"    on public.categories;
drop policy if exists "categories writable from studio" on public.categories;
create policy "categories are public"
  on public.categories for select
  using (true);
create policy "categories writable from studio"
  on public.categories for all
  to anon, authenticated
  using (true) with check (true);

drop policy if exists "products are public"           on public.products;
drop policy if exists "products writable by staff"     on public.products;
drop policy if exists "products writable from studio"  on public.products;
create policy "products are public"
  on public.products for select
  using (true);
create policy "products writable from studio"
  on public.products for all
  to anon, authenticated
  using (true) with check (true);

-- Shoppers may create an order and never read the list back. With no Supabase
-- Auth there is no "staff" role to read them, so orders are read in the
-- Supabase table editor (or by adding a policy of your own).
drop policy if exists "anyone can place an order" on public.orders;
drop policy if exists "orders readable by staff"  on public.orders;
drop policy if exists "orders updatable by staff" on public.orders;
drop policy if exists "orders deletable by staff" on public.orders;
create policy "anyone can place an order"
  on public.orders for insert
  to anon, authenticated
  with check (true);


-- ------------------------------------------------------------------- realtime
-- Optional: live grid updates across devices. Safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'products'
  ) then
    alter publication supabase_realtime add table public.products;
  end if;
exception
  when undefined_object then
    raise notice 'Publication supabase_realtime not found — enable Realtime in the dashboard.';
end;
$$;


-- ================================================================ storage bucket
-- Supabase-only: a plain Postgres database has no `storage` schema, so the whole
-- block is skipped there instead of failing the rest of the script.
do $storage$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not found — skipping the product-images bucket (expected outside Supabase).';
    return;
  end if;

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
