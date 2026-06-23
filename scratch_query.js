require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function queryBrain() {
  console.log('Querying ai_brain table...');
  try {
    const { data, error } = await supabase.from('ai_brain').select('*');
    if (error) throw error;
    console.log('BRAIN DATA:');
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error querying Supabase:', err.message);
  }
}

queryBrain();
