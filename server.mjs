import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initDatabase } from "./config/database.mjs";
import authRoutes from "./api/auth.mjs";
import nutritionRoutes from "./api/nutrition.mjs";
import workoutRoutes from "./api/workout.mjs";
import userRoutes from "./api/user.mjs";
import progressRoutes from "./api/progress.mjs";

// Load environment variables from the root .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// Configure CORS
const corsOptions = {
  origin: [
    'https://67b4fe234891eb00898b9747--mellow-tartufo-8c3fb5.netlify.app',
    'http://localhost:3000', 
    'https://mellow-tartufo-8c3fb5.netlify.app',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Apply CORS middleware
app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/nutrition", nutritionRoutes);
app.use("/api/workout", workoutRoutes);
app.use("/api/user", userRoutes);
app.use("/api/progress", progressRoutes);


app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Test route
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date() });
});


app.use((req, res) => {
  console.log(`404: ${req.method} ${req.url}`);
  res.status(404).json({ message: "Not Found" });
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    message: "Internal server error",
    details: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  // Serve frontend static files
  app.use(express.static(join(__dirname, '../dist')));
  
  // Handle client-side routing
  app.get('*', (req, res) => {
    if (!req.url.startsWith('/api')) {
      res.sendFile(join(__dirname, '../dist/index.html'));
    }
  });
}

// Initialize database and start server
async function startServer() {
  try {
    console.log("Connecting to database...");
    await initDatabase();
    console.log("Database connected successfully");

    app.listen(PORT, HOST, () => {
      console.log(`Server running at http://${HOST}:${PORT}`);
      console.log(`API endpoint: http://${HOST}:${PORT}/api`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
