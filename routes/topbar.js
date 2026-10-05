var express = require("express");
var router = express.Router();

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("topbar", { title: "Top Page" });
});

// Return logged-in user (from JWT, via req.user set by attachUser middleware)
router.get("/api/user", (req, res) => {
  console.log("[TOPBAR] GET /api/user");

  if (!req.user) {
    console.log("[TOPBAR] No req.user — not logged in — 401");
    return res.status(401).json({
      success: false,
      message: "Not logged in",
    });
  }

  console.log("[TOPBAR] Returning user:", req.user.username);
  res.json(req.user);
});

module.exports = router;
