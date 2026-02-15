-- product_performance: Per-product scorecard
-- Grain: one row per product (200 rows)
-- Joins products + order_items + orders + product_reviews
-- Only counts shipped/delivered orders for revenue accuracy

SELECT
  p.product_id,
  p.product_name,
  p.category,
  p.brand_line,
  COUNT(DISTINCT oi.order_id) AS total_orders,
  SUM(oi.quantity) AS total_units,
  SUM(oi.quantity * oi.unit_price) AS total_revenue,
  AVG(pr.rating) AS avg_rating,
  COUNT(DISTINCT pr.review_id) AS review_count
FROM products p
LEFT JOIN order_items oi ON p.product_id = oi.product_id
LEFT JOIN orders o ON oi.order_id = o.order_id
  AND o.order_status IN ('shipped', 'delivered')
LEFT JOIN product_reviews pr ON p.product_id = pr.product_id
GROUP BY p.product_id, p.product_name, p.category, p.brand_line
