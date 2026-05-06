/**
 * server.js — صالون وردة البنفسج
 * Node.js + Express + PostgreSQL Backend
 * Run: npm install && node server.js
 */

require('dotenv').config();
const jwt         = require('jsonwebtoken');
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
// AUTH — Login endpoint
// ─────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  res.json({ token });
});

// ─────────────────────────────────────────
// AUTH — verifyAdmin middleware
// ─────────────────────────────────────────
function verifyAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.admin = decoded;
    next();
  });
}

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

    // ── Safe migration: add variable-pricing columns to Services ──
    await client.query(`ALTER TABLE Services ADD COLUMN IF NOT EXISTS "pricingType" TEXT DEFAULT 'fixed'`);
    await client.query(`ALTER TABLE Services ADD COLUMN IF NOT EXISTS "guideImage" TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE Services ADD COLUMN IF NOT EXISTS "priceOptions" JSONB DEFAULT '[]'::jsonb`);
    console.log('✅ Services pricing columns ready');

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

    // ── Safe migration: add variable-pricing columns to Appointments ──
    await client.query(`ALTER TABLE Appointments ADD COLUMN IF NOT EXISTS "serviceLevel" TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE Appointments ADD COLUMN IF NOT EXISTS "serviceOptionLabel" TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE Appointments ADD COLUMN IF NOT EXISTS "finalPrice" NUMERIC DEFAULT 0`);
    console.log('✅ Appointments pricing columns ready');

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
// GET /api/products — public
// POST, PUT, DELETE — protected
// ─────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM Products ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', verifyAdmin, upload.single('image'), async (req, res) => {
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

