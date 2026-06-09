// generate_pdf.js
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const mdPath = 'C:\\Users\\lucia\\Desktop\\CRM_IA_Master_Blueprint.md';
const htmlPath = 'C:\\Users\\lucia\\Desktop\\temp_blueprint.html';
const pdfPath = 'C:\\Users\\lucia\\Desktop\\CRM_IA_Master_Blueprint.pdf';

if (!fs.existsSync(mdPath)) {
  console.error('❌ Error: No se encontró el archivo markdown en el Escritorio.');
  process.exit(1);
}

const mdContent = fs.readFileSync(mdPath, 'utf8');

// Función para escapar HTML de forma segura
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Función para formatear estilos inline (Negrita, Código en línea, Enlaces)
function parseInline(text) {
  let escaped = escapeHtml(text);
  // Negrita: **texto**
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Código en línea: `código`
  escaped = escaped.replace(/`(.*?)`/g, '<code class="inline-code">$1</code>');
  return escaped;
}

// Resaltador de sintaxis para bloques de código
function highlightCode(code, lang) {
  const lines = code.split('\n');
  if (lang === 'env') {
    return lines.map(line => {
      // Comentarios en env
      if (line.trim().startsWith('#')) {
        return `<span class="code-comment">${escapeHtml(line)}</span>`;
      }
      const eqIdx = line.indexOf('=');
      if (eqIdx !== -1) {
        const key = line.slice(0, eqIdx);
        const val = line.slice(eqIdx); // incluye el '='
        return `<span class="code-key">${escapeHtml(key)}</span><span class="code-operator">=</span><span class="code-value">${escapeHtml(val.slice(1))}</span>`;
      }
      return escapeHtml(line);
    }).join('\n');
  }
  if (lang === 'text') {
    return lines.map(line => {
      const commentIdx = line.indexOf('&lt;--');
      let mainLine = escapeHtml(line);
      let commentPart = '';
      if (commentIdx !== -1) {
        // Como ya escapamos, buscamos la versión escapada en el texto original antes de escapar de nuevo
        const rawLine = line;
        const rawCommentIdx = rawLine.indexOf('&lt;--');
        mainLine = escapeHtml(rawLine.slice(0, rawCommentIdx));
        commentPart = `<span class="code-comment">${escapeHtml(rawLine.slice(rawCommentIdx))}</span>`;
      } else {
        const arrowIdx = line.indexOf('<--');
        if (arrowIdx !== -1) {
          mainLine = escapeHtml(line.slice(0, arrowIdx));
          commentPart = `<span class="code-comment">${escapeHtml(line.slice(arrowIdx))}</span>`;
        }
      }
      // Estilizar la estructura del árbol de directorios
      mainLine = mainLine.replace(/(├──|└──|│   |├── |└── )/g, '<span class="code-tree">$1</span>');
      // Carpetas terminadas en /
      mainLine = mainLine.replace(/([\w\.\-*_]+\/)/g, '<span class="code-folder">$1</span>');
      return mainLine + commentPart;
    }).join('\n');
  }
  return lines.map(line => escapeHtml(line)).join('\n');
}

