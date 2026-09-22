const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');
const path = require('path');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// ให้ Express บริการไฟล์ Static ในโฟลเดอร์ public และ Root
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// PostgreSQL Connection Config
// const pool = new Pool({
//   user: process.env.DB_USER || 'postgres',
//   host: process.env.DB_HOST || 'localhost',
//   database: process.env.DB_NAME || 'CocoYeah',
//   password: process.env.DB_PASSWORD || 'Edition012',
//   port: process.env.DB_PORT || 5432,
// });

// PostgreSQL Connection Config (ใช้ DATABASE_URL สำหรับ Heroku Deployment)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Helper Function: แปลง User ID ปลอดภัย
function parseUserIdSafely(userId) {
  if (typeof userId === 'string') {
    return parseInt(userId.replace(/\D/g, ''), 10) || 1;
  }
  return parseInt(userId, 10) || 1;
}

// =======================================================
// ROLE-BASED AUTHORIZATION MIDDLEWARE
// =======================================================
// ตรวจสอบสิทธิ์ Admin สำหรับ API ที่ห้าม Staff แก้ไข/ลบ/จัดการ
function requireAdmin(req, res, next) {
  const requireAdmin = (req, res, next) => {
    if (req.user && req.user.user_role === 'admin') {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized or access denied' });
    }
  };
  next();
}

// =======================================================
// AUTO DATABASE SCHEMA INITIALIZATION & MIGRATION
// =======================================================
async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. ตาราง users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(20) DEFAULT 'staff',
        email VARCHAR(100) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. ตาราง categories
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. ตาราง inventory_items
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id SERIAL PRIMARY KEY,
        item_code VARCHAR(50),
        name VARCHAR(150) NOT NULL,
        category_id INT REFERENCES categories(id) ON DELETE SET NULL,
        unit VARCHAR(30) DEFAULT 'หน่วย',
        unit_cost NUMERIC(10, 2) DEFAULT 0,
        remaining_qty NUMERIC(10, 2) DEFAULT 0,
        min_threshold NUMERIC(10, 2) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. ตาราง stock_logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_logs (
        id SERIAL PRIMARY KEY,
        item_id INT REFERENCES inventory_items(id) ON DELETE CASCADE,
        type VARCHAR(20) NOT NULL,
        qty NUMERIC(10, 2) NOT NULL,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. ตาราง waste_logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS waste_logs (
        id SERIAL PRIMARY KEY,
        item_id INT REFERENCES inventory_items(id) ON DELETE CASCADE,
        qty NUMERIC(10, 2) NOT NULL,
        unit_cost NUMERIC(10, 2) DEFAULT 0,
        total_cost NUMERIC(10, 2) DEFAULT 0,
        waste_type VARCHAR(50) DEFAULT 'WASTE',
        reason TEXT,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6. ตาราง stock_counts
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_counts (
        id SERIAL PRIMARY KEY,
        item_id INT REFERENCES inventory_items(id) ON DELETE CASCADE,
        count_type VARCHAR(50) NOT NULL,
        counted_qty NUMERIC(10, 2) NOT NULL,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // --- AUTO MIGRATION ---
    await client.query(`
      ALTER TABLE waste_logs ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE stock_logs ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
    `);

    await client.query('COMMIT');
    console.log('✅ Database tables & schema migrations checked successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database initialization error:', err.message);
  } finally {
    client.release();
  }
}
initDb();

// Health Check API
app.get('/api/health', (req, res) => {
  res.json({ status: 'online', timestamp: new Date() });
});

// =======================================================
// HANDLER FOR GET /api/login & ROOT ROUTE
// =======================================================
app.get('/api/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'), (err) => {
    if (err) {
      res.sendFile(path.join(__dirname, 'login.html'));
    }
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'), (err) => {
    if (err) {
      res.sendFile(path.join(__dirname, 'login.html'));
    }
  });
});