app.put('/api/products/:id', verifyAdmin, upload.single('image'), async (req, res) => {
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

app.delete('/api/products/:id', verifyAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM Products WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Product not found' });
    res.json({ deleted: true, id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// SERVICES ENDPOINTS
// GET /api/services and GET /api/services/:id — public
// POST, PUT, DELETE — protected
// ─────────────────────────────────────────
app.get('/api/services', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM Services ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/services/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM Services WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Service not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/services', verifyAdmin, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'guideImageFile', maxCount: 1 }]), async (req, res) => {
  const { name } = req.body;
  const pricingType = req.body.pricingType || 'fixed';

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    // Service image
    let image = req.body.imageUrl || '';
    if (req.files && req.files['image'] && req.files['image'][0]) {
      image = await uploadToCloudinary(req.files['image'][0].buffer, 'salon/services');
    }

    let price = parseFloat(req.body.price) || 0;
    let guideImage = req.body.guideImageUrl || '';
    let priceOptions = [];

    if (pricingType === 'variable') {
      // Guide image upload
      if (req.files && req.files['guideImageFile'] && req.files['guideImageFile'][0]) {
        guideImage = await uploadToCloudinary(req.files['guideImageFile'][0].buffer, 'salon/guides');
      }
      // Parse and validate priceOptions
      try {
        priceOptions = JSON.parse(req.body.priceOptions || '[]');
      } catch { priceOptions = []; }

      if (!priceOptions.length) {
        return res.status(400).json({ error: 'priceOptions is required for variable pricing' });
      }
      for (const opt of priceOptions) {
        if (!opt.label || opt.price === undefined) {
          return res.status(400).json({ error: 'Each price option must have label and price' });
        }
      }
      // Set main price to minimum option price for backward compatibility
      price = Math.min(...priceOptions.map(o => parseFloat(o.price)));
    } else {
      if (!price) return res.status(400).json({ error: 'price is required for fixed pricing' });
    }

    const { rows } = await pool.query(
      `INSERT INTO Services (name, price, image, "pricingType", "guideImage", "priceOptions")
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, price, image, pricingType, guideImage, JSON.stringify(priceOptions)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Upload or DB error: ' + err.message });
  }
});

app.put('/api/services/:id', verifyAdmin, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'guideImageFile', maxCount: 1 }]), async (req, res) => {
  const { name } = req.body;
  const pricingType = req.body.pricingType || 'fixed';

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    // Service image — keep existing if nothing new provided
    let image = req.body.imageUrl || '';
    if (req.files && req.files['image'] && req.files['image'][0]) {
      image = await uploadToCloudinary(req.files['image'][0].buffer, 'salon/services');
    }

    let price = parseFloat(req.body.price) || 0;
    let guideImage = req.body.guideImageUrl || '';
    let priceOptions = [];

    if (pricingType === 'variable') {
      // Guide image upload
      if (req.files && req.files['guideImageFile'] && req.files['guideImageFile'][0]) {
        guideImage = await uploadToCloudinary(req.files['guideImageFile'][0].buffer, 'salon/guides');
      }
      try {
        priceOptions = JSON.parse(req.body.priceOptions || '[]');
      } catch { priceOptions = []; }

      if (!priceOptions.length) {
        return res.status(400).json({ error: 'priceOptions is required for variable pricing' });
      }
      for (const opt of priceOptions) {
        if (!opt.label || opt.price === undefined) {
          return res.status(400).json({ error: 'Each price option must have label and price' });
        }
      }
      price = Math.min(...priceOptions.map(o => parseFloat(o.price)));
    } else {
      if (!price) return res.status(400).json({ error: 'price is required for fixed pricing' });
    }

    const { rows } = await pool.query(
      `UPDATE Services SET name=$1, price=$2, image=$3, "pricingType"=$4, "guideImage"=$5, "priceOptions"=$6
       WHERE id=$7 RETURNING *`,
      [name, price, image, pricingType, guideImage, JSON.stringify(priceOptions), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Service not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Upload or DB error: ' + err.message });
  }
});

app.delete('/api/services/:id', verifyAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM Services WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Service not found' });
    res.json({ deleted: true, id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// ORDERS ENDPOINTS — all protected
// ─────────────────────────────────────────
app.get('/api/orders', verifyAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM Orders ORDER BY "orderDate" DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
// APPOINTMENTS ENDPOINTS — all protected
// ─────────────────────────────────────────
app.get('/api/appointments', verifyAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM Appointments ORDER BY "apptDate" ASC, "apptTime" ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/appointments', async (req, res) => {
  const { customerName, customerPhone, apptDate, apptTime } = req.body;
  const serviceId    = req.body.serviceId;
  const serviceLevel = req.body.serviceLevel || '';

  if (!customerName || !customerPhone || !apptDate || !apptTime || !serviceId) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    // ── Look up the service from the database ──
    const svcResult = await pool.query('SELECT * FROM Services WHERE id = $1', [serviceId]);
    if (!svcResult.rows.length) {
      return res.status(404).json({ error: 'Service not found' });
    }
    const service = svcResult.rows[0];

    let serviceName        = service.name;
    let finalPrice         = 0;
    let serviceOptionLabel = '';

    const pricingType = service.pricingType || 'fixed';

    if (pricingType === 'fixed') {
      // Fixed price — take price from DB, ignore anything the frontend sent
      finalPrice = parseFloat(service.price) || 0;
    } else {
      // Variable price — validate serviceLevel against priceOptions
      if (!serviceLevel) {
        return res.status(400).json({ error: 'Please select hair length level' });
      }

      const priceOptions = (typeof service.priceOptions === 'string'
        ? JSON.parse(service.priceOptions || '[]')
        : service.priceOptions) || [];

      const matchedOption = priceOptions.find(o => String(o.level) === String(serviceLevel));
      if (!matchedOption) {
        return res.status(400).json({ error: 'Invalid hair length level' });
      }

      finalPrice         = parseFloat(matchedOption.price) || 0;
      serviceOptionLabel = matchedOption.label || '';
    }

    // ── Insert appointment with server-determined values ──
    const { rows } = await pool.query(
      `INSERT INTO Appointments ("customerName", "customerPhone", "serviceName", "apptDate", "apptTime", "serviceLevel", "serviceOptionLabel", "finalPrice")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [customerName, customerPhone, serviceName, apptDate, apptTime, serviceLevel, serviceOptionLabel, finalPrice]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/appointments/:id', verifyAdmin, async (req, res) => {
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

app.delete('/api/appointments/:id', verifyAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM Appointments WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Appointment not found' });
    res.json({ deleted: true, id: Number(req.params.id) });
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