// Parser completo de Markdown a HTML estructurado
function parseMarkdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  let html = '';
  let inCode = false;
  let codeLang = '';
  let codeBlock = [];
  let listStack = []; // Pila para rastrear 'ul' y 'ol' abiertos

  function closeLists(targetDepth = 0) {
    while (listStack.length > targetDepth) {
      const type = listStack.pop();
      html += `</${type}>\n`;
    }
  }

  // Detectamos y creamos el banner del encabezado con el primer título y párrafo
  let processedStartIndex = 0;
  if (lines.length > 0 && lines[0].startsWith('# 🏆')) {
    const title = lines[0].replace('# 🏆', '').trim();
    let desc = '';
    let nextIdx = 1;
    while (nextIdx < lines.length && lines[nextIdx].trim() === '') {
      nextIdx++;
    }
    if (nextIdx < lines.length && !lines[nextIdx].startsWith('#') && !lines[nextIdx].startsWith('---')) {
      desc = lines[nextIdx];
      nextIdx++;
    }
    processedStartIndex = nextIdx;
    
    html += `
    <div class="header-banner">
      <div class="header-icon">🏆</div>
      <div class="header-text-group">
        <h1>${parseInline(title)}</h1>
        <p>${parseInline(desc)}</p>
      </div>
    </div>
    `;
  }

  for (let i = processedStartIndex; i < lines.length; i++) {
    const line = lines[i];

    // Bloques de código
    if (line.trim().startsWith('```')) {
      if (inCode) {
        inCode = false;
        const highlighted = highlightCode(codeBlock.join('\n'), codeLang);
        html += `<pre><code class="language-${codeLang}">${highlighted}</code></pre>\n`;
        codeBlock = [];
      } else {
        closeLists();
        inCode = true;
        codeLang = line.trim().slice(3).trim().toLowerCase();
      }
      continue;
    }

    if (inCode) {
      codeBlock.push(line);
      continue;
    }

    // Líneas divisorias horizontales (---)
    if (line.trim() === '---') {
      closeLists();
      html += '<hr>\n';
      continue;
    }

    // Encabezados
    if (line.startsWith('# ')) {
      closeLists();
      html += `<h1>${parseInline(line.slice(2))}</h1>\n`;
      continue;
    }
    if (line.startsWith('## ')) {
      closeLists();
      html += `<h2>${parseInline(line.slice(3))}</h2>\n`;
      continue;
    }
    if (line.startsWith('### ')) {
      closeLists();
      html += `<h3>${parseInline(line.slice(4))}</h3>\n`;
      continue;
    }

    // Listas ordenadas e independientes
    const ulMatch = line.match(/^(\s*)([*+-])\s+(.*)$/);
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);

    if (ulMatch || olMatch) {
      const indent = ulMatch ? ulMatch[1].length : olMatch[1].length;
      const type = ulMatch ? 'ul' : 'ol';
      const content = ulMatch ? ulMatch[3] : olMatch[3];
      const depth = Math.floor(indent / 2); // 2 espacios por nivel

      if (depth > listStack.length - 1) {
        while (listStack.length <= depth) {
          listStack.push(type);
          html += `<${type}>\n`;
        }
      } else if (depth < listStack.length - 1) {
        closeLists(depth + 1);
        if (listStack[listStack.length - 1] !== type) {
          const oldType = listStack.pop();
          html += `</${oldType}>\n<${type}>\n`;
          listStack.push(type);
        }
      } else {
        if (listStack[listStack.length - 1] !== type) {
          const oldType = listStack.pop();
          html += `</${oldType}>\n<${type}>\n`;
          listStack.push(type);
        }
      }

      html += `<li>${parseInline(content)}</li>\n`;
      continue;
    }

    // Líneas vacías
    if (line.trim() === '') {
      continue;
    }

    // Párrafos normales
    closeLists();
    html += `<p>${parseInline(line)}</p>\n`;
  }

  closeLists();
  return html;
}

