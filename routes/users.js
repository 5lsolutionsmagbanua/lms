var express = require("express");
var router = express.Router();
const {
  Select,
  Update,
  Insert,
  Delete,
} = require("../repository/dbconnection");
/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("users", { title: "Users Page" });
});

module.exports = router;
/* =========================
GET USERS
========================= */
router.get("/get-users", async (req, res, next) => {
  try {
    const query = `       SELECT *
      FROM users
      ORDER BY id DESC
    `;

    const result = await Select(query);

    res.status(200).json(result);
  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: "Failed to fetch users.",
    });
  }
});

/* =========================
ADD USER
========================= */
router.post("/add-user", async (req, res) => {
  try {
    const { full_name, username, password, role, status } = req.body;

    if (!full_name || !username || !password || !role) {
      return res.status(400).json({
        message: "Missing required fields",
      });
    }

    const checkUsername = `
  SELECT username
  FROM users
  WHERE username = ?
  LIMIT 1
`;

    const existingUser = await Select(checkUsername, [username]);

    if (existingUser.length > 0) {
      return res.status(400).json({
        message: "Username already exists",
      });
    }

    const is_active = status === "inactive" ? 0 : 1;

    const query = `
  INSERT INTO users
  (
    full_name,
    username,
    password,
    role,
    is_active,
    created_at,
    updated_at
  )
  VALUES ?
`;

    const result = await Insert(query, [
      [full_name, username, password, role, is_active, new Date(), new Date()],
    ]);

    res.status(200).json({
      message: "User added successfully",
      result,
    });
  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: "Failed to add user.",
    });
  }
});

/* =========================
UPDATE USER
========================= */
router.put("/update-user", async (req, res) => {
  try {
    const { id, full_name, username, role, status } = req.body;

    if (!id || !full_name || !username || !role) {
      return res.status(400).json({
        message: "Missing required fields",
      });
    }

    const is_active = status === "inactive" ? 0 : 1;

    const query = `
  UPDATE users
  SET
    full_name = ?,
    username = ?,
    role = ?,
    is_active = ?,
    updated_at = ?
  WHERE id = ?
`;

    const affectedRows = await Update(query, [
      full_name,
      username,
      role,
      is_active,
      new Date(),
      id,
    ]);

    if (affectedRows === 0) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.status(200).json({
      message: "User updated successfully",
    });
  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: "Failed to update user.",
    });
  }
});

/* =========================
DELETE USER
========================= */
router.delete("/delete-user", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({
        message: "User ID is required",
      });
    }

    const query = `
  DELETE FROM users
  WHERE id = ?
`;

    const affectedRows = await Delete(query, [id]);

    if (affectedRows === 0) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.status(200).json({
      message: "User deleted successfully",
    });
  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: "Failed to delete user.",
    });
  }
});
