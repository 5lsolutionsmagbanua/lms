var express = require("express");
var router = express.Router();

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("vendor", { title: "Vendor Page" });
});

module.exports = router;