// Estructura HTML final con diseño CSS ultra-premium y tipografía moderna
const htmlTemplate = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Plano Maestro: CRM Inteligente con IA Conversacional</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&family=Fira+Code:wght@400;500&display=swap');

    body {
      font-family: 'Inter', sans-serif;
      color: #1e293b;
      line-height: 1.6;
      background-color: #ffffff;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
    }

    .document-container {
      max-width: 850px;
      margin: 0 auto;
      padding: 40px 50px;
    }

    /* Banner del Encabezado */
    .header-banner {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0d9488 100%);
      color: #ffffff;
      padding: 35px 40px;
      border-radius: 16px;
      margin-bottom: 40px;
      display: flex;
      align-items: center;
      gap: 28px;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.15), 0 8px 10px -6px rgba(15, 23, 42, 0.15);
    }
    
    .header-icon {
      font-size: 44px;
      background: rgba(255, 255, 255, 0.12);
      width: 76px;
      height: 76px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      flex-shrink: 0;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    
    .header-text-group {
      flex-grow: 1;
    }
    
    .header-banner h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 24px;
      font-weight: 800;
      margin: 0 0 8px 0;
      line-height: 1.25;
      letter-spacing: -0.5px;
      color: #ffffff;
    }
    
    .header-banner p {
      font-size: 13.5px;
      color: #ccfbf1;
      margin: 0;
      line-height: 1.5;
      font-weight: 400;
      text-align: left;
    }

    /* Encabezados h2 */
    h2 {
      font-family: 'Outfit', sans-serif;
      color: #0f172a;
      font-size: 18px;
      font-weight: 700;
      margin-top: 36px;
      margin-bottom: 16px;
      padding: 10px 16px;
      background-color: #f8fafc;
      border-left: 5px solid #0d9488;
      border-radius: 0 8px 8px 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    /* Encabezados h3 */
    h3 {
      font-family: 'Outfit', sans-serif;
      color: #0f766e;
      font-size: 14.5px;
      font-weight: 600;
      margin-top: 26px;
      margin-bottom: 12px;
    }

    /* Párrafos */
    p {
      margin-top: 0;
      margin-bottom: 16px;
      font-size: 14.5px;
      color: #334155;
      text-align: justify;
    }

    /* Listas y viñetas modernas */
    ul {
      list-style-type: none;
      padding-left: 0;
      margin-bottom: 20px;
    }
    
    ul li {
      position: relative;
      padding-left: 20px;
      margin-bottom: 8px;
      font-size: 14px;
      color: #334155;
      line-height: 1.6;
    }
    
    ul li::before {
      content: "•";
      color: #0d9488;
      font-weight: bold;
      font-size: 18px;
      position: absolute;
      left: 0;
      top: -2px;
    }
    
    ol {
      counter-reset: li;
      list-style-type: none;
      padding-left: 0;
      margin-bottom: 20px;
    }
    
    ol li {
      position: relative;
      padding-left: 28px;
      margin-bottom: 10px;
      font-size: 14px;
      color: #334155;
      line-height: 1.6;
    }
    
    ol li::before {
      content: counter(li);
      counter-increment: li;
      position: absolute;
      left: 0;
      top: 2px;
      background-color: #f1f5f9;
      border: 1px solid #cbd5e1;
      color: #0f172a;
      font-size: 10px;
      font-weight: 700;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Bloques de Código */
    pre {
      background-color: #0f172a;
      border-radius: 12px;
      padding: 18px 22px;
      margin: 22px 0;
      overflow-x: auto;
      box-shadow: 0 4px 15px rgba(15, 23, 42, 0.08);
      border: 1px solid #1e293b;
    }

    pre code {
      font-family: 'Fira Code', 'Consolas', monospace;
      font-size: 12.5px;
      color: #e2e8f0;
      line-height: 1.6;
      background-color: transparent;
      padding: 0;
      border-radius: 0;
      display: block;
    }

    /* Resaltador de código customizado */
    .code-comment {
      color: #64748b;
      font-style: italic;
    }
    
    .code-key {
      color: #38bdf8; /* sky-400 */
      font-weight: 600;
    }
    
    .code-operator {
      color: #fb7185; /* rose-400 */
      font-weight: bold;
    }
    
    .code-value {
      color: #fbbf24; /* amber-400 */
    }
    
    .code-tree {
      color: #475569; /* slate-600 */
      font-weight: bold;
    }
    
    .code-folder {
      color: #2dd4bf; /* teal-400 */
      font-weight: 600;
    }

    /* Código en línea */
    code.inline-code {
      font-family: 'Fira Code', 'Consolas', monospace;
      background-color: #f1f5f9;
      color: #0f766e;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
      font-weight: 500;
      border: 1px solid #e2e8f0;
    }

    /* Divisor */
    hr {
      border: 0;
      height: 1px;
      background: linear-gradient(to right, #f1f5f9, #cbd5e1, #f1f5f9);
      margin: 30px 0;
    }

    /* Impresión y saltos de página optimizados */
    @media print {
      body {
        background-color: #ffffff;
      }
      .document-container {
        padding: 0;
        max-width: 100%;
      }
      h2, h3 {
        page-break-after: avoid;
      }
      pre {
        page-break-inside: avoid;
      }
      li {
        page-break-inside: avoid;
      }
      @page {
        margin: 20mm 15mm 20mm 15mm;
      }
    }
  </style>
</head>
<body>
  <div class="document-container">
    {{CONTENT}}
  </div>
</body>
</html>
`;

// Generamos el HTML completo
const bodyContent = parseMarkdownToHtml(mdContent);
const finalHtml = htmlTemplate.replace('{{CONTENT}}', bodyContent);

fs.writeFileSync(htmlPath, finalHtml, 'utf8');
console.log('✅ HTML intermedio estilizado generado con éxito.');

// Comando para MS Edge headless que imprime a PDF
const edgeCommand = `start /wait "" "msedge.exe" --headless --disable-gpu --print-to-pdf="${pdfPath}" "${htmlPath}"`;

console.log('Generando PDF premium usando Microsoft Edge Headless...');
exec(edgeCommand, (err) => {
  if (err) {
    console.error('❌ Error al generar PDF con Edge:', err.message);
  } else {
    console.log('✅ PDF de alta calidad generado con éxito en el Escritorio.');
    // Limpiamos el archivo temporal
    if (fs.existsSync(htmlPath)) {
      fs.unlinkSync(htmlPath);
      console.log('🧹 Archivo HTML temporal eliminado.');
    }
  }
});
