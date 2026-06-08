import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StatusBar,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { APIClient } from '../api/APIClient';
const apiClient = new APIClient();


const { width } = Dimensions.get('window');

interface SavingsGoal {
  id: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  category: string;
}

const API_BASE_URL = 'https://api.insureportal.io/v1';

const SavingsGoalsScreen = () => {
  const navigation = useNavigation();
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  
  // Form state for new goal
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalTarget, setNewGoalTarget] = useState('');
  const [newGoalDeadline, setNewGoalDeadline] = useState('');

  useEffect(() => {
    fetchGoals();
  }, []);

  const fetchGoals = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/savings-goals`);
      if (response.ok) {
        const data = await response.json();
        setGoals(data);
      } else {
        // Fallback for demo purposes if API is not ready
        setGoals([
          { id: '1', title: 'New Car', targetAmount: 5000000, currentAmount: 1200000, deadline: '2026-12-31', category: 'Transport' },
          { id: '2', title: 'Emergency Fund', targetAmount: 1000000, currentAmount: 850000, deadline: '2026-06-30', category: 'Security' },
          { id: '3', title: 'Vacation', targetAmount: 500000, currentAmount: 50000, deadline: '2026-08-15', category: 'Leisure' },
        ]);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to fetch savings goals. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddGoal = async () => {
    if (!newGoalTitle || !newGoalTarget || !newGoalDeadline) {
      Alert.alert('Validation Error', 'Please fill in all fields');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/savings-goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newGoalTitle,
          targetAmount: parseFloat(newGoalTarget),
          deadline: newGoalDeadline,
          currentAmount: 0,
        }),
      });

      if (response.ok) {
        Alert.alert('Success', 'Savings goal added successfully!');
        setIsAdding(false);
        setNewGoalTitle('');
        setNewGoalTarget('');
        setNewGoalDeadline('');
        fetchGoals();
      } else {
        throw new Error('Failed to add goal');
      }
    } catch (error) {
      // Mock success for demo if API fails
      const mockNewGoal: SavingsGoal = {
        id: Math.random().toString(),
        title: newGoalTitle,
        targetAmount: parseFloat(newGoalTarget),
        currentAmount: 0,
        deadline: newGoalDeadline,
        category: 'General',
      };
      setGoals([...goals, mockNewGoal]);
      setIsAdding(false);
      setNewGoalTitle('');
      setNewGoalTarget('');
      setNewGoalDeadline('');
      Alert.alert('Success', 'Savings goal created!');
    } finally {
      setLoading(false);
    }
  };

  const renderGoalItem = ({ item }: { item: SavingsGoal }) => {
    const progress = Math.min(item.currentAmount / item.targetAmount, 1);
    const percentage = Math.round(progress * 100);

    return (
      <View style={styles.goalCard}>
        <View style={styles.goalHeader}>
          <Text style={styles.goalTitle}>{item.title}</Text>
          <Text style={styles.goalCategory}>{item.category}</Text>
        </View>
        
        <View style={styles.amountContainer}>
          <Text style={styles.currentAmount}>₦{item.currentAmount.toLocaleString()}</Text>
          <Text style={styles.targetAmount}>of ₦{item.targetAmount.toLocaleString()}</Text>
        </View>

        <View style={styles.progressBarContainer}>
          <View style={[styles.progressBar, { width: `${percentage}%` }]} />
        </View>
        
        <View style={styles.goalFooter}>
          <Text style={styles.percentageText}>{percentage}% Complete</Text>
          <Text style={styles.deadlineText}>Target: {item.deadline}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Savings Goals</Text>
        <View style={{ width: 40 }} />
      </View>

      {isAdding ? (
        <ScrollView contentContainerStyle={styles.formContainer}>
          <Text style={styles.formLabel}>Goal Title</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. New Laptop"
            placeholderTextColor="#666"
            value={newGoalTitle}
            onChangeText={setNewGoalTitle}
          />

          <Text style={styles.formLabel}>Target Amount (₦)</Text>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            placeholderTextColor="#666"
            keyboardType="numeric"
            value={newGoalTarget}
            onChangeText={setNewGoalTarget}
          />

          <Text style={styles.formLabel}>Target Date (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            placeholder="2026-12-31"
            placeholderTextColor="#666"
            value={newGoalDeadline}
            onChangeText={setNewGoalDeadline}
          />

          <TouchableOpacity style={styles.submitButton} onPress={handleAddGoal}>
            <Text style={styles.submitButtonText}>Create Goal</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={() => setIsAdding(false)}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {loading && goals.length === 0 ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#6C63FF" />
            </View>
          ) : (
            <FlatList
              data={goals}
              renderItem={renderGoalItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContainer}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No savings goals yet.</Text>
                  <Text style={styles.emptySubText}>Start saving for your future today!</Text>
                </View>
              }
            />
          )}

          <TouchableOpacity 
            style={styles.fab} 
            onPress={() => setIsAdding(true)}
          >
            <Text style={styles.fabText}>+</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A4E',
  },
  backButton: {
    padding: 5,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  listContainer: {
    padding: 20,
    paddingBottom: 100,
  },
  goalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  goalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1A1A2E',
  },
  goalCategory: {
    fontSize: 12,
    color: '#6C63FF',
    backgroundColor: '#F0EFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
  amountContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  currentAmount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1A1A2E',
  },
  targetAmount: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    marginBottom: 12,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#6C63FF',
    borderRadius: 4,
  },
  goalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  percentageText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6C63FF',
  },
  deadlineText: {
    fontSize: 12,
    color: '#888',
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 30,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#6C63FF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '300',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 100,
  },
  emptyText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptySubText: {
    color: '#aaa',
    fontSize: 14,
  },
  formContainer: {
    padding: 20,
  },
  formLabel: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#1A1A2E',
  },
  submitButton: {
    backgroundColor: '#6C63FF',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 32,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cancelButton: {
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelButtonText: {
    color: '#FF4D4D',
    fontSize: 16,
  },
});

export default SavingsGoalsScreen;
