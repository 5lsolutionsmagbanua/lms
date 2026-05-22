var express = require("express");
var router = express.Router();

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("warehouse", { title: "Warehouse Page" });
});

module.exports = router;
