-- ============================================================================
--  CREE WRLD — Supabase schema
--  Run this once in the Supabase dashboard → SQL Editor → New query → Run.
--  It is idempotent: re-running it will not lose data.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------- categories
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  slug        text not null unique,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.categories (name, slug, sort_order) values
  ('Sneakers',   'sneakers',   1),
  ('Streetwear', 'streetwear', 2),
  ('Old Money',  'old-money',  3),
  ('Y2K',        'y2k',        4)
on conflict (slug) do update
  set name = excluded.name,
      sort_order = excluded.sort_order;

-- ------------------------------------------------------------------- products
create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(trim(title)) >= 2),
  category_id  uuid references public.categories(id) on delete set null,
  price        integer not null check (price > 0),           -- whole KSh
  condition    text  not null default 'Excellent'
               check (condition in ('New','Like New','Excellent','Very Good','Good')),
  sizes        text[] not null default '{}',
  image_url    text not null,
  description  text not null default '',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists products_created_at_idx  on public.products (created_at desc);
create index if not exists products_category_id_idx on public.products (category_id);

-- keep updated_at honest without trusting the client
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
  phone             text not null,
  delivery_location text not null,
  zone              text not null,
  zone_label        text not null default '',
  zone_fee          integer not null default 0,
  subtotal          integer not null default 0,
  total             integer not null default 0,
  item_count        integer not null default 0,
  items             jsonb not null default '[]'::jsonb,
  source            text not null default 'product',
  status            text not null default 'new'
                    check (status in ('new','contacted','paid','dispatched','cancelled'))
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx     on public.orders (status);

-- =========================================================== row level security
alter table public.categories enable row level security;
alter table public.products   enable row level security;
alter table public.orders     enable row level security;

-- Anyone can read the shop. Only a signed-in merchant can change it.
drop policy if exists "categories are public"      on public.categories;
drop policy if exists "categories writable by staff" on public.categories;
create policy "categories are public"
  on public.categories for select
  using (true);
create policy "categories writable by staff"
  on public.categories for all
  to authenticated
  using (true) with check (true);

drop policy if exists "products are public" on public.products;
drop policy if exists "products writable by staff" on public.products;
create policy "products are public"
  on public.products for select
  using (true);
create policy "products writable by staff"
  on public.products for all
  to authenticated
  using (true) with check (true);

-- Shoppers are anonymous: they may create an order, never read the list back.
drop policy if exists "anyone can place an order" on public.orders;
drop policy if exists "orders readable by staff"  on public.orders;
drop policy if exists "orders updatable by staff" on public.orders;
drop policy if exists "orders deletable by staff" on public.orders;
create policy "anyone can place an order"
  on public.orders for insert
  to anon, authenticated
  with check (true);
create policy "orders readable by staff"
  on public.orders for select
  to authenticated
  using (true);
create policy "orders updatable by staff"
  on public.orders for update
  to authenticated
  using (true) with check (true);
create policy "orders deletable by staff"
  on public.orders for delete
  to authenticated
  using (true);

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
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  6291456, -- 6 MB, matching the form's client-side guard
  array['image/jpeg','image/png','image/webp','image/avif']
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product images are public"   on storage.objects;
drop policy if exists "staff upload product images" on storage.objects;
drop policy if exists "staff update product images" on storage.objects;
drop policy if exists "staff delete product images" on storage.objects;

create policy "product images are public"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "staff upload product images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-images');

create policy "staff update product images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-images')
  with check (bucket_id = 'product-images');

create policy "staff delete product images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images');
