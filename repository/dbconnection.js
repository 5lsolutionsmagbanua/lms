require("dotenv").config();
const mysql = require("mysql");

console.log("host",process.env.DB_HOST)

let connection = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

exports.CheckConnection = () => {
  connection.connect((err) => {
    if (err) {
      console.log("error while connecting to server");
      return;
    }
    console.log("connected to database");
  });
};

exports.Select = (query, data = []) => {
  return new Promise((resolve, reject) => {
    connection.query(query, data, (err, result) => {
      if (err) {
        console.log("Error running query:", err);
        reject(err);
      } else {
        // console.log("Query executed successfully:", result);
        resolve(result);
      }
    });
  });
};

exports.Update = (query, data) => {
  return new Promise((resolve, reject) => {
    connection.query(query, data, (err, result) => {
      if (err) {
        console.log("Error running query:", err);
        reject(err);
      } else {
        // console.log("Query executed successfully:", result);
        resolve(result.affectedRows);
      }
    });
  });
};

exports.Insert = (query, data) => {
  return new Promise((resolve, reject) => {
    connection.query(query, [data], (err, result) => {
      if (err) {
        console.log("Error running query:", err);
        reject(err);
      } else {
        // console.log("Query executed successfully:", result);
        resolve([{ rows: result.affectedRows, id: result.insertId }]);
      }
    });
  });
};

exports.Delete = (query, data) => {
  return new Promise((resolve, reject) => {
    connection.query(query, data, (err, result) => {
      if (err) {
        console.log("Error running query:", err);
        reject(err);
      } else {
        // console.log("Query executed successfully:", result);
        resolve(result.affectedRows);
      }
    });
  });
};
