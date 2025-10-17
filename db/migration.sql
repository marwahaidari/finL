-- 1) جدول تاریخچه پرداخت (order_payment_history)
CREATE TABLE IF NOT EXISTS order_payment_history (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) DEFAULT 0,
  method VARCHAR(100) DEFAULT 'online',
  paid_at TIMESTAMP DEFAULT NOW()
);

-- 2) اگر جدول order_tags/order_attachments/order_history/order_status_history/order_comments/order_ratings ندارن، ایجاد کن (نمونه)
CREATE TABLE IF NOT EXISTS order_tags (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  tag VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS order_attachments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  file_name VARCHAR(255),
  file_path TEXT
);

CREATE TABLE IF NOT EXISTS order_history (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  action VARCHAR(255),
  changed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  status VARCHAR(100),
  changed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_comments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_ratings (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3) اگر جدول team_members (برای نوتیفیکیشن تیم پشتیبانی) لازم است:
CREATE TABLE IF NOT EXISTS team_members (
  id SERIAL PRIMARY KEY,
  team_name VARCHAR(100),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
);

-- 4) اضافه کردن ستون is_active در reviews (اگر وجود نداره)
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
