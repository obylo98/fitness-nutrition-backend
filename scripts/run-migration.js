import { pool } from '../config/database.mjs';
import fs from 'fs';
import path from 'path';

async function runMigration() {
  const client = await pool.connect();
  try {
    // Read and execute the migration SQL
    const sql = fs.readFileSync(
      path.resolve('migrations/add_email_to_users.sql'), 
      'utf8'
    );
    await client.query(sql);
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    client.release();
  }
}

runMigration(); 