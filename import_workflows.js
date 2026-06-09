// import_workflows.js
// Importa y activa los workflows de n8n en el orden correcto via API REST

const http = require('http');
const fs = require('fs');
const path = require('path');

const N8N_BASE = 'http://localhost:5678';
const N8N_USER = 'admin@mpsalud.com'; // Usuario por defecto n8n
const N8N_PASS = 'mpsalud2026';       // Contraseña por defecto n8n

// Orden correcto de importación
const WORKFLOW_FILES = [
  'n8n_workflow_mp_salud___antena_receptora_vapi.json',
  'n8n_workflow_mp_salud___valentina__nuevo_disparador_.json',
  'n8n_workflow_mp_salud___prospecci_n_inteligente.json',
  'n8n_workflow_mp_salud___produccion_final.json',
];

function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getApiKey() {
  // Intentar obtener API key via login
  const loginBody = JSON.stringify({ email: N8N_USER, password: N8N_PASS });
  const result = await makeRequest({
    hostname: 'localhost',
    port: 5678,
    path: '/rest/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginBody)
    }
  }, loginBody);

  if (result.status === 200 && result.body?.data?.token) {
    return { type: 'cookie', value: result.body.data.token };
  }
  
  console.log('Login response:', result.status, JSON.stringify(result.body).substring(0, 200));
  return null;
}

async function importWorkflow(wfPath, authHeader) {
  const wfContent = fs.readFileSync(wfPath, 'utf8');
  const wfJson = JSON.parse(wfContent);
  
  // n8n API para crear workflow
  const body = JSON.stringify(wfJson);
  const result = await makeRequest({
    hostname: 'localhost',
    port: 5678,
    path: '/rest/workflows',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...authHeader
    }
  }, body);
  
  return result;
}

async function activateWorkflow(id, authHeader) {
  const result = await makeRequest({
    hostname: 'localhost',
    port: 5678,
    path: `/rest/workflows/${id}/activate`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': 0,
      ...authHeader
    }
  });
  return result;
}

async function listWorkflows(authHeader) {
  const result = await makeRequest({
    hostname: 'localhost',
    port: 5678,
    path: '/rest/workflows',
    method: 'GET',
    headers: authHeader
  });
  return result;
}

async function main() {
  console.log('🔐 Conectando con n8n...');
  
  const auth = await getApiKey();
  if (!auth) {
    console.error('❌ No se pudo autenticar en n8n. Verifica usuario/contraseña.');
    console.log('\n📋 Intenta verificar las credenciales de n8n en:');
    console.log('   http://localhost:5678');
    process.exit(1);
  }
  
  const authHeader = auth.type === 'cookie' 
    ? { 'Cookie': `n8n-auth=${auth.value}` }
    : { 'X-N8N-API-KEY': auth.value };

  console.log('✅ Autenticado en n8n\n');

  // Listar workflows existentes
  console.log('📋 Verificando workflows existentes...');
  const existing = await listWorkflows(authHeader);
  if (existing.status === 200) {
    const count = existing.body?.data?.length || 0;
    console.log(`   Workflows actuales: ${count}`);
    if (count > 0) {
      existing.body.data.forEach(wf => {
        console.log(`   - [${wf.active ? '✅ ACTIVO' : '⏸  inactivo'}] ${wf.name} (id: ${wf.id})`);
      });
    }
  }

  console.log('\n🚀 Importando workflows en orden...\n');

  for (const file of WORKFLOW_FILES) {
    const fullPath = path.join(__dirname, file);
    if (!fs.existsSync(fullPath)) {
      console.log(`⚠️  Archivo no encontrado, saltando: ${file}`);
      continue;
    }

    const wfName = JSON.parse(fs.readFileSync(fullPath, 'utf8')).name;
    console.log(`📥 Importando: ${wfName}`);

    const result = await importWorkflow(fullPath, authHeader);
    
    if (result.status === 200 || result.status === 201) {
      const wfId = result.body?.data?.id || result.body?.id;
      console.log(`   ✅ Importado con ID: ${wfId}`);
      
      // Activar el workflow
      if (wfId) {
        const activateResult = await activateWorkflow(wfId, authHeader);
        if (activateResult.status === 200) {
          console.log(`   ✅ ACTIVADO correctamente\n`);
        } else {
          console.log(`   ⚠️  No se pudo activar automáticamente (status ${activateResult.status})`);
          console.log(`      Activalo manualmente en n8n desde: http://localhost:5678\n`);
        }
      }
    } else {
      console.log(`   ❌ Error al importar (status ${result.status}): ${JSON.stringify(result.body).substring(0, 200)}\n`);
    }
    
    // Pequeña pausa entre imports
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n📊 Estado final de workflows:');
  const finalList = await listWorkflows(authHeader);
  if (finalList.status === 200) {
    finalList.body.data.forEach(wf => {
      console.log(`   [${wf.active ? '✅ ACTIVO' : '⏸  inactivo'}] ${wf.name}`);
    });
  }
  
  console.log('\n🎉 Proceso completado.');
}

main().catch(e => {
  console.error('Error fatal:', e.message);
  process.exit(1);
});
