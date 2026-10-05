require("dotenv").config();
const mysql = require("mysql");

console.log("host", process.env.DB_HOST);

// ============================================================
// FIX: connection pool instead of a single long-lived connection
// ============================================================
// The previous version used mysql.createConnection(), which opens ONE
// connection when the app starts and reuses it for every query,
// forever. The `mysql` package does NOT automatically reconnect a
// dropped connection. If that single connection ever drops — MySQL's
// wait_timeout closing an idle connection, a network blip, the DB
// restarting — every query issued afterward silently hangs forever:
// no error, no resolve, no reject. That matches the "Save button does
// nothing, no error, no response" symptom exactly.
//
// A pool avoids this: each query borrows a connection, uses it, and
// returns it. If a connection in the pool goes bad, the pool detects
// it and hands out a fresh one on the next query instead of the whole
// app being stuck on one dead connection.
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  // Fails fast instead of hanging if the pool is exhausted (e.g. from
  // a leak elsewhere) rather than queuing forever with no feedback.
  waitForConnections: true,
  queueLimit: 0,
});

// Surface pool-level errors (e.g. a connection reset by the server)
// instead of letting them fail silently.
pool.on("error", (err) => {
  console.error("MySQL pool error:", err);
});

exports.CheckConnection = () => {
  pool.getConnection((err, connection) => {
    if (err) {
      console.log("error while connecting to server", err);
      return;
    }
    console.log("connected to database");
    connection.release();
  });
};

exports.Select = (query, data = []) => {
  return new Promise((resolve, reject) => {
    pool.query(query, data, (err, result) => {
      if (err) {
        console.log("Error running query:", err);
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
};

exports.Update = (query, data) => {
  return new Promise((resolve, reject) => {
    pool.query(query, data, (err, result) => {
      if (err) {
        console.log("Error running query:", err);
        reject(err);
      } else {
        // FIX: previously resolved `result.affectedRows` (a bare
        // number). Now resolves the raw `result` object, which has
        // BOTH `.affectedRows` and `.changedRows` etc. This matches
        // what shipmentDispatchRouter.js's conditional-update checks
        // expect (`driverUpdate.affectedRows === 0`), and is more
        // useful generally. If you have older code elsewhere relying
        // on Update() resolving a plain number, it'll need a small
        // update to read `.affectedRows` off the result instead.
        resolve(result);
      }
    });
  });
};

exports.Insert = (query, data) => {
  return new Promise((resolve, reject) => {
    pool.query(query, data, (err, result) => {
      if (err) {
        console.log("Error running query:", err);
        reject(err);
      } else {
        // FIX: previously resolved `[{ rows: result.affectedRows, id:
        // result.insertId }]` — an array wrapping an object with `id`,
        // not `insertId`. Every caller in the routers reads
        // `result.insertId` directly, which was always `undefined`
        // (e.g. dispatch_id came back undefined, and the generated
        // dispatch_number literally contained the string
        // "undefined"). Resolving the raw result restores
        // `.insertId` and `.affectedRows` exactly as callers expect,
        // with no changes needed on their end.
        resolve(result);
      }
    });
  });
};

exports.Delete = (query, data) => {
  return new Promise((resolve, reject) => {
    pool.query(query, data, (err, result) => {
      if (err) {
        console.log("Error running query:", err);
        reject(err);
      } else {
        // Same consistency fix as Update() — raw result instead of a
        // bare number, so `.affectedRows` is available if a caller
        // ever needs to check whether a delete actually matched a row.
        resolve(result);
      }
    });
  });
};
