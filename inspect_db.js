require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function inspect() {
  const { data, error } = await supabase.from('agent_status').select('*');
  if (error) {
    console.error('Error querying agent_status:', error);
  } else {
    console.log('Total status items:', data.length);
    console.log('Status:', JSON.stringify(data, null, 2));
  }
}

inspect();
