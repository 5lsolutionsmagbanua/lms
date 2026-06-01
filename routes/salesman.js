
var express = require("express");
var router = express.Router();

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("salesman", { title: "Salesman Page" });
});

module.exports = router;
