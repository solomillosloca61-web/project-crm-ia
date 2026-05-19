// C:\Users\lucia\PROJECT_CRM_IA\src\app\page.tsx
'use client';

import React, { useState, useEffect, useRef } from 'react';

interface Contact {
  id: string;
  phone: string;
  name: string;
  email: string;
  source: string;
  status: string;
  score: number;
  notes: string;
  calendly_link: string;
  pause_ai?: boolean;
  created_at: string;
  updated_at: string;
  conversations?: Conversation[];
}

interface Conversation {
  id: string;
  contact_id: string;
  started_at: string;
  last_message: string;
  intent: string;
  resolved: boolean;
}

interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export default function CRMDashboard() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');
  
  // States for the edit form
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editScore, setEditScore] = useState(0);
  const [editCalendly, setEditCalendly] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editPauseIA, setEditPauseIA] = useState(false);
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  // States for sending messages
  const [typedMessage, setTypedMessage] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Fetch contacts list
  const loadContacts = async (silent = false) => {
    try {
      const res = await fetch('/api/contacts');
      if (res.ok) {
        const data = await res.json();
        setContacts(data);
        
        // If a contact is selected, update its reference to catch changes (like score/status/conversations)
        if (selectedContact) {
          const updated = data.find((c: Contact) => c.id === selectedContact.id);
          if (updated) {
            setSelectedContact(updated);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching contacts:', error);
    }
  };

  // 2. Fetch messages for active conversation
  const loadMessages = async (conversationId: string) => {
    try {
      const res = await fetch(`/api/messages?conversationId=${conversationId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  // On Mount: load contacts and set up real-time polling
  useEffect(() => {
    loadContacts();
    
    const interval = setInterval(() => {
      loadContacts(true);
    }, 4000); // Poll every 4 seconds

    return () => clearInterval(interval);
  }, [selectedContact?.id]);

  // Load messages whenever contact or conversation changes
  useEffect(() => {
    if (selectedContact && selectedContact.conversations && selectedContact.conversations.length > 0) {
      const activeConv = selectedContact.conversations.find(c => !c.resolved) || selectedContact.conversations[0];
      loadMessages(activeConv.id);
    } else {
      setMessages([]);
    }

    // Populate edit form
    if (selectedContact) {
      setEditName(selectedContact.name || '');
      setEditEmail(selectedContact.email || '');
      setEditStatus(selectedContact.status || 'nuevo');
      setEditScore(selectedContact.score || 0);
      setEditCalendly(selectedContact.calendly_link || '');
      setEditNotes(selectedContact.notes || '');
      setEditPauseIA(selectedContact.pause_ai || false);
    }
  }, [selectedContact]);

  // Scroll to bottom of chat when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Setup sub-polling for active messages
  useEffect(() => {
    if (!selectedContact) return;
    const activeConv = selectedContact.conversations?.find(c => !c.resolved) || selectedContact.conversations?.[0];
    if (!activeConv) return;

    const interval = setInterval(() => {
      loadMessages(activeConv.id);
    }, 3000); // Poll messages every 3 seconds when chat is open

    return () => clearInterval(interval);
  }, [selectedContact]);

  // Handle saving details
  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContact) return;
    
    setIsSavingDetails(true);
    try {
      const res = await fetch('/api/contacts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedContact.id,
          name: editName,
          email: editEmail,
          status: editStatus,
          score: editScore,
          calendly_link: editCalendly,
          notes: editNotes,
          pause_ai: editPauseIA
        })
      });

      if (res.ok) {
        const updated = await res.json();
        // Update local status
        setSelectedContact(prev => prev ? { ...prev, ...updated } : null);
        loadContacts();
      } else {
        alert('Error al guardar los detalles.');
      }
    } catch (err) {
      console.error(err);
      alert('Fallo de conexión.');
    } finally {
      setIsSavingDetails(false);
    }
  };

  // Handle sending manual WhatsApp responses
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContact || !typedMessage.trim()) return;

    const activeConv = selectedContact.conversations?.find(c => !c.resolved) || selectedContact.conversations?.[0];
    if (!activeConv) {
      alert('Este contacto no tiene una conversación activa. Por favor, inicia una llamada o espera un mensaje.');
      return;
    }

    setIsSendingMessage(true);
    const contentToSend = typedMessage;
    setTypedMessage(''); // Clear input instantly for snappy feel

    // Add temporary message locally for immediate UI update
    const tempMsg: Message = {
      id: Math.random().toString(),
      conversation_id: activeConv.id,
      role: 'assistant',
      content: contentToSend,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempMsg]);

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConv.id,
          toPhone: selectedContact.phone,
          content: contentToSend
        })
      });

      if (res.ok) {
        // Refresh messages from server
        loadMessages(activeConv.id);
        loadContacts();
      } else {
        alert('Fallo al enviar el mensaje de WhatsApp.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión.');
    } finally {
      setIsSendingMessage(false);
    }
  };

  // Filter contacts lists based on search bar and status filter
  const filteredContacts = contacts.filter(contact => {
    const matchesSearch = 
      contact.name?.toLowerCase().includes(search.toLowerCase()) || 
      contact.phone?.includes(search);
    
    const matchesStatus = 
      statusFilter === 'todos' || 
      contact.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'nuevo': return 'badge badge-nuevo';
      case 'en_conversacion': return 'badge badge-en_conversacion';
      case 'lead_calificado': return 'badge badge-lead_calificado';
      case 'reunion_agendada': return 'badge badge-reunion_agendada';
      case 'lead_frio': return 'badge badge-lead_frio';
      case 'cliente': return 'badge badge-cliente';
      default: return 'badge badge-lead_frio';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'nuevo': return 'Nuevo';
      case 'en_conversacion': return 'En Charla';
      case 'lead_calificado': return 'Calificado';
      case 'reunion_agendada': return 'Cita Agendada';
      case 'lead_frio': return 'Frío';
      case 'cliente': return 'Cliente';
      default: return status || 'Desconocido';
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 60) return '#f59e0b'; // Gold / Hot
    if (score >= 30) return '#a78bfa'; // Purple / Warm
    return '#9ca3af'; // Gray / Cold
  };

  const getScoreEmoji = (score: number) => {
    if (score >= 60) return '🔥';
    if (score >= 30) return '⚡';
    return '❄️';
  };

  const activeConv = selectedContact?.conversations?.find(c => !c.resolved) || selectedContact?.conversations?.[0];

  return (
    <div className="crm-container">
      {/* 1. SIDEBAR COLUMN: Contact List */}
      <div className="crm-sidebar">
        <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 className="sidebar-title" style={{ margin: 0 }}>
            🏥 <span>MP Salud</span> CRM
          </h1>
          <span style={{ fontSize: '11px', fontWeight: 'bold', background: 'rgba(255, 255, 255, 0.08)', padding: '4px 8px', borderRadius: '10px', color: 'var(--text-muted)' }}>
            Leads: {filteredContacts.length}
          </span>
        </div>

        <div className="sidebar-search">
          <input
            type="text"
            className="search-input"
            placeholder="Buscar por nombre o cel..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ marginTop: '10px', display: 'flex', gap: '5px', overflowX: 'auto', paddingBottom: '2px' }}>
            {['todos', 'nuevo', 'en_conversacion', 'lead_calificado', 'reunion_agendada', 'lead_frio', 'cliente'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                style={{
                  background: statusFilter === st ? 'var(--accent)' : 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '3px 8px',
                  fontSize: '9px',
                  fontWeight: '600',
                  color: '#fff',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap'
                }}
              >
                {st === 'todos' ? 'Todos' : getStatusLabel(st)}
              </button>
            ))}
          </div>
        </div>

        <div className="contact-list">
          {filteredContacts.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '14px' }}>
              Ningún prospecto encontrado
            </div>
          ) : (
            filteredContacts.map((contact) => (
              <div
                key={contact.id}
                className={`contact-item ${selectedContact?.id === contact.id ? 'selected' : ''}`}
                onClick={() => setSelectedContact(contact)}
              >
                <div className="contact-item-header">
                  <span className="contact-name">{contact.name || 'Cliente de WhatsApp'}</span>
                  <span className={getStatusBadgeClass(contact.status)}>
                    {getStatusLabel(contact.status)}
                  </span>
                </div>
                <span className="contact-phone">📞 {contact.phone}</span>
                <div className="contact-meta">
                  <span className="contact-score" style={{ color: getScoreColor(contact.score || 0) }}>
                    {getScoreEmoji(contact.score || 0)} {contact.score || 0} pts
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
                    {contact.updated_at ? new Date(contact.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 2. CHAT COLUMN: Message History & Input */}
      <div className="crm-chat">
        {!selectedContact ? (
          <div className="chat-empty">
            <span className="chat-empty-icon">💬</span>
            <h2>Selecciona una conversación</h2>
            <p>Selecciona un contacto de la barra lateral para ver su historial de chat de WhatsApp</p>
          </div>
        ) : (
          <>
            <div className="chat-header">
              <div className="chat-header-info">
                <span className="chat-header-title">{selectedContact.name || 'Cliente de WhatsApp'}</span>
                <span className="chat-header-subtitle">
                  Celular: {selectedContact.phone} | Score: {selectedContact.score} pts
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <span className={getStatusBadgeClass(selectedContact.status)}>
                  {getStatusLabel(selectedContact.status)}
                </span>
                {selectedContact.source && (
                  <span className="badge" style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
                    {selectedContact.source}
                  </span>
                )}
              </div>
            </div>

            <div className="chat-body">
              {messages.length === 0 ? (
                <div style={{ display: 'flex', flex: 1, justifyContent: 'center', alignItems: 'center', color: 'var(--text-dim)', fontSize: '14px' }}>
                  No hay mensajes registrados. Envía un mensaje para iniciar el chat.
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`message-bubble ${msg.role === 'user' ? 'user' : 'assistant'}`}
                  >
                    <span>{msg.content}</span>
                    <span className="message-time">{formatTime(msg.created_at)}</span>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="chat-footer">
              <form onSubmit={handleSendMessage} className="chat-input-form">
                <textarea
                  className="chat-textarea"
                  placeholder={`Responder a ${selectedContact.name || 'cliente'} por WhatsApp...`}
                  value={typedMessage}
                  onChange={(e) => setTypedMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e);
                    }
                  }}
                />
                <button
                  type="submit"
                  className="btn-send"
                  disabled={isSendingMessage || !typedMessage.trim() || !activeConv}
                  title={!activeConv ? "No hay conversación activa creada para este contacto." : "Enviar mensaje"}
                >
                  {isSendingMessage ? 'Enviando...' : 'Enviar 🚀'}
                </button>
              </form>
            </div>
          </>
        )}
      </div>

      {/* 3. DETAILS COLUMN: Edit Fields, Score, Notes */}
      <div className="crm-details">
        {!selectedContact ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
            Selecciona un contacto para editar su información.
          </div>
        ) : (
          <form onSubmit={handleSaveDetails} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="details-section">
              <h2 className="details-title">Datos del Prospecto</h2>
              
              <div className="input-group">
                <label className="form-label">Nombre</label>
                <input
                  type="text"
                  className="form-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="form-label">Email</label>
                <input
                  type="email"
                  className="form-input"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="ejemplo@correo.com"
                />
              </div>

              <div className="input-group">
                <label className="form-label">Estado de Venta</label>
                <select
                  className="form-select"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                >
                  <option value="nuevo">Nuevo</option>
                  <option value="en_conversacion">En conversación</option>
                  <option value="lead_calificado">Lead Calificado</option>
                  <option value="reunion_agendada">Reunión Agendada</option>
                  <option value="lead_frio">Lead Frío</option>
                  <option value="cliente">Cliente</option>
                </select>
              </div>

              <div className="input-group">
                <label className="form-label">Score de Interés</label>
                <input
                  type="number"
                  className="form-input"
                  value={editScore}
                  onChange={(e) => setEditScore(parseInt(e.target.value, 10) || 0)}
                />
              </div>

              <div className="input-group">
                <label className="form-label">Enlace de Calendly</label>
                <input
                  type="url"
                  className="form-input"
                  value={editCalendly}
                  onChange={(e) => setEditCalendly(e.target.value)}
                  placeholder="https://calendly.com/tu-link"
                />
              </div>

              <div className="input-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                <input
                  type="checkbox"
                  id="pause-ai-checkbox"
                  checked={editPauseIA}
                  onChange={(e) => setEditPauseIA(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label htmlFor="pause-ai-checkbox" style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--warning)', cursor: 'pointer' }}>
                  ⏸️ Pausar Inteligencia Artificial
                </label>
              </div>
            </div>

            <div className="details-section" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <h2 className="details-title">Notas de Seguimiento</h2>
              <div className="input-group" style={{ flex: 1, marginBottom: 0 }}>
                <textarea
                  className="form-textarea"
                  style={{ flex: 1, minHeight: '150px' }}
                  placeholder="Añade aquí notas sobre la afiliación a la obra social, objeciones del cliente, cotizaciones, etc..."
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>
            </div>

            <div style={{ padding: '20px', borderTop: '1px solid var(--border)' }}>
              <button
                type="submit"
                className="btn-save primary"
                disabled={isSavingDetails}
              >
                {isSavingDetails ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
