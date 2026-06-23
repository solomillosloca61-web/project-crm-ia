require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const http = require('http');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  try {
    // 1. Fetch current settings from Supabase
    console.log('Fetching brain settings from Supabase...');
    const { data: dbSettings, error } = await supabase.from('ai_brain').select('*');
    if (error) {
      throw new Error(`Failed to fetch from Supabase: ${error.message}`);
    }

    const system_prompt_whatsapp = dbSettings.find(s => s.key === 'system_prompt_whatsapp')?.value || '';
    const knowledge_base = dbSettings.find(s => s.key === 'knowledge_base')?.value || '';
    const learned_facts = dbSettings.find(s => s.key === 'learned_facts')?.value || '';

    console.log('Values fetched successfully:');
    console.log(`- WhatsApp Prompt length: ${system_prompt_whatsapp.length}`);
    console.log(`- Knowledge Base length: ${knowledge_base.length}`);
    console.log(`- Learned Facts length: ${learned_facts.length}`);

    // 2. Send POST request to http://localhost:3000/api/brain
    const payload = JSON.stringify({
      system_prompt_whatsapp,
      knowledge_base,
      learned_facts
    });

    const auth = 'Basic ' + Buffer.from(`${process.env.CRM_USERNAME}:${process.env.CRM_PASSWORD}`).toString('base64');

    console.log('\nSending POST request to http://localhost:3000/api/brain to trigger Vapi sync...');
    const reqOptions = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/brain',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': auth
      }
    };

    const req = http.request(reqOptions, (res) => {
      console.log(`Response Status Code: ${res.statusCode}`);
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(responseBody);
          console.log('Server response:', JSON.stringify(json, null, 2));
        } catch (e) {
          console.log('Could not parse response JSON:', e.message);
          console.log('Raw response:', responseBody);
        }
      });
    });

    req.on('error', (err) => {
      console.error('Connection error to Next.js server:', err.message);
      console.log('Please ensure that the Next.js CRM dev server is running on port 3000.');
    });

    req.write(payload);
    req.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
