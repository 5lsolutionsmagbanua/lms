const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "LMS API",
      version: "1.0.0",
      description:
        "API documentation for the LMS backend (authentication, dashboards, etc.)",
    },
    servers: [
      { url: "http://localhost:3000", description: "Local dev" },
      // Add your staging/production URLs here once deployed, e.g.
      // { url: "https://lms.example.com", description: "Production" },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "token", // matches res.cookie("token", ...) set in login route
        },
      },
      // Reusable path/query parameters — reference these with $ref
      // instead of retyping "id in path, required, integer" in every module.
      parameters: {
        IdParam: {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "integer" },
          description: "Record ID",
        },
        PageParam: {
          name: "page",
          in: "query",
          required: false,
          schema: { type: "integer", default: 1 },
        },
        LimitParam: {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", default: 20 },
        },
      },
      // Reusable responses — reference these instead of redefining
      // "404 Not Found" / "401 Unauthorized" in every single endpoint.
      responses: {
        NotFound: {
          description: "Resource not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        Unauthorized: {
          description: "Not logged in",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        Forbidden: {
          description: "Logged in but role not permitted",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
      schemas: {
        LoginRequest: {
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string", example: "jdoe" },
            password: {
              type: "string",
              format: "password",
              example: "secret123",
            },
            remember: { type: "boolean", example: false },
          },
        },
        LoginSuccess: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string", example: "Login successful." },
            redirect: { type: "string", example: "/dashboard" },
            user: {
              type: "object",
              properties: {
                id: { type: "integer", example: 1 },
                username: { type: "string", example: "jdoe" },
                full_name: { type: "string", example: "John Doe" },
                role: { type: "string", example: "admin" },
                role_id: { type: "integer", example: 1 },
              },
            },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string", example: "Invalid username or password." },
          },
        },
        DriverRequest: {
          type: "object",
          properties: {
            dr_id: { type: "string", format: "uuid" },
            dr_requestId: { type: "string" },
            dr_storeId: { type: "string", format: "uuid" },
            dr_ticketNumber: { type: "string" },
            dr_storeName: { type: "string" },
            dr_storeCode: { type: "string" },
            dr_status: { type: "string", enum: ["PENDING", "SYNCED", "FAILED"] },
            dr_createdDate: { type: "string", format: "date-time" },
            dr_createdBy: { type: "string" },
          },
        },
      },
    },
    tags: [
      { name: "Auth", description: "Authentication endpoints" },
      { name: "Dashboard", description: "Protected dashboard endpoints" },
      { name: "Store", description: "Store management" },
      { name: "Branch", description: "Branch management" },
      { name: "Client", description: "Client records" },
      { name: "Employees", description: "Employee records" },
      { name: "Users", description: "User accounts" },
      { name: "Currency", description: "Currency settings" },
      { name: "Inventory", description: "Inventory products, history, and stock adjustments" },
      { name: "Client Orders", description: "Client orders and activity log" },
      { name: "Purchase Requests", description: "Purchase requests and activity log" },
      { name: "Sales Receiving", description: "Sales receiving and activity log" },
      { name: "Sales Orders", description: "Sales orders and activity log" },
      { name: "Purchase Orders", description: "Purchase order requests, activity, and receiving reports" },
      { name: "Shipment", description: "Shipment request, planning, dispatch, tracking, POD, returns, activity" },
      { name: "Admin", description: "Admin-only endpoints" },
      { name: "Vendor", description: "Vendor records" },
      { name: "Staff", description: "Staff records" },
      { name: "Driver", description: "Driver records and registration" },
      { name: "Driver Requests", description: "Driver requests and sync to the external system" },
      { name: "Vehicle", description: "Vehicle records" },
      { name: "Salesman", description: "Salesman records" },
      { name: "Products", description: "Product catalog, types, units, categories" },
      { name: "Ledger", description: "Ledger entries" },
      { name: "Procurement", description: "Procurement" },
      { name: "Warehouse", description: "Warehouse management" },
      { name: "User Roles", description: "Role management" },
      { name: "Sync", description: "Sync index" },
      { name: "Driver Dashboard", description: "Driver-facing dashboard" },
      { name: "Topbar", description: "Topbar / navigation data" },
    ],
  },
  // Glob pattern(s) telling swagger-jsdoc where to look for @swagger comments.
  // Adjust this path to match your actual routes folder location.
  apis: ["./routes/**/*.js"],
};

module.exports = swaggerJsdoc(options);