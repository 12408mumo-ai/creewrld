-- ============================================================================
--  CREE WRLD — starter catalogue (optional)
--
--  The ten pieces the shop launched with. Run this only on a fresh database:
--  the insert is a no-op once any product exists. The studio can then edit or
--  delete each piece normally.
--
--  image_url points at the photographs bundled with the site ("assets/img/…");
--  the storefront resolves those to its hashed build URLs. Uploads made through
--  the Add / Edit form are stored as Supabase Storage URLs instead, so the two
--  coexist.
-- ============================================================================

insert into public.products (title, category_id, price, condition, sizes, image_url, description)
select v.title, c.id, v.price, v.condition, v.sizes, v.image_url, v.description
from (values
  ('Mocha Suede High-Top', 'sneakers', 6500, 'Excellent', array['41', '42', '43', '44'], 'assets/img/sneaker-mocha.jpg', 'Mocha suede and sail leather high-top in the ''85 court silhouette. Light creasing at the toe box, gum outsole fully intact, laces replaced. True to size — narrow feet may prefer a half size down.'),
  ('Chrome Runner ''03', 'sneakers', 5200, 'Very Good', array['40', '41', '42', '44'], 'assets/img/sneaker-silver.jpg', 'Metallic silver technical runner with layered mesh and reflective piping. Minimal midsole wear, every panel intact and reflective still bright. Runs half a size small.'),
  ('Noir Utility Cargo', 'streetwear', 3200, 'Like New', array['S', 'M', 'L', 'XL'], 'assets/img/cargo-street.jpg', 'Oversized black ripstop cargos with six pockets and webbing straps. Deadstock from a closed Nairobi stockist — unworn, tags removed. Adjustable hem, generous through the leg.'),
  ('Crimson Fade Set', 'streetwear', 4800, 'Excellent', array['M', 'L', 'XL'], 'assets/img/hoodie-crimson.jpg', 'Garment-dyed crimson zip hoodie with matching wide-leg sweats. Sun-faded finish with no pilling, drawcords and zip pulls complete. Sold as a full set.'),
  ('Varsity Wool Bomber', 'streetwear', 7400, 'Very Good', array['M', 'L'], 'assets/img/bomber-varsity.jpg', 'Heavyweight black wool body with cream leather sleeves and striped ribbing. Honest vintage patina on the leather cuffs; interior lining clean and fully stitched.'),
  ('Charcoal Wool Blazer', 'old-money', 8900, 'Excellent', array['48', '50', '52'], 'assets/img/blazer-wool.jpg', 'Double-breasted charcoal wool blazer with pleated stone trousers. Half-canvassed, fully lined, deep interior pockets. Tailored fit with a 62cm sleeve — see measurements on request.'),
  ('Burgundy Penny Loafers', 'old-money', 7800, 'Like New', array['41', '42', '43'], 'assets/img/loafers-leather.jpg', 'Polished burgundy calf leather penny loafers on leather soles. Worn twice indoors only — sole edges crisp, uppers unmarked. Hand-finished in Italy.'),
  ('Camel Belted Overcoat', 'old-money', 12500, 'Excellent', array['M', 'L', 'XL'], 'assets/img/trench-camel.jpg', 'Long camel brushed-wool overcoat with wide lapels and self belt. Fully lined with horn-look buttons. Slight cuff wear, already reflected in the price.'),
  ('Y2K Low-Rise Denim', 'y2k', 2900, 'Very Good', array['28', '30', '32'], 'assets/img/denim-y2k.jpg', 'Early-2000s light wash low-rise baggy denim with contrast stitching. Authentic Y2K cut with original whiskering, no repairs or alterations. True to vintage sizing.'),
  ('Silver Mesh Halter Set', 'y2k', 4200, 'Excellent', array['S', 'M'], 'assets/img/tank-y2k.jpg', 'Metallic mesh halter top with a matching low-rise skirt. Lined stretch mesh, no snags or pulls. Clubwear with a 2003 soul — best paired with something plain.')
) as v(title, category_slug, price, condition, sizes, image_url, description)
join public.categories c on c.slug = v.category_slug
where not exists (select 1 from public.products);
