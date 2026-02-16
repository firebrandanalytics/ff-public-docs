-- customer_orders: All orders for a given customer
-- Grain: one row per order
-- Parameters: $1 = customer_id (integer)
-- Joins orders + order_items (count) + shipping_performance (on-time flag)

SELECT
  o.order_id,
  o.order_date,
  o.order_status,
  o.order_channel,
  o.total_amount,
  COUNT(oi.order_item_id) AS item_count,
  sp.on_time AS shipped_on_time
FROM orders o
LEFT JOIN order_items oi ON o.order_id = oi.order_id
LEFT JOIN shipping_performance sp ON o.order_id = sp.order_id
WHERE o.customer_id = $1
GROUP BY o.order_id, o.order_date, o.order_status, o.order_channel,
         o.total_amount, sp.on_time
ORDER BY o.order_date DESC
