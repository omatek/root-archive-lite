CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    semester TEXT NOT NULL DEFAULT '',
    contributor TEXT NOT NULL DEFAULT '',
    owner_id TEXT NOT NULL,
    file_key TEXT NOT NULL UNIQUE
);
