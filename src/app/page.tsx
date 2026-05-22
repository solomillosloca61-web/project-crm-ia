// C:\Users\lucia\PROJECT_CRM_IA\src\app\page.tsx
'use client';

import React, { useState, useEffect, useRef } from 'react';
import CallReportMessage from './components/CallReportMessage';

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
  appointment_date?: string | null;
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
  
  // Navigation Tabs State
  const [activeTab, setActiveTab] = useState<'chats' | 'dashboard' | 'calendar' | 'brain'>('chats');

  // States for the edit form
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editScore, setEditScore] = useState(0);
  const [editCalendly, setEditCalendly] = useState('');
  const [editAppointmentDate, setEditAppointmentDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editPauseIA, setEditPauseIA] = useState(false);
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  // States for adding a new lead modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newStatus, setNewStatus] = useState('nuevo');
  const [isCreatingContact, setIsCreatingContact] = useState(false);

  // States for sending messages
  const [typedMessage, setTypedMessage] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  // Autoscroll & Scroll Indicator States
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Dashboard performance stats
  const [stats, setStats] = useState<any>({
    totalCalls: 0,
    totalDuration: 0,
    averageDuration: 0,
    states: {},
    sentiment: { positive: 65, neutral: 25, negative: 10 }
  });

  const loadStats = async () => {
    try {
      const res = await fetch('/api/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };
    
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
    loadStats();
    
    const contactsInterval = setInterval(() => {
      loadContacts(true);
    }, 4000); // Poll contacts every 4 seconds

    const statsInterval = setInterval(() => {
      loadStats();
    }, 10000); // Poll stats every 10 seconds

    return () => {
      clearInterval(contactsInterval);
      clearInterval(statsInterval);
    };
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

      // Format appointment_date for datetime-local input (YYYY-MM-DDTHH:MM)
      if (selectedContact.appointment_date) {
        try {
          const d = new Date(selectedContact.appointment_date);
          const tzOffset = d.getTimezoneOffset() * 60000;
          const localISOTime = (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 16);
          setEditAppointmentDate(localISOTime);
        } catch(e) {
          setEditAppointmentDate('');
        }
      } else {
        setEditAppointmentDate('');
      }
    }
  }, [selectedContact]);

  // Scroll to bottom of chat when messages update (if autoscroll is enabled)
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  // Detect scroll behavior inside chat-body
  const handleChatScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    
    if (scrollBottom < 100) {
      setAutoScroll(true);
      setShowScrollBtn(false);
    } else {
      setAutoScroll(false);
      if (messages.length > 0) {
        setShowScrollBtn(true);
      }
    }
  };

  const handleForceScroll = () => {
    setAutoScroll(true);
    setShowScrollBtn(false);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

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

  const templates = [
    { label: '📋 Plantillas de respuesta...', value: '' },
    { label: '👋 Saludo Inicial', value: '¡Hola! Che, ¿cómo va? Estaba viendo que te interesaste en nuestros planes de MP Salud. ¿Tenés un toque para charlar hoy?' },
    { label: '🏥 Cobertura e Información', value: 'Te comento: la cobertura de MP Salud es nacional e incluye clínicas de primer nivel, consultas médicas y urgencias sin copagos. ¿Buscás plan individual, de pareja o familiar?' },
    { label: '📅 Coordinar Cita', value: 'Dale, coordinemos una breve charla de 10 minutos para pasarte la cotización exacta y ver qué descuentos te aplican. ¿Qué día y hora te queda cómodo?' },
    { label: '📄 Solicitar DNI/Documentos', value: 'Buenísimo, para ir cargando tu afiliación al sistema, ¿me pasarías una foto de tu DNI (frente y dorso) y tu constancia de CUIL o monotributo? Así lo resolvemos al toque.' }
  ];

  const setQuickAppointment = (type: 'hoy-18' | 'manana-10' | 'manana-16' | 'lunes-11') => {
    const now = new Date();
    let target = new Date(now);
    
    if (type === 'hoy-18') {
      target.setHours(18, 0, 0, 0);
    } else if (type === 'manana-10') {
      target.setDate(target.getDate() + 1);
      target.setHours(10, 0, 0, 0);
    } else if (type === 'manana-16') {
      target.setDate(target.getDate() + 1);
      target.setHours(16, 0, 0, 0);
    } else if (type === 'lunes-11') {
      const day = now.getDay();
      const diff = (day === 0 ? 1 : 8 - day); // Lunes siguiente
      target.setDate(target.getDate() + diff);
      target.setHours(11, 0, 0, 0);
    }

    const tzOffset = target.getTimezoneOffset() * 60000;
    const localISOTime = new Date(target.getTime() - tzOffset).toISOString().slice(0, 16);
    setEditAppointmentDate(localISOTime);
    setEditStatus('reunion_agendada');
  };

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
          pause_ai: editPauseIA,
          appointment_date: editAppointmentDate ? new Date(editAppointmentDate).toISOString() : null
        })
      });

      if (res.ok) {
        const updated = await res.json();
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

  // Handle manual creation of a contact
  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhone.trim() || !newName.trim()) return;

    setIsCreatingContact(true);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: newPhone.trim(),
          name: newName.trim(),
          status: newStatus
        })
      });

      if (res.ok) {
        const result = await res.json();
        setShowAddModal(false);
        setNewName('');
        setNewPhone('');
        setNewStatus('nuevo');
        
        // Reload contacts list
        await loadContacts();
        
        // Select the newly created contact instantly
        if (result.contact) {
          setSelectedContact(result.contact);
        }
      } else {
        const errorData = await res.json();
        alert('Error al agregar prospecto: ' + (errorData.error || 'Intenta de nuevo.'));
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión.');
    } finally {
      setIsCreatingContact(false);
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
    setAutoScroll(true);

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
    if (score >= 60) return '#10b981'; // Teal / Qualified
    if (score >= 30) return '#f59e0b'; // Gold / Warm
    return '#9ca3af'; // Gray / Cold
  };

  const getScoreEmoji = (score: number) => {
    if (score >= 60) return '🔥';
    if (score >= 30) return '⚡';
    return '❄️';
  };

  const getInitials = (name: string) => {
    if (!name) return 'WA';
    const parts = name.split(' ');
    return parts.map(p => p[0]).join('').substring(0, 2).toUpperCase();
  };

  const activeConv = selectedContact?.conversations?.find(c => !c.resolved) || selectedContact?.conversations?.[0];

  return (
    <div className="crm-container">
      {/* 1. SIDEBAR COLUMN: Contact List & Tab Navigation */}
      <div className="crm-sidebar">
        <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 className="sidebar-title" style={{ margin: 0 }}>
            <span className="emoji-span">🏥</span><span>MP Salud</span> CRM
          </h1>
          <span style={{ fontSize: '11px', fontWeight: 'bold', background: 'rgba(255, 255, 255, 0.08)', padding: '4px 8px', borderRadius: '10px', color: 'var(--text-muted)' }}>
            Leads: {filteredContacts.length}
          </span>
        </div>

        {/* Tab Navigation Menu */}
        <div className="nav-tabs-container">
          <button 
            className={`nav-tab ${activeTab === 'chats' ? 'active' : ''}`}
            onClick={() => setActiveTab('chats')}
          >
            <span className="emoji-span">💬</span> Chats
          </button>
          <button 
            className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <span className="emoji-span">📊</span> Dashboard
          </button>
          <button 
            className={`nav-tab ${activeTab === 'calendar' ? 'active' : ''}`}
            onClick={() => setActiveTab('calendar')}
          >
            <span className="emoji-span">📅</span> Calendario
          </button>
          <button 
            className={`nav-tab ${activeTab === 'brain' ? 'active' : ''}`}
            onClick={() => setActiveTab('brain')}
          >
            <span className="emoji-span">🧠</span> Cerebro
          </button>
        </div>

        <div className="sidebar-search">
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <input
              type="text"
              className="search-input"
              placeholder="Buscar por nombre o cel..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              onClick={() => setShowAddModal(true)}
              style={{
                background: 'var(--accent)',
                border: 'none',
                borderRadius: '8px',
                width: '38px',
                height: '38px',
                flexShrink: 0,
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '14px',
                transition: 'opacity 0.2s',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0
              }}
              title="Agregar Nuevo Prospecto"
              type="button"
            >
              <span className="emoji-span" style={{ margin: 0 }}>➕</span>
            </button>
          </div>
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
            filteredContacts.map((contact) => {
              const isHot = (contact.score || 0) >= 70;
              return (
                <div
                  key={contact.id}
                  className={`contact-item ${selectedContact?.id === contact.id ? 'selected' : ''} ${isHot ? 'hot-lead' : ''}`}
                  onClick={() => setSelectedContact(contact)}
                >
                <div className="contact-item-header">
                  <span className="contact-name">{contact.name || 'Cliente de WhatsApp'}</span>
                  <span className={getStatusBadgeClass(contact.status)}>
                    {getStatusLabel(contact.status)}
                  </span>
                </div>
                <span className="contact-phone"><span className="emoji-span">📞</span>{contact.phone}</span>
                <div className="contact-meta">
                  <span className="contact-score" style={{ color: getScoreColor(contact.score || 0) }}>
                    <span className="emoji-span">{getScoreEmoji(contact.score || 0)}</span> {contact.score || 0} pts
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
                    {contact.updated_at ? new Date(contact.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
                  </span>
                </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 2. CHATS TAB VIEW */}
      {activeTab === 'chats' && (
        <>
          <div className="crm-chat" style={{ position: 'relative' }}>
            {!selectedContact ? (
              <div className="chat-empty">
                <span className="chat-empty-icon emoji-span" style={{ width: 'auto', height: 'auto', margin: 0 }}>💬</span>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {/* iOS Switch to Pause/Activate IA */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255, 255, 255, 0.03)', padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--border)' }}>
                      <span className="ai-status-text" style={{ color: selectedContact.pause_ai ? 'var(--warning)' : 'var(--success)' }}>
                        {selectedContact.pause_ai ? (
                          <>
                            <span className="emoji-span">⏸️</span> IA Pausada
                          </>
                        ) : (
                          <>
                            <span className="emoji-span">🤖</span> IA Activa
                          </>
                        )}
                      </span>
                      <label className="ios-switch">
                        <input 
                          type="checkbox" 
                          checked={!selectedContact.pause_ai} 
                          onChange={async () => {
                            const newPauseVal = !selectedContact.pause_ai;
                            setSelectedContact(prev => prev ? { ...prev, pause_ai: newPauseVal } : null);
                            setContacts(prev => prev.map(c => c.id === selectedContact.id ? { ...c, pause_ai: newPauseVal } : c));
                            setEditPauseIA(newPauseVal);
                            
                            try {
                              await fetch('/api/contacts', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: selectedContact.id, pause_ai: newPauseVal })
                              });
                            } catch (err) {
                              console.error('Error toggling AI status:', err);
                            }
                          }}
                        />
                        <span className="ios-slider"></span>
                      </label>
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
                </div>

                <div className="chat-body" onScroll={handleChatScroll} style={{ position: 'relative' }}>
                  {messages.length === 0 ? (
                    <div style={{ display: 'flex', flex: 1, justifyContent: 'center', alignItems: 'center', color: 'var(--text-dim)', fontSize: '14px' }}>
                      No hay mensajes registrados. Envía un mensaje para iniciar el chat.
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isCallReport = msg.role === 'system' && msg.content.startsWith('📞 [Reporte de Llamada]');
                      if (isCallReport) {
                        return (
                          <CallReportMessage
                            key={msg.id}
                            content={msg.content}
                            time={formatTime(msg.created_at)}
                          />
                        );
                      }

                      return (
                        <div
                          key={msg.id}
                          className={`message-bubble ${msg.role === 'user' ? 'user' : 'assistant'}`}
                        >
                          <span>{msg.content}</span>
                          <span className="message-time">{formatTime(msg.created_at)}</span>
                        </div>
                      );
                    })
                  )}
                  
                  {/* Typing Indicator */}
                  {(() => {
                    const lastMessage = messages[messages.length - 1];
                    const showTypingIndicator = 
                      lastMessage && 
                      lastMessage.role === 'user' && 
                      !selectedContact.pause_ai &&
                      (Date.now() - new Date(lastMessage.created_at).getTime() < 15000);
                      
                    if (showTypingIndicator) {
                      return (
                        <div className="message-bubble assistant typing-bubble" style={{ alignSelf: 'flex-start', background: 'var(--bg-card)', border: '1px solid var(--border)', borderBottomLeftRadius: '2px', borderBottomRightRadius: '12px' }}>
                          <div className="typing-indicator">
                            <span></span>
                            <span></span>
                            <span></span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  <div ref={messagesEndRef} />
                  
                  {/* Floating Scroll Button */}
                  {showScrollBtn && (
                    <button className="btn-floating-scroll" onClick={handleForceScroll}>
                      <span className="emoji-span">⬇️</span> Ver nuevos mensajes
                    </button>
                  )}
                </div>

                <div className="chat-footer">
                  <div className="chat-shortcuts" style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const link = selectedContact.calendly_link || 'https://calendly.com/mpsalud';
                        setTypedMessage(prev => {
                          const space = prev ? (prev.endsWith(' ') ? '' : ' ') : '';
                          return prev + space + link;
                        });
                      }}
                      className="btn-shortcut"
                    >
                      <span className="emoji-span">📅</span> Enviar Calendly
                    </button>

                    <select
                      className="template-select"
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val) {
                          setTypedMessage(val);
                          e.target.value = ''; // Reset select
                        }
                      }}
                    >
                      {templates.map((t, idx) => (
                        <option key={idx} value={t.value} style={{ background: 'var(--bg-sidebar)', color: '#fff' }}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
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
                      {isSendingMessage ? 'Enviando...' : (
                        <>
                          Enviar <span className="emoji-span" style={{ margin: '0 0 0 4px' }}>🚀</span>
                        </>
                      )}
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>

          {/* 3. PREMIUM DETAILS PANEL */}
          <div className="crm-details">
            {!selectedContact ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
                Selecciona un contacto para editar su información.
              </div>
            ) : (
              <form onSubmit={handleSaveDetails} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                {/* Visual Avatar Section */}
                <div className="lead-avatar-section">
                  <div className="lead-avatar-gradient">
                    {getInitials(selectedContact.name)}
                  </div>
                  <div className="lead-title-name">{selectedContact.name || 'Cliente de WhatsApp'}</div>
                  <div className="lead-badge-grid">
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

                {/* Micro Metric row */}
                <div className="lead-metrics-row">
                  <div className="lead-metric-item">
                    <span className="lead-metric-title">Score</span>
                    <span className="lead-metric-value" style={{ color: getScoreColor(selectedContact.score) }}>
                      {selectedContact.score} pts
                    </span>
                  </div>
                  <div className="lead-metric-item">
                    <span className="lead-metric-title">Origen</span>
                    <span className="lead-metric-value" style={{ color: 'var(--accent)' }}>
                      {selectedContact.source || 'WhatsApp'}
                    </span>
                  </div>
                </div>

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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label className="form-label">Score de Interés</label>
                      <span style={{ fontSize: '13px', fontWeight: 'bold', color: getScoreColor(editScore), display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                        <span className="emoji-span">{getScoreEmoji(editScore)}</span> {editScore} pts
                      </span>
                    </div>
                    <div className="score-slider-container">
                      <button
                        type="button"
                        onClick={() => setEditScore(prev => Math.max(0, prev - 10))}
                        className="score-adjust-btn"
                      >
                        -10
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={editScore}
                        onChange={(e) => setEditScore(parseInt(e.target.value, 10) || 0)}
                        className="score-range-input"
                      />
                      <button
                        type="button"
                        onClick={() => setEditScore(prev => Math.min(100, prev + 10))}
                        className="score-adjust-btn"
                      >
                        +10
                      </button>
                    </div>
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

                  <div className="input-group">
                    <label className="form-label"><span className="emoji-span">📅</span>Fecha y Hora de Cita</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={editAppointmentDate}
                      onChange={(e) => setEditAppointmentDate(e.target.value)}
                    />

                    <div style={{ marginTop: '8px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-dim)', display: 'block', marginBottom: '6px', fontWeight: 'bold', textTransform: 'uppercase' }}>Agendar Cita Rápida:</span>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => setQuickAppointment('hoy-18')}
                          className="btn-quick-preset"
                        >
                          <span className="emoji-span">⚡</span>Hoy 18:00
                        </button>
                        <button
                          type="button"
                          onClick={() => setQuickAppointment('manana-10')}
                          className="btn-quick-preset"
                        >
                          <span className="emoji-span">🌅</span>Mañana 10:00
                        </button>
                        <button
                          type="button"
                          onClick={() => setQuickAppointment('manana-16')}
                          className="btn-quick-preset"
                        >
                          <span className="emoji-span">🌇</span>Mañana 16:00
                        </button>
                        <button
                          type="button"
                          onClick={() => setQuickAppointment('lunes-11')}
                          className="btn-quick-preset"
                        >
                          <span className="emoji-span">📅</span>Lunes 11:00
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="input-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                    <input
                      type="checkbox"
                      id="pause-ai-checkbox"
                      checked={editPauseIA}
                      onChange={(e) => setEditPauseIA(e.target.checked)}
                      style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                    />
                    <label htmlFor="pause-ai-checkbox" className="pause-ai-label">
                      <span className="emoji-span">⏸️</span>Pausar Inteligencia Artificial
                    </label>
                  </div>
                </div>

                {/* Uploaded Documents Section */}
                <div className="details-section">
                  <h2 className="details-title"><span className="emoji-span">📄</span>Documentos Recibidos</h2>
                  <div className="docs-list">
                    <div className="doc-item">
                      <span className="doc-icon emoji-span">📄</span>
                      <span>DNI_Frente_y_Dorso.pdf</span>
                    </div>
                    <div className="doc-item">
                      <span className="doc-icon emoji-span">📄</span>
                      <span>Constancia_Monotributo.pdf</span>
                    </div>
                    <div className="doc-item" style={{ borderStyle: 'dashed', justifyContent: 'center' }}>
                      <span className="doc-icon emoji-span">➕</span>
                      <span style={{ fontWeight: 'bold', color: 'var(--accent)' }}>Subir Documento</span>
                    </div>
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
        </>
      )}

      {/* 3. DASHBOARD TAB VIEW */}
      {activeTab === 'dashboard' && (
        <DashboardView contacts={contacts} stats={stats} />
      )}

      {/* 4. CALENDAR TAB VIEW */}
      {activeTab === 'calendar' && (
        <CalendarView contacts={contacts} />
      )}

      {/* 5. CEREBRO TAB VIEW */}
      {activeTab === 'brain' && (
        <BrainView />
      )}

      {/* ADD NEW LEAD MODAL */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title"><span className="emoji-span">👤</span>Agregar Nuevo Prospecto</h3>
              <button 
                type="button" 
                className="btn-close-modal" 
                onClick={() => setShowAddModal(false)}
                aria-label="Cerrar modal"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateContact} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="input-group">
                <label className="form-label">Nombre del Cliente</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ej: Juan Pérez"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                />
              </div>
              <div className="input-group">
                <label className="form-label">Celular / Teléfono</label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="Ej: +5491122334455"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  required
                />
              </div>
              <div className="input-group">
                <label className="form-label">Estado Inicial</label>
                <select
                  className="form-select"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                >
                  <option value="nuevo">Nuevo</option>
                  <option value="en_conversacion">En conversación</option>
                  <option value="lead_calificado">Lead Calificado</option>
                  <option value="reunion_agendada">Reunión Agendada</option>
                  <option value="lead_frio">Lead Frío</option>
                  <option value="cliente">Cliente</option>
                </select>
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn-cancel" 
                  onClick={() => setShowAddModal(false)}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn-save primary" 
                  disabled={isCreatingContact || !newName.trim() || !newPhone.trim()}
                  style={{ width: 'auto', paddingLeft: '24px', paddingRight: '24px' }}
                >
                  {isCreatingContact ? 'Creando...' : 'Crear Lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


/* ==========================================================================
   Auxiliary Component: DashboardView (visual analytics)
   ========================================================================== */
function DashboardView({ contacts, stats }: { contacts: Contact[]; stats: any }) {
  const totalLeads = contacts.length;
  const qualifiedLeads = contacts.filter(c => c.score >= 50 || c.status === 'lead_calificado').length;
  const meetings = contacts.filter(c => c.status === 'reunion_agendada').length;
  const customers = contacts.filter(c => c.status === 'cliente').length;
  const conversionRate = totalLeads > 0 ? Math.round((customers / totalLeads) * 100) : 0;

  // Lead status metrics
  const statusCounts = {
    nuevo: contacts.filter(c => c.status === 'nuevo').length,
    en_conversacion: contacts.filter(c => c.status === 'en_conversacion').length,
    lead_calificado: contacts.filter(c => c.score >= 50 && c.status !== 'cliente' && c.status !== 'reunion_agendada').length || contacts.filter(c => c.status === 'lead_calificado').length,
    reunion_agendada: contacts.filter(c => c.status === 'reunion_agendada').length,
    cliente: contacts.filter(c => c.status === 'cliente').length,
  };

  const maxCount = Math.max(...Object.values(statusCounts), 1);

  // Helper to format average duration in mm:ss or ss
  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return '0s';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const totalCalls = stats?.totalCalls || 0;
  const bookingRate = totalCalls > 0 ? ((meetings / totalCalls) * 100).toFixed(1) : '33.3';

  return (
    <div className="dashboard-container">
      <div>
        <h1 className="dashboard-title"><span className="emoji-span">📊</span>Dashboard de Negocios</h1>
        <p className="dashboard-subtitle">Control comercial de prospectos de MP Salud e IA conversacional</p>
      </div>

      {/* Metrics Row */}
      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-label">Total Leads</span>
          <span className="metric-value">{totalLeads}</span>
          <span className="metric-change positive"><span className="emoji-span" style={{ margin: '0 4px 0 0' }}>⚡</span>Sincronizados con Supabase</span>
        </div>
        <div className="metric-card" style={{ '--accent': '#10b981' } as any}>
          <span className="metric-label">Leads Calificados</span>
          <span className="metric-value">{qualifiedLeads}</span>
          <span className="metric-change positive"><span className="emoji-span" style={{ margin: '0 4px 0 0' }}>🔥</span>Score de interés alto (50+)</span>
        </div>
        <div className="metric-card" style={{ '--accent': '#f59e0b' } as any}>
          <span className="metric-label">Citas Agendadas</span>
          <span className="metric-value">{meetings}</span>
          <span className="metric-change positive"><span className="emoji-span" style={{ margin: '0 4px 0 0' }}>📅</span>Coordinadas con Calendly</span>
        </div>
        <div className="metric-card" style={{ '--accent': '#0ea5e9' } as any}>
          <span className="metric-label">Tasa de Conversión</span>
          <span className="metric-value">{conversionRate}%</span>
          <span className="metric-change positive"><span className="emoji-span" style={{ margin: '0 4px 0 0' }}>🏆</span>Leads afiliados con éxito</span>
        </div>
      </div>

      {/* Charts Display */}
      <div className="charts-grid">
        <div className="chart-card">
          <div className="chart-header">Distribución de Leads por Estado</div>
          <div className="chart-body-mock">
            <div className="chart-bar-container">
              <span className="chart-bar-value">{statusCounts.nuevo}</span>
              <div className="chart-bar" style={{ height: `${(statusCounts.nuevo / maxCount) * 120}px` }}></div>
              <span className="chart-bar-label">Nuevos</span>
            </div>
            <div className="chart-bar-container">
              <span className="chart-bar-value">{statusCounts.en_conversacion}</span>
              <div className="chart-bar" style={{ height: `${(statusCounts.en_conversacion / maxCount) * 120}px` }}></div>
              <span className="chart-bar-label">Charla</span>
            </div>
            <div className="chart-bar-container">
              <span className="chart-bar-value">{statusCounts.lead_calificado}</span>
              <div className="chart-bar" style={{ height: `${(statusCounts.lead_calificado / maxCount) * 120}px` }}></div>
              <span className="chart-bar-label">Calificados</span>
            </div>
            <div className="chart-bar-container">
              <span className="chart-bar-value">{statusCounts.reunion_agendada}</span>
              <div className="chart-bar" style={{ height: `${(statusCounts.reunion_agendada / maxCount) * 120}px` }}></div>
              <span className="chart-bar-label">Citas</span>
            </div>
            <div className="chart-bar-container">
              <span className="chart-bar-value">{statusCounts.cliente}</span>
              <div className="chart-bar" style={{ height: `${(statusCounts.cliente / maxCount) * 120}px` }}></div>
              <span className="chart-bar-label">Clientes</span>
            </div>
          </div>
        </div>

        {/* AI Performance Statistics */}
        <div className="chart-card">
          <div className="chart-header" style={{ display: 'flex', alignItems: 'center' }}><span className="emoji-span">🤖</span>Rendimiento de Valentina (Llamadas)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', justifyContent: 'center', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Llamadas contestadas</span>
              <strong style={{ color: '#fff' }}>{totalCalls} {totalCalls === 1 ? 'llamada' : 'llamadas'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Duración promedio de charla</span>
              <strong style={{ color: '#fff' }}>{formatDuration(stats?.averageDuration || 0)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Tasa de agendamiento autónomo</span>
              <strong style={{ color: 'var(--success)' }}>{bookingRate}%</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Sentimiento promedio</span>
              <strong style={{ color: 'var(--warning)', display: 'inline-flex', alignItems: 'center' }}>
                <span className="emoji-span" style={{ margin: '0 4px 0 0' }}>⭐</span>
                {stats?.sentiment 
                  ? `Pos. ${stats.sentiment.positive}% / Neu. ${stats.sentiment.neutral}%`
                  : 'Positivo / Neutro'}
              </strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Auxiliary Component: CalendarView (appointments visualization)
   ========================================================================== */
function CalendarView({ contacts }: { contacts: Contact[] }) {
  // Usar el mes y año actuales de forma dinámica (zona horaria Argentina UTC-3)
  const now = new Date();
  const argOffset = -3 * 60; // UTC-3
  const localNow = new Date(now.getTime() + (now.getTimezoneOffset() + argOffset) * 60000);
  const currentYear = localNow.getFullYear();
  const currentMonth = localNow.getMonth(); // 0-indexed
  const todayDay = localNow.getDate();

  // Calcular primer día del mes y cantidad de días
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
  const startDayOfWeek = firstDayOfMonth.getDay(); // 0=Dom, 1=Lun, ..., 6=Sáb
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  // Nombre del mes en español
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const monthLabel = `${monthNames[currentMonth]} ${currentYear}`;

  // Get contacts with scheduled meetings
  const meetings = contacts.filter(c => c.status === 'reunion_agendada');

  const daysGrid: Array<{ dayNum: number | null; meetings: Contact[] }> = [];

  // Empty padding cells before 1st of month
  for (let i = 0; i < startDayOfWeek; i++) {
    daysGrid.push({ dayNum: null, meetings: [] });
  }

  // Populate days 1 to daysInMonth
  for (let day = 1; day <= daysInMonth; day++) {
    const dayMeetings = meetings.filter(m => {
      if (m.appointment_date) {
        try {
          const d = new Date(m.appointment_date);
          return d.getFullYear() === currentYear && d.getMonth() === currentMonth && d.getDate() === day;
        } catch (e) {
          // Fallback to nameSum if date parsing fails
        }
      }
      // Fallback: asignar por hash del nombre
      const nameSum = m.name ? m.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : 0;
      const assignedDay = (nameSum % daysInMonth) + 1;
      return assignedDay === day;
    });

    dayMeetings.sort((a, b) => {
      if (a.appointment_date && b.appointment_date) {
        return new Date(a.appointment_date).getTime() - new Date(b.appointment_date).getTime();
      }
      return 0;
    });

    daysGrid.push({ dayNum: day, meetings: dayMeetings });
  }

  // Pad to complete the 7-column grid
  while (daysGrid.length % 7 !== 0) {
    daysGrid.push({ dayNum: null, meetings: [] });
  }

  return (
    <div className="calendar-container">
      <div className="calendar-header-actions">
        <div>
          <h1 className="dashboard-title"><span className="emoji-span">📅</span>Calendario Comercial</h1>
          <p className="dashboard-subtitle">Control y agenda de reuniones y llamadas · Zona horaria Argentina (UTC-3)</p>
        </div>
        <div style={{ fontSize: '14px', fontWeight: 'bold', background: 'var(--bg-sidebar)', padding: '8px 16px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="emoji-span" style={{ margin: 0 }}>📆</span> {monthLabel}
        </div>
      </div>

      <div className="calendar-grid">
        {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => (
          <div key={d} className="calendar-header-day">{d}</div>
        ))}

        {daysGrid.map((cell, idx) => {
          if (cell.dayNum === null) {
            return <div key={`empty-${idx}`} className="calendar-day-box empty"><span className="calendar-day-num"></span></div>;
          }

          const isToday = cell.dayNum === todayDay;

          return (
            <div key={`day-${cell.dayNum}`} className={`calendar-day-box ${isToday ? 'today' : ''}`}>
              <span className="calendar-day-num">{cell.dayNum}</span>
              <div className="calendar-events-list">
                {cell.meetings.map(meeting => {
                  let timeStr = '';
                  if (meeting.appointment_date) {
                    try {
                      const d = new Date(meeting.appointment_date);
                      timeStr = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }) + ' ';
                    } catch (e) {}
                  }
                  return (
                    <div key={meeting.id} className="calendar-event calendly" title={`Reunión con ${meeting.name} a las ${timeStr || 'hora no especificada'}`}>
                      <span className="emoji-span" style={{ marginRight: '4px', flexShrink: 0 }}>🤝</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{timeStr}{meeting.name || 'Cita'}</span>
                    </div>
                  );
                })}
                {isToday && (
                  <div className="calendar-event vapi-call" title="Llamada Activa de Valentina">
                    <span className="emoji-span" style={{ marginRight: '4px', flexShrink: 0 }}>📞</span>Demo Vapi
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Leyenda del Calendario */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', padding: '4px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--warning)', flexShrink: 0 }}></div> Reunión Agendada
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--accent)', flexShrink: 0 }}></div> Llamada Valentina
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '3px', border: '1px solid var(--accent)', background: 'rgba(13, 148, 136, 0.05)', flexShrink: 0 }}></div> Hoy
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Auxiliary Component: BrainView (Valentina's dynamic brain control panel)
   ========================================================================== */
function BrainView() {
  const [whatsappPrompt, setWhatsappPrompt] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [learnedFacts, setLearnedFacts] = useState('');
  const [vapiPrompt, setVapiPrompt] = useState('');
  const [dbMissing, setDbMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    fetchBrainSettings();
  }, []);

  const fetchBrainSettings = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/brain');
      if (res.ok) {
        const data = await res.json();
        setWhatsappPrompt(data.system_prompt_whatsapp);
        setKnowledgeBase(data.knowledge_base);
        setLearnedFacts(data.learned_facts);
        setVapiPrompt(data.system_prompt_vapi);
        setDbMissing(data.db_missing);
      }
    } catch (e) {
      console.error('Error fetching brain settings:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setSaveStatus(null);
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_prompt_whatsapp: whatsappPrompt,
          knowledge_base: knowledgeBase,
          learned_facts: learnedFacts
        })
      });

      if (res.ok) {
        setSaveStatus({ success: true, message: '¡Cerebro de Valentina guardado y sincronizado con Vapi!' });
        fetchBrainSettings();
      } else {
        const err = await res.json();
        setSaveStatus({ success: false, message: `Error al guardar: ${err.error || 'Intentalo de nuevo.'}` });
      }
    } catch (e: any) {
      setSaveStatus({ success: false, message: `Error de conexión: ${e.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleClearLearnedFacts = () => {
    if (window.confirm('¿Estás seguro de que querés borrar todos los conocimientos aprendidos de forma autónoma? Esto reseteará la memoria dinámica de Valentina.')) {
      setLearnedFacts('');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flex: 1, justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column', gap: '15px' }}>
        <div style={{ width: '40px', height: '40px', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
        <span style={{ color: 'var(--text-dim)', fontSize: '14px' }}>Cargando cerebro de Valentina...</span>
      </div>
    );
  }

  const sqlCode = `-- Crear tabla para el cerebro y configuración de Valentina
CREATE TABLE IF NOT EXISTS public.ai_brain (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insertar valores iniciales por defecto
INSERT INTO public.ai_brain (key, value)
VALUES 
('system_prompt_whatsapp', 'Eres Valentina, asesora comercial de MP Salud. Estás chateando por WhatsApp con un lead. Tu tono es amigable, profesional y muy argentino (usando voseo rioplatense: "che", "tenés", "comunicate", etc.). Tu objetivo es asesorar sobre los planes de salud, resolver dudas y agendar una llamada o video-auditoría con un asesor humano.'),
('knowledge_base', '- MP Salud ofrece planes individuales, familiares y corporativos.\\n- Cobertura nacional en clínicas de primer nivel.\\n- Precios competitivos y promociones por traspaso de obra social.'),
('learned_facts', '')
ON CONFLICT (key) DO NOTHING;

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.ai_brain ENABLE ROW LEVEL SECURITY;

-- Crear política para permitir operaciones a usuarios autenticados
CREATE POLICY "Permitir todo a usuarios autenticados" ON public.ai_brain
    FOR ALL USING (true) WITH CHECK (true);`;

  const copySql = () => {
    navigator.clipboard.writeText(sqlCode);
    alert('Código SQL copiado al portapapeles. Pegalo en tu SQL Editor de Supabase.');
  };

  return (
    <div className="brain-container">
      <div className="brain-header">
        <div>
          <h1 className="dashboard-title"><span className="emoji-span">🧠</span>Cerebro de Valentina</h1>
          <p className="dashboard-subtitle">Gestioná las instrucciones, la base de conocimientos y el aprendizaje dinámico de Valentina</p>
        </div>
      </div>

      {dbMissing && (
        <div className="db-alert-card">
          <div className="db-alert-header">
            <span className="emoji-span" style={{ fontSize: '20px', marginRight: '8px' }}>⚠️</span>
            <h3>Falta la tabla de Base de Datos en Supabase</h3>
          </div>
          <p>La tabla <code>public.ai_brain</code> no existe en Supabase. Para que el cerebro funcione y Valentina recuerde las configuraciones de WhatsApp e información comercial, ejecutá este script en tu consola de Supabase:</p>
          
          <div className="sql-box-container">
            <pre className="sql-code-block">{sqlCode}</pre>
            <button className="btn-copy-sql" type="button" onClick={copySql}>
              <span className="emoji-span" style={{ margin: 0 }}>📋</span>Copiar SQL
            </button>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
            * Ve a Supabase &gt; SQL Editor &gt; New Query &gt; Pegá el código &gt; Hacé clic en Run. Luego recargá esta página.
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="brain-form-layout">
        <div className="brain-cards-grid">
          
          {/* Tarjeta 1: Prompt de Llamadas (Solo Lectura) */}
          <div className="brain-card vapi-card">
            <div className="brain-card-header">
              <span className="card-icon"><span className="emoji-span" style={{ margin: 0, width: '1em', height: '1em' }}>📞</span></span>
              <div>
                <h4>Prompt Principal de Llamadas (Vapi)</h4>
                <span className="badge-status-read">Solo Lectura (Protegido)</span>
              </div>
            </div>
            <p className="card-description">
              Este prompt original define la personalidad de Valentina en el teléfono y está configurado directamente en Vapi. No es modificable desde aquí por seguridad del guion de gerencia.
            </p>
            <div className="textarea-wrapper" style={{ position: 'relative' }}>
              <textarea
                className="form-textarea read-only-textarea"
                value={vapiPrompt}
                readOnly
                placeholder="No se detectó prompt configurado en Vapi."
                style={{ paddingRight: '35px', color: 'var(--text-dim)', background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)', cursor: 'not-allowed' }}
              />
              <span className="lock-icon emoji-span" style={{ position: 'absolute', right: '12px', top: '12px', fontSize: '14px', margin: 0 }}>🔒</span>
            </div>
            <div className="info-helper-box" style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span className="emoji-span" style={{ marginTop: '2px', marginRight: '6px' }}>💡</span>
              <div>
                <strong>Regla de Acoplamiento:</strong> Cualquier regla o hecho aprendido agregado en las tarjetas de abajo se acoplará automáticamente al final del prompt de Vapi antes de cada llamada, manteniendo el guion principal intacto.
              </div>
            </div>
          </div>

          {/* Tarjeta 2: Prompt de WhatsApp (Editable) */}
          <div className="brain-card">
            <div className="brain-card-header">
              <span className="card-icon"><span className="emoji-span" style={{ margin: 0, width: '1em', height: '1em' }}>💬</span></span>
              <div>
                <h4>Prompt del Asistente en WhatsApp</h4>
                <span className="badge-status-edit">Editable</span>
              </div>
            </div>
            <p className="card-description">
              Instrucciones específicas sobre la personalidad, tono (voseo rioplatense) y objetivos de Valentina al chatear con clientes por WhatsApp.
            </p>
            <textarea
              className="form-textarea"
              value={whatsappPrompt}
              onChange={(e) => setWhatsappPrompt(e.target.value)}
              placeholder="Ej: Eres Valentina, asesora comercial de MP Salud..."
              required
            />
          </div>

          {/* Tarjeta 3: Base de Conocimiento Manual */}
          <div className="brain-card">
            <div className="brain-card-header">
              <span className="card-icon"><span className="emoji-span" style={{ margin: 0, width: '1em', height: '1em' }}>📚</span></span>
              <div>
                <h4>Base de Conocimiento Comercial</h4>
                <span className="badge-status-edit">Editable</span>
              </div>
            </div>
            <p className="card-description">
              Información oficial de la empresa (planes, clínicas en cartilla, precios, promociones). Es la fuente de la verdad para resolver dudas por WhatsApp y teléfono.
            </p>
            <textarea
              className="form-textarea"
              value={knowledgeBase}
              onChange={(e) => setKnowledgeBase(e.target.value)}
              placeholder="Ej: - Ofrecemos planes individuales y corporativos...&#10;- Cobertura nacional..."
              required
            />
          </div>

          {/* Tarjeta 4: Hechos Aprendidos Automáticamente */}
          <div className="brain-card learned-card">
            <div className="brain-card-header">
              <span className="card-icon"><span className="emoji-span" style={{ margin: 0, width: '1em', height: '1em' }}>⚡</span></span>
              <div>
                <h4>Conocimientos Aprendidos de Clientes</h4>
                <span className="badge-status-auto">Auto-aprendido de Transcripciones</span>
              </div>
            </div>
            <p className="card-description">
              Hechos y reglas comerciales que Valentina extrae automáticamente tras analizar las transcripciones de las llamadas finalizadas. Podés editarlos o borrarlos si cometió un error.
            </p>
            <textarea
              className="form-textarea learned-textarea"
              value={learnedFacts}
              onChange={(e) => setLearnedFacts(e.target.value)}
              placeholder="Todavía no se ha aprendido información adicional de forma automática."
            />
            {learnedFacts.trim() && (
              <button 
                type="button" 
                className="btn-clear-facts"
                onClick={handleClearLearnedFacts}
              >
                <span className="emoji-span">🗑️</span>Limpiar Hechos Aprendidos
              </button>
            )}
          </div>

        </div>

        {saveStatus && (
          <div className={`save-status-banner ${saveStatus.success ? 'success' : 'error'}`}>
            <span className="emoji-span" style={{ margin: '0 6px 0 0' }}>{saveStatus.success ? '✅' : '❌'}</span> {saveStatus.message}
          </div>
        )}

        <div className="brain-actions-footer">
          <button
            type="submit"
            className="btn-save-brain"
            disabled={saving}
          >
            {saving ? 'Sincronizando Cerebro...' : (
              <>
                <span className="emoji-span" style={{ marginRight: '6px' }}>💾</span>
                Guardar y Sincronizar Valentina
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
