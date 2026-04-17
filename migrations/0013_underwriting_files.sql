CREATE TABLE IF NOT EXISTS underwriting_files (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES prospect_applications(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  category TEXT,
  description TEXT,
  uploaded_by VARCHAR,
  uploaded_at TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS underwriting_files_app_idx ON underwriting_files(application_id);
