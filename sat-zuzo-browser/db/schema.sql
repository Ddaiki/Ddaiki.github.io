PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    volume INTEGER NOT NULL,
    page INTEGER NOT NULL,
    iiif_manifest_url TEXT NOT NULL,
    iiif_image_url TEXT NOT NULL,
    title TEXT,
    deity_category TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(volume, page)
);

CREATE INDEX IF NOT EXISTS idx_images_volume ON images(volume);
CREATE INDEX IF NOT EXISTS idx_images_category ON images(deity_category);
CREATE INDEX IF NOT EXISTS idx_images_title ON images(title);

CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    w REAL NOT NULL,
    h REAL NOT NULL,
    deity_name TEXT,
    tags_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_annotations_image ON annotations(image_id);
CREATE INDEX IF NOT EXISTS idx_annotations_deity ON annotations(deity_name);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    value TEXT NOT NULL,
    UNIQUE(category, value)
);

CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category);

-- 初期ファセット（仏教図像学の代表的な分類軸）
INSERT OR IGNORE INTO tags (category, value) VALUES
    ('尊格', '仏'),
    ('尊格', '菩薩'),
    ('尊格', '明王'),
    ('尊格', '天'),
    ('尊格', '神将');