// =======================================================
// SEED API (สำหรับสร้าง Admin / Staff ด้วย Bcrypt)
// =======================================================
app.get('/api/seed-users', async (req, res) => {
  try {
    const adminPass = await bcrypt.hash('Admin1234', 10);
    const staffPass = await bcrypt.hash('Staff1234', 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM users');
      
      await client.query(
        `INSERT INTO users (username, password_hash, name, role, email) VALUES
         ('admin', $1, 'ผู้ดูแลระบบ', 'admin', 'admin@cocoyeah.com'),
         ('staff', $2, 'พนักงานประจำร้าน', 'staff', 'staff@cocoyeah.com')`,
        [adminPass, staffPass]
      );

      await client.query('COMMIT');
      res.json({ 
        message: 'สร้างผู้ใช้งาน admin และ staff เรียบร้อยแล้ว!',
        credentials: {
          admin: 'Username: admin | Password: Admin1234',
          staff: 'Username: staff | Password: Staff1234'
        }
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// AUTHENTICATION ENDPOINT (POST)
// =======================================================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอก Username และ Password' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const { password_hash, ...userProfile } = user;
    res.json({ message: 'เข้าสู่ระบบสำเร็จ', user: userProfile });
  } catch (err) {
    console.error('POST /api/login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 0. CATEGORIES ENDPOINT
// =======================================================
app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/categories error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 1. INVENTORY ENDPOINTS
// =======================================================
// ดูรายการวัตถุดิบ (อนุญาตทั้งหมด)
app.get('/api/inventory', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT i.*, c.name AS category_name 
      FROM inventory_items i
      LEFT JOIN categories c ON i.category_id = c.id
      ORDER BY i.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/inventory error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// เพิ่มวัตถุดิบใหม่ (อนุญาตทั้งหมด)
app.post('/api/inventory', async (req, res) => {
  let { item_code, name, category_id, unit, unit_cost, remaining_qty, min_threshold } = req.body;

  category_id = parseInt(category_id, 10) || 1;
  unit_cost = parseFloat(unit_cost) || 0;
  remaining_qty = parseFloat(remaining_qty) || 0;
  min_threshold = parseFloat(min_threshold) || 0;

  try {
    const result = await pool.query(
      `INSERT INTO inventory_items (item_code, name, category_id, unit, unit_cost, remaining_qty, min_threshold)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [item_code, name, category_id, unit, unit_cost, remaining_qty, min_threshold]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/inventory error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// แก้ไขรายการวัตถุดิบ (❌ ล็อกเฉพาะ Admin)
app.put('/api/inventory/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  let { item_code, name, category_id, unit, unit_cost, min_threshold } = req.body;

  category_id = parseInt(category_id, 10) || 1;
  unit_cost = parseFloat(unit_cost) || 0;
  min_threshold = parseFloat(min_threshold) || 0;

  try {
    const result = await pool.query(
      `UPDATE inventory_items 
       SET item_code = $1, name = $2, category_id = $3, unit = $4, unit_cost = $5, min_threshold = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 RETURNING *`,
      [item_code, name, category_id, unit, unit_cost, min_threshold, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการวัตถุดิบที่ต้องการแก้ไข' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /api/inventory error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ลบวัตถุดิบ (❌ ล็อกเฉพาะ Admin)
app.delete('/api/inventory/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM stock_logs WHERE item_id = $1', [id]);
    await client.query('DELETE FROM waste_logs WHERE item_id = $1', [id]);
    await client.query('DELETE FROM stock_counts WHERE item_id = $1', [id]);
    
    const result = await client.query('DELETE FROM inventory_items WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'ไม่พบรายการวัตถุดิบที่ต้องการลบ' });
    }

    await client.query('COMMIT');
    res.json({ message: 'ลบรายการวัตถุดิบเรียบร้อยแล้ว' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('DELETE /api/inventory error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =======================================================
// 2. STOCK MOVEMENT & HISTORY ENDPOINTS
// =======================================================
// เพิ่มการย้าย/บันทึกเข้า-ออกสต๊อก (อนุญาตทั้งหมด)
app.post('/api/stock/movement', async (req, res) => {
  let { item_id, type, qty, user_id, note } = req.body;

  const cleanItemId = parseInt(item_id, 10);
  const cleanQty = parseFloat(qty) || 0;
  const cleanUserId = parseUserIdSafely(user_id);

  if (isNaN(cleanItemId) || cleanItemId <= 0 || isNaN(cleanQty)) {
    return res.status(400).json({ error: 'รหัสวัตถุดิบ (item_id) หรือ จำนวน (qty) ไม่ถูกต้อง' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemCheck = await client.query('SELECT id FROM inventory_items WHERE id = $1', [cleanItemId]);
    if (itemCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `ไม่พบวัตถุดิบ ID: ${cleanItemId} ในระบบ` });
    }

    await client.query(
      `INSERT INTO stock_logs (item_id, type, qty, user_id, note) VALUES ($1, $2, $3, $4, $5)`,
      [cleanItemId, type, cleanQty, cleanUserId, note || '']
    );

    let updateQuery = '';
    if (type === 'IN') {
      updateQuery = 'UPDATE inventory_items SET remaining_qty = remaining_qty + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
    } else if (type === 'OUT' || type === 'WASTE' || type === 'TRIM') {
      updateQuery = 'UPDATE inventory_items SET remaining_qty = remaining_qty - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
    } else if (type === 'ADJUST') {
      updateQuery = 'UPDATE inventory_items SET remaining_qty = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
    }

    if (updateQuery) {
      await client.query(updateQuery, [cleanQty, cleanItemId]);
    }

    await client.query('COMMIT');
    res.json({ message: 'บันทึกความเคลื่อนไหวสต็อกสำเร็จ' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/stock/movement error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ดูประวัติสต๊อก (อนุญาตทั้งหมด)
app.get('/api/stock/history', async (req, res) => {
  const { date } = req.query;
  try {
    let queryText = `
      SELECT l.*, i.name AS item_name, i.item_code, i.unit, i.unit_cost, u.name AS user_name
      FROM stock_logs l
      LEFT JOIN inventory_items i ON l.item_id = i.id
      LEFT JOIN users u ON l.user_id = u.id
    `;
    const params = [];

    if (date) {
      queryText += ` WHERE DATE(l.created_at) = $1`;
      params.push(date);
    }

    queryText += ` ORDER BY l.created_at DESC LIMIT 100`;

    const result = await pool.query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/stock/history error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 3. WASTE LOGS ENDPOINTS
// =======================================================
// ดูรายการของเสีย (อนุญาตทั้งหมด)
app.get('/api/waste', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT w.*, i.name AS item_name, i.unit, i.unit_cost, u.name AS user_name
      FROM waste_logs w
      LEFT JOIN inventory_items i ON w.item_id = i.id
      LEFT JOIN users u ON w.user_id = u.id
      ORDER BY w.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/waste error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// บันทึกของเสีย (อนุญาตทั้งหมด)
app.post('/api/waste', async (req, res) => {
  let { item_id, qty, waste_type, reason, user_id } = req.body;

  const cleanItemId = parseInt(item_id, 10);
  const cleanQty = parseFloat(qty) || 0;
  const cleanUserId = parseUserIdSafely(user_id);

  if (isNaN(cleanItemId) || cleanItemId <= 0 || cleanQty <= 0) {
    return res.status(400).json({ error: 'ข้อมูลวัตถุดิบหรือจำนวนไม่ถูกต้อง' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemRes = await client.query('SELECT unit_cost FROM inventory_items WHERE id = $1', [cleanItemId]);
    if (itemRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'ไม่พบรายการวัตถุดิบ' });
    }
    const unitCost = parseFloat(itemRes.rows[0].unit_cost) || 0;
    const totalCost = unitCost * cleanQty;

    const wasteResult = await client.query(
      `INSERT INTO waste_logs (item_id, qty, unit_cost, total_cost, waste_type, reason, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [cleanItemId, cleanQty, unitCost, totalCost, waste_type || 'WASTE', reason || '', cleanUserId]
    );

    await client.query(
      'UPDATE inventory_items SET remaining_qty = remaining_qty - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [cleanQty, cleanItemId]
    );

    await client.query(
      `INSERT INTO stock_logs (item_id, type, qty, user_id, note) VALUES ($1, 'WASTE', $2, $3, $4)`,
      [cleanItemId, cleanQty, cleanUserId, `[บันทึกของเสีย] ${reason || ''}`]
    );

    await client.query('COMMIT');
    res.status(201).json(wasteResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/waste error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// แก้ไขประวัติของเสีย (❌ ล็อกเฉพาะ Admin)
app.put('/api/waste/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  let { qty, waste_type, reason } = req.body;
  const newQty = parseFloat(qty) || 0;

  if (newQty <= 0) {
    return res.status(400).json({ error: 'จำนวนต้องมากกว่า 0' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const oldRes = await client.query('SELECT * FROM waste_logs WHERE id = $1', [id]);
    if (oldRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'ไม่พบรายการที่ต้องการแก้ไข' });
    }
    const oldLog = oldRes.rows[0];
    const oldQty = parseFloat(oldLog.qty);
    const diffQty = newQty - oldQty;

    const unitCost = parseFloat(oldLog.unit_cost);
    const newTotalCost = unitCost * newQty;

    await client.query(
      `UPDATE waste_logs SET qty = $1, total_cost = $2, waste_type = $3, reason = $4 WHERE id = $5`,
      [newQty, newTotalCost, waste_type || oldLog.waste_type, reason || '', id]
    );

    if (diffQty !== 0) {
      await client.query(
        'UPDATE inventory_items SET remaining_qty = remaining_qty - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [diffQty, oldLog.item_id]
      );

      const movementType = diffQty > 0 ? 'OUT' : 'IN';
      await client.query(
        `INSERT INTO stock_logs (item_id, type, qty, user_id, note) VALUES ($1, $2, $3, 1, $4)`,
        [oldLog.item_id, movementType, Math.abs(diffQty), `[แก้ไขรายการของเสีย #${id}]`]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'แก้ไขรายการของเสียเรียบร้อยแล้ว' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT /api/waste error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ลบประวัติของเสีย (❌ ล็อกเฉพาะ Admin)
app.delete('/api/waste/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const wasteRes = await client.query('SELECT * FROM waste_logs WHERE id = $1', [id]);
    if (wasteRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'ไม่พบรายการของเสียที่ต้องการลบ' });
    }
    const wasteLog = wasteRes.rows[0];

    await client.query(
      'UPDATE inventory_items SET remaining_qty = remaining_qty + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [wasteLog.qty, wasteLog.item_id]
    );

    await client.query(
      `INSERT INTO stock_logs (item_id, type, qty, user_id, note) VALUES ($1, 'IN', $2, 1, $3)`,
      [wasteLog.item_id, wasteLog.qty, `[ยกเลิกบันทึกของเสีย #${id}]`]
    );

    await client.query('DELETE FROM waste_logs WHERE id = $1', [id]);

    await client.query('COMMIT');
    res.json({ message: 'ลบรายการของเสียและปรับยอดสต๊อกคืนเรียบร้อยแล้ว' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('DELETE /api/waste error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =======================================================
// 4. USERS ENDPOINTS (❌ ล็อกเฉพาะ Admin ทั้งหมด)
// =======================================================
app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, name, role, email, created_at FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/users error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, name, role, email } = req.body;

  if (!username || !password || !name) {
    return res.status(400).json({ error: 'กรุณากรอก Username, Password และ ชื่อผู้ใช้งาน' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, email) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, username, name, role, email, created_at`,
      [username, hashedPassword, name, role || 'staff', email || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/users error:', err.message);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Username หรือ Email นี้ถูกใช้งานแล้ว' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, role, email, password } = req.body;

  try {
    let query = '';
    let params = [];

    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      query = `UPDATE users SET name = $1, role = $2, email = $3, password_hash = $4 WHERE id = $5 RETURNING id, username, name, role, email`;
      params = [name, role, email, hashedPassword, id];
    } else {
      query = `UPDATE users SET name = $1, role = $2, email = $3 WHERE id = $4 RETURNING id, username, name, role, email`;
      params = [name, role, email, id];
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้ในระบบ' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /api/users/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้ที่ต้องการลบ' });
    }
    res.json({ message: 'ลบผู้ใช้เรียบร้อยแล้ว' });
  } catch (err) {
    console.error('DELETE /api/users/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/profile', async (req, res) => {
  const { user_id, name, current_password, new_password } = req.body;
  const cleanUserId = parseUserIdSafely(user_id);

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [cleanUserId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ใช้งาน' });
    }

    const user = userRes.rows[0];

    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ message: 'กรุณากรอกรหัสผ่านเดิมเพื่อยืนยัน' });
      }
      const isMatch = await bcrypt.compare(current_password, user.password_hash);
      if (!isMatch) {
        return res.status(400).json({ message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
      }
      const newHash = await bcrypt.hash(new_password, 10);
      await pool.query('UPDATE users SET name = $1, password_hash = $2 WHERE id = $3', [name, newHash, cleanUserId]);
    } else {
      await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, cleanUserId]);
    }

    res.json({ message: 'อัปเดตข้อมูลโปรไฟล์เรียบร้อยแล้ว' });
  } catch (err) {
    console.error('PUT /api/users/profile error:', err.message);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ' });
  }
});

// =======================================================
// 5. STOCK COUNT ENDPOINTS
// =======================================================
// บันทึกการนับสต๊อกประจำวัน (อนุญาตทั้งหมด)
app.post('/api/stock-count', async (req, res) => {
  const { item_id, count_type, counted_qty, user_id, overwrite } = req.body;
  const client = await pool.connect();

  const cleanItemId = parseInt(item_id, 10);
  const cleanQty = parseFloat(counted_qty) || 0;
  const cleanUserId = parseUserIdSafely(user_id);

  try {
    await client.query('BEGIN');

    const checkQuery = `
      SELECT id, counted_qty FROM stock_counts 
      WHERE item_id = $1 
        AND count_type = $2 
        AND DATE(created_at) = CURRENT_DATE
    `;
    const checkRes = await client.query(checkQuery, [cleanItemId, count_type]);

    if (checkRes.rows.length > 0 && !overwrite) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        duplicate: true,
        message: 'พบการบันทึกสต๊อกของรายการนี้ไปแล้วในวันนี้ ต้องการบันทึกเขียนทับหรือไม่?',
        existingQty: checkRes.rows[0].counted_qty
      });
    }

    if (checkRes.rows.length > 0 && overwrite) {
      const existingId = checkRes.rows[0].id;
      await client.query(
        `UPDATE stock_counts 
         SET counted_qty = $1, user_id = $2, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $3`,
        [cleanQty, cleanUserId, existingId]
      );
    } else {
      await client.query(
        `INSERT INTO stock_counts (item_id, count_type, counted_qty, user_id) 
         VALUES ($1, $2, $3, $4)`,
        [cleanItemId, count_type, cleanQty, cleanUserId]
      );
    }

    await client.query(
      `UPDATE inventory_items 
       SET remaining_qty = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2`,
      [cleanQty, cleanItemId]
    );

    await client.query(
      `INSERT INTO stock_logs (item_id, type, qty, user_id, note) VALUES ($1, 'ADJUST', $2, $3, $4)`,
      [cleanItemId, cleanQty, cleanUserId, `[นับสต๊อกประจำวัน - ${count_type}]`]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'บันทึกข้อมูลสต๊อกเรียบร้อยแล้ว' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Stock Count Error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});