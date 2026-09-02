-- Reverses 0020_pipeline_stage_bottleneck_threshold.up.sql.

alter table pipeline_stages drop column if exists bottleneck_threshold_days;
