var express = require("express");
var router = express.Router();

const {
  Select,
  Update,
  Insert,
  Delete,
} = require("../repository/dbconnection");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

/**
 * @swagger
 * /login:
 *   get:
 *     summary: Render the login page
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Login page HTML
 */
router.get("/", function (req, res) {
  console.log("[LOGIN] GET / — rendering login page");
  res.render("login", { title: "Login Page" });
});

function getDashboard(role) {
  if (!role) return "/dashboard";

  switch (role.toLowerCase()) {
    case "admin":
    case "administrator":
    case "manager":
    case "warehouse":
    case "dispatcher":
      return "/dashboard";
    case "driver":
      return "/driverDashboard";
    default:
      return "/dashboard";
  }
}

router.post("/", async (req, res) => {
  try {
    const { username, password, remember } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required.",
      });
    }

    const users = await Select(
      `
      SELECT
          u.id, u.username, u.password, u.is_active, u.role_id,
          r.role_name,
          CONCAT(u.first_name,' ',u.last_name) AS full_name
      FROM users u
      INNER JOIN roles r ON r.id = u.role_id
      WHERE u.username = ?
      LIMIT 1
      `,
      [username],
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password.",
      });
    }

    const user = users[0];

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password.",
      });
    }

    if (Number(user.is_active) !== 1) {
      return res.status(403).json({
        success: false,
        message: "Your account is inactive.",
      });
    }

    const sessionUser = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role_name,
      role_id: user.role_id,
    };

    // Regenerate the session on login to prevent session fixation —
    // issues a fresh session ID rather than reusing whatever ID the
    // client had before authenticating.
    req.session.regenerate((err) => {
      if (err) {
        console.error("[LOGIN] session regenerate error:", err);
        return res.status(500).json({
          success: false,
          message: "An unexpected error occurred.",
        });
      }

      req.session.user = sessionUser;

      if (remember) {
        req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 days
      }
      // else: falls back to the default maxAge set in app.js (1 day)

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("[LOGIN] session save error:", saveErr);
          return res.status(500).json({
            success: false,
            message: "An unexpected error occurred.",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Login successful.",
          redirect: getDashboard(sessionUser.role),
          user: sessionUser,
        });
      });
    });
  } catch (err) {
    console.error("[LOGIN] ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred.",
    });
  }
});

router.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error("[LOGIN] session destroy error:", err);

    // Must match the same path/secure/sameSite the cookie was
    // originally set with in app.js's session() config, or the
    // browser won't recognize it as the same cookie and silently
    // keeps it.
    res.clearCookie("lms.sid", {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    res.redirect("/login");
  });
});

module.exports = router;
