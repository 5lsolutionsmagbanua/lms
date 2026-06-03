var express = require("express");
var router = express.Router();

const { Select } = require("../repository/dbconnection");

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("login", { title: "Login Page" });
});

module.exports = router;

/* =========================
LOGIN PROCESS
========================= */
function getDashboard(role) {
  switch (role) {
    case "admin":
      return "/admin/dashboard";

    case "manager":
      return "/manager/dashboard";

    case "staff":
      return "/staff/dashboard";

    case "driver":
      return "/driver/dashboard";

    default:
      return "/dashboard";
  }
}

router.post("/", async (req, res) => {
  try {
    const { username, password } = req.body;

    const users = await Select(
      "SELECT * FROM users WHERE username = ? LIMIT 1",
      [username],
    );

    // Username check
    if (users.length === 0) {
      return res.status(401).json({
        message: "Username does not exist",
      });
    }

    const user = users[0];

    // Password check
    if (user.password !== password) {
      return res.status(401).json({
        message: "Incorrect password",
      });
    }

    // Account status check
    if (user.is_active !== 1) {
      return res.status(403).json({
        message: "Account is inactive. Please contact the administrator.",
      });
    }

    // ✅ SESSION FIRST
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      full_name: user.full_name,
    };

    // ✅ THEN RESPONSE (THIS IS WHERE YOUR CODE GOES)
    req.session.save(() => {
      return res.json({
        success: true,
        role: user.role,
        redirect: getDashboard(user.role),
      });
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Login error" });
  }
});

/* =========================
LOGOUT
========================= */
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

const { requireLogin, requireRole } = require("../middleware/auth");

router.get("/dashboard", requireRole("admin"), (req, res) => {
  res.render("dashboard", {
    user: req.session.user,
  });
});

router.get("/staff/dashboard", requireRole("staff"), (req, res) => {
  res.render("staff/dashboard");
});

router.post("/", async (req, res) => {
  try {
    const { username, password, remember } = req.body;

    // login validation here...

    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      full_name: user.full_name,
    };

    // Remember Me
    if (remember) {
      // 30 days
      req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
    } else {
      // Session expires when browser closes
      req.session.cookie.expires = false;
    }

    req.session.save(() => {
      res.json({
        success: true,
        redirect: getDashboard(user.role),
      });
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Login error",
    });
  }
});
