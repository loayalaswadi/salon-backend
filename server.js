/**
 * server.js — صالون وردة البنفسج
 * Node.js + Express + SQLite3 Backend
 * Run: npm install express sqlite3 cors && node server.js
 */

require('dotenv').config();
const express     = require('express');
const sqlite3     = require('sqlite3').verbose();
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
// DATABASE SETUP
// ─────────────────────────────────────────
const db = new sqlite3.Database('./salon.db', (err) => {
  if (err) {
    console.error('❌ DB Connection error:', err.message);
  } else {
    console.log('✅ Connected to SQLite database.');
    createTables();
  }
});

function createTables() {
  db.serialize(() => {
    // Products table
    db.run(`CREATE TABLE IF NOT EXISTS Products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      image TEXT
    )`, (err) => { if (err) console.error(err); else console.log('✅ Products table ready'); });

    // Orders table
    db.run(`CREATE TABLE IF NOT EXISTS Orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customerName TEXT NOT NULL,
      customerPhone TEXT NOT NULL,
      totalAmount REAL NOT NULL,
      orderDate DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => { if (err) console.error(err); else console.log('✅ Orders table ready'); });

    // ✅ NEW — Services table
    db.run(`CREATE TABLE IF NOT EXISTS Services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      image TEXT
    )`, (err) => { if (err) console.error(err); else console.log('✅ Services table ready'); });

    // Appointments table
    db.run(`CREATE TABLE IF NOT EXISTS Appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customerName TEXT NOT NULL,
      customerPhone TEXT NOT NULL,
      serviceName TEXT NOT NULL,
      apptDate TEXT NOT NULL,
      apptTime TEXT NOT NULL,
      status TEXT DEFAULT 'pending'
    )`, (err) => { if (err) console.error(err); else console.log('✅ Appointments table ready'); });

    // Insert sample products if empty
    db.get('SELECT COUNT(*) as count FROM Products', (err, row) => {
      if (!err && row.count === 0) {
        const samples = [
          ['كريم مرطب فاخر', 45, ''],
          ['مجموعة العناية بالشعر', 89, ''],
          ['ماسك للوجه - ورد البنفسج', 35, ''],
          ['سيروم مضاد للتجاعيد', 120, ''],
          ['زيت الأرغان الطبيعي', 65, ''],
          ['مجموعة العطور', 150, ''],
        ];
        const stmt = db.prepare('INSERT INTO Products (name, price, image) VALUES (?, ?, ?)');
        samples.forEach(s => stmt.run(s));
        stmt.finalize();
        console.log('✅ Sample products inserted');
      }
    });
  });
}

// ─────────────────────────────────────────
// PRODUCTS ENDPOINTS
// ─────────────────────────────────────────
// GET all products
app.get('/api/products', (req, res) => {
  db.all('SELECT * FROM Products', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
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
    db.run(
      'INSERT INTO Products (name, price, image) VALUES (?, ?, ?)',
      [name, price, image],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID, name, price, image });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Cloudinary upload failed: ' + err.message });
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
    db.run(
      'UPDATE Products SET name = ?, price = ?, image = ? WHERE id = ?',
      [name, price, image, req.params.id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Product not found' });
        res.json({ id: Number(req.params.id), name, price, image });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Cloudinary upload failed: ' + err.message });
  }
});

// ✅ NEW — DELETE product
app.delete('/api/products/:id', (req, res) => {
  db.run('DELETE FROM Products WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ deleted: true, id: Number(req.params.id) });
  });
});

// ─────────────────────────────────────────
// ✅ NEW — SERVICES ENDPOINTS (Full CRUD)
// ─────────────────────────────────────────
// GET all services
app.get('/api/services', (req, res) => {
  db.all('SELECT * FROM Services', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// GET single service by ID
app.get('/api/services/:id', (req, res) => {
  db.get('SELECT * FROM Services WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Service not found' });
    res.json(row);
  });
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
    db.run(
      'INSERT INTO Services (name, price, image) VALUES (?, ?, ?)',
      [name, price, image],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID, name, price, image });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Cloudinary upload failed: ' + err.message });
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
    db.run(
      'UPDATE Services SET name = ?, price = ?, image = ? WHERE id = ?',
      [name, price, image, req.params.id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Service not found' });
        res.json({ id: Number(req.params.id), name, price, image });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Cloudinary upload failed: ' + err.message });
  }
});

// DELETE service
app.delete('/api/services/:id', (req, res) => {
  db.run('DELETE FROM Services WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Service not found' });
    res.json({ deleted: true, id: Number(req.params.id) });
  });
});

// ─────────────────────────────────────────
// ORDERS ENDPOINTS
// ─────────────────────────────────────────
// GET all orders
app.get('/api/orders', (req, res) => {
  db.all('SELECT * FROM Orders ORDER BY orderDate DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// POST create order
app.post('/api/orders', (req, res) => {
  const { customerName, customerPhone, totalAmount } = req.body;
  if (!customerName || !customerPhone || totalAmount === undefined) {
    return res.status(400).json({ error: 'customerName, customerPhone, totalAmount required' });
  }
  db.run(
    'INSERT INTO Orders (customerName, customerPhone, totalAmount) VALUES (?, ?, ?)',
    [customerName, customerPhone, totalAmount],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID, customerName, customerPhone, totalAmount });
    }
  );
});

// ─────────────────────────────────────────
// APPOINTMENTS ENDPOINTS
// ─────────────────────────────────────────
// GET all appointments
app.get('/api/appointments', (req, res) => {
  db.all(
    `SELECT * FROM Appointments ORDER BY apptDate ASC, apptTime ASC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// POST create appointment
app.post('/api/appointments', (req, res) => {
  const { customerName, customerPhone, serviceName, apptDate, apptTime } = req.body;
  if (!customerName || !customerPhone || !serviceName || !apptDate || !apptTime) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  db.run(
    `INSERT INTO Appointments (customerName, customerPhone, serviceName, apptDate, apptTime)
     VALUES (?, ?, ?, ?, ?)`,
    [customerName, customerPhone, serviceName, apptDate, apptTime],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID, customerName, customerPhone, serviceName, apptDate, apptTime, status: 'pending' });
    }
  );
});

// PATCH update appointment status
app.patch('/api/appointments/:id', (req, res) => {
  const { status } = req.body;
  db.run('UPDATE Appointments SET status = ? WHERE id = ?', [status, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ updated: this.changes });
  });
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
