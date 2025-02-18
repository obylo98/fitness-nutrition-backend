import express from "express";
import { pool } from "../config/database.mjs";
import { authenticateToken } from "../middleware/auth.mjs";

const router = express.Router();

router.get("/", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { range = "month" } = req.query;

    let timeFilter;
    switch (range) {
      case "week":
        timeFilter = "AND date >= NOW() - INTERVAL '7 days'";
        break;
      case "month":
        timeFilter = "AND date >= NOW() - INTERVAL '30 days'";
        break;
      case "year":
        timeFilter = "AND date >= NOW() - INTERVAL '365 days'";
        break;
      default:
        timeFilter = "AND date >= NOW() - INTERVAL '30 days'";
    }

    // Check if tables exist first
    const tablesExist = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'workout_logs'
      ) as workout_exists,
      EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'food_logs'
      ) as food_exists
    `);

    // If tables don't exist, return empty data structure
    if (
      !tablesExist.rows[0].workout_exists ||
      !tablesExist.rows[0].food_exists
    ) {
      return res.json({
        workouts: {
          dates: [],
          durations: [],
          counts: [],
        },
        nutrition: {
          dates: [],
          calories: [],
          protein: [],
          carbs: [],
          fats: [],
        },
        metrics: {
          totalWorkouts: 0,
          avgDuration: 0,
          totalCalories: 0,
          avgCalories: 0,
        },
      });
    }

    // Get workout data
    const workouts = await client.query(
      `SELECT 
         date::date,
         COUNT(*) as workout_count,
         SUM(duration) as total_duration
       FROM workout_logs
       WHERE user_id = $1 ${timeFilter}
       GROUP BY date::date
       ORDER BY date::date`,
      [userId]
    );

    // Get nutrition data
    const nutrition = await client.query(
      `SELECT 
         date::date,
         SUM(calories) as total_calories,
         SUM(protein) as total_protein,
         SUM(carbs) as total_carbs,
         SUM(fats) as total_fats
       FROM food_logs
       WHERE user_id = $1 ${timeFilter}
       GROUP BY date::date
       ORDER BY date::date`,
      [userId]
    );

    // If no data found, return empty data structure
    if (workouts.rows.length === 0 && nutrition.rows.length === 0) {
      return res.json({
        workouts: {
          dates: [],
          durations: [],
          counts: [],
        },
        nutrition: {
          dates: [],
          calories: [],
          protein: [],
          carbs: [],
          fats: [],
        },
        metrics: {
          totalWorkouts: 0,
          avgDuration: 0,
          totalCalories: 0,
          avgCalories: 0,
        },
      });
    }

    // Calculate metrics
    const metrics = {
      totalWorkouts: workouts.rows.reduce(
        (sum, row) => sum + parseInt(row.workout_count || 0),
        0
      ),
      avgDuration: workouts.rows.length
        ? workouts.rows.reduce(
            (sum, row) => sum + parseInt(row.total_duration || 0),
            0
          ) / workouts.rows.length
        : 0,
      totalCalories: nutrition.rows.reduce(
        (sum, row) => sum + parseInt(row.total_calories || 0),
        0
      ),
      avgCalories: nutrition.rows.length
        ? nutrition.rows.reduce(
            (sum, row) => sum + parseInt(row.total_calories || 0),
            0
          ) / nutrition.rows.length
        : 0,
    };

    // Format dates for charts
    const dates = [
      ...new Set([
        ...workouts.rows.map((row) => row.date),
        ...nutrition.rows.map((row) => row.date),
      ]),
    ].sort();

    const response = {
      workouts: {
        dates: dates.map((d) => d.toISOString().split("T")[0]),
        durations: dates.map((date) => {
          const workout = workouts.rows.find(
            (w) =>
              w.date.toISOString().split("T")[0] ===
              date.toISOString().split("T")[0]
          );
          return workout ? parseInt(workout.total_duration) || 0 : 0;
        }),
        counts: dates.map((date) => {
          const workout = workouts.rows.find(
            (w) =>
              w.date.toISOString().split("T")[0] ===
              date.toISOString().split("T")[0]
          );
          return workout ? parseInt(workout.workout_count) || 0 : 0;
        }),
      },
      nutrition: {
        dates: dates.map((d) => d.toISOString().split("T")[0]),
        calories: dates.map((date) => {
          const log = nutrition.rows.find(
            (n) =>
              n.date.toISOString().split("T")[0] ===
              date.toISOString().split("T")[0]
          );
          return log ? parseInt(log.total_calories) || 0 : 0;
        }),
        protein: dates.map((date) => {
          const log = nutrition.rows.find(
            (n) =>
              n.date.toISOString().split("T")[0] ===
              date.toISOString().split("T")[0]
          );
          return log ? parseFloat(log.total_protein) || 0 : 0;
        }),
        carbs: dates.map((date) => {
          const log = nutrition.rows.find(
            (n) =>
              n.date.toISOString().split("T")[0] ===
              date.toISOString().split("T")[0]
          );
          return log ? parseFloat(log.total_carbs) || 0 : 0;
        }),
        fats: dates.map((date) => {
          const log = nutrition.rows.find(
            (n) =>
              n.date.toISOString().split("T")[0] ===
              date.toISOString().split("T")[0]
          );
          return log ? parseFloat(log.total_fats) || 0 : 0;
        }),
      },
      metrics,
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching progress:", error);
    // Instead of sending a 500 error, send empty data
    res.json({
      workouts: {
        dates: [],
        durations: [],
        counts: [],
      },
      nutrition: {
        dates: [],
        calories: [],
        protein: [],
        carbs: [],
        fats: [],
      },
      metrics: {
        totalWorkouts: 0,
        avgDuration: 0,
        totalCalories: 0,
        avgCalories: 0,
      },
    });
  } finally {
    client.release();
  }
});

export default router;
