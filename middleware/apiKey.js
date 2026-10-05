
const crypto = require("crypto");

const requireApiKey = (req, res, next) => {
  try {
    const providedKey = req.get("x-api-key");
    const expectedKey = process.env.EXTERNAL_API_KEY;

    // Server configuration check
    if (!expectedKey) {
      console.error(
        "EXTERNAL_API_KEY is missing from environment variables."
      );

      return res.status(500).json({
        success: false,
        message: "External API authentication is not configured.",
      });
    }

    // Missing API key
    if (!providedKey) {
      return res.status(401).json({
        success: false,
        message: "API key is required.",
      });
    }

    const providedBuffer = Buffer.from(providedKey);
    const expectedBuffer = Buffer.from(expectedKey);

    // Prevent timingSafeEqual length error
    if (providedBuffer.length !== expectedBuffer.length) {
      return res.status(403).json({
        success: false,
        message: "Invalid API key.",
      });
    }

    // Secure comparison
    if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
      return res.status(403).json({
        success: false,
        message: "Invalid API key.",
      });
    }

    // API key is valid
    next();
  } catch (error) {
    console.error("API Key Middleware Error:", error);

    return res.status(500).json({
      success: false,
      message: "API authentication failed.",
    });
  }
};

module.exports = requireApiKey;