const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qaeiuyymntnwrnedyiag.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = '***REMOVED_SERVICE_ROLE_KEY***';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data, error } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error('Error fetching rules:', error);
  } else {
    console.log('Active rules:', data);
  }
}

main();
