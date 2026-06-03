var express = require("express");
var router = express.Router();

router.get("/dashboard", (req, res) => {
  res.render("dashboard", {
    title: "Dashboard",
    user: req.session.user,
  });
});

module.exports = router;