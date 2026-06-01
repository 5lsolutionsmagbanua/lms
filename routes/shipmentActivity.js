
var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('shipmentActivity', { title: 'Express' });
});

module.exports = router;


