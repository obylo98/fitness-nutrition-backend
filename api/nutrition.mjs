import express from "express";
import { pool } from "../config/database.mjs";
import { authenticateToken } from "../middleware/auth.mjs";
import fetch from "node-fetch";

const router = express.Router();

// Nutritionix API configuration
const NUTRITIONIX_APP_ID = process.env.NUTRITIONIX_APP_ID;
const NUTRITIONIX_API_KEY = process.env.NUTRITIONIX_API_KEY;
const NUTRITIONIX_BASE_URL = "https://trackapi.nutritionix.com/v2";

// Add these helper functions at the top of the file
function applyDietaryRestrictions(query, restrictions) {
  const dietaryFilters = {
    vegetarian: "AND NOT foods.category = ANY($1)",
    vegan: "AND NOT foods.category = ANY($2)",
    "gluten-free": "AND NOT foods.contains_gluten = true",
    "dairy-free": "AND NOT foods.contains_dairy = true",
  };

  return restrictions.reduce((sql, restriction) => {
    return sql + (dietaryFilters[restriction] || "");
  }, query);
}

// Add this function to update food usage statistics
async function incrementFoodUsage(foodId, client) {
  try {
    await client.query(
      `UPDATE foods 
       SET times_logged = times_logged + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [foodId]
    );
  } catch (error) {
    console.error("Error updating food usage:", error);
  }
}

// Search food items using Nutritionix API
router.get("/search", authenticateToken, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ message: "Query parameter is required" });
    }

    // Call Nutritionix instant search endpoint
    const response = await fetch(`${NUTRITIONIX_BASE_URL}/search/instant?query=${encodeURIComponent(query)}`, {
      headers: {
        "x-app-id": NUTRITIONIX_APP_ID,
        "x-app-key": NUTRITIONIX_API_KEY,
        "x-remote-user-id": "0"  // Required by Nutritionix for tracking
      }
    });

    if (!response.ok) {
      throw new Error(`Nutritionix API error: ${response.status}`);
    }

    const data = await response.json();

    // Add attribution requirement
    const searchResults = {
      ...data,
      attribution: {
        text: "Powered by Nutritionix",
        image: "https://www.nutritionix.com/images/attribute_logo_white.png"
      }
    };

    res.json(searchResults);
  } catch (error) {
    console.error("Error searching foods:", error);
    res.status(500).json({ message: "Error searching foods", error: error.message });
  }
});

// Get detailed nutrients for a food
router.post("/nutrients", authenticateToken, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ message: "Query is required" });
    }

    const response = await fetch(`${NUTRITIONIX_BASE_URL}/natural/nutrients`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-app-id": NUTRITIONIX_APP_ID,
        "x-app-key": NUTRITIONIX_API_KEY,
        "x-remote-user-id": "0"
      },
      body: JSON.stringify({
        query,
        timezone: "US/Eastern"
      })
    });

    if (!response.ok) {
      throw new Error(`Nutritionix API error: ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error getting nutrients:", error);
    res.status(500).json({ message: "Error getting nutrients", error: error.message });
  }
});

