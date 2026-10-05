const jwt = require("jsonwebtoken");

// =======================================
// ATTACH req.user FROM SESSION
// Call this globally (app.use) so req.user is available everywhere,
// even on routes that don't require login.
// =======================================
function attachUser(req, res, next) {
  req.user = (req.session && req.session.user) || null;
  next();
}
function getChangedBy(req) {
  return req.session?.user?.name || req.user?.name || null;
}
// =======================================
// REQUIRE LOGIN
// =======================================
function requireLogin(req, res, next) {
  if (!req.user) {
    return res.redirect("/login");
  }
  next();
}

function requireRole(...roles) {
  const normalizedRoles = roles.map((r) => r.toLowerCase());

  return (req, res, next) => {
    const wantsJson =
      req.xhr ||
      req.path.startsWith("/api") ||
      req.get("accept")?.includes("application/json") ||
      req.originalUrl.includes("/api/");

    if (!req.user) {
      if (wantsJson) {
        return res
          .status(401)
          .json({ success: false, message: "Not logged in." });
      }
      return res.redirect("/login");
    }

    const userRole = (req.user.role || "").toLowerCase();

    if (!normalizedRoles.includes(userRole)) {
      if (wantsJson) {
        return res
          .status(403)
          .json({ success: false, message: "Access denied." });
      }
      return res.status(403).render("errors/403", {
        title: "Access Denied",
        user: req.user,
      });
    }

    next();
  };
}

// =======================================
// REDIRECT TO USER DASHBOARD
// =======================================
function redirectDashboard(req, res) {
  if (!req.user) {
    return res.redirect("/login");
  }

  switch ((req.user.role || "").toLowerCase()) {
    case "administrator":
    case "admin":
    case "manager":
    case "warehouse":
    case "dispatcher":
      return res.redirect("/dashboard");
    case "driver":
      return res.redirect("/driverDashboard");
    default:
      return res.redirect("/dashboard");
  }
}

// middleware/auth.js — add this export
function noCache(req, res, next) {
  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
}

module.exports = {
  attachUser,
  requireLogin,
  requireRole,
  redirectDashboard,
  noCache,
  getChangedBy,
};
