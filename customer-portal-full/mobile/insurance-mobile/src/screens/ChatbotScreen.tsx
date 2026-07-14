import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { api } from '../services/api';

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

export default function ChatbotScreen() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '0', text: 'Hello! I\'m InsureBot. I can help you with policy inquiries, claims status, premium calculations, and coverage recommendations. What would you like to know?', isUser: false, timestamp: new Date() },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg: Message = { id: Date.now().toString(), text: input.trim(), isUser: true, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const resp = await api.mutate('ai.chat', { message: input.trim() });
      const botMsg: Message = { id: (Date.now() + 1).toString(), text: resp?.response || 'I apologize, I could not process that request.', isUser: false, timestamp: new Date() };
      setMessages(prev => [...prev, botMsg]);
    } catch {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: 'Sorry, I\'m having trouble connecting. Please try again.', isUser: false, timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={s.title}>InsureBot Assistant</Text>
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        style={s.list}
        renderItem={({ item }) => (
          <View style={[s.bubble, item.isUser ? s.userBubble : s.botBubble]}>
            <Text style={[s.bubbleText, item.isUser ? s.userText : s.botText]}>{item.text}</Text>
          </View>
        )}
      />
      <View style={s.inputRow}>
        <TextInput style={s.input} value={input} onChangeText={setInput} placeholder="Ask about your insurance..." placeholderTextColor="#94a3b8" onSubmitEditing={sendMessage} />
        <TouchableOpacity style={[s.sendBtn, loading && s.sendBtnDisabled]} onPress={sendMessage} disabled={loading}>
          <Text style={s.sendText}>{loading ? '...' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  title: { fontSize: 20, fontWeight: '700', color: '#1e293b', padding: 16, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  list: { flex: 1, padding: 16 },
  bubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginBottom: 8 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#2563eb' },
  botBubble: { alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0' },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  userText: { color: '#fff' },
  botText: { color: '#1e293b' },
  inputRow: { flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0', backgroundColor: '#fff' },
  input: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#1e293b' },
  sendBtn: { marginLeft: 8, backgroundColor: '#2563eb', borderRadius: 24, paddingHorizontal: 20, justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
