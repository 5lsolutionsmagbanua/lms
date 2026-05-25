var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
var { CheckConnection } = require("./repository/dbconnection");

var indexRouter = require("./routes/index");
var dashboardRouter = require("./routes/dashboard");
var vendorRouter = require("./routes/vendor");
var branchRouter = require("./routes/branch");
var clientRouter = require("./routes/client");
var usersRouter = require("./routes/users");
var inventoryRouter = require("./routes/inventory");
var shipmentsRouter = require("./routes/shipments");
var warehouseRouter = require("./routes/warehouse");

var app = express();
// console.log("working", CheckConnection())
// view engine setup
app.set("views", path.join(__dirname, "views/layout"));
app.set("view engine", "ejs");

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter);
app.use("/dashboard", dashboardRouter);
app.use("/vendor", vendorRouter);
app.use("/branch", branchRouter);
app.use("/client", clientRouter);
app.use("/users", usersRouter);
app.use("/inventory", inventoryRouter);
app.use("/shipments", shipmentsRouter);
app.use("/warehouse", warehouseRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;
