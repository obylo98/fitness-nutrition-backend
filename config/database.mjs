import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// Create a new pool using the connection string from environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Initialize database schema
async function initDatabase() {
  const client = await pool.connect();
  try {
    // First create users table
    await client.query(`
      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create user preferences table
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        theme VARCHAR(20) DEFAULT 'light',
        units VARCHAR(20) DEFAULT 'metric',
        notifications BOOLEAN DEFAULT false,
        workout_reminder TIME,
        nutrition_reminder TIME,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Workout logs table
      CREATE TABLE IF NOT EXISTS workout_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        duration INTEGER NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Workout exercises table
      CREATE TABLE IF NOT EXISTS workout_exercises (
        id SERIAL PRIMARY KEY,
        workout_id INTEGER REFERENCES workout_logs(id) ON DELETE CASCADE,
        exercise_name VARCHAR(255) NOT NULL,
        sets INTEGER NOT NULL,
        reps INTEGER NOT NULL,
        weight DECIMAL(5,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Create exercises table with all columns
      CREATE TABLE IF NOT EXISTS exercises (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        body_part VARCHAR(100),
        equipment VARCHAR(100),
        target VARCHAR(100),
        instructions TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Food logs table
      CREATE TABLE IF NOT EXISTS food_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        food_name VARCHAR(255) NOT NULL,
        serving_size VARCHAR(100) NOT NULL,
        calories INTEGER,
        protein DECIMAL(5,2),
        carbs DECIMAL(5,2),
        fats DECIMAL(5,2),
        logged_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Daily nutrition goals table
      CREATE TABLE IF NOT EXISTS daily_goals (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        calorie_goal INTEGER NOT NULL,
        protein_goal INTEGER NOT NULL,
        carbs_goal INTEGER NOT NULL,
        fats_goal INTEGER NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Meal templates table
      CREATE TABLE IF NOT EXISTS meal_templates (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        foods JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);
      CREATE INDEX IF NOT EXISTS idx_workout_logs_user_id ON workout_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_workout_logs_date ON workout_logs(date);
      CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout_id ON workout_exercises(workout_id);
      CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises USING gin(to_tsvector('english', name));
      CREATE INDEX IF NOT EXISTS idx_exercises_body_part ON exercises(body_part);
      CREATE INDEX IF NOT EXISTS idx_food_logs_user_id ON food_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_food_logs_logged_at ON food_logs(logged_at);
      CREATE INDEX IF NOT EXISTS idx_meal_templates_user_id ON meal_templates(user_id);
    `);

    // Add default exercises
    await client.query(`
      INSERT INTO exercises (name, body_part, equipment, target)
      VALUES 
        ('Push-up', 'chest', 'bodyweight', 'pectorals'),
        ('Pull-up', 'back', 'bodyweight', 'latissimus'),
        ('Squat', 'legs', 'bodyweight', 'quadriceps'),
        ('Bench Press', 'chest', 'barbell', 'pectorals'),
        ('Deadlift', 'back', 'barbell', 'posterior chain')
      ON CONFLICT (name) DO NOTHING;
    `);

    console.log('Database schema initialized successfully');
  } catch (error) {
    console.error('Error initializing database schema:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Test database connection
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('Database connection successful');
    client.release();
    return true;
  } catch (error) {
    console.error('Database connection error:', error);
    return false;
  }
}

export { pool, initDatabase, testConnection };
