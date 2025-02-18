import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../config/database.mjs";
import { authenticateToken } from "../middleware/auth.mjs";

const router = express.Router();

// Get user reminders
router.get("/reminders", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    // Add cache control headers
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const userId = req.user.id;

    // First check if user exists
    const userCheck = await client.query(
      'SELECT id FROM users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ 
        message: "User not found" 
      });
    }

    // Get user preferences with default values
    const prefsResult = await client.query(
      `SELECT 
        COALESCE(workout_reminder, null) as workout_reminder,
        COALESCE(nutrition_reminder, null) as nutrition_reminder
       FROM user_preferences
       WHERE user_id = $1`,
      [userId]
    );

    // Get user's last workout
    const lastWorkout = await client.query(
      `SELECT date 
       FROM workout_logs 
       WHERE user_id = $1 
       ORDER BY date DESC 
       LIMIT 1`,
      [userId]
    );

    // Get user's last food log
    const lastNutrition = await client.query(
      `SELECT logged_at 
       FROM food_logs 
       WHERE user_id = $1 
       ORDER BY logged_at DESC 
       LIMIT 1`,
      [userId]
    );

    // If no preferences exist, create default ones
    if (prefsResult.rows.length === 0) {
      await client.query(
        `INSERT INTO user_preferences (user_id)
         VALUES ($1)`,
        [userId]
      );
    }

    const preferences = prefsResult.rows[0] || {};

    res.json({
      workoutReminder: preferences.workout_reminder,
      nutritionReminder: preferences.nutrition_reminder,
      lastWorkout: lastWorkout.rows[0]?.date || null,
      lastNutrition: lastNutrition.rows[0]?.logged_at || null
    });

  } catch (error) {
    console.error("Error fetching reminders:", error);
    res.status(500).json({ 
      message: "Error fetching reminders",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
});

// Update user reminders
router.put("/reminders", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { workoutReminder, nutritionReminder } = req.body;

    await client.query(
      `INSERT INTO user_preferences (
         user_id, 
         workout_reminder, 
         nutrition_reminder
       ) 
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) 
       DO UPDATE SET 
         workout_reminder = $2,
         nutrition_reminder = $3,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, workoutReminder, nutritionReminder]
    );

    res.json({ message: "Reminders updated successfully" });
  } catch (error) {
    console.error("Error updating reminders:", error);
    res.status(500).json({ message: "Error updating reminders" });
  } finally {
    client.release();
  }
});

// Change password
router.put("/password", authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Get user's current password
    const user = await pool.query("SELECT password FROM users WHERE id = $1", [
      userId,
    ]);

    // Verify current password
    const validPassword = await bcrypt.compare(
      currentPassword,
      user.rows[0].password
    );

    if (!validPassword) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [
      hashedPassword,
      userId,
    ]);

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete account
router.delete("/account", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userId = req.user.id;

    // Delete user's data from related tables
    await client.query("DELETE FROM food_logs WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM workout_logs WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM daily_goals WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM user_preferences WHERE user_id = $1", [
      userId,
    ]);

    // Finally, delete the user
    await client.query("DELETE FROM users WHERE id = $1", [userId]);

    await client.query("COMMIT");
    res.json({ message: "Account deleted successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting account:", error);
    res.status(500).json({ message: "Error deleting account" });
  } finally {
    client.release();
  }
});

// Get user stats
router.get("/stats", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const stats = await calculateUserStats(userId);
    res.json(stats);
  } catch (error) {
    console.error("Error fetching user stats:", error);
    res.status(500).json({ message: "Error fetching user stats" });
  }
});

// Helper function to calculate user stats
async function calculateUserStats(userId) {
  const client = await pool.connect();
  try {
    // Get total workouts
    const workoutResult = await client.query(
      "SELECT COUNT(*) FROM workout_logs WHERE user_id = $1",
      [userId]
    );
    const totalWorkouts = parseInt(workoutResult.rows[0].count);

    // Get workout streak
    const streakResult = await client.query(
      `WITH consecutive_days AS (
        SELECT date,
               date - (ROW_NUMBER() OVER (ORDER BY date))::integer AS grp
        FROM (SELECT DISTINCT date::date FROM workout_logs WHERE user_id = $1) d
      )
      SELECT COUNT(*) + 1 AS streak
      FROM (
        SELECT grp, COUNT(*) AS days
        FROM consecutive_days
        GROUP BY grp
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) s`,
      [userId]
    );
    const streak = parseInt(streakResult.rows[0]?.streak || 0);

    // Get average daily calories
    const caloriesResult = await client.query(
      `SELECT AVG(daily_calories) as avg_calories
       FROM (
         SELECT date::date, SUM(calories) as daily_calories
         FROM food_logs
         WHERE user_id = $1
         GROUP BY date::date
       ) daily`,
      [userId]
    );
    const avgCalories = parseFloat(caloriesResult.rows[0]?.avg_calories || 0);

    // Get monthly stats
    const monthlyStats = await client.query(
      `SELECT 
         EXTRACT(MONTH FROM date) as month,
         COUNT(DISTINCT date) as active_days,
         COUNT(*) as total_workouts,
         SUM(duration) as total_duration
       FROM workout_logs
       WHERE user_id = $1
       AND date >= NOW() - INTERVAL '6 months'
       GROUP BY EXTRACT(MONTH FROM date)
       ORDER BY month DESC`,
      [userId]
    );

    // Get most common exercises
    const topExercises = await client.query(
      `SELECT 
         exercise_name,
         COUNT(*) as times_performed,
         AVG(COALESCE(weight, 0)) as avg_weight
       FROM workout_exercises we
       JOIN workout_logs wl ON we.workout_id = wl.id
       WHERE wl.user_id = $1
       GROUP BY exercise_name
       ORDER BY times_performed DESC
       LIMIT 5`,
      [userId]
    );

    return {
      totalWorkouts,
      streak,
      avgCalories,
      monthlyStats: monthlyStats.rows,
      topExercises: topExercises.rows,
      lastUpdated: new Date(),
    };
  } finally {
    client.release();
  }
}

// Get user profile
router.get("/profile", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    // Add cache control headers
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const userId = req.user.id;
    
    const result = await client.query(
      `SELECT 
        u.username,
        u.email,
        u.name,
        json_build_object(
          'theme', COALESCE(up.theme, 'light'),
          'units', COALESCE(up.units, 'metric'),
          'notifications', COALESCE(up.notifications, false),
          'workout_reminder', up.workout_reminder,
          'nutrition_reminder', up.nutrition_reminder
        ) as preferences
      FROM users u
      LEFT JOIN user_preferences up ON u.id = up.user_id
      WHERE u.id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({ 
      message: "Error fetching user profile",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
});

// Update user preferences
router.put("/preferences", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { theme, units, notifications, workout_reminder, nutrition_reminder } = req.body;

    await client.query(
      `INSERT INTO user_preferences (
        user_id, 
        theme, 
        units, 
        notifications, 
        workout_reminder, 
        nutrition_reminder,
        updated_at
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        theme = EXCLUDED.theme,
        units = EXCLUDED.units,
        notifications = EXCLUDED.notifications,
        workout_reminder = EXCLUDED.workout_reminder,
        nutrition_reminder = EXCLUDED.nutrition_reminder,
        updated_at = CURRENT_TIMESTAMP`,
      [
        userId, 
        theme || 'light',
        units || 'metric',
        notifications || false,
        workout_reminder,
        nutrition_reminder
      ]
    );

    res.json({ 
      message: "Preferences updated successfully",
      preferences: {
        theme,
        units,
        notifications,
        workout_reminder,
        nutrition_reminder
      }
    });

  } catch (error) {
    console.error("Error updating user preferences:", error);
    res.status(500).json({ 
      message: "Error updating preferences",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
});

// Update user profile
router.put("/profile", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { email, name } = req.body;

    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ 
          message: "Invalid email format" 
        });
      }

      // Check if email is already taken by another user
      const emailCheck = await client.query(
        "SELECT id FROM users WHERE email = $1 AND id != $2",
        [email, userId]
      );

      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ 
          message: "Email already in use" 
        });
      }
    }

    // Update user profile
    const result = await client.query(
      `UPDATE users 
       SET 
         email = COALESCE($1, email),
         name = COALESCE($2, name),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING username, email, name`,
      [email, name, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        message: "User not found" 
      });
    }

    res.json({
      message: "Profile updated successfully",
      user: result.rows[0]
    });

  } catch (error) {
    console.error("Error updating user profile:", error);
    res.status(500).json({ 
      message: "Error updating profile",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
});

export default router;
