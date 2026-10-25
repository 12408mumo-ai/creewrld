-- ============================================================================
--  CREE WRLD — reset (DESTRUCTIVE)
--
--  Deletes the three tables and their data so `schema.sql` can rebuild them
--  from scratch. Use this only when a project has no real content yet — for
--  example when an older `categories`/`products` table is in the way and
--  `schema.sql` cannot top it up.
--
--  Order of use:
--    1. run this file
--    2. run supabase/schema.sql
--    3. run supabase/seed.sql        (optional: the ten starter pieces)
--
--  The `product-images` bucket is left alone: schema.sql re-creates its
--  policies, and any images already uploaded stay where they are.
-- ============================================================================

drop table if exists public.orders     cascade;
drop table if exists public.products   cascade;
drop table if exists public.categories cascade;

drop function if exists public.touch_updated_at() cascade;
