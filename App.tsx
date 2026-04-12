/**
 * Quran Reciter App
 * On-device Arabic speech-to-text using Whisper
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RecorderScreen from './src/screens/RecorderScreen';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      <RecorderScreen />
    </SafeAreaProvider>
  );
}

export default App;
