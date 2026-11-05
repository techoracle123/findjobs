-- Pro application tools: reusable answers and generated application packs.
CREATE TABLE IF NOT EXISTS application_answers (
  user_id TEXT PRIMARY KEY,
  answers TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prepared_applications (
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, job_id)
);
