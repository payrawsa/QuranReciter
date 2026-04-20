/**
 * Quran Reciter App
 * On-device Arabic speech-to-text using Whisper
 */

import React from 'react';
import { StatusBar, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RecitationScreen from './src/screens/RecitationScreen';
import { useWhisper } from './src/hooks/useWhisper';

function App() {
  const whisper = useWhisper();

  // Show loading screen while model is downloading/loading
  if (whisper.status === 'idle' || whisper.status === 'downloading' || whisper.status === 'loading') {
    const label =
      whisper.status === 'downloading'
        ? `Downloading model… ${whisper.downloadProgress?.percent ?? 0}%`
        : whisper.status === 'loading'
          ? 'Loading model…'
          : 'Initializing…';

    return (
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#5bd882" />
          <Text style={styles.loadingText}>{label}</Text>
          {whisper.error && <Text style={styles.errorText}>{whisper.error}</Text>}
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
      <RecitationScreen whisper={whisper} />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0d1117',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#8899AA',
    fontSize: 16,
    marginTop: 16,
  },
  errorText: {
    color: '#f75555',
    fontSize: 14,
    marginTop: 8,
  },
});

export default App;
