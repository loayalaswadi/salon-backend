/**
 * server.js — صالون وردة البنفسج
 * Node.js + Express + SQLite3 Backend
 * Run: npm install && node server.js
 */

require('dotenv').config();
const express     = require('express');
const { Pool }    = require('pg');
const cors        = require('cors');
const path        = require('path');
const multer      = require('multer');
const cloudinary  = require('cloudinary').v2;
const streamifier = require('streamifier');

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────
// CLOUDINARY CONFIGURATION
// ─────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─────────────────────────────────────────
// MULTER — memory storage (no disk writes)
// ─────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage() });

// ─────────────────────────────────────────
// CLOUDINARY UPLOAD HELPER
// Streams a buffer to Cloudinary, returns secure_url
// ─────────────────────────────────────────
function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: folder || 'salon', resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}


// ─────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────
// DATABASE SETUP — PostgreSQL
// ─────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function createTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS Products (
        id   SERIAL PRIMARY KEY,
        name TEXT    NOT NULL,
        price NUMERIC NOT NULL,
        image TEXT   DEFAULT ''
      )
    `);
    console.log('✅ Products table ready');

    await client.query(`
      CREATE TABLE IF NOT EXISTS Orders (
        id            SERIAL PRIMARY KEY,
        "customerName"  TEXT    NOT NULL,
        "customerPhone" TEXT    NOT NULL,
        "totalAmount"   NUMERIC NOT NULL,
        "orderDate"     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Orders table ready');

    await client.query(`
      CREATE TABLE IF NOT EXISTS Services (
        id    SERIAL PRIMARY KEY,
        name  TEXT    NOT NULL,
        price NUMERIC NOT NULL,
        image TEXT    DEFAULT ''
      )
    `);
    console.log('✅ Services table ready');

    await client.query(`
      CREATE TABLE IF NOT EXISTS Appointments (
        id              SERIAL PRIMARY KEY,
        "customerName"  TEXT NOT NULL,
        "customerPhone" TEXT NOT NULL,
        "serviceName"   TEXT NOT NULL,
        "apptDate"      TEXT NOT NULL,
        "apptTime"      TEXT NOT NULL,
        status          TEXT DEFAULT 'pending'
      )
    `);
    console.log('✅ Appointments table ready');

    // Insert sample products if table is empty
    const { rows } = await client.query('SELECT COUNT(*) AS count FROM Products');
    if (parseInt(rows[0].count) === 0) {
      const samples = [
        ['كريم مرطب فاخر', 45, ''],
        ['مجموعة العناية بالشعر', 89, ''],
        ['ماسك للوجه - ورد البنفسج', 35, ''],
        ['سيروم مضاد للتجاعيد', 120, ''],
        ['زيت الأرغان الطبيعي', 65, ''],
        ['مجموعة العطور', 150, ''],
      ];
      for (const [name, price, image] of samples) {
        await client.query(
          'INSERT INTO Products (name, price, image) VALUES ($1, $2, $3)',
          [name, price, image]
        );
      }
      console.log('✅ Sample products inserted');
    }
  } finally {
    client.release();
  }
}

// Connect and initialise tables on startup
pool.connect()
  .then(client => {
    console.log('✅ Connected to PostgreSQL database.');
    client.release();
    return createTables();
  })
  .catch(err => console.error('❌ DB Connection error:', err.message));

