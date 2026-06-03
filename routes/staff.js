var express = require("express");
var router = express.Router();
const { requireRole } = require("../middleware/auth");

router.get("/dashboard", requireRole("staff"), (req, res) => {
  res.render("staff/dashboard", {
    user: req.session.user,
  });
});

module.exports = router;