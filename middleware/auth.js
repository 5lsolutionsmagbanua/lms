function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    if (req.session.user.role !== role) {
      return res.status(403).send("Access Denied");
    }

    next();
  };
}

module.exports = { requireLogin, requireRole };