// ─────────────────────────────────────────
// PRODUCTS ENDPOINTS
// ─────────────────────────────────────────
// GET all products
app.get('/api/products', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM Products ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create product (multipart/form-data or JSON)
app.post('/api/products', upload.single('image'), async (req, res) => {
  const { name, price } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name and price are required' });
  }
  try {
    let image = req.body.imageUrl || '';
    if (req.file) {
      image = await uploadToCloudinary(req.file.buffer, 'salon/products');
    }
    const { rows } = await pool.query(
      'INSERT INTO Products (name, price, image) VALUES ($1, $2, $3) RETURNING *',
      [name, price, image]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Upload or DB error: ' + err.message });
  }
});

// PUT update product (multipart/form-data or JSON)
app.put('/api/products/:id', upload.single('image'), async (req, res) => {
  const { name, price } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name and price are required' });
  }
  try {
    let image = req.body.imageUrl || '';
    if (req.file) {
      image = await uploadToCloudinary(req.file.buffer, 'salon/products');
    }
    const { rows } = await pool.query(
      'UPDATE Products SET name=$1, price=$2, image=$3 WHERE id=$4 RETURNING *',
      [name, price, image, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Upload or DB error: ' + err.message });
  }
});

// DELETE product
app.delete('/api/products/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM Products WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Product not found' });
    res.json({ deleted: true, id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// ✅ NEW — SERVICES ENDPOINTS (Full CRUD)
// ─────────────────────────────────────────
// GET all services
app.get('/api/services', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM Services ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single service by ID
app.get('/api/services/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM Services WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Service not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create service (multipart/form-data or JSON)
app.post('/api/services', upload.single('image'), async (req, res) => {
  const { name, price } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name and price are required' });
  }
  try {
    let image = req.body.imageUrl || '';
    if (req.file) {
      image = await uploadToCloudinary(req.file.buffer, 'salon/services');
    }
    const { rows } = await pool.query(
      'INSERT INTO Services (name, price, image) VALUES ($1, $2, $3) RETURNING *',
      [name, price, image]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Upload or DB error: ' + err.message });
  }
});

// PUT update service (multipart/form-data or JSON)
app.put('/api/services/:id', upload.single('image'), async (req, res) => {
  const { name, price } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name and price are required' });
  }
  try {
    let image = req.body.imageUrl || '';
    if (req.file) {
      image = await uploadToCloudinary(req.file.buffer, 'salon/services');
    }
    const { rows } = await pool.query(
      'UPDATE Services SET name=$1, price=$2, image=$3 WHERE id=$4 RETURNING *',
      [name, price, image, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Service not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Upload or DB error: ' + err.message });
  }
});

// DELETE service
app.delete('/api/services/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM Services WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Service not found' });
    res.json({ deleted: true, id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// ORDERS ENDPOINTS
// ─────────────────────────────────────────
// GET all orders
app.get('/api/orders', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM Orders ORDER BY "orderDate" DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create order
app.post('/api/orders', async (req, res) => {
  const { customerName, customerPhone, totalAmount } = req.body;
  if (!customerName || !customerPhone || totalAmount === undefined) {
    return res.status(400).json({ error: 'customerName, customerPhone, totalAmount required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO Orders ("customerName", "customerPhone", "totalAmount")
       VALUES ($1, $2, $3) RETURNING *`,
      [customerName, customerPhone, totalAmount]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// APPOINTMENTS ENDPOINTS
// ─────────────────────────────────────────
// GET all appointments
app.get('/api/appointments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM Appointments ORDER BY "apptDate" ASC, "apptTime" ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create appointment
app.post('/api/appointments', async (req, res) => {
  const { customerName, customerPhone, serviceName, apptDate, apptTime } = req.body;
  if (!customerName || !customerPhone || !serviceName || !apptDate || !apptTime) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO Appointments ("customerName", "customerPhone", "serviceName", "apptDate", "apptTime")
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [customerName, customerPhone, serviceName, apptDate, apptTime]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update appointment status
app.patch('/api/appointments/:id', async (req, res) => {
  const { status } = req.body;
  try {
    const { rowCount } = await pool.query(
      'UPDATE Appointments SET status=$1 WHERE id=$2',
      [status, req.params.id]
    );
    res.json({ updated: rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌸 صالون وردة البنفسج — Server running!`);
  console.log(`🔗 http://localhost:${PORT}`);
  console.log(`📂 API: http://localhost:${PORT}/api/products`);
  console.log(`📂 API: http://localhost:${PORT}/api/orders`);
  console.log(`📂 API: http://localhost:${PORT}/api/appointments\n`);
});
