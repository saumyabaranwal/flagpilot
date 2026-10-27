// db.js - one shared connection pool for the whole app.

const mysql = require('mysql2/promise');
require('dotenv').config();

// a "pool" is a few open database connections that get reused.
// opening a fresh one for every request would be slow.
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = { pool };