-- campaign_roi_summary: Per-campaign ROI
-- Grain: one row per campaign (80 rows)
-- Joins campaigns + campaign_performance
-- ROI = (revenue - spend) / spend * 100

SELECT
  c.campaign_id,
  c.campaign_name,
  c.campaign_type,
  c.target_segment,
  c.budget,
  SUM(cp.spend) AS total_spend,
  SUM(cp.impressions) AS total_impressions,
  SUM(cp.clicks) AS total_clicks,
  SUM(cp.conversions) AS total_conversions,
  SUM(cp.revenue_attributed) AS revenue_attributed,
  CASE
    WHEN SUM(cp.spend) > 0
    THEN ROUND((SUM(cp.revenue_attributed) - SUM(cp.spend)) / SUM(cp.spend) * 100, 2)
    ELSE 0
  END AS roi_percentage
FROM campaigns c
LEFT JOIN campaign_performance cp ON c.campaign_id = cp.campaign_id
GROUP BY c.campaign_id, c.campaign_name, c.campaign_type, c.target_segment, c.budget
