/**
 * server.js — صالون وردة البنفسج
 * Node.js + Express + SQLite3 Backend
 * Run: npm install express sqlite3 cors && node server.js
 */

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

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

// POST create product
app.post('/api/products', (req, res) => {
  const { name, price, image = '' } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name and price are required' });
  }
  db.run(
    'INSERT INTO Products (name, price, image) VALUES (?, ?, ?)',
    [name, price, image],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID, name, price, image });
    }
  );
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
