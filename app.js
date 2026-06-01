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
var employeesRouter = require("./routes/employees");
var usersRouter = require("./routes/users");
var currencyRouter = require("./routes/currency");
var inventoryProductRouter = require("./routes/inventoryProduct");
var inventoryHistoryRouter = require("./routes/inventoryHistory");
var stockAdjustmentRouter = require("./routes/stockAdjustment");
var clientOrderRouter = require("./routes/clientOrder");
var clientOrderActivityRouter = require("./routes/clientOrderActivity");
var purchaseRequestRouter = require("./routes/purchaseRequest");
var purchaseRequestActivityRouter = require("./routes/purchaseRequestActivity");
var salesReceivingActivityRouter = require("./routes/salesReceivingActivity");
var salesReceivingRouter = require("./routes/salesReceiving");
var salesOrderRouter = require("./routes/salesOrder");
var salesOrderActivityRouter = require("./routes/salesOrderActivity");
var purchaseOrderRequestRouter = require("./routes/purchaseOrderRequest");
var purchaseOrderActivityRouter = require("./routes/purchaseOrderActivity");
var purchaseReceivingReportRouter = require("./routes/purchaseReceivingReport");
var shipmentRequestRouter = require("./routes/shipmentRequest");
var shipmentPlanningRouter = require("./routes/shipmentPlanning");
var shipmentDispatchRouter = require("./routes/shipmentDispatch");
var shipmentTrackingRouter = require("./routes/shipmentTracking");
var shipmentProofOfDeliveryRouter = require("./routes/shipmentProofOfDelivery");
var shipmentReturnRouter = require("./routes/shipmentReturn");
var shipmentActivityRouter = require("./routes/shipmentActivity");
var salesmanRouter = require("./routes/salesman");
var productsRouter = require("./routes/products");
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
app.use("/employees", employeesRouter);
app.use("/users", usersRouter);
app.use("/currency", currencyRouter);
app.use("/inventoryProduct", inventoryProductRouter);
app.use("/inventoryHistory", inventoryHistoryRouter);
app.use("/stockAdjustment", stockAdjustmentRouter);
app.use("/clientOrder", clientOrderRouter);
app.use("/clientOrderActivity", clientOrderActivityRouter);
app.use("/purchaseRequest", purchaseRequestRouter);
app.use("/purchaseRequestActivity", purchaseRequestActivityRouter);
app.use("/salesReceiving", salesReceivingRouter);
app.use("/salesOrder", salesOrderRouter);
app.use("/salesman", salesmanRouter);
app.use("/salesReceivingActivity", salesReceivingActivityRouter);
app.use("/salesOrderActivity", salesOrderActivityRouter);
app.use("/purchaseOrderRequest", purchaseOrderRequestRouter);
app.use("/purchaseOrderActivity", purchaseOrderActivityRouter);
app.use("/purchaseReceivingReport", purchaseReceivingReportRouter);
app.use("/shipmentRequest", shipmentRequestRouter);
app.use("/shipmentPlanning", shipmentPlanningRouter);
app.use("/shipmentDispatch", shipmentDispatchRouter);
app.use("/shipmentTracking", shipmentTrackingRouter);
app.use("/shipmentProofOfDelivery", shipmentProofOfDeliveryRouter);
app.use("/shipmentReturn", shipmentReturnRouter);
app.use("/shipmentActivity", shipmentActivityRouter);
app.use("/products", productsRouter);
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
