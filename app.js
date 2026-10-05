require("dotenv").config();

var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");

var session = require("express-session");
var MongoDBStore = require("connect-mongodb-session")(session);

var { CheckConnection } = require("./repository/dbconnection");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./config/swagger");

const externalDriverRequestRoutes = require("./routes/externalDriverRequest");

// =========================
// ROUTES
// =========================

var indexRouter = require("./routes/index");
var loginRouter = require("./routes/login");
var dashboardRouter = require("./routes/dashboard");
var storeRouter = require("./routes/store");
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
var adminRouter = require("./routes/admin");
var vendorRouter = require("./routes/vendor");
var staffRouter = require("./routes/staff");
var driverRouter = require("./routes/driver");
var driverRegistrationRouter = require("./routes/driverRegistration");
var vehicleRouter = require("./routes/vehicle");
var salesmanRouter = require("./routes/salesman");
var productsRouter = require("./routes/products");
var typesRouter = require("./routes/types");
var unitsRouter = require("./routes/units");
var ledgerRouter = require("./routes/ledger");
var categoriesRouter = require("./routes/categories");
var procurementRouter = require("./routes/procurement");
var warehouseRouter = require("./routes/warehouse");
var userRolesRouter = require("./routes/userRoles");
var syncIndexRouter = require("./routes/syncIndex");
var driverDashboardRouter = require("./routes/driverDashboard");
var driverRequestRouter = require("./routes/driverRequest");
var topbarRouter = require("./routes/topbar");

// =========================
// APP INIT (ONLY ONCE)
// =========================
var app = express();

// =========================
// VIEW ENGINE
// =========================
app.set("views", path.join(__dirname, "views/layout"));
app.set("view engine", "ejs");

// =========================
// BASIC MIDDLEWARE
// =========================
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// =========================
// EXTERNAL API
// =========================
// No LMS session/login required.
// Authentication is handled by x-api-key
// inside externalDriverRequestRoutes.

app.use("/api/external", externalDriverRequestRoutes);

// =========================
// MONGO CONNECTION
// =========================
const connectMongo = require("./repository/mongo");
connectMongo();

const store = new MongoDBStore({
  uri: process.env.MONGO_URL,
  collection: "lms_sessions",
});
store.on("error", (err) => console.error("[SESSION STORE] error:", err));

app.set("trust proxy", 1); // needed if behind a reverse proxy/load balancer serving HTTPS

app.use(
  session({
    name: "lms.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true, // refresh expiry on activity
    store: store,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24, // 1 day default
    },
  }),
);

const {
  attachUser,
  requireLogin,
  requireRole,
  noCache,
} = require("./middleware/auth");
app.use(attachUser);
app.use(noCache);
// =========================================================
// SWAGGER DOCS WIRING
// NOTE: app.set("views", ...) above points at "views/layout",
// so res.render("docs") normally resolves to views/layout/docs.ejs.
// docs.ejs lives at views/docs.ejs instead, so it's rendered with
// a path ("../docs") relative to the configured views root.
// =========================================================

// Default swagger-ui-express page at /api-docs
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Raw OpenAPI spec as JSON, consumed by the custom EJS page below
app.get("/api-docs.json", (req, res) => {
  res.json(swaggerSpec);
});

// Custom EJS-rendered docs page at /docs
app.get("/docs", (req, res) => {
  res.render("../docs", { title: "API Documentation" });
});

// Public — no login required
app.use("/login", loginRouter);

// Logged-in users, any role
app.use("/dashboard", requireLogin, dashboardRouter);
app.use("/store", requireLogin, storeRouter);
app.use("/branch", requireLogin, branchRouter);
app.use("/client", requireLogin, clientRouter);
app.use("/employees", requireLogin, employeesRouter);
app.use("/users", requireLogin, usersRouter);
app.use("/currency", requireLogin, currencyRouter);
app.use("/inventoryProduct", requireLogin, inventoryProductRouter);
app.use("/inventoryHistory", requireLogin, inventoryHistoryRouter);
app.use("/stockAdjustment", requireLogin, stockAdjustmentRouter);
app.use("/clientOrder", requireLogin, clientOrderRouter);
app.use("/clientOrderActivity", requireLogin, clientOrderActivityRouter);
app.use("/purchaseRequest", requireLogin, purchaseRequestRouter);
app.use(
  "/purchaseRequestActivity",
  requireLogin,
  purchaseRequestActivityRouter,
);
app.use("/salesReceiving", requireLogin, salesReceivingRouter);
app.use("/salesOrder", requireLogin, salesOrderRouter);
app.use("/salesman", requireLogin, salesmanRouter);
app.use("/salesReceivingActivity", requireLogin, salesReceivingActivityRouter);
app.use("/salesOrderActivity", requireLogin, salesOrderActivityRouter);
app.use("/purchaseOrderRequest", requireLogin, purchaseOrderRequestRouter);
app.use("/purchaseOrderActivity", requireLogin, purchaseOrderActivityRouter);
app.use(
  "/purchaseReceivingReport",
  requireLogin,
  purchaseReceivingReportRouter,
);
app.use("/shipmentRequest", requireLogin, shipmentRequestRouter);
app.use("/shipmentPlanning", requireLogin, shipmentPlanningRouter);
app.use("/shipmentDispatch", requireLogin, shipmentDispatchRouter);
app.use("/shipmentTracking", requireLogin, shipmentTrackingRouter);
app.use(
  "/shipmentProofOfDelivery",
  requireLogin,
  shipmentProofOfDeliveryRouter,
);
app.use("/shipmentReturn", requireLogin, shipmentReturnRouter);
app.use("/shipmentActivity", requireLogin, shipmentActivityRouter);
app.use("/staff", requireLogin, staffRouter);
app.use("/vendor", requireLogin, vendorRouter);
app.use("/driver", requireLogin, driverRouter);
app.use("/driverRegistration", requireLogin, driverRegistrationRouter);
app.use("/vehicle", requireLogin, vehicleRouter);
app.use("/products", requireLogin, productsRouter);
app.use("/types", requireLogin, typesRouter);
app.use("/units", requireLogin, unitsRouter);
app.use("/ledger", requireLogin, ledgerRouter);
app.use("/categories", requireLogin, categoriesRouter);
app.use("/procurement", requireLogin, procurementRouter);
app.use("/warehouse", requireLogin, warehouseRouter);
app.use("/userRoles", requireLogin, userRolesRouter);
app.use("/syncIndex", requireLogin, syncIndexRouter);
app.use("/topbar", requireLogin, topbarRouter);
app.use("/driverRequest", requireLogin, driverRequestRouter);

// Admin-only
app.use(
  "/admin",
  requireLogin,
  requireRole("admin", "administrator"),
  adminRouter,
);

// driverDashboard already gates per-route internally with
// requireRole("Driver") — requireLogin here is redundant but
// harmless as a first line of defense.
app.use("/driverDashboard", requireLogin, driverDashboardRouter);

// =========================
// 404 HANDLER
// =========================
app.use(function (req, res, next) {
  next(createError(404));
});

// =========================
// ERROR HANDLER
// =========================
app.use(function (err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  res.status(err.status || 500);
  res.render("error");
});

// =========================
// EXPORT APP
// =========================
module.exports = app;
