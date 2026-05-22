'use client';

import React, { useState } from 'react';

interface CallReportMessageProps {
  content: string;
  time: string;
}

export default function CallReportMessage({ content, time }: CallReportMessageProps) {
  const [expanded, setExpanded] = useState(false);

  // Parse lines from plain text format:
  // 📞 [Reporte de Llamada] Estado: POTENCIAL POSITIVO
  // Notas: Llamada de prueba...
  // Transcripción:
  // Hola, me interesa...
  const lines = content.split('\n');

  let estado = '';
  let notas = '';
  let transcript = '';

  for (const line of lines) {
    if (line.includes('Estado:')) {
      estado = line.substring(line.indexOf('Estado:') + 'Estado:'.length).trim();
    }
    if (line.startsWith('Notas:')) {
      notas = line.substring(line.indexOf('Notas:') + 'Notas:'.length).trim();
    }
  }

  const transcriptIndex = content.indexOf('Transcripción:\n');
  if (transcriptIndex !== -1) {
    transcript = content.substring(transcriptIndex + 'Transcripción:\n'.length).trim();
  }

  return (
    <div className="call-report-message">
      <div className="header">
        <span className="phone-icon emoji-span">📞</span>
        <span>Reporte de Llamada</span>
        {estado && (
          <span className="badge badge-reunion_agendada" style={{ fontSize: '9px', padding: '2px 6px', marginLeft: '4px' }}>
            {estado}
          </span>
        )}
        <span className="message-time" style={{ marginLeft: 'auto' }}>{time}</span>
      </div>

      {notas && (
        <div className="summary"><strong>Resumen:</strong> {notas}</div>
      )}

      {expanded && transcript && (
        <div className="transcript-section">
          <strong style={{ fontSize: '11px', display: 'block', marginBottom: '6px', color: 'var(--text-dim)' }}>Transcripción completa:</strong>
          <div>{transcript}</div>
        </div>
      )}

      {transcript && (
        <button onClick={() => setExpanded(!expanded)}>
          {expanded ? (
            <>
              <span className="emoji-span" style={{ marginRight: '4px' }}>▲</span>
              Ocultar transcripción
            </>
          ) : (
            <>
              <span className="emoji-span" style={{ marginRight: '4px' }}>▼</span>
              Ver transcripción completa
            </>
          )}
        </button>
      )}
    </div>
  );
}
