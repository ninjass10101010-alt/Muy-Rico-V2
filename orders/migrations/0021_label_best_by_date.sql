-- 0021: snapshot best-by date at label generation time (stop daily drift)
ALTER TABLE label_templates ADD COLUMN best_by_date TEXT;