// Log food item
router.post("/log", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { food_name, serving_size, nutrients } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!food_name || !serving_size || !nutrients) {
      return res.status(400).json({ 
        message: "Missing required fields: food_name, serving_size, or nutrients" 
      });
    }

    const result = await client.query(
      `INSERT INTO food_logs (
        user_id, 
        food_name, 
        serving_size,
        calories, 
        protein, 
        carbs, 
        fats,
        logged_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP) 
      RETURNING *`,
      [
        userId,
        food_name,
        serving_size,
        Math.round(nutrients.calories || 0),
        Math.round(nutrients.protein || 0),
        Math.round(nutrients.totalCarbs || 0),
        Math.round(nutrients.totalFat || 0)
      ]
    );

    await client.query("COMMIT");
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error logging food:", error);
    res.status(500).json({ 
      message: "Error logging food", 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// Get user's food logs for a specific date
router.get("/logs/:date", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const date = req.params.date;

    const result = await pool.query(
      `SELECT * FROM food_logs 
       WHERE user_id = $1 
       AND DATE(logged_at) = $2
       ORDER BY logged_at DESC`,
      [userId, date]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching food logs:", error);
    res.status(500).json({ message: "Error fetching food logs" });
  }
});

// Get user's nutrition goals
router.get("/goals", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await pool.query(
      `SELECT 
        calorie_goal,
        protein_goal,
        carbs_goal,
        fats_goal
       FROM daily_goals 
       WHERE user_id = $1`,
      [userId]
    );

    // If no goals are set, return default values
    if (result.rows.length === 0) {
      return res.json({
        calorie_goal: 2000,
        protein_goal: 50,
        carbs_goal: 250,
        fats_goal: 70
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching nutrition goals:", error);
    res.status(500).json({ 
      message: "Error fetching nutrition goals",
      error: error.message 
    });
  }
});

// Set daily nutrition goals
router.post("/goals", authenticateToken, async (req, res) => {
  try {
    const { calorie_goal, protein_goal, carbs_goal, fats_goal } = req.body;
    const userId = req.user.id;

    // Validate the input
    if (!calorie_goal || !protein_goal || !carbs_goal || !fats_goal) {
      return res.status(400).json({ message: "All goals are required" });
    }

    const result = await pool.query(
      `INSERT INTO daily_goals 
       (user_id, calorie_goal, protein_goal, carbs_goal, fats_goal)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) 
       DO UPDATE SET 
         calorie_goal = $2,
         protein_goal = $3,
         carbs_goal = $4,
         fats_goal = $5,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, calorie_goal, protein_goal, carbs_goal, fats_goal]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error setting goals:", error);
    res.status(500).json({ 
      message: "Error setting goals",
      error: error.message 
    });
  }
});

// Delete a food log entry
router.delete("/logs/:id", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const logId = req.params.id;
    const userId = req.user.id;

    // First check if the log exists and belongs to the user
    const checkOwnership = await client.query(
      "SELECT user_id FROM food_logs WHERE id = $1",
      [logId]
    );

    if (checkOwnership.rows.length === 0) {
      return res.status(404).json({ 
        message: "Food log entry not found" 
      });
    }

    if (checkOwnership.rows[0].user_id !== userId) {
      return res.status(403).json({ 
        message: "Unauthorized to delete this food log entry" 
      });
    }

    // Delete the food log
    await client.query(
      "DELETE FROM food_logs WHERE id = $1 AND user_id = $2",
      [logId, userId]
    );

    res.json({ 
      message: "Food log entry deleted successfully" 
    });

  } catch (error) {
    console.error("Error deleting food log:", error);
    res.status(500).json({ 
      message: "Failed to delete food log entry",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
});

// Get nutrition recommendations
router.get("/recommendations", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user profile data for calculations
    const userProfile = await pool.query(
      `SELECT * FROM user_preferences WHERE user_id = $1`,
      [userId]
    );

    if (!userProfile.rows.length) {
      return res.status(400).json({ message: "User profile not found" });
    }

    // Calculate recommendations
    const recommendations = calculateNutritionRecommendations(
      userProfile.rows[0]
    );
    res.json(recommendations);
  } catch (error) {
    console.error("Error getting recommendations:", error);
    res.status(500).json({ message: "Error getting recommendations" });
  }
});

// Save meal template
router.post("/templates", authenticateToken, async (req, res) => {
  try {
    const { name, foods } = req.body;
    const userId = req.user.id;

    const result = await pool.query(
      `INSERT INTO meal_templates (user_id, name, foods)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, name, JSON.stringify(foods)]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error saving template:", error);
    res.status(500).json({ message: "Error saving template" });
  }
});

// Get meal templates
router.get("/templates", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const templates = await pool.query(
      `SELECT * FROM meal_templates WHERE user_id = $1`,
      [userId]
    );
    res.json(templates.rows);
  } catch (error) {
    console.error("Error getting templates:", error);
    res.status(500).json({ message: "Error getting templates" });
  }
});

// Get all templates for a user
router.get("/templates", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await pool.query(
      `SELECT id, name, foods, created_at 
       FROM meal_templates 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching templates:", error);
    res.status(500).json({ 
      message: "Error fetching templates",
      error: error.message 
    });
  }
});

// Get a specific template
router.get("/templates/:id", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const templateId = req.params.id;
    
    const result = await pool.query(
      `SELECT id, name, foods, created_at 
       FROM meal_templates 
       WHERE id = $1 AND user_id = $2`,
      [templateId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Template not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching template:", error);
    res.status(500).json({ 
      message: "Error fetching template",
      error: error.message 
    });
  }
});

// Create a new template
router.post("/templates", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { name, foods } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!name || !foods || !Array.isArray(foods)) {
      return res.status(400).json({ 
        message: "Name and foods array are required" 
      });
    }

    const result = await client.query(
      `INSERT INTO meal_templates (user_id, name, foods)
       VALUES ($1, $2, $3)
       RETURNING id, name, foods, created_at`,
      [userId, name, JSON.stringify(foods)]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error creating template:", error);
    res.status(500).json({ 
      message: "Error creating template",
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// Delete a template
router.delete("/templates/:id", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userId = req.user.id;
    const templateId = req.params.id;

    // Check if template exists and belongs to user
    const checkResult = await client.query(
      `SELECT id FROM meal_templates 
       WHERE id = $1 AND user_id = $2`,
      [templateId, userId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: "Template not found" });
    }

    // Delete the template
    await client.query(
      `DELETE FROM meal_templates 
       WHERE id = $1 AND user_id = $2`,
      [templateId, userId]
    );

    await client.query('COMMIT');
    res.json({ message: "Template deleted successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error deleting template:", error);
    res.status(500).json({ 
      message: "Error deleting template",
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// Update a template
router.put("/templates/:id", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { name, foods } = req.body;
    const userId = req.user.id;
    const templateId = req.params.id;

    // Validate input
    if (!name || !foods || !Array.isArray(foods)) {
      return res.status(400).json({ 
        message: "Name and foods array are required" 
      });
    }

    // Check if template exists and belongs to user
    const checkResult = await client.query(
      `SELECT id FROM meal_templates 
       WHERE id = $1 AND user_id = $2`,
      [templateId, userId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: "Template not found" });
    }

    // Update the template
    const result = await client.query(
      `UPDATE meal_templates 
       SET name = $1, foods = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND user_id = $4
       RETURNING id, name, foods, created_at, updated_at`,
      [name, JSON.stringify(foods), templateId, userId]
    );

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error updating template:", error);
    res.status(500).json({ 
      message: "Error updating template",
      error: error.message 
    });
  } finally {
    client.release();
  }
});

export default router;
