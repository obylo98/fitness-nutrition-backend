import express from "express";
import { pool } from "../config/database.mjs";
import { authenticateToken } from "../middleware/auth.mjs";
import fetch from "node-fetch";
import { validateDateRange } from '../middleware/validation.mjs';

const router = express.Router();

// Search exercises from ExerciseDB API
router.get("/exercises/search", authenticateToken, async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query || query.length < 2) {
      return res.status(400).json({
        message: "Search query must be at least 2 characters"
      });
    }

    // Check for API key
    if (!process.env.RAPIDAPI_KEY) {
      console.error('RapidAPI key not found in environment variables');
      throw new Error('Exercise search is temporarily unavailable');
    }

    // First try searching by name
    const response = await fetch(
      `https://exercisedb.p.rapidapi.com/exercises/name/${encodeURIComponent(query.toLowerCase())}`,
      {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
          'X-RapidAPI-Host': process.env.RAPIDAPI_HOST,
          'Accept': 'application/json'
        }
      }
    );

    // If name search fails, try searching by target muscle
    if (response.status === 422) {
      const targetResponse = await fetch(
        `https://exercisedb.p.rapidapi.com/exercises/target/${encodeURIComponent(query.toLowerCase())}`,
        {
          method: 'GET',
          headers: {
            'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
            'X-RapidAPI-Host': process.env.RAPIDAPI_HOST,
            'Accept': 'application/json'
          }
        }
      );

      if (!targetResponse.ok) {
        return res.json([]); // Return empty array if no results found
      }

      const exercises = await targetResponse.json();
      return res.json(exercises);
    }

    if (!response.ok) {
      console.error('ExerciseDB API error:', {
        status: response.status,
        statusText: response.statusText
      });
      
      return res.json([]); // Return empty array if no results found
    }

    const exercises = await response.json();
    res.json(exercises);

  } catch (error) {
    console.error("Error searching exercises:", error);
    res.status(500).json({ 
      message: "Failed to search exercises",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Add an endpoint to list all exercises
router.get("/exercises", authenticateToken, async (req, res) => {
  try {
    const response = await fetch(
      'https://exercisedb.p.rapidapi.com/exercises',
      {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
          'X-RapidAPI-Host': process.env.RAPIDAPI_HOST,
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`ExerciseDB API error: ${response.status}`);
    }

    const exercises = await response.json();
    res.json(exercises);

  } catch (error) {
    console.error("Error fetching exercises:", error);
    res.status(500).json({ 
      message: "Failed to fetch exercises",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Add an endpoint to get exercise by name
router.get("/exercises/name/:name", authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;
    
    const response = await fetch(
      `https://exercisedb.p.rapidapi.com/exercises/name/${encodeURIComponent(name)}`,
      {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
          'X-RapidAPI-Host': process.env.RAPIDAPI_HOST,
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`ExerciseDB API error: ${response.status}`);
    }

    const exercises = await response.json();
    res.json(exercises);

  } catch (error) {
    console.error("Error searching exercises by name:", error);
    res.status(500).json({ 
      message: "Failed to search exercises",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Add an endpoint to get exercise details
router.get("/exercises/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const response = await fetch(
      `https://exercisedb.p.rapidapi.com/exercises/exercise/${id}`,
      {
        headers: {
          "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
          "X-RapidAPI-Host": process.env.RAPIDAPI_HOST,
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch exercise details");
    }

    const exercise = await response.json();
    
    res.json({
      id: exercise.id,
      name: exercise.name,
      bodyPart: exercise.bodyPart,
      equipment: exercise.equipment,
      target: exercise.target,
      gifUrl: exercise.gifUrl,
      instructions: exercise.instructions
    });
  } catch (error) {
    console.error("Error fetching exercise details:", error);
    res.status(500).json({ 
      message: "Error fetching exercise details",
      error: error.message 
    });
  }
});

// Log a new workout
router.post("/log", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { name, date, duration, notes, exercises } = req.body;

    console.log('Received workout data:', {
      name,
      date,
      duration,
      notesLength: notes?.length,
      exercisesCount: exercises?.length,
      exercises
    });

    // Validate required fields with more detailed errors
    if (!name) {
      return res.status(400).json({
        message: "Invalid workout name",
        details: "Workout name is required"
      });
    }
    if (typeof name !== 'string') {
      return res.status(400).json({
        message: "Invalid workout name",
        details: `Workout name must be a string, received ${typeof name}`
      });
    }

    if (!date) {
      return res.status(400).json({
        message: "Invalid date",
        details: "Date is required"
      });
    }
    if (!Date.parse(date)) {
      return res.status(400).json({
        message: "Invalid date",
        details: `Invalid date format: ${date}`
      });
    }

    if (!duration) {
      return res.status(400).json({
        message: "Invalid duration",
        details: "Duration is required"
      });
    }
    if (typeof duration !== 'number') {
      return res.status(400).json({
        message: "Invalid duration",
        details: `Duration must be a number, received ${typeof duration}`
      });
    }
    if (duration <= 0) {
      return res.status(400).json({
        message: "Invalid duration",
        details: "Duration must be greater than 0"
      });
    }

    // Validate exercises array
    if (!exercises) {
      return res.status(400).json({
        message: "Invalid exercises",
        details: "Exercises array is required"
      });
    }
    if (!Array.isArray(exercises)) {
      return res.status(400).json({
        message: "Invalid exercises",
        details: `Exercises must be an array, received ${typeof exercises}`
      });
    }
    if (exercises.length === 0) {
      return res.status(400).json({
        message: "Invalid exercises",
        details: "At least one exercise is required"
      });
    }

    // Validate each exercise
    for (const [index, exercise] of exercises.entries()) {
      const validationErrors = [];
      
      if (!exercise.name || typeof exercise.name !== 'string') {
        validationErrors.push('name is required and must be a string');
      }
      
      if (!exercise.sets || typeof exercise.sets !== 'number' || exercise.sets <= 0) {
        validationErrors.push('sets must be a positive number');
      }
      
      if (!exercise.reps || typeof exercise.reps !== 'number' || exercise.reps <= 0) {
        validationErrors.push('reps must be a positive number');
      }
      
      if (exercise.weight !== null && (typeof exercise.weight !== 'number' || exercise.weight < 0)) {
        validationErrors.push('weight must be a non-negative number or null');
      }

      if (validationErrors.length > 0) {
        return res.status(400).json({
          message: `Invalid exercise at index ${index}`,
          details: validationErrors.join(', '),
          exercise: exercise
        });
      }
    }

    console.log('Attempting to log workout:', {
      userId,
      name,
      date,
      duration,
      exerciseCount: exercises.length,
      exercises: exercises.map(e => ({
        name: e.name,
        sets: e.sets,
        reps: e.reps,
        weight: e.weight
      }))
    });

    await client.query('BEGIN');

    // Insert workout log
    const workoutResult = await client.query(
      `INSERT INTO workout_logs (
        user_id, 
        name, 
        date, 
        duration, 
        notes
      ) VALUES ($1, $2, $3, $4, $5) 
      RETURNING id`,
      [userId, name, date, duration, notes]
    );

    const workoutId = workoutResult.rows[0].id;

    // Insert exercises with better error handling
    for (const [index, exercise] of exercises.entries()) {
      try {
        await client.query(
          `INSERT INTO workout_exercises (
            workout_id,
            exercise_name,
            sets,
            reps,
            weight
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            workoutId,
            exercise.name,
            exercise.sets,
            exercise.reps,
            exercise.weight || null
          ]
        );
      } catch (exerciseError) {
        console.error(`Error inserting exercise at index ${index}:`, exerciseError);
        throw new Error(`Failed to save exercise "${exercise.name}": ${exerciseError.message}`);
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: "Workout logged successfully",
      workoutId
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error logging workout:", {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    
    res.status(500).json({ 
      message: "Failed to log workout",
      details: process.env.NODE_ENV === 'development' ? 
        `${error.message} (See server logs for more details)` : 
        'An unexpected error occurred'
    });
  } finally {
    client.release();
  }
});

// Get workout history
router.get("/history", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const workouts = await client.query(
      `SELECT 
        wl.id,
        wl.name,
        wl.date,
        wl.duration,
        wl.notes,
        json_agg(
          json_build_object(
            'name', we.exercise_name,
            'sets', we.sets,
            'reps', we.reps,
            'weight', we.weight
          )
        ) as exercises
      FROM workout_logs wl
      LEFT JOIN workout_exercises we ON wl.id = we.workout_id
      WHERE wl.user_id = $1
      GROUP BY wl.id
      ORDER BY wl.date DESC`,
      [userId]
    );

    res.json(workouts.rows);

  } catch (error) {
    console.error("Error fetching workout history:", error);
    res.status(500).json({ 
      message: "Failed to fetch workout history",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
});

// Get user's workouts
router.get("/logs", authenticateToken, validateDateRange, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    let query = `
      SELECT 
        wl.id,
        wl.date,
        wl.duration,
        wl.calories,
        wl.notes,
        json_agg(
          json_build_object(
            'exercise_name', we.exercise_name,
            'sets', we.sets,
            'reps', we.reps,
            'weight', we.weight,
            'completed_sets', we.completed_sets
          )
        ) as exercises
      FROM workout_logs wl
      LEFT JOIN workout_exercises we ON wl.id = we.workout_id
      WHERE wl.user_id = $1
    `;

    const queryParams = [userId];
    let paramCount = 2;

    if (startDate && startDate.trim() !== '') {
      query += ` AND wl.date >= $${paramCount}`;
      queryParams.push(startDate);
      paramCount++;
    }

    if (endDate && endDate.trim() !== '') {
      query += ` AND wl.date <= $${paramCount}`;
      queryParams.push(endDate);
      paramCount++;
    }

    query += `
      GROUP BY wl.id
      ORDER BY wl.date DESC
    `;

    const result = await client.query(query, queryParams);

    res.json(result.rows.map(row => ({
      ...row,
      exercises: row.exercises[0] === null ? [] : row.exercises
    })));

  } catch (error) {
    console.error("Error fetching workout logs:", error);
    res.status(500).json({ 
      message: "Error fetching workout logs",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
});

export default router;