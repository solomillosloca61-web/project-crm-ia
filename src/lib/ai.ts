
/**
 * Configura la llamada a OpenRouter con el modelo y la clave del .env.
 */
export async function callAI(payload: any): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-5-sonnet';
  const systemPrompt = process.env.SYSTEM_PROMPT || '';

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not set');
  }

  // Construir el historial de mensajes a partir del payload
  const messages = (payload?.messages ?? []).map((msg: any) => ({
    role: msg.from?.type === 'business' ? 'assistant' : 'user',
    content: msg.text?.body ?? ''
  }));

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ]
  };

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('OpenRouter error', response.status, err);
    // Retornar mensaje de fallback amigable en lugar de crashear el webhook
    return 'Hola. Gracias por contactarte con MP Salud. Estamos procesando tu consulta y un asesor te responderá a la brevedad.';
  }

  try {
    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content ?? '';
    return reply || 'Hola. Gracias por escribirnos, un asesor se comunicará contigo pronto.';
  } catch (parseError) {
    console.error('Error parseando respuesta de OpenRouter:', parseError);
    return 'Hola. Gracias por contactarte con MP Salud. Estamos procesando tu consulta y te responderemos pronto.';
  }
}
