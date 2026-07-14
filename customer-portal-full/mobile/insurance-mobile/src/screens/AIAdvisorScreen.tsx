import React, { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  suggestions?: string[];
  timestamp: string;
}

export default function AIAdvisorScreen() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', content: 'Hello! I\'m your InsurePortal AI advisor. How can I help you today?', suggestions: ['Check my policy', 'File a claim', 'Get a quote'], timestamp: new Date().toISOString() },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const sendMessage = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: messageText, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/v1/advisor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: 'mobile-user', message: messageText, language: 'en' }),
      });
      const data = await response.json();
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        suggestions: data.suggestions,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: 'I\'m offline right now. Your message has been saved and will be processed when you\'re back online.', timestamp: new Date().toISOString() }]);
    }
    setLoading(false);
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <View style={[styles.messageBubble, item.role === 'user' ? styles.userBubble : styles.aiBubble]}>
      <Text style={[styles.messageText, item.role === 'user' && styles.userText]}>{item.content}</Text>
      {item.suggestions && (
        <View style={styles.suggestions}>
          {item.suggestions.map((s, i) => (
            <TouchableOpacity key={i} style={styles.suggestionChip} onPress={() => sendMessage(s)}>
              <Text style={styles.suggestionText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AI Insurance Advisor</Text>
        <Text style={styles.headerSubtitle}>Ask me anything about your insurance</Text>
      </View>
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        style={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
      />
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type your question..."
          onSubmitEditing={() => sendMessage()}
          editable={!loading}
        />
        <TouchableOpacity style={styles.sendButton} onPress={() => sendMessage()} disabled={loading || !input.trim()}>
          <Text style={styles.sendButtonText}>{loading ? '...' : '→'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { padding: 16, backgroundColor: '#1a56db', paddingTop: 48 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  headerSubtitle: { fontSize: 14, color: '#e0e0ff', marginTop: 4 },
  messageList: { flex: 1, padding: 16 },
  messageBubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginBottom: 8 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#1a56db' },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0e0e0' },
  messageText: { fontSize: 15, lineHeight: 22, color: '#333' },
  userText: { color: '#fff' },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 6 },
  suggestionChip: { backgroundColor: '#e8f0fe', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  suggestionText: { fontSize: 13, color: '#1a56db' },
  inputContainer: { flexDirection: 'row', padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e0e0e0' },
  input: { flex: 1, height: 44, borderWidth: 1, borderColor: '#ddd', borderRadius: 22, paddingHorizontal: 16, fontSize: 15 },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1a56db', justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  sendButtonText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
});
